import { useState } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { supabase, type Match } from '@/lib/supabase';
import { useRosters } from '@/lib/hooks';
import { refreshAdminData } from '@/lib/adminRefresh';
import { formatClock, parseClock } from '@/lib/time';
import { FormError, FormField, FormInput, FormSelect } from '@/components/ui';
import { PRESUMED_DURATION_SECONDS, scoreFromGoals, toLocalInput, type GoalSide as Side } from '@/lib/matchRecovery';

type GoalRow = { key: number; side: Side; playerId: string; ownGoal: boolean; minute: string; assistId: string };

let nextKey = 1;
const newGoal = (side: Side): GoalRow => ({ key: nextKey++, side, playerId: '', ownGoal: false, minute: '', assistId: '' });

// Result of a match played outside the system (record_retroactive_match_result).
// Nothing is invented: empty date keeps the scheduled one, empty duration is
// stored as 14:00 and flagged as presumed, a goal may name only the team, and
// a goal without time is stored without time.
export function RetroactiveResultForm({ match, onDone }: { match: Match; onDone: () => void }) {
  const homeName = match.home_team?.team?.name ?? 'Mandante';
  const awayName = match.away_team?.team?.name ?? 'Visitante';
  const { rosters: homeRoster } = useRosters(match.home_team_id ?? undefined);
  const { rosters: awayRoster } = useRosters(match.away_team_id ?? undefined);
  const [playedAt, setPlayedAt] = useState(toLocalInput(match.scheduled_at));
  const [duration, setDuration] = useState('');
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computed = scoreFromGoals(goals);
  const expectedHome = homeScore === '' ? null : Number(homeScore);
  const expectedAway = awayScore === '' ? null : Number(awayScore);
  const rosterOf = (side: Side) => (side === 'home' ? homeRoster : awayRoster);
  const update = (key: number, patch: Partial<GoalRow>) => setGoals((current) => current.map((goal) => (goal.key === key ? { ...goal, ...patch } : goal)));

  function fillTeamOnlyGoals() {
    if (expectedHome === null || expectedAway === null) { setError('Informe o placar antes de gerar os gols.'); return; }
    setError(null);
    setGoals([...Array.from({ length: expectedHome }, () => newGoal('home')), ...Array.from({ length: expectedAway }, () => newGoal('away'))]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (expectedHome === null || expectedAway === null || !Number.isInteger(expectedHome) || !Number.isInteger(expectedAway) || expectedHome < 0 || expectedAway < 0) {
      setError('Informe o placar oficial da partida.'); return;
    }
    const durationSeconds = duration.trim() ? parseClock(duration) : null;
    if (duration.trim() && (durationSeconds === null || durationSeconds <= 0)) { setError('Informe a duração no formato m:ss ou deixe em branco.'); return; }
    const limit = durationSeconds ?? PRESUMED_DURATION_SECONDS;
    const payload = [];
    for (const goal of goals) {
      const minute = goal.minute.trim() ? parseClock(goal.minute) : null;
      if (goal.minute.trim() && (minute === null || minute > limit)) { setError(`Tempo de gol inválido: ${goal.minute}. Use m:ss dentro da duração.`); return; }
      if (goal.assistId && !goal.playerId) { setError('Assistência só pode ser registrada em gol com autor.'); return; }
      payload.push({
        team_id: goal.side === 'home' ? match.home_team_id : match.away_team_id,
        player_id: goal.playerId || null,
        is_own_goal: goal.ownGoal,
        minute_seconds: minute,
        assist_player_id: goal.ownGoal ? null : goal.assistId || null,
      });
    }
    if (computed.home !== expectedHome || computed.away !== expectedAway) {
      setError(`Os gols informados resultam em ${computed.home} × ${computed.away}, mas o placar oficial é ${expectedHome} × ${expectedAway}.`); return;
    }
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc('record_retroactive_match_result', {
      p_match_id: match.id,
      p_played_at: playedAt ? new Date(playedAt).toISOString() : null,
      p_duration_seconds: durationSeconds,
      p_goals: payload,
      p_expected_home_score: expectedHome,
      p_expected_away_score: expectedAway,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Não foi possível registrar o resultado. Nada foi alterado.'); return; }
    refreshAdminData();
    onDone();
  }

  return (
    <form onSubmit={save} className="retro-form">
      <p className="admin-hint">
        Para jogos já disputados fora do sistema. A partida é finalizada de uma só vez e alimenta classificação e estatísticas.
        Gols sem autor contam no placar e na classificação, mas não na artilharia.
      </p>
      <FormField label="Data e hora em que foi disputada (horário de Brasília)">
        <FormInput type="datetime-local" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} />
      </FormField>
      <FormField label="Duração (m:ss)">
        <FormInput value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={`Em branco: ${formatClock(PRESUMED_DURATION_SECONDS)} presumidos`} />
      </FormField>
      <div className="retro-score">
        <FormField label={`Gols de ${homeName}`}><FormInput type="number" min={0} value={homeScore} onChange={(e) => setHomeScore(e.target.value)} required /></FormField>
        <FormField label={`Gols de ${awayName}`}><FormInput type="number" min={0} value={awayScore} onChange={(e) => setAwayScore(e.target.value)} required /></FormField>
      </div>

      <div className="retro-goals-header">
        <strong>Gols ({computed.home} × {computed.away})</strong>
        <div>
          <button type="button" className="button button-outline" onClick={fillTeamOnlyGoals}>Gols sem autor pelo placar</button>
          <button type="button" className="icon-button" onClick={() => setGoals((current) => [...current, newGoal('home')])} title="Adicionar gol"><Plus size={15} /></button>
        </div>
      </div>
      {goals.length === 0 && <p className="admin-empty-text">Nenhum gol informado. Um 0 × 0 não precisa de gols.</p>}
      {goals.map((goal) => {
        const roster = rosterOf(goal.side);
        return (
          <div key={goal.key} className="retro-goal">
            <div className="retro-goal-line">
            <FormSelect value={goal.side} onChange={(e) => update(goal.key, { side: e.target.value as Side, playerId: '', assistId: '' })} aria-label="Equipe do autor">
              <option value="home">{homeName}</option>
              <option value="away">{awayName}</option>
            </FormSelect>
            <FormSelect value={goal.playerId} onChange={(e) => update(goal.key, { playerId: e.target.value })} aria-label="Autor do gol">
              <option value="">Sem autor (só a equipe)</option>
              {roster.map((item) => <option key={item.player_id} value={item.player_id}>{item.player?.nickname ?? 'Jogador'}</option>)}
            </FormSelect>
            </div>
            <div className="retro-goal-line">
            <FormSelect value={goal.assistId} disabled={goal.ownGoal || !goal.playerId} onChange={(e) => update(goal.key, { assistId: e.target.value })} aria-label="Assistência">
              <option value="">Sem assistência</option>
              {roster.filter((item) => item.player_id !== goal.playerId).map((item) => <option key={item.player_id} value={item.player_id}>{item.player?.nickname ?? 'Jogador'}</option>)}
            </FormSelect>
            <FormInput value={goal.minute} onChange={(e) => update(goal.key, { minute: e.target.value })} placeholder="Tempo (opcional)" aria-label="Tempo do gol" />
            <label className="form-check"><input type="checkbox" checked={goal.ownGoal} onChange={(e) => update(goal.key, { ownGoal: e.target.checked, assistId: '' })} /> <span>Gol contra</span></label>
            <button type="button" className="icon-button" onClick={() => setGoals((current) => current.filter((item) => item.key !== goal.key))} title="Remover gol"><Trash2 size={14} /></button>
            </div>
          </div>
        );
      })}
      {(homeRoster.length === 0 || awayRoster.length === 0) && (
        <p className="admin-hint">Uma das equipes ainda não tem elenco nesta temporada: os gols dela ficam registrados só com a equipe.</p>
      )}
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Registrando...' : 'Registrar resultado'} <ArrowRight size={16} /></button>
    </form>
  );
}

// Dates of every match of a round at once. Only scheduled or postponed
// matches can be re-dated (the database locks the date after kick-off).
export function RoundScheduleForm({ matches, onDone }: { matches: Match[]; onDone: () => void }) {
  const editable = matches.filter((match) => match.status === 'SCHEDULED' || match.status === 'POSTPONED');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(editable.map((match) => [match.id, toLocalInput(match.scheduled_at)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const changed = editable.filter((match) => values[match.id] !== toLocalInput(match.scheduled_at));
    if (!changed.length) { onDone(); return; }
    setBusy(true); setError(null);
    const failures: string[] = [];
    for (const match of changed) {
      const { error: updateError } = await supabase.from('matches')
        .update({ scheduled_at: values[match.id] ? new Date(values[match.id]).toISOString() : null })
        .eq('id', match.id);
      if (updateError) failures.push(`${match.home_team?.team?.name ?? '—'} × ${match.away_team?.team?.name ?? '—'}`);
    }
    setBusy(false);
    refreshAdminData();
    if (failures.length) { setError(`Não foi possível salvar: ${failures.join(', ')}. As demais datas foram salvas.`); return; }
    onDone();
  }

  return (
    <form onSubmit={save}>
      <p className="admin-hint">Horário de Brasília. Deixe em branco para “a definir”. Partidas ao vivo, finalizadas ou canceladas não mudam de data.</p>
      {editable.length === 0 && <p className="admin-empty-text">Nenhuma partida desta rodada pode ter a data alterada.</p>}
      {editable.map((match) => (
        <FormField key={match.id} label={`${match.home_team?.team?.name ?? '—'} × ${match.away_team?.team?.name ?? '—'}`}>
          <FormInput type="datetime-local" value={values[match.id] ?? ''} onChange={(e) => setValues((current) => ({ ...current, [match.id]: e.target.value }))} />
        </FormField>
      ))}
      <FormError message={error} />
      <button className="button button-primary" disabled={busy || editable.length === 0}>{busy ? 'Salvando...' : 'Salvar datas'} <ArrowRight size={16} /></button>
    </form>
  );
}
