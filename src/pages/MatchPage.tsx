import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Goal } from 'lucide-react';
import { useMatch, useMatchEvents } from '@/lib/hooks';
import { matchStatusLabels } from '@/lib/labels';
import { formatClock } from '@/lib/time';
import { formatMatchDate } from '@/lib/format';
import { usePageTitle } from '@/lib/pageTitle';
import { LoadingCard, EmptyState, TeamLogo, PlayerPhoto } from '@/components/ui';
import { supabase, type MatchEvent } from '@/lib/supabase';
import { MatchReplayReport, useMatchReplayReport } from '@/components/replay/MatchReplayReport';
import { MatchMvp } from '@/components/MatchMvp';

const eventLabels: Record<MatchEvent['event_type'], string> = {
  GOAL: 'Gol',
  ASSIST: 'Assistência',
  SUBSTITUTION: 'Substituição',
  GOALKEEPER_IN: 'Goleiro entrou',
  GOALKEEPER_OUT: 'Goleiro saiu',
};

type MatchDetail = {
  id: string;
  scheduled_at: string | null;
  status: keyof typeof matchStatusLabels;
  home_score: number | null;
  away_score: number | null;
  home_penalty_score: number | null;
  home_team_id?: string | null;
  away_penalty_score: number | null;
  home_team: { team: { name: string; logo_url: string | null } | null } | null;
  away_team: { team: { name: string; logo_url: string | null } | null } | null;
  round: { name: string; stage_id?: string; stage: { name: string; season: { name: string; competition: { id: string; name: string } | null } | null } | null } | null;
};

type RecordMarkers = { recorded_retroactively: boolean; duration_is_presumed: boolean; duration_seconds: number | null };

// Read apart and tolerant to failure, so the page works whether or not the
// database already has these columns.
function useRecordMarkers(matchId?: string) {
  const [markers, setMarkers] = useState<RecordMarkers | null>(null);
  useEffect(() => {
    let active = true;
    setMarkers(null);
    if (!matchId) return () => { active = false; };
    supabase.from('matches').select('recorded_retroactively, duration_is_presumed, duration_seconds').eq('id', matchId).maybeSingle()
      .then(({ data, error }) => { if (active && !error && data) setMarkers(data as RecordMarkers); });
    return () => { active = false; };
  }, [matchId]);
  return markers;
}

export function MatchPage() {
  const { id } = useParams();
  const { match: rawMatch, loading: matchLoading, error: matchError } = useMatch(id);
  const { events, loading: eventsLoading, error: eventsError } = useMatchEvents(id);
  const match = rawMatch as unknown as MatchDetail | null;
  const markers = useRecordMarkers(id);
  const replayReport = useMatchReplayReport(id);
  usePageTitle(match ? `${match.home_team?.team?.name || 'A definir'} x ${match.away_team?.team?.name || 'A definir'}` : matchLoading ? null : 'Partida');

  const scorers = useMemo(() => {
    const totals = new Map<string, { id: string; name: string; photo: string | null; goals: number }>();
    for (const ev of events) {
      if (ev.event_type !== 'GOAL' || ev.is_own_goal || ev.period === 'PENALTY_SHOOTOUT' || !ev.player) continue;
      const current = totals.get(ev.player.id) ?? { id: ev.player.id, name: ev.player.nickname, photo: ev.player.photo_url, goals: 0 };
      current.goals += 1;
      totals.set(ev.player.id, current);
    }
    return [...totals.values()].sort((a, b) => b.goals - a.goals);
  }, [events]);

  if (matchLoading || eventsLoading) return <section className="container detail-section"><LoadingCard /></section>;
  if (matchError || eventsError) return <section className="container detail-section"><EmptyState icon={<Goal />} title="Não foi possível carregar a partida" description="O serviço de partidas está indisponível no momento. Tente novamente mais tarde." actionLabel="Ver competições" actionTo="/competicoes" /></section>;
  if (!match) return <section className="container detail-section"><EmptyState icon={<Goal />} title="Partida não encontrada" description="Verifique o link ou volte para a lista de competições." actionLabel="Ver competições" actionTo="/competicoes" /></section>;

  const competition = match.round?.stage?.season?.competition;
  // No mata-mata empatado, o primeiro gol no período extra (gol de ouro) decide a partida.
  const decidedByGoldenGoal = events.some((ev) => ev.event_type === 'GOAL' && ev.period === 'EXTRA_TIME');
  const homeName = match.home_team?.team?.name || '—';
  const awayName = match.away_team?.team?.name || '—';
  const finished = match.status === 'FINISHED' && match.home_score !== null && match.away_score !== null;
  const live = match.status === 'LIVE' && match.home_score !== null && match.away_score !== null;

  return (
    <section className="container detail-section">
      <Link to={competition ? `/competicoes/${competition.id}?aba=rodadas` : '/competicoes'} className="back-link">← {competition ? competition.name : 'Competições'}</Link>
      <h1 className="sr-only">{homeName} x {awayName}</h1>
      <div className={`score-banner score-${match.status.toLowerCase()}`}>
        <div className="score-meta">
          <span>{[match.round?.stage?.name, match.round?.name].filter(Boolean).join(' · ') || 'Partida'}</span>
          <span className={`match-status-tag tag-${match.status.toLowerCase()}`}>{match.status === 'LIVE' && <i aria-hidden="true" />}{matchStatusLabels[match.status]}{decidedByGoldenGoal ? ' · gol de ouro' : ''}</span>
        </div>
        <div className="score-row">
          <div className="score-team"><TeamLogo src={match.home_team?.team?.logo_url ?? null} name={homeName} size={64} /><span>{homeName}</span></div>
          <strong aria-label={finished || live ? `Placar ${match.home_score} a ${match.away_score}` : 'Partida sem placar'}>
            {finished || live ? <>{match.home_score}<small>×</small>{match.away_score}</> : <small className="score-vs">vs</small>}
          </strong>
          <div className="score-team"><TeamLogo src={match.away_team?.team?.logo_url ?? null} name={awayName} size={64} /><span>{awayName}</span></div>
        </div>
        <p className="score-date">{formatMatchDate(match.scheduled_at)}</p>
        {replayReport && finished ? (
          <p className="score-note">Súmula validada a partir das gravações da partida · duração {formatClock(replayReport.report.durationSeconds)}</p>
        ) : markers?.recorded_retroactively && (
          <p className="score-note">
            Resultado registrado após a partida
            {markers.duration_is_presumed && markers.duration_seconds ? ` · duração presumida (${formatClock(markers.duration_seconds)})` : ''}
          </p>
        )}
      </div>

      {finished && id && <MatchMvp matchId={id} homeName={homeName} awayName={awayName} homeTeamId={match.home_team_id ?? null} />}

      <div className="match-page-grid">
        <div>
          <h2 className="match-page-heading">Linha do tempo</h2>
          {events.length === 0 ? (
            <EmptyState icon={<Goal />} title="Sem eventos registrados" description="Gols, assistências e substituições aparecerão aqui conforme forem registrados." />
          ) : (
            <div className="timeline">
              {events.map((ev) => (
                <div key={ev.id} className="timeline-item">
                  <span className="timeline-minute" title={ev.metadata?.minute_unknown ? 'Tempo não informado' : undefined}>{ev.metadata?.minute_unknown ? '—' : formatClock(ev.minute_seconds)}</span>
                  <div className="timeline-body">
                    <strong>{ev.is_own_goal ? `${ev.player?.nickname || 'Autor não informado'} (gol contra)` : ev.player?.nickname || 'Autor não informado'}{ev.related_player ? ` ↔ ${ev.related_player.nickname}` : ''}</strong>
                    <span>{ev.team?.team?.name || '—'}</span>
                  </div>
                  <span className="timeline-type">{ev.event_type === 'GOAL' && ev.is_own_goal ? 'Gol contra' : eventLabels[ev.event_type]}{ev.period === 'EXTRA_TIME' ? ' · Gol de ouro' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="match-page-heading">Artilheiros da partida</h2>
          {scorers.length === 0 ? <p className="admin-empty-text">Nenhum gol registrado.</p> : (
            <div className="scorer-list">
              {scorers.map((s) => (
                <div key={s.id} className="scorer-item">
                  <PlayerPhoto src={s.photo} name={s.name} size={36} />
                  <strong>{s.name}</strong>
                  <span>{s.goals} {s.goals === 1 ? 'gol' : 'gols'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {replayReport && finished && <MatchReplayReport row={replayReport} homeName={homeName} awayName={awayName} events={events} />}
    </section>
  );
}
