import { useEffect, useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { supabase, type Match } from '@/lib/supabase';
import { useCompetitions, useSeasons, useStages, useRounds, useMatches, useRosters, useGoalkeeperParticipations } from '@/lib/hooks';
import { formatClock } from '@/lib/time';
import { isCleanSheet } from '@/lib/cleanSheet';
import { LoadingCard, FormField, FormSelect, FormError, PlayerPhoto } from '@/components/ui';

export function GoalkeepersTab() {
  const { competitions } = useCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { stages } = useStages(selectedSeason || undefined);
  const [selectedStage, setSelectedStage] = useState('');
  const { rounds } = useRounds(selectedStage || undefined);
  const [selectedRound, setSelectedRound] = useState('');
  const { matches } = useMatches(selectedRound || undefined);
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
        <h3>Registrar goleiro</h3>
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
        {match && <SpellForm match={match} />}
      </div>
      <div className="admin-list-card">
        <h3>Participações de goleiros</h3>
        {match ? <SpellList matchId={match.id} /> : <p className="admin-empty-text">Selecione uma partida para ver os goleiros.</p>}
      </div>
    </div>
  );
}

function SpellForm({ match }: { match: Match }) {
  const teams = [match.home_team, match.away_team].filter((t): t is NonNullable<typeof t> => Boolean(t));
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [playerId, setPlayerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { rosters } = useRosters(teamId || undefined);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!teamId || !playerId) { setError('Selecione o time e o goleiro.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('goalkeeper_participations').insert({
      match_id: match.id,
      team_id: teamId,
      player_id: playerId,
      started_at_seconds: 0,
    });
    setBusy(false);
    if (err) { setError('Não foi possível registrar a participação.'); return; }
    window.location.reload();
  }

  return (
    <form onSubmit={save}>
      <div className="admin-divider" />
      <p className="admin-hint">Registre o goleiro inicial. Entradas e saídas posteriores são calculadas pelos eventos de substituição.</p>
      <FormField label="Time">
        <FormSelect value={teamId} onChange={(e) => { setTeamId(e.target.value); setPlayerId(''); }}>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.team?.name || '—'}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Goleiro">
        <FormSelect value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          <option value="">Selecione...</option>
          {rosters.map((r) => <option key={r.id} value={r.player_id}>{r.player?.nickname} ({r.player?.position})</option>)}
        </FormSelect>
      </FormField>
      <FormError message={error} />
      <button className="button button-primary" disabled={busy || !playerId}>{busy ? 'Aguarde...' : 'Registrar goleiro'} <ArrowRight size={16} /></button>
    </form>
  );
}

function SpellList({ matchId }: { matchId: string }) {
  const { spells, loading, error: loadError } = useGoalkeeperParticipations([matchId]);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    if (!window.confirm('Remover esta participação?')) return;
    const { error: err } = await supabase.from('goalkeeper_participations').delete().eq('id', id);
    if (err) { setError('Não foi possível remover a participação.'); return; }
    window.location.reload();
  }

  if (loading) return <LoadingCard />;
  if (loadError) return <FormError message="Não foi possível carregar os goleiros desta partida." />;
  if (spells.length === 0) return <p className="admin-empty-text">Nenhum goleiro registrado nesta partida.</p>;
  return (
    <div className="admin-list">
      <FormError message={error} />
      {spells.map((s) => (
        <div key={s.id} className="admin-list-item">
          <div className="admin-list-team">
            <PlayerPhoto src={s.player?.photo_url ?? null} name={s.player?.nickname ?? ''} size={32} />
            <div>
              <strong>{s.player?.nickname || '—'} · {s.team?.team?.name || '—'}</strong>
              <span>
                {formatClock(s.started_at_seconds)} até {s.ended_at_seconds !== null ? formatClock(s.ended_at_seconds) : 'o fim'}
                {' · '}{s.first_conceded_at_seconds !== null ? `gol sofrido em ${formatClock(s.first_conceded_at_seconds)}` : isCleanSheet(s, s.match?.status === 'FINISHED' ? s.match.duration_seconds : null) ? 'Clean Sheet' : 'sem gol sofrido'}
              </span>
            </div>
          </div>
          {s.source_event_id === null && s.exit_event_id === null && (
            <div className="admin-list-actions">
              <button className="icon-button-danger" onClick={() => remove(s.id)} title="Remover"><Trash2 size={15} /></button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
