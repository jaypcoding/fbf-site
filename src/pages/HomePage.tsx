import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarDays, ChevronRight, Goal, Radio, Shield, Sparkles } from 'lucide-react';
import { supabase, type Match } from '@/lib/supabase';
import { useCompetitions } from '@/lib/hooks';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { buildMatchFeed } from '@/lib/matchFeed';
import { usePageTitle } from '@/lib/pageTitle';
import { one } from '@/lib/relations';
import { EmptyState, LoadingCard } from '@/components/ui';
import { CompetitionGrid, FBF_LOGO, MatchCard } from '@/components/site';

type FeedRow = Match & {
  round?: Match['round'] & {
    stage?: { season?: { competition?: { id: string; name: string; status: string } | null } | null } | null;
  };
};

// Matches from archived (old CANCELLED) or draft competitions never appear in
// the public agenda. The competition embed is !inner, so rows the visitor is not
// allowed to see are dropped by the database itself.
const HIDDEN_COMPETITION_STATUSES = new Set(['DRAFT', 'CANCELLED']);

const FEED_SELECT = 'id, round_id, home_team_id, away_team_id, scheduled_at, home_score, away_score, status, series_id, series_leg, home_source_match_id, home_source_outcome, away_source_match_id, away_source_outcome, home_team:home_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), away_team:away_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), round:round_id!inner ( id, stage_id, name, round_order, phase_type, stage_group_id, leg_number, bracket_round, stage_group:stage_group_id ( id, name, group_order ), stage:stage_id!inner ( id, season:season_id!inner ( id, competition:competition_id!inner ( id, name, status ) ) ) )';

function competitionOf(match: FeedRow) {
  return one(one(one(match.round?.stage)?.season)?.competition);
}

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
      const visible = rows.filter((row) => {
        const competition = competitionOf(row);
        return competition && !HIDDEN_COMPETITION_STATUSES.has(competition.status);
      });
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
        <div className="section-heading"><div><span className="section-kicker live-kicker"><Radio size={12} /> Ao vivo agora</span><h2>Partidas em andamento</h2></div></div>
        <div className="matches-list">{feed.live.map((match) => <MatchCard key={match.id} match={match} context={competitionOf(match)?.name} />)}</div>
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
