import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, CalendarClock, FileVideo, Lock, MoveRight, Save } from 'lucide-react';
import { supabase, type Match } from '@/lib/supabase';
import { useManagedCompetitions, useRounds, useSeasons, useStageMatches, useStages } from '@/lib/hooks';
import { matchStatusLabels } from '@/lib/labels';
import { formatMatchDate } from '@/lib/format';
import { toLocalInput } from '@/lib/matchRecovery';
import { refreshAdminData } from '@/lib/adminRefresh';
import {
  buildRoundsView,
  isEditableMatch,
  matchAttention,
  mirrorMatch,
  roundStateLabels,
  summarizeMatches,
  type GroupOfTeam,
  type MatchAttention,
  type RoundInfo,
} from '@/lib/roundsView';
import { FormError, FormField, FormInput, FormSelect, LoadingCard, Modal } from '@/components/ui';
import { RoundScheduleForm } from './MatchRecoveryForms';

type Filter = 'all' | 'pending' | 'undated' | 'locked';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'pending', label: 'Sem resultado (data passada)' },
  { id: 'undated', label: 'Sem data' },
  { id: 'locked', label: 'Disputadas / encerradas' },
];
const attentionLabels: Record<MatchAttention, string> = {
  locked: 'Protegida',
  overdue: 'Sem resultado',
  undated: 'Sem data',
  ok: 'Agendada',
};

const teamName = (match: Match, side: 'home' | 'away') => (side === 'home' ? match.home_team : match.away_team)?.team?.name ?? 'A definir';

// Database messages of the integrity triggers are already in Portuguese and
// say exactly what is wrong (team twice in a round, pairing repeated in the
// leg, match already started...). Anything else gets a generic message.
function describeError(error: { code?: string; message?: string } | null): string {
  if (!error) return 'Não foi possível salvar.';
  if ((error.code === '23514' || error.code === 'P0001' || error.code === '23505') && error.message) {
    return error.code === '23505' ? 'Esse confronto já existe nesta fase e turno.' : error.message;
  }
  return 'Não foi possível salvar. Verifique suas permissões e tente novamente.';
}

// Only scheduled/postponed matches are touched: the filter makes a stale
// screen unable to change a match that has started or finished meanwhile.
async function updateEditable(matchId: string, values: Record<string, unknown>) {
  const { data, error } = await supabase.from('matches').update(values).eq('id', matchId).in('status', ['SCHEDULED', 'POSTPONED']).select('id');
  if (error) return describeError(error);
  if (!data || data.length === 0) return 'A partida já começou ou foi encerrada; atualize a página.';
  return null;
}

export function RoundsAdminTab() {
  const { competitions, error: competitionsError } = useManagedCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { stages } = useStages(selectedSeason || undefined);
  const [selectedStage, setSelectedStage] = useState('');
  const { rounds, loading: roundsLoading } = useRounds(selectedStage || undefined);
  const roundIds = useMemo(() => rounds.map((round) => round.id), [rounds]);
  const { matches, loading: matchesLoading, error: matchesError } = useStageMatches(roundIds);
  const [groupOf, setGroupOf] = useState<GroupOfTeam>(new Map());
  const [filter, setFilter] = useState<Filter>('all');
  const [scheduling, setScheduling] = useState<Match[] | null>(null);
  const [swapping, setSwapping] = useState<Match | null>(null);
  const [moving, setMoving] = useState<Match | null>(null);
  const now = Date.now();

  useEffect(() => { if (!selectedComp && competitions.length > 0) setSelectedComp(competitions[0].id); }, [competitions, selectedComp]);
  useEffect(() => { if (!selectedSeason && seasons.length > 0) setSelectedSeason(seasons[0].id); }, [seasons, selectedSeason]);
  useEffect(() => { if (!selectedStage && stages.length > 0) setSelectedStage(stages[0].id); }, [stages, selectedStage]);
  useEffect(() => {
    let active = true;
    if (!selectedStage) { setGroupOf(new Map()); return () => { active = false; }; }
    Promise.all([
      supabase.from('stage_groups').select('id, name, group_order').eq('stage_id', selectedStage),
      supabase.from('stage_group_teams').select('stage_group_id, season_team_id').eq('stage_id', selectedStage),
    ]).then(([groups, members]) => {
      if (!active) return;
      const meta = new Map(((groups.data || []) as { id: string; name: string; group_order: number }[]).map((g) => [g.id, g]));
      const map: GroupOfTeam = new Map();
      for (const row of (members.data || []) as { stage_group_id: string; season_team_id: string }[]) {
        const group = meta.get(row.stage_group_id);
        if (group) map.set(row.season_team_id, { name: group.name, order: group.group_order });
      }
      setGroupOf(map);
    });
    return () => { active = false; };
  }, [selectedStage]);

  const roundInfos = rounds as unknown as RoundInfo[];
  const views = useMemo(() => buildRoundsView(roundInfos, matches, { groupOf }), [roundInfos, matches, groupOf]);
  const summary = summarizeMatches(matches, now);
  const visible = (match: Match) => {
    const attention = matchAttention(match, now);
    if (filter === 'pending') return attention === 'overdue';
    if (filter === 'undated') return attention === 'undated';
    if (filter === 'locked') return attention === 'locked';
    return true;
  };

  return (
    <div className="admin-rounds">
      <div className="admin-form-card admin-rounds-filters">
        <h3>Rodadas da competição</h3>
        <div className="admin-rounds-selects">
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(e) => { setSelectedComp(e.target.value); setSelectedSeason(''); setSelectedStage(''); }}>
              <option value="">Selecione...</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Temporada">
            <FormSelect value={selectedSeason} onChange={(e) => { setSelectedSeason(e.target.value); setSelectedStage(''); }} disabled={!seasons.length}>
              <option value="">Selecione...</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Fase">
            <FormSelect value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)} disabled={!stages.length}>
              <option value="">Selecione...</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect>
          </FormField>
        </div>
        <FormError message={competitionsError ? 'Não foi possível carregar as competições autorizadas.' : null} />
        {matches.length > 0 && (
          <div className="admin-rounds-summary" aria-label="Resumo das partidas">
            <span><strong>{summary.total}</strong> partidas</span>
            <span><strong>{summary.finished}</strong> encerradas</span>
            {summary.live > 0 && <span className="is-live"><strong>{summary.live}</strong> ao vivo</span>}
            <span className={summary.overdue ? 'is-warning' : ''}><strong>{summary.overdue}</strong> sem resultado</span>
            <span><strong>{summary.undated}</strong> sem data</span>
            <span><strong>{summary.upcoming}</strong> futuras</span>
          </div>
        )}
        <div className="admin-rounds-filter-row" role="group" aria-label="Filtrar partidas">
          {FILTERS.map((item) => (
            <button key={item.id} type="button" className={`round-chip${filter === item.id ? ' active' : ''}`} onClick={() => setFilter(item.id)}>{item.label}</button>
          ))}
        </div>
        <p className="admin-hint">Partidas ao vivo, finalizadas ou canceladas ficam protegidas: o confronto, a rodada e a data não podem mais ser alterados (o banco recusa). Resultados e eventos são registrados nas abas Partidas e Eventos.</p>
      </div>

      {!selectedStage ? <p className="admin-empty-text">Selecione uma fase para ver as rodadas.</p>
        : roundsLoading || matchesLoading ? <LoadingCard />
        : matchesError ? <FormError message="Não foi possível carregar as partidas desta fase." />
        : views.length === 0 ? <p className="admin-empty-text">Esta fase ainda não tem rodadas. Gere a tabela em Fases & Rodadas.</p>
        : views.map((view) => {
          const shown = view.matches.filter(({ match }) => visible(match as Match));
          if (filter !== 'all' && shown.length === 0) return null;
          return (
            <div className="admin-list-card admin-round-card" key={view.round.id}>
              <div className="admin-list-heading">
                <h3>{view.label} <span className={`round-state state-${view.state}`}>{roundStateLabels[view.state]}</span></h3>
                <span className="admin-round-count">{view.finished}/{view.total} encerradas{view.round.leg_number ? ` · ${view.round.leg_number === 2 ? 'returno' : 'turno'}` : ''}</span>
                {view.matches.some(({ match }) => isEditableMatch(match)) && (
                  <button type="button" className="button button-outline" onClick={() => setScheduling(view.matches.map(({ match }) => match as Match))}><CalendarClock size={15} /> Datas da rodada</button>
                )}
              </div>
              {view.total === 0 ? <p className="admin-empty-text">Nenhuma partida nesta rodada.</p> : (
                <div className="admin-list">
                  {shown.map(({ match, group }) => {
                    const m = match as Match;
                    const attention = matchAttention(m, now);
                    const editable = isEditableMatch(m);
                    return (
                      <div className={`admin-list-item admin-round-match attention-${attention}`} key={m.id}>
                        <span className="admin-round-group">{group ?? ''}</span>
                        <span className="admin-round-teams"><strong>{teamName(m, 'home')}</strong> <span className="match-vs">×</span> <strong>{teamName(m, 'away')}</strong></span>
                        <span className="admin-round-score">{m.home_score !== null && m.away_score !== null && m.status !== 'SCHEDULED' ? `${m.home_score} × ${m.away_score}` : '—'}</span>
                        <span className="admin-round-date">{formatMatchDate(m.scheduled_at)}</span>
                        <span className={`match-status-tag tag-${m.status.toLowerCase()}`}>{matchStatusLabels[m.status]}</span>
                        <span className={`admin-attention attention-${attention}`}>{attention === 'locked' && <Lock size={11} />} {attentionLabels[attention]}</span>
                        {editable ? (
                          <span className="admin-round-actions">
                            <MatchDateInline match={m} />
                            <button type="button" className="icon-button" title="Inverter mando" aria-label="Inverter mando" onClick={() => setSwapping(m)}><ArrowLeftRight size={15} /></button>
                            <button type="button" className="icon-button" title="Mover para outra rodada" aria-label="Mover para outra rodada" onClick={() => setMoving(m)}><MoveRight size={15} /></button>
                            <Link className="icon-button" to={`/painel?sumula=${m.id}`} title="Gravação e validação da partida" aria-label="Gravação e validação da partida"><FileVideo size={15} /></Link>
                          </span>
                        ) : <span className="admin-round-actions"><Link className="icon-button" to={`/painel?sumula=${m.id}`} title="Gravação e súmula da partida" aria-label="Gravação e súmula da partida"><FileVideo size={15} /></Link></span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

      {scheduling && (
        <Modal title="Datas da rodada" onClose={() => setScheduling(null)}>
          <RoundScheduleForm matches={scheduling} onDone={() => setScheduling(null)} />
        </Modal>
      )}
      {swapping && (
        <Modal title="Inverter mando" onClose={() => setSwapping(null)}>
          <SwapHomeForm match={swapping} mirror={mirrorMatch(swapping, matches, roundInfos)} onDone={() => setSwapping(null)} />
        </Modal>
      )}
      {moving && (
        <Modal title="Mover partida" onClose={() => setMoving(null)}>
          <MoveMatchForm match={moving} rounds={roundInfos} onDone={() => setMoving(null)} />
        </Modal>
      )}
    </div>
  );
}

function MatchDateInline({ match }: { match: Match }) {
  const [value, setValue] = useState(toLocalInput(match.scheduled_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = value !== toLocalInput(match.scheduled_at);
  async function save() {
    setBusy(true); setError(null);
    const message = await updateEditable(match.id, { scheduled_at: value ? new Date(value).toISOString() : null });
    setBusy(false);
    if (message) { setError(message); return; }
    refreshAdminData();
  }
  return (
    <span className="admin-round-date-edit">
      <FormInput type="datetime-local" aria-label="Data e hora (Brasília)" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" className="icon-button" title="Salvar data" aria-label="Salvar data" disabled={!changed || busy} onClick={save}><Save size={15} /></button>
      {error && <FormError message={error} />}
    </span>
  );
}

function SwapHomeForm({ match, mirror, onDone }: { match: Match; mirror: Match | null; onDone: () => void }) {
  const mirrorEditable = Boolean(mirror && isEditableMatch(mirror));
  const [withMirror, setWithMirror] = useState(mirrorEditable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true); setError(null);
    const message = await updateEditable(match.id, { home_team_id: match.away_team_id, away_team_id: match.home_team_id });
    if (message) { setBusy(false); setError(message); return; }
    if (withMirror && mirror) {
      const mirrorMessage = await updateEditable(mirror.id, { home_team_id: mirror.away_team_id, away_team_id: mirror.home_team_id });
      if (mirrorMessage) { setBusy(false); refreshAdminData(); setError(`O mando desta partida foi invertido, mas o do jogo de volta não: ${mirrorMessage}`); return; }
    }
    setBusy(false);
    refreshAdminData();
    onDone();
  }
  return (
    <div>
      <p>Hoje: <strong>{teamName(match, 'home')}</strong> (mandante) × <strong>{teamName(match, 'away')}</strong>.</p>
      <p>Depois: <strong>{teamName(match, 'away')}</strong> (mandante) × <strong>{teamName(match, 'home')}</strong>.</p>
      {mirror ? (
        <label className="admin-check">
          <input type="checkbox" checked={withMirror} disabled={!mirrorEditable} onChange={(e) => setWithMirror(e.target.checked)} />
          Inverter também o jogo de volta ({mirror.round?.name ?? 'outro turno'}: {teamName(mirror, 'home')} × {teamName(mirror, 'away')}){!mirrorEditable ? ' — já disputado, não pode mudar' : ''}
        </label>
      ) : <p className="admin-empty-text">Não há jogo de volta deste confronto nesta fase.</p>}
      {mirror && !withMirror && <p className="admin-hint">Sem inverter o jogo de volta, os dois jogos do confronto ficam com o mesmo mandante.</p>}
      <FormError message={error} />
      <div className="deletion-actions">
        <button type="button" className="button button-outline" onClick={onDone}>Cancelar</button>
        <button type="button" className="button button-primary" disabled={busy} onClick={confirm}>{busy ? 'Aguarde...' : 'Confirmar inversão'}</button>
      </div>
    </div>
  );
}

function MoveMatchForm({ match, rounds, onDone }: { match: Match; rounds: RoundInfo[]; onDone: () => void }) {
  const current = rounds.find((round) => round.id === match.round_id);
  const options = rounds.filter((round) => round.id !== match.round_id && round.phase_type === current?.phase_type);
  const [target, setTarget] = useState(options[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    if (!target) return;
    setBusy(true); setError(null);
    const message = await updateEditable(match.id, { round_id: target });
    setBusy(false);
    if (message) { setError(message); return; }
    refreshAdminData();
    onDone();
  }
  return (
    <div>
      <p><strong>{teamName(match, 'home')}</strong> × <strong>{teamName(match, 'away')}</strong>, hoje na {current?.name ?? 'rodada atual'}.</p>
      {options.length === 0 ? <p className="admin-empty-text">Não há outra rodada compatível nesta fase.</p> : (
        <FormField label="Mover para">
          <FormSelect value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((round) => <option key={round.id} value={round.id}>{[round.stage_group?.name, round.name].filter(Boolean).join(' · ')}{round.leg_number ? ` (${round.leg_number === 2 ? 'returno' : 'turno'})` : ''}</option>)}
          </FormSelect>
        </FormField>
      )}
      <p className="admin-hint">O banco confere a mudança: uma equipe não pode jogar duas vezes na mesma rodada, e o confronto não pode se repetir no mesmo turno.</p>
      <FormError message={error} />
      <div className="deletion-actions">
        <button type="button" className="button button-outline" onClick={onDone}>Cancelar</button>
        <button type="button" className="button button-primary" disabled={busy || !target} onClick={confirm}>{busy ? 'Aguarde...' : 'Mover partida'}</button>
      </div>
    </div>
  );
}
