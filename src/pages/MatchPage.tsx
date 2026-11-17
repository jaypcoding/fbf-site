import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Goal } from 'lucide-react';
import { useMatch, useMatchEvents } from '@/lib/hooks';
import { matchStatusLabels } from '@/lib/labels';
import { formatClock } from '@/lib/time';
import { LoadingCard, EmptyState, TeamLogo, PlayerPhoto, PageIntro } from '@/components/ui';
import type { MatchEvent } from '@/lib/supabase';

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
  away_penalty_score: number | null;
  home_team: { team: { name: string; logo_url: string | null } | null } | null;
  away_team: { team: { name: string; logo_url: string | null } | null } | null;
  round: { name: string; stage: { name: string; season: { name: string; competition: { id: string; name: string } | null } | null } | null } | null;
};

export function MatchPage() {
  const { id } = useParams();
  const { match: rawMatch, loading: matchLoading, error: matchError } = useMatch(id);
  const { events, loading: eventsLoading, error: eventsError } = useMatchEvents(id);
  const match = rawMatch as unknown as MatchDetail | null;

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
  const homeName = match.home_team?.team?.name || '—';
  const awayName = match.away_team?.team?.name || '—';
  const finished = match.status === 'FINISHED' && match.home_score !== null && match.away_score !== null;
  const live = match.status === 'LIVE' && match.home_score !== null && match.away_score !== null;

  return (
    <section className="container detail-section">
      {competition && <Link to={`/competicoes/${competition.id}`} className="back-link">← {competition.name}</Link>}
      <PageIntro eyebrow={match.round?.name || 'Partida'} title={`${homeName} x ${awayName}`} description={match.scheduled_at ? new Date(match.scheduled_at).toLocaleString('pt-BR') : 'Data a definir'} />
      <div className="score-banner">
        <div className="score-team"><TeamLogo src={match.home_team?.team?.logo_url ?? null} name={homeName} size={56} /><span>{homeName}</span></div>
        <strong>
          {finished || live ? `${match.home_score} × ${match.away_score}` : 'vs'}
          {finished && match.home_penalty_score !== null && match.away_penalty_score !== null
            ? ` (Pên. ${match.home_penalty_score} × ${match.away_penalty_score})`
            : ''}
        </strong>
        <div className="score-team"><TeamLogo src={match.away_team?.team?.logo_url ?? null} name={awayName} size={56} /><span>{awayName}</span></div>
      </div>
      <p className="admin-hint">{matchStatusLabels[match.status]}</p>

      <div className="match-page-grid">
        <div>
          <h2 className="match-page-heading">Linha do tempo</h2>
          {events.length === 0 ? (
            <EmptyState icon={<Goal />} title="Sem eventos registrados" description="Gols, assistências e substituições aparecerão aqui conforme forem registrados." />
          ) : (
            <div className="timeline">
              {events.map((ev) => (
                <div key={ev.id} className="timeline-item">
                  <span className="timeline-minute">{formatClock(ev.minute_seconds)}</span>
                  <div className="timeline-body">
                    <strong>{ev.is_own_goal ? `${ev.player?.nickname || '—'} (gol contra)` : ev.player?.nickname || '—'}{ev.related_player ? ` ↔ ${ev.related_player.nickname}` : ''}</strong>
                    <span>{ev.team?.team?.name || '—'}</span>
                  </div>
                  <span className="timeline-type">{eventLabels[ev.event_type]}{ev.period === 'EXTRA_TIME' ? ' · Prorrogação' : ev.period === 'PENALTY_SHOOTOUT' ? ' · Pênaltis' : ''}</span>
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
    </section>
  );
}
