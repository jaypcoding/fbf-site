import { useEffect, useState } from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import { supabase, type Match, type SeasonTeam } from '@/lib/supabase';
import { useManagedCompetitions, useSeasons, useStages, useRounds, useMatches, useSeasonTeams } from '@/lib/hooks';
import { matchStatusLabels } from '@/lib/labels';
import { availableMatchStatuses } from '@/lib/matchRules';
import { LoadingCard, Modal, FormField, FormInput, FormSelect, FormError } from '@/components/ui';
import { formatClock, parseClock } from '@/lib/time';
import { refreshAdminData } from '@/lib/adminRefresh';

type MatchStatus = Match['status'];

const statusOptions = (Object.keys(matchStatusLabels) as MatchStatus[]).map((value) => ({ value, label: matchStatusLabels[value] }));

function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Data a definir';
}

function teamName(st?: SeasonTeam) {
  return st?.team?.name || '—';
}

export function MatchesTab() {
  const { competitions, error: competitionsError } = useManagedCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { stages } = useStages(selectedSeason || undefined);
  const [selectedStage, setSelectedStage] = useState('');
  const { rounds } = useRounds(selectedStage || undefined);
  const [selectedRound, setSelectedRound] = useState('');
  const { matches, loading, error: matchesError } = useMatches(selectedRound || undefined);
  const { seasonTeams, error: seasonTeamsError } = useSeasonTeams(selectedSeason || undefined);
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Match | null>(null);

  useEffect(() => {
    if (!selectedComp && competitions.length > 0) setSelectedComp(competitions[0].id);
  }, [competitions, selectedComp]);
  useEffect(() => {
    if (!selectedSeason && seasons.length > 0) setSelectedSeason(seasons[0].id);
  }, [seasons, selectedSeason]);
  useEffect(() => {
    if (!selectedStage && stages.length > 0) setSelectedStage(stages[0].id);
  }, [stages, selectedStage]);
  useEffect(() => {
    if (!selectedRound && rounds.length > 0) setSelectedRound(rounds[0].id);
  }, [rounds, selectedRound]);

  async function createMatch(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRound || !homeTeam || !awayTeam) { setError('Selecione a rodada e os dois times.'); return; }
    if (homeTeam === awayTeam) { setError('Um time não pode jogar contra ele mesmo.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('matches').insert({
      round_id: selectedRound,
      home_team_id: homeTeam,
      away_team_id: awayTeam,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });
    setBusy(false);
    if (err) { setError('Não foi possível criar a partida.'); return; }
    setHomeTeam(''); setAwayTeam(''); setScheduledAt('');
    refreshAdminData();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Nova partida</h3>
        <form onSubmit={createMatch}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(e) => { setSelectedComp(e.target.value); setSelectedSeason(''); setSelectedStage(''); setSelectedRound(''); }}>
              <option value="">Selecione...</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Temporada">
            <FormSelect value={selectedSeason} onChange={(e) => { setSelectedSeason(e.target.value); setSelectedStage(''); setSelectedRound(''); }} disabled={!seasons.length}>
              <option value="">Selecione...</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Fase">
            <FormSelect value={selectedStage} onChange={(e) => { setSelectedStage(e.target.value); setSelectedRound(''); }} disabled={!stages.length}>
              <option value="">Selecione...</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Rodada">
            <FormSelect value={selectedRound} onChange={(e) => setSelectedRound(e.target.value)} disabled={!rounds.length}>
              <option value="">Selecione...</option>
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Mandante">
            <FormSelect value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} disabled={!seasonTeams.length}>
              <option value="">Selecione...</option>
              {seasonTeams.map((st) => <option key={st.id} value={st.id}>{teamName(st)}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Visitante">
            <FormSelect value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} disabled={!seasonTeams.length}>
              <option value="">Selecione...</option>
              {seasonTeams.map((st) => <option key={st.id} value={st.id}>{teamName(st)}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Data e hora">
            <FormInput type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </FormField>
          <FormError message={error || (competitionsError ? 'Não foi possível carregar as competições autorizadas.' : null)} />
          <button className="button button-primary" disabled={busy || !selectedRound}>{busy ? 'Aguarde...' : 'Criar partida'} <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Partidas da rodada</h3>
        {matchesError || seasonTeamsError ? <FormError message="Não foi possível carregar as partidas ou as equipes inscritas. Verifique suas permissões e tente novamente." /> : loading ? <LoadingCard /> : !selectedRound ? <p className="admin-empty-text">Selecione uma rodada para ver as partidas.</p> : matches.length === 0 ? <p className="admin-empty-text">Nenhuma partida nesta rodada.</p> : (
          <div className="admin-list">
            {matches.map((m) => (
              <MatchRow key={m.id} match={m} onEdit={() => setEditing(m)} />
            ))}
          </div>
        )}
      </div>
      {editing && (
        <Modal title="Editar partida" onClose={() => setEditing(null)}>
          <MatchEditForm match={editing} seasonTeams={seasonTeams} onSaved={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function MatchRow({ match, onEdit }: { match: Match; onEdit: () => void }) {
  const [statusValue, setStatusValue] = useState<MatchStatus>(match.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(value: MatchStatus) {
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('matches').update({ status: value }).eq('id', match.id);
    setBusy(false);
    if (err) { setError('Não foi possível mudar o status.'); return; }
    setStatusValue(value);
    refreshAdminData();
  }

  return (
    <div className="admin-list-item admin-match-row">
      <div className="admin-match-teams">
        <span>{teamName(match.home_team)}</span>
        <span className="match-vs">vs</span>
        <span>{teamName(match.away_team)}</span>
      </div>
      <span>{formatDate(match.scheduled_at)}</span>
      <div className="admin-match-score">
        <span>{match.home_score ?? '—'}</span>
        <span>×</span>
        <span>{match.away_score ?? '—'}</span>
        {match.home_penalty_score !== null && match.away_penalty_score !== null && (
          <small>(Pên. {match.home_penalty_score}×{match.away_penalty_score})</small>
        )}
      </div>
      <FormError message={error} />
      <div className="admin-match-actions">
        <FormSelect value={statusValue} disabled={busy} onChange={(e) => changeStatus(e.target.value as MatchStatus)} aria-label="Status da partida">
          {statusOptions.filter((option) => availableMatchStatuses(statusValue).includes(option.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </FormSelect>
        <button className="icon-button" onClick={onEdit} title="Editar partida"><Pencil size={15} /></button>
      </div>
    </div>
  );
}

function MatchEditForm({ match, seasonTeams, onSaved }: { match: Match; seasonTeams: SeasonTeam[]; onSaved: () => void }) {
  const [homeTeam, setHomeTeam] = useState(match.home_team_id ?? '');
  const [awayTeam, setAwayTeam] = useState(match.away_team_id ?? '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(match.scheduled_at));
  const [duration, setDuration] = useState(match.duration_seconds !== null ? formatClock(match.duration_seconds) : '');
  const [status, setStatus] = useState<MatchStatus>(match.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!homeTeam || !awayTeam) { setError('Selecione os dois times.'); return; }
    if (homeTeam === awayTeam) { setError('Um time não pode jogar contra ele mesmo.'); return; }
    const durationSeconds = duration.trim() ? parseClock(duration) : null;
    if (duration.trim() && (durationSeconds === null || durationSeconds <= 0)) { setError('Informe uma duração maior que zero no formato m:ss.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('matches').update({
      home_team_id: homeTeam,
      away_team_id: awayTeam,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      duration_seconds: durationSeconds,
      status,
    }).eq('id', match.id);
    setBusy(false);
    if (err) { setError('Não foi possível salvar as alterações.'); return; }
    refreshAdminData();
    onSaved();
  }

  return (
    <form onSubmit={save}>
      <FormField label="Mandante">
        <FormSelect value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)}>
          {seasonTeams.map((st) => <option key={st.id} value={st.id}>{teamName(st)}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Visitante">
        <FormSelect value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)}>
          {seasonTeams.map((st) => <option key={st.id} value={st.id}>{teamName(st)}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Data e hora">
        <FormInput type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
      </FormField>
      <FormField label="Duração real da partida (m:ss)">
        <FormInput value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Informe para calcular o CS até o apito final" />
      </FormField>
      <FormField label="Status">
        <FormSelect value={status} onChange={(e) => setStatus(e.target.value as MatchStatus)}>
          {statusOptions.filter((option) => availableMatchStatuses(match.status).includes(option.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </FormSelect>
      </FormField>
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Salvar alterações'} <ArrowRight size={16} /></button>
    </form>
  );
}
