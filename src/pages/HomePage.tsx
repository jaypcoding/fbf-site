import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarDays, ChevronRight, Goal, Radio, Shield, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCompetitions } from '@/lib/hooks';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { buildMatchFeed } from '@/lib/matchFeed';
import { usePageTitle } from '@/lib/pageTitle';
import { FEED_SELECT, competitionOf, isPublicFeedRow, type FeedRow } from '@/lib/feedSelect';
import { EmptyState, LoadingCard } from '@/components/ui';
import { NewsCard } from '@/pages/NewsPages';
import { usePublishedNews } from '@/lib/newsData';
import { CompetitionGrid, FBF_LOGO, MatchCard } from '@/components/site';

function useMatchFeed() {
  const [feed, setFeed] = useState<ReturnType<typeof buildMatchFeed<FeedRow>> | null>(null);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    let active = true;
    const now = new Date();
    const since = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    Promise.all([
      supabase.from('matches').select(FEED_SELECT).in('status', ['SCHEDULED', 'LIVE']).gte('scheduled_at', since).order('scheduled_at', { ascending: true }).limit(60),
      supabase.from('matches').select(FEED_SELECT).eq('status', 'FINISHED').order('scheduled_at', { ascending: false, nullsFirst: false }).limit(60),
    ]).then(([upcomingResult, recentResult]) => {
      if (!active) return;
      if (upcomingResult.error || recentResult.error) {
        setError(true);
        return;
      }
      const rows = [...(upcomingResult.data || []), ...(recentResult.data || [])] as unknown as FeedRow[];
      const visible = rows.filter(isPublicFeedRow);
      setFeed(buildMatchFeed(visible, now, 6));
    });
    return () => { active = false; };
  }, [refreshVersion]);

  return { feed, error };
}

function useDirectoryCounts() {
  const [counts, setCounts] = useState<{ teams: number; players: number } | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from('teams').select('id', { count: 'exact', head: true }),
      supabase.from('players').select('id', { count: 'exact', head: true }),
    ]).then(([teams, players]) => {
      if (!active || teams.error || players.error) return;
      setCounts({ teams: teams.count ?? 0, players: players.count ?? 0 });
    });
    return () => { active = false; };
  }, []);
  return counts;
}

function MatchColumn({ title, kicker, matches, empty }: { title: string; kicker: string; matches: FeedRow[]; empty: string }) {
  return (
    <div className="feed-column">
      <div className="feed-heading"><span className="section-kicker">{kicker}</span><h3>{title}</h3></div>
      {matches.length === 0
        ? <p className="feed-empty">{empty}</p>
        : <div className="matches-list compact">{matches.map((match) => <MatchCard key={match.id} match={match} context={competitionOf(match)?.name} />)}</div>}
    </div>
  );
}

export function HomePage() {
  usePageTitle(null);
  const { competitions, loading, error } = useCompetitions();
  const { feed, error: feedError } = useMatchFeed();
  const counts = useDirectoryCounts();
  const news = usePublishedNews(3);
  const active = competitions.filter((competition) => competition.status === 'ACTIVE');
  const upcoming = competitions.filter((competition) => ['UPCOMING', 'REGISTRATION'].includes(competition.status));
  const featured = [...active, ...upcoming];
  const publicCompetitions = competitions.filter((competition) => competition.status !== 'CANCELLED').length;
  const hasFeed = feed && (feed.live.length > 0 || feed.upcoming.length > 0 || feed.recent.length > 0);

  return <>
    <section className="hero-section">
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> Federação Brasileira de Futsal</div>
          <h1>O jogo brasileiro,<br /><em>organizado.</em></h1>
          <p>Competições, equipes, resultados e estatísticas do HaxBall brasileiro em um só lugar.</p>
          <div className="hero-actions">
            <Link to="/competicoes" className="button button-primary">Explorar competições <ArrowRight size={17} /></Link>
            <Link to="/jogadores" className="button button-quiet">Ver jogadores</Link>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-card">
            <div className="hero-card-top"><span>Temporada</span><span className="live-chip">FBF</span></div>
            <div className="hero-card-logo"><img src={FBF_LOGO} alt="" /></div>
            <strong>FBF</strong>
            <span>Federação Brasileira de Futsal</span>
            <div className="hero-card-line"><i /><i /><i /></div>
          </div>
          <div className="hero-stamp"><Shield size={17} /><span>Desde<br /><b>2018</b></span></div>
        </div>
      </div>
    </section>

    {(counts || (!loading && !error)) && (
      <section className="container numbers-band" aria-label="A FBF em números">
        {!loading && !error && <Link to="/competicoes"><strong>{publicCompetitions}</strong><span>{publicCompetitions === 1 ? 'Competição' : 'Competições'}</span></Link>}
        {counts && <Link to="/times"><strong>{counts.teams}</strong><span>Times</span></Link>}
        {counts && <Link to="/jogadores"><strong>{counts.players}</strong><span>Jogadores</span></Link>}
      </section>
    )}

    {feed && feed.live.length > 0 && (
      <section className="container content-section live-section">
        <div className="section-heading"><div><span className="section-kicker live-kicker"><Radio size={12} /> Ao vivo agora</span><h2>Partidas em andamento</h2></div><Link to="/ao-vivo" className="text-link">Central ao Vivo <ArrowRight size={16} /></Link></div>
        <div className="matches-list">{feed.live.map((match) => <MatchCard key={match.id} match={match} context={competitionOf(match)?.name} />)}</div>
      </section>
    )}

    {news.posts.length > 0 && (
      <section className="container content-section news-home">
        <div className="section-heading"><div><span className="section-kicker">FBF informa</span><h2>Notícias e comunicados</h2></div><Link to="/noticias" className="text-link">Ver todas <ArrowRight size={16} /></Link></div>
        <div className="news-grid">{news.posts.map((p) => <NewsCard key={p.id} post={p} />)}</div>
      </section>
    )}

    {hasFeed && !feedError && (
      <section className="container content-section feed-section">
        <div className="section-heading"><div><span className="section-kicker">Agenda</span><h2>Jogos e resultados</h2></div><Link to="/competicoes" className="text-link">Ver competições <ArrowRight size={16} /></Link></div>
        <div className="feed-grid">
          <MatchColumn kicker="Em breve" title="Próximos jogos" matches={feed.upcoming} empty="Nenhuma partida agendada para os próximos dias." />
          <MatchColumn kicker="Encerrados" title="Últimos resultados" matches={feed.recent} empty="Os resultados aparecerão aqui ao fim das partidas." />
        </div>
      </section>
    )}

    <section className="container content-section">
      <div className="section-heading">
        <div><span className="section-kicker">Agora na FBF</span><h2>Competições em destaque</h2></div>
        <Link to="/competicoes" className="text-link">Ver todas <ArrowRight size={16} /></Link>
      </div>
      {loading ? <LoadingCard />
        : error ? <EmptyState icon={<CalendarDays />} title="Não foi possível carregar as competições" description="Tente novamente mais tarde." actionLabel="Ver competições" actionTo="/competicoes" />
        : featured.length === 0 ? <EmptyState icon={<CalendarDays />} title="Não há competições em andamento" description="Quando uma competição começar, você poderá acompanhar jogos, tabela e estatísticas por aqui." actionLabel="Conhecer competições" actionTo="/competicoes" />
        : <CompetitionGrid competitions={featured} />}
    </section>

    <section className="container feature-row">
      <Link to="/competicoes" className="feature-card accent-card">
        <div className="feature-icon"><Sparkles size={19} /></div>
        <div>
          <span className="section-kicker">Próximo capítulo</span>
          <h3>{upcoming.length ? 'Inscrições e novidades em breve' : 'Um espaço pronto para a próxima temporada'}</h3>
          <p>A estrutura da FBF está preparada para receber novas edições, times e disputas.</p>
        </div>
        <ArrowRight size={20} />
      </Link>
      <Link to="/estatisticas" className="feature-card">
        <div className="feature-icon dark"><Goal size={19} /></div>
        <div>
          <span className="section-kicker">Dados do jogo</span>
          <h3>Estatísticas que contam a história</h3>
          <p>Artilharia, assistências e tempo sem sofrer gol calculados a partir dos eventos reais.</p>
        </div>
        <ChevronRight size={20} />
      </Link>
    </section>
  </>;
}

export function NotFoundPage() {
  usePageTitle('Página não encontrada');
  return <section className="container detail-section"><EmptyState icon={<BarChart3 />} title="Página não encontrada" description="O endereço pode estar incorreto ou o conteúdo não está mais disponível." actionLabel="Voltar ao início" actionTo="/" /></section>;
}
