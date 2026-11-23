// Central ao Vivo (route /ao-vivo). Shows only what the organization records
// in the system: matches put LIVE, their official score (derived from the
// registered events), the goals in the registered order, the goalkeepers
// registered in goal, the linked transmissions and when each match was put
// live. There is no clock and no estimated minute: the HaxBall game time is
// not sent to the site. When nothing is registered for a while, the page says
// so instead of pretending the match is going on as shown.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock3, ExternalLink, Goal, Hand, Radio, RefreshCw, TriangleAlert, Tv } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePageTitle } from '@/lib/pageTitle';
import { formatClock } from '@/lib/time';
import { channelUrl, platformLabel } from '@/lib/streaming';
import { FEED_SELECT, competitionOf, isPublicFeedRow, type FeedRow } from '@/lib/feedSelect';
import { agenda, freshness, lastRegisteredAt, liveGoals, STALE_AFTER_MINUTES, type LiveEventRow } from '@/lib/liveCenter';
import { EmptyState, LoadingCard, PageIntro, TeamLogo } from '@/components/ui';
import { MatchCard } from '@/components/site';

const REFRESH_MS = 20000;
type LiveRow = FeedRow & { updated_at: string | null };
type Keeper = { match_id: string; team_id: string; player: { nickname: string } | null };
type StreamLink = { match_id: string; streamer: { id: string; display_name: string; platform: string; channel: string } | null };
type LiveData = {
  live: LiveRow[]; since: Map<string, string | null>; events: Map<string, LiveEventRow[]>; keepers: Map<string, Keeper[]>; streams: Map<string, StreamLink[]>;
  agenda: ReturnType<typeof agenda<FeedRow>>;
};

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
const group = <T extends { match_id: string }>(rows: T[]) => rows.reduce((m, r) => m.set(r.match_id, [...(m.get(r.match_id) ?? []), r]), new Map<string, T[]>());

function useLiveCenter() {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const now = Date.now();
    const from = new Date(now - 24 * 3600000).toISOString();
    const to = new Date(now + 24 * 3600000).toISOString();
    const [liveRes, sinceRes, dayRes] = await Promise.all([
      supabase.from('matches').select(`${FEED_SELECT}, updated_at`).eq('status', 'LIVE'),
      supabase.rpc('live_match_status'),
      supabase.from('matches').select(FEED_SELECT).in('status', ['SCHEDULED', 'FINISHED']).gte('scheduled_at', from).lte('scheduled_at', to).order('scheduled_at').limit(80),
    ]);
    if (liveRes.error || sinceRes.error || dayRes.error) { setError(true); setBusy(false); return; }
    const live = ((liveRes.data ?? []) as unknown as LiveRow[]).filter(isPublicFeedRow);
    const ids = live.map((m) => m.id);
    const empty = Promise.resolve({ data: [], error: null });
    const [evRes, gkRes, stRes] = await Promise.all([
      ids.length ? supabase.from('match_events').select('id, match_id, event_type, minute_seconds, created_at, team_id, player_id, is_own_goal, goal_event_id, player:player_id ( nickname )').in('match_id', ids) : empty,
      ids.length ? supabase.from('goalkeeper_participations').select('match_id, team_id, player:player_id ( nickname )').in('match_id', ids).is('ended_at_seconds', null) : empty,
      ids.length ? supabase.from('match_streamers').select('match_id, streamer:streamer_id ( id, display_name, platform, channel )').in('match_id', ids) : empty,
    ]);
    if (evRes.error || gkRes.error || stRes.error) { setError(true); setBusy(false); return; }
    setError(false);
    setData({
      live,
      since: new Map(((sinceRes.data ?? []) as { match_id: string; live_since: string | null }[]).map((r) => [r.match_id, r.live_since])),
      events: group((evRes.data ?? []) as unknown as (LiveEventRow & { match_id: string })[]),
      keepers: group((gkRes.data ?? []) as unknown as Keeper[]),
      streams: group((stRes.data ?? []) as unknown as StreamLink[]),
      agenda: agenda(((dayRes.data ?? []) as unknown as FeedRow[]).filter(isPublicFeedRow), now),
    });
    setLoadedAt(now);
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
    // refresh while the page is visible; never in a hidden tab
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  return { data, error, loadedAt, busy, reload: load };
}

function LiveMatch({ match, data, now }: { match: LiveRow; data: LiveData; now: number }) {
  const events = useMemo(() => data.events.get(match.id) ?? [], [data.events, match.id]);
  const goals = useMemo(() => liveGoals(events), [events]);
  const since = data.since.get(match.id) ?? null;
  const last = lastRegisteredAt(since, events, match.updated_at);
  const fresh = freshness(last, now);
  const keepers = data.keepers.get(match.id) ?? [];
  const streams = (data.streams.get(match.id) ?? []).filter((s) => s.streamer);
  const home = match.home_team?.team;
  const away = match.away_team?.team;
  const hasScore = match.home_score !== null && match.away_score !== null;
  const side = (teamId: string | null) => (teamId === match.home_team_id ? 'home' : teamId === match.away_team_id ? 'away' : null);
  const competition = competitionOf(match);

  return (
    <article className={`live-card${fresh.state === 'stale' ? ' is-stale' : ''}`}>
      <header className="live-card-top">
        <span className="live-badge"><i aria-hidden="true" /> Ao vivo</span>
        <span className="live-card-context">{competition?.name}{match.round?.name ? ` · ${match.round.name}` : ''}</span>
      </header>
      <Link to={`/partidas/${match.id}`} className="live-scoreboard" aria-label={hasScore ? `${home?.name} ${match.home_score} a ${match.away_score} ${away?.name}` : `${home?.name} x ${away?.name}`}>
        <span className="live-team"><TeamLogo src={home?.logo_url ?? null} name={home?.name ?? '?'} size={44} /><strong>{home?.name ?? 'A definir'}</strong></span>
        <span className="live-score">{hasScore ? <>{match.home_score}<small>×</small>{match.away_score}</> : <small>placar não registrado</small>}</span>
        <span className="live-team is-away"><TeamLogo src={away?.logo_url ?? null} name={away?.name ?? '?'} size={44} /><strong>{away?.name ?? 'A definir'}</strong></span>
      </Link>
      <p className="live-facts">
        <span><Clock3 size={13} aria-hidden="true" /> Iniciada no sistema às {time(since)}</span>
        <span>Último registro às {time(last)}{fresh.minutes !== null ? ` (há ${fresh.minutes} min)` : ''}</span>
      </p>
      {fresh.state === 'stale' && (
        <p className="live-stale" role="status"><TriangleAlert size={14} aria-hidden="true" /> Nenhum registro novo há {fresh.minutes} minutos. O placar mostrado é o último registrado e pode estar desatualizado.</p>
      )}
      {goals.length > 0 ? (
        <ol className="live-goals">
          {goals.map((g) => (
            <li key={g.id} className={`is-${side(g.teamId) ?? 'unknown'}`}>
              <Goal size={13} aria-hidden="true" />
              <span className="live-goal-min">{g.minuteSeconds !== null ? formatClock(g.minuteSeconds) : '—'}</span>
              <span>{g.scorer ?? 'Gol sem autor registrado'}{g.ownGoal ? ' (contra)' : ''}{g.assist ? <small> assistência de {g.assist}</small> : null}</span>
            </li>
          ))}
        </ol>
      ) : <p className="live-empty">Nenhum gol registrado até agora.</p>}
      {keepers.length > 0 && (
        <p className="live-keepers"><Hand size={13} aria-hidden="true" /> No gol (registrado): {keepers.map((k) => `${k.player?.nickname ?? 'goleiro'} (${k.team_id === match.home_team_id ? home?.name : away?.name})`).join(' · ')}</p>
      )}
      {streams.length > 0 && (
        <p className="live-streams"><Tv size={13} aria-hidden="true" /> {streams.map((s) => (
          <a key={s.streamer!.id} href={channelUrl(s.streamer!.platform, s.streamer!.channel)} target="_blank" rel="noreferrer noopener">{s.streamer!.display_name} · {platformLabel(s.streamer!.platform)} <ExternalLink size={11} aria-hidden="true" /></a>
        ))}</p>
      )}
    </article>
  );
}

export function LiveCenterPage() {
  usePageTitle('Central ao Vivo');
  const { data, error, loadedAt, busy, reload } = useLiveCenter();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (loadedAt) setNow(loadedAt); }, [loadedAt]);

  return (
    <>
      <PageIntro eyebrow="Ao vivo" title="Central ao Vivo" description="Partidas em andamento, com o placar e os lances registrados pela organização, e a agenda do dia." />
      <section className="container content-section live-page">
        <div className="live-toolbar">
          <span>{loadedAt ? `Atualizado às ${new Date(loadedAt).toLocaleTimeString('pt-BR')}` : 'Carregando...'} · atualiza sozinho a cada {REFRESH_MS / 1000} s</span>
          <button type="button" className="button button-outline button-small" onClick={() => void reload()} disabled={busy}><RefreshCw size={14} aria-hidden="true" /> {busy ? 'Atualizando...' : 'Atualizar'}</button>
        </div>
        {error && !data ? <EmptyState icon={<Radio />} title="Não foi possível carregar a Central ao Vivo" description="Tente atualizar em instantes." />
          : !data ? <LoadingCard />
          : (
            <>
              {error && <p className="live-stale" role="status"><TriangleAlert size={14} aria-hidden="true" /> A última atualização falhou; mostrando os dados de {time(new Date(now).toISOString())}.</p>}
              <h2 className="live-heading"><Radio size={18} aria-hidden="true" /> Em andamento</h2>
              {data.live.length === 0 ? (
                <p className="live-none">Nenhuma partida em andamento registrada no sistema agora.</p>
              ) : (
                <div className="live-grid">{data.live.map((m) => <LiveMatch key={m.id} match={m} data={data} now={now} />)}</div>
              )}
              {data.agenda.waiting.length > 0 && (
                <>
                  <h2 className="live-heading">Aguardando início</h2>
                  <p className="live-note">O horário marcado já passou, mas a partida ainda não foi iniciada no sistema.</p>
                  <div className="matches-list">{data.agenda.waiting.map((m) => <MatchCard key={m.id} match={m} context={competitionOf(m)?.name} />)}</div>
                </>
              )}
              <h2 className="live-heading">Próximas 24 horas</h2>
              {data.agenda.upcoming.length === 0 ? <p className="live-none">Nenhuma partida marcada para as próximas 24 horas.</p>
                : <div className="matches-list">{data.agenda.upcoming.map((m) => <MatchCard key={m.id} match={m} context={competitionOf(m)?.name} />)}</div>}
              {data.agenda.finished.length > 0 && (
                <>
                  <h2 className="live-heading">Encerradas nas últimas 24 horas</h2>
                  <div className="matches-list">{data.agenda.finished.map((m) => <MatchCard key={m.id} match={m} context={competitionOf(m)?.name} />)}</div>
                </>
              )}
              <p className="ranking-note is-rules">
                A Central mostra só o que a organização registra no sistema. Não há cronômetro: o tempo de jogo do HaxBall não é enviado ao site, e os minutos dos gols são os registrados na súmula.
                Sem novos registros por {STALE_AFTER_MINUTES} minutos, a partida aparece como possivelmente desatualizada.
              </p>
            </>
          )}
      </section>
    </>
  );
}
