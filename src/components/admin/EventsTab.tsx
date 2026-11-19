import { useEffect, useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { supabase, type Match, type MatchEvent } from '@/lib/supabase';
import { useManagedCompetitions, useSeasons, useStages, useRounds, useMatches, useMatchEvents, useRosters, useGoalkeeperParticipations } from '@/lib/hooks';
import { parseClock, formatClock } from '@/lib/time';
import { refreshAdminData } from '@/lib/adminRefresh';
import { LoadingCard, FormField, FormInput, FormSelect, FormError } from '@/components/ui';

type EventType = MatchEvent['event_type'];

const eventTypeLabels: Record<EventType, string> = {
  GOAL: 'Gol',
  ASSIST: 'Assistência',
  SUBSTITUTION: 'Substituição',
  GOALKEEPER_IN: 'Goleiro entrou',
  GOALKEEPER_OUT: 'Goleiro saiu',
};

const periodLabels = {
  REGULATION: 'Tempo normal',
  // A FBF não tem prorrogação nem pênaltis: o período extra é o gol de ouro
  // do mata-mata. PENALTY_SHOOTOUT só é rotulado para exibir registros antigos.
  EXTRA_TIME: 'Gol de ouro (mata-mata)',
  PENALTY_SHOOTOUT: 'Pênaltis (registro antigo)',
} as const;

export function EventsTab() {
  const { competitions, error: competitionsError } = useManagedCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons, error: seasonsError } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { stages, error: stagesError } = useStages(selectedSeason || undefined);
  const [selectedStage, setSelectedStage] = useState('');
  const { rounds, error: roundsError } = useRounds(selectedStage || undefined);
  const [selectedRound, setSelectedRound] = useState('');
  const { matches, error: matchesError } = useMatches(selectedRound || undefined);
  const [selectedMatch, setSelectedMatch] = useState('');
  const match = matches.find((m) => m.id === selectedMatch) ?? null;

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

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Registrar evento</h3>
        {(competitionsError || seasonsError || stagesError || roundsError || matchesError) && <FormError message="Não foi possível carregar todos os dados da partida. Verifique suas permissões e tente novamente." />}
        <FormField label="Competição">
          <FormSelect value={selectedComp} onChange={(e) => { setSelectedComp(e.target.value); setSelectedSeason(''); setSelectedStage(''); setSelectedRound(''); setSelectedMatch(''); }}>
            <option value="">Selecione...</option>
            {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Temporada">
          <FormSelect value={selectedSeason} onChange={(e) => { setSelectedSeason(e.target.value); setSelectedStage(''); setSelectedRound(''); setSelectedMatch(''); }} disabled={!seasons.length}>
            <option value="">Selecione...</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Fase">
          <FormSelect value={selectedStage} onChange={(e) => { setSelectedStage(e.target.value); setSelectedRound(''); setSelectedMatch(''); }} disabled={!stages.length}>
            <option value="">Selecione...</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Rodada">
          <FormSelect value={selectedRound} onChange={(e) => { setSelectedRound(e.target.value); setSelectedMatch(''); }} disabled={!rounds.length}>
            <option value="">Selecione...</option>
            {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Partida">
          <FormSelect value={selectedMatch} onChange={(e) => setSelectedMatch(e.target.value)} disabled={!matches.length}>
            <option value="">Selecione...</option>
            {matches.map((m) => <option key={m.id} value={m.id}>{m.home_team?.team?.name || '—'} x {m.away_team?.team?.name || '—'}</option>)}
          </FormSelect>
        </FormField>
        {match && <EventForm key={match.id} match={match} />}
      </div>
      <div className="admin-list-card">
        <h3>Eventos da partida</h3>
        {match ? <MatchEventList matchId={match.id} /> : <p className="admin-empty-text">Selecione uma partida para ver e registrar eventos.</p>}
      </div>
    </div>
  );
}

function EventForm({ match }: { match: Match }) {
  const [eventType, setEventType] = useState<EventType>('GOAL');
  const [minute, setMinute] = useState('');
  const [teamId, setTeamId] = useState(match.home_team_id ?? '');
  const [playerId, setPlayerId] = useState('');
  const [relatedId, setRelatedId] = useState('');
  const [goalEventId, setGoalEventId] = useState('');
  const [period, setPeriod] = useState<MatchEvent['period']>('REGULATION');
  const [ownGoal, setOwnGoal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { rosters, error: rostersError } = useRosters(teamId || undefined);
  const { events, error: eventsError } = useMatchEvents(match.id);
  const { spells, error: spellsError } = useGoalkeeperParticipations([match.id]);
  const teamOptions = [match.home_team, match.away_team].filter(Boolean);
  const assistGoals = events.filter((item) =>
    item.event_type === 'GOAL'
    && !item.is_own_goal
    && item.period !== 'PENALTY_SHOOTOUT'
    && item.team_id === teamId,
  );
  const eventPlayers = eventType === 'GOALKEEPER_IN'
    ? rosters.filter((roster) => roster.player?.position === 'Goleiro')
    : eventType === 'GOALKEEPER_OUT'
      ? spells.filter((spell) => spell.team_id === teamId && spell.ended_at_seconds === null)
        .map((spell) => ({ player_id: spell.player_id, player: spell.player }))
      : rosters;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const seconds = parseClock(minute);
    if (seconds === null) { setError('Informe o minuto como 12 ou 12:30.'); return; }
    if (!teamId || !playerId) { setError('Selecione o time e o jogador.'); return; }
    if (!eventPlayers.some((player) => player.player_id === playerId)) { setError('Selecione um jogador válido para este tipo de evento e time.'); return; }
    if (eventType === 'SUBSTITUTION' && !relatedId) { setError('Informe quem saiu na substituição.'); return; }
    if (eventType === 'SUBSTITUTION' && relatedId === playerId) { setError('Quem entra e quem sai devem ser jogadores diferentes.'); return; }
    if (eventType === 'ASSIST' && !goalEventId) { setError('Vincule a assistência a um gol válido.'); return; }
    const linkedGoal = events.find((item) => item.id === goalEventId);
    if (eventType === 'ASSIST' && (!linkedGoal || linkedGoal.team_id !== teamId)) {
      setError('Selecione um gol do mesmo time para vincular a assistência.');
      return;
    }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('match_events').insert({
      match_id: match.id,
      event_type: eventType,
      minute_seconds: linkedGoal && eventType === 'ASSIST' ? linkedGoal.minute_seconds : seconds,
      period: linkedGoal && eventType === 'ASSIST' ? linkedGoal.period : period,
      is_own_goal: eventType === 'GOAL' && ownGoal,
      goal_event_id: eventType === 'ASSIST' ? goalEventId : null,
      team_id: teamId,
      player_id: playerId,
      related_player_id: eventType === 'SUBSTITUTION' ? relatedId : null,
    });
    setBusy(false);
    if (err) { setError(err.message || 'Não foi possível registrar o evento.'); return; }
    setMinute('');
    setPlayerId('');
    setRelatedId('');
    setGoalEventId('');
    setOwnGoal(false);
    refreshAdminData();
  }

  return (
    <form onSubmit={save}>
      <div className="admin-divider" />
      <FormField label="Tipo de evento">
        <FormSelect value={eventType} onChange={(e) => {
          const nextType = e.target.value as EventType;
          setEventType(nextType);
          setOwnGoal(false);
          if (nextType === 'ASSIST' && period === 'PENALTY_SHOOTOUT') setPeriod('REGULATION');
        }}>
          {(Object.keys(eventTypeLabels) as EventType[]).map((t) => <option key={t} value={t}>{eventTypeLabels[t]}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Minuto (m ou m:ss)">
        <FormInput value={minute} onChange={(e) => setMinute(e.target.value)} placeholder="Ex: 12:30" disabled={eventType === 'ASSIST'} />
      </FormField>
      <FormField label="Período">
        <FormSelect
          value={period}
          disabled={eventType === 'ASSIST'}
          onChange={(e) => {
            const nextPeriod = e.target.value as MatchEvent['period'];
            setPeriod(nextPeriod);
            if (nextPeriod === 'PENALTY_SHOOTOUT') setOwnGoal(false);
          }}
        >
          {Object.entries(periodLabels)
            .filter(([value]) => value !== 'PENALTY_SHOOTOUT')
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </FormSelect>
      </FormField>
      {eventType === 'ASSIST' && (
        <FormField label="Gol relacionado">
          <FormSelect value={goalEventId} onChange={(e) => {
            const goal = assistGoals.find((item) => item.id === e.target.value);
            setGoalEventId(e.target.value);
            if (goal) {
              setMinute(formatClock(goal.minute_seconds));
              setPeriod(goal.period);
            }
          }}>
            <option value="">Selecione...</option>
            {assistGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {formatClock(goal.minute_seconds)} · {goal.player?.nickname || 'Gol'} · {goal.team?.team?.name || 'Time'}
              </option>
            ))}
          </FormSelect>
        </FormField>
      )}
      <FormField label="Time">
        <FormSelect value={teamId} onChange={(e) => { setTeamId(e.target.value); setPlayerId(''); setRelatedId(''); setGoalEventId(''); }}>
          {teamOptions.map((st) => st && <option key={st.id} value={st.id}>{st.team?.name || '—'}</option>)}
        </FormSelect>
      </FormField>
      <FormField label={eventType === 'SUBSTITUTION' ? 'Quem entrou' : eventType === 'GOALKEEPER_IN' || eventType === 'GOALKEEPER_OUT' ? 'Goleiro' : 'Jogador'}>
        <FormSelect value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          <option value="">Selecione...</option>
          {eventPlayers.map((roster) => <option key={roster.player_id} value={roster.player_id}>{roster.player?.nickname}</option>)}
        </FormSelect>
      </FormField>
      {(rostersError || eventsError || (eventType === 'GOALKEEPER_OUT' && spellsError)) && <FormError message="Não foi possível carregar os dados para registrar este evento." />}
      {eventType === 'SUBSTITUTION' && (
        <FormField label="Quem saiu">
          <FormSelect value={relatedId} onChange={(e) => setRelatedId(e.target.value)}>
            <option value="">Selecione...</option>
            {rosters.map((r) => <option key={r.id} value={r.player_id}>{r.player?.nickname}</option>)}
          </FormSelect>
        </FormField>
      )}
      {eventType === 'GOAL' && period !== 'PENALTY_SHOOTOUT' && (
        <FormField label="Gol contra">
          <input type="checkbox" checked={ownGoal} onChange={(e) => setOwnGoal(e.target.checked)} />
        </FormField>
      )}
      <FormError message={error} />
      <button className="button button-primary" disabled={busy || rostersError || eventsError || (eventType === 'GOALKEEPER_OUT' && spellsError)}>{busy ? 'Aguarde...' : 'Registrar evento'} <ArrowRight size={16} /></button>
    </form>
  );
}

function MatchEventList({ matchId }: { matchId: string }) {
  const { events, loading, error: loadError } = useMatchEvents(matchId);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    if (!window.confirm('Remover este evento?')) return;
    const { error: err } = await supabase.from('match_events').delete().eq('id', id);
    if (err) { setError('Não foi possível remover o evento.'); return; }
    refreshAdminData();
  }

  if (loading) return <LoadingCard />;
  if (loadError) return <FormError message="Não foi possível carregar os eventos desta partida." />;
  if (loadError) return <FormError message="Não foi possível carregar os eventos desta partida." />;
  if (events.length === 0) return <p className="admin-empty-text">Nenhum evento registrado nesta partida.</p>;
  return (
    <div className="admin-list">
      <FormError message={error} />
      {events.map((ev) => (
        <div key={ev.id} className="admin-list-item">
          <div>
            <strong>
              {formatClock(ev.minute_seconds)} · {ev.is_own_goal ? 'Gol contra' : eventTypeLabels[ev.event_type]}
              {' · '}{periodLabels[ev.period]}
            </strong>
            <span>{ev.player?.nickname || '—'}{ev.related_player ? ` (saiu: ${ev.related_player.nickname})` : ''} · {ev.team?.team?.name || '—'}</span>
          </div>
          <div className="admin-list-actions">
            <button className="icon-button-danger" onClick={() => remove(ev.id)} title="Remover"><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
