import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarDays, Check, ChevronRight, CircleUserRound, ClipboardList, Goal, LayoutDashboard, LogIn, Menu, Shield, Sparkles, Trophy, Users, X } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { shouldBlockOnProfile } from '@/lib/authProfile';
import { buildSeasonLeaders, type LeaderPlayer, type SeasonStatRow } from '@/lib/seasonLeaders';
import { supabase, type Competition, type Team, type Player, type Match } from '@/lib/supabase';
import { useCompetitions, useSeasons, useTeams, usePlayers, useSeasonTeams, useRosters, useStages } from '@/lib/hooks';
import { LoadingCard, EmptyState, PageIntro, TeamLogo, PlayerPhoto } from '@/components/ui';
import { AdminPanel } from '@/components/AdminPanel';
import { LiveMiniPlayer } from '@/components/LiveMiniPlayer';
import { GoalkeeperRanking } from '@/components/GoalkeeperRanking';
import { PlayerCareerStats } from '@/components/PlayerCareerStats';
import { TeamRecordStats } from '@/components/TeamRecordStats';
import { MatchPage } from '@/pages/MatchPage';
import { StageStandings } from '@/components/StageStandings';
import { KnockoutBracket } from '@/components/KnockoutBracket';
import { formatClock } from '@/lib/time';
import { useAdminDataVersion } from '@/lib/adminRefresh';

type Status = Competition['status'];

type LeaderData = { rows: SeasonStatRow[]; players: Map<string, LeaderPlayer>; teams: Map<string, string> };
const EMPTY_LEADER_DATA: LeaderData = { rows: [], players: new Map(), teams: new Map() };

const statusLabels: Record<Status, string> = {
  DRAFT: 'Em preparação',
  UPCOMING: 'Próxima',
  REGISTRATION: 'Inscrições abertas',
  ACTIVE: 'Em andamento',
  FINISHED: 'Finalizada',
  CANCELLED: 'Cancelada',
};

const navItems = [
  { label: 'Início', to: '/', icon: Trophy },
  { label: 'Competições', to: '/competicoes', icon: ClipboardList },
  { label: 'Times', to: '/times', icon: Users },
  { label: 'Jogadores', to: '/jogadores', icon: CircleUserRound },
  { label: 'Estatísticas', to: '/estatisticas', icon: BarChart3 },
];

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authActionError, setAuthActionError] = useState('');
  const { session, profile } = useAuth();
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  async function signOut() {
    setAuthActionError('');
    const { error } = await supabase.auth.signOut();
    if (error) setAuthActionError('Não foi possível encerrar a sessão. Tente novamente.');
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="FBF, início">
            <img src="/1389286770004463646.webp" alt="Logo FBF" className="brand-mark" />
            <span><strong>FBF</strong><small>Federação Brasileira de Futsal</small></span>
          </Link>
          <button className="mobile-toggle" onClick={() => setMobileOpen((open) => !open)} aria-label="Abrir menu">
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
          <nav className={`main-nav ${mobileOpen ? 'is-open' : ''}`}>
            {navItems.map(({ label, to, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
            {session && profile && (profile.role === 'ADMIN' || profile.role === 'ORGANIZER') && (
              <NavLink to="/painel" className="nav-link panel-link"><LayoutDashboard size={16} /> Painel</NavLink>
            )}
            {session ? <button className="account-link" onClick={signOut}><CircleUserRound size={16} /> Sair</button> : <Link to="/login" className="login-link"><LogIn size={16} /> Login</Link>}
            {authActionError && <span role="alert" className="admin-hint">{authActionError}</span>}
          </nav>
        </div>
      </header>
      <main><Routes><Route path="/" element={<Home />} /><Route path="/competicoes" element={<Competitions />} /><Route path="/competicoes/:id" element={<CompetitionDetail />} /><Route path="/times" element={<TeamsPage />} /><Route path="/times/:id" element={<TeamDetail />} /><Route path="/jogadores" element={<PlayersPage />} /><Route path="/jogadores/:id" element={<PlayerDetail />} /><Route path="/estatisticas" element={<Stats />} /><Route path="/login" element={<Login />} /><Route path="/painel" element={<Dashboard />} /><Route path="/partidas/:id" element={<MatchPage />} /><Route path="*" element={<NotFound />} /></Routes></main>
      <footer className="site-footer"><div className="container footer-inner"><div className="footer-brand"><img src="/1389286770004463646.webp" alt="" /><strong>FBF</strong></div><span>Competições, equipes e histórias do futsal brasileiro.</span><span>© {new Date().getFullYear()} FBF</span></div></footer><LiveMiniPlayer />
    </div>
  );
}

function Home() {
  const { competitions, loading, error } = useCompetitions();
  const active = competitions.filter((competition) => competition.status === 'ACTIVE');
  const upcoming = competitions.filter((competition) => ['UPCOMING', 'REGISTRATION'].includes(competition.status));
  return <>
    <section className="hero-section"><div className="container hero-grid"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> Federação Brasileira de Futsal</div><h1>O jogo brasileiro,<br /><em>organizado.</em></h1><p>Competições, equipes, resultados e estatísticas do HaxBall brasileiro em um só lugar.</p><div className="hero-actions"><Link to="/competicoes" className="button button-primary">Explorar competições <ArrowRight size={17} /></Link><Link to="/jogadores" className="button button-quiet">Ver jogadores</Link></div></div><div className="hero-visual"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-card"><div className="hero-card-top"><span>Temporada</span><span className="live-chip">FBF</span></div><div className="hero-card-logo"><img src="/1389286770004463646.webp" alt="Logo FBF" /></div><strong>FBF</strong><span>Federação Brasileira de Futsal</span><div className="hero-card-line"><i /><i /><i /></div></div><div className="hero-stamp"><Shield size={17} /><span>Desde<br /><b>2018</b></span></div></div></div></section>
    <section className="container content-section"><div className="section-heading"><div><span className="section-kicker">Agora na FBF</span><h2>O calendário começa aqui</h2></div><Link to="/competicoes" className="text-link">Ver todas <ArrowRight size={16} /></Link></div>{loading ? <LoadingCard /> : error ? <EmptyState icon={<CalendarDays />} title="Não foi possível carregar as competições" description="Tente novamente mais tarde." actionLabel="Ver competições" actionTo="/competicoes" /> : active.length === 0 ? <EmptyState icon={<CalendarDays />} title="Não há competições em andamento" description="Quando uma competição começar, você poderá acompanhar jogos, tabela e estatísticas por aqui." actionLabel="Conhecer competições" actionTo="/competicoes" /> : <CompetitionGrid competitions={active} />}</section>
    <section className="container feature-row"><div className="feature-card accent-card"><div className="feature-icon"><Sparkles size={19} /></div><div><span className="section-kicker">Próximo capítulo</span><h3>{upcoming.length ? 'Inscrições e novidades em breve' : 'Um espaço pronto para a próxima temporada'}</h3><p>A estrutura da FBF está preparada para receber novas edições, times e disputas.</p></div><ArrowRight size={20} /></div><div className="feature-card"><div className="feature-icon dark"><Goal size={19} /></div><div><span className="section-kicker">Dados do jogo</span><h3>Estatísticas que contam a história</h3><p>Artilharia, assistências e CS calculados a partir dos eventos reais.</p></div><ChevronRight size={20} /></div></section>
  </>;
}

function NotFound() {
  return <section className="container detail-section"><EmptyState icon={<Trophy />} title="Página não encontrada" description="O endereço pode estar incorreto ou o conteúdo não está mais disponível." actionLabel="Voltar ao início" actionTo="/" /></section>;
}

function Competitions() {
  const { competitions, loading, error } = useCompetitions();
  const [filter, setFilter] = useState('Todas');
  const [category, setCategory] = useState('Todas');
  const categories = ['Todas', ...Array.from(new Set(competitions.map((competition) => competition.category)))];
  const filtered = competitions.filter((competition) => {
    const statusMatches = filter === 'Todas' || (filter === 'Em andamento' && competition.status === 'ACTIVE') || (filter === 'Próximas' && ['UPCOMING', 'REGISTRATION'].includes(competition.status)) || (filter === 'Finalizadas' && competition.status === 'FINISHED');
    return statusMatches && (category === 'Todas' || competition.category === category);
  });
  return <><PageIntro eyebrow="Calendário FBF" title="Competições" description="Acompanhe todas as competições e suas futuras edições em um calendário único." /><section className="container listing-section"><div className="filter-bar"><div className="filter-tabs">{['Todas', 'Em andamento', 'Próximas', 'Finalizadas'].map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'selected' : ''}>{item}</button>)}</div><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoria">{categories.map((item) => <option key={item}>{item}</option>)}</select></div>{loading ? <LoadingCard /> : error ? <EmptyState icon={<Trophy />} title="Não foi possível carregar as competições" description="Tente novamente mais tarde." /> : filtered.length ? <CompetitionGrid competitions={filtered} /> : <EmptyState icon={<Trophy />} title="Nenhuma competição encontrada" description="Não há edições com esses filtros no momento. As competições base estão prontas para receber novas temporadas." />}</section></>;
}

function CompetitionDetail() {
  const { id } = useParams();
  const { competitions, loading, error: competitionsError } = useCompetitions();
  const competition = competitions.find((item) => item.id === id);
  const [tab, setTab] = useState('Visão geral');
  const { seasons, loading: seasonsLoading, error: seasonsError } = useSeasons(id);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const activeSeason = seasons.find((season) => season.id === selectedSeasonId) ?? seasons[0];
  const { seasonTeams, loading: stLoading, error: seasonTeamsError } = useSeasonTeams(activeSeason?.id);
  const { stages, loading: stagesLoading, error: stagesError } = useStages(activeSeason?.id);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [leaderData, setLeaderData] = useState<LeaderData>(EMPTY_LEADER_DATA);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(false);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    if (!seasons.some((season) => season.id === selectedSeasonId)) {
      setSelectedSeasonId(seasons[0]?.id ?? '');
    }
  }, [seasons, selectedSeasonId]);

  useEffect(() => {
    if (seasonsLoading || stagesLoading) {
      setDataLoading(true);
      return;
    }
    if (seasonsError || stagesError) {
      setDataError(true);
      setDataLoading(false);
      return;
    }
    if (!activeSeason || stages.length === 0) {
      setAllMatches([]);
      setLeaderData(EMPTY_LEADER_DATA);
      setDataError(false);
      setDataLoading(false);
      return;
    }

    let active = true;
    setDataLoading(true);
    setDataError(false);
    const stageIds = stages.map((s) => s.id);
    const seasonId = activeSeason.id;

    async function loadMatches(): Promise<Match[]> {
      const { data: roundRows, error: roundsError } = await supabase.from('rounds').select('id').in('stage_id', stageIds);
      if (roundsError) throw roundsError;
      const roundIds = (roundRows as { id: string }[] | null)?.map((r) => r.id) || [];
      if (roundIds.length === 0) return [];
      const { data: matchData, error: matchesError } = await supabase.from('matches').select('id, round_id, home_team_id, away_team_id, scheduled_at, home_score, away_score, status, series_id, series_leg, home_source_match_id, home_source_outcome, away_source_match_id, away_source_outcome, home_team:home_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), away_team:away_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), round:round_id ( id, stage_id, name, round_order, phase_type, stage_group_id, leg_number, bracket_round, stage_group:stage_group_id ( id, name, group_order ) )').in('round_id', roundIds).order('scheduled_at', { ascending: true });
      if (matchesError) throw matchesError;
      return (matchData || []) as unknown as Match[];
    }

    // Season leaders come from the official statistics view (one row per player),
    // instead of downloading every event of the season and aggregating here.
    async function loadLeaders(): Promise<LeaderData> {
      const { data: statRows, error: statsError } = await supabase.from('player_competition_statistics').select('player_id, goals, assists').eq('season_id', seasonId);
      if (statsError) throw statsError;
      const rows = (statRows || []) as SeasonStatRow[];
      const playerIds = rows.map((row) => row.player_id);
      if (playerIds.length === 0) return EMPTY_LEADER_DATA;
      const [playersResult, rostersResult] = await Promise.all([
        supabase.from('players').select('id, nickname, photo_url, position').in('id', playerIds),
        supabase.from('rosters').select('player_id, season_team:season_team_id ( season_id, team:team_id ( name ) )').in('player_id', playerIds),
      ]);
      if (playersResult.error) throw playersResult.error;
      if (rostersResult.error) throw rostersResult.error;
      const players = new Map(((playersResult.data || []) as LeaderPlayer[]).map((player) => [player.id, player]));
      const teams = new Map<string, string>();
      for (const roster of (rostersResult.data || []) as unknown as { player_id: string; season_team: { season_id: string; team: { name: string } | null } | null }[]) {
        if (roster.season_team?.season_id === seasonId && roster.season_team.team?.name && !teams.has(roster.player_id)) {
          teams.set(roster.player_id, roster.season_team.team.name);
        }
      }
      return { rows, players, teams };
    }

    Promise.all([loadMatches(), loadLeaders()]).then(([matchesList, leaders]) => {
      if (!active) return;
      setAllMatches(matchesList);
      setLeaderData(leaders);
      setDataLoading(false);
    }).catch(() => {
      if (!active) return;
      setDataError(true);
      setDataLoading(false);
    });

    return () => { active = false; };
  }, [activeSeason, stages, seasonsLoading, seasonsError, stagesLoading, stagesError, refreshVersion]);

  if (loading || seasonsLoading) return <section className="container detail-section"><LoadingCard /></section>;
  if (competitionsError) return <section className="container detail-section"><EmptyState icon={<Trophy />} title="Não foi possível carregar a competição" description="Tente novamente mais tarde." actionLabel="Voltar para competições" actionTo="/competicoes" /></section>;
  if (!competition) return <section className="container detail-section"><EmptyState icon={<Trophy />} title="Competição não encontrada" description="A competição que você procura ainda não está disponível." actionLabel="Voltar para competições" actionTo="/competicoes" /></section>;

  const teamCount = seasonTeams.length;
  const scorers = buildSeasonLeaders(leaderData.rows, 'goals', leaderData.players, leaderData.teams);
  const assisters = buildSeasonLeaders(leaderData.rows, 'assists', leaderData.players, leaderData.teams);

  return <section className="container detail-section"><Link to="/competicoes" className="back-link">← Todas as competições</Link><div className="detail-hero"><div><span className="status-pill"><span /> {statusLabels[competition.status]}</span><h1>{competition.name}</h1><p>{competition.description || 'Uma competição oficial da Federação Brasileira de Futsal.'}</p></div><div className="detail-emblem"><img src="/1389286770004463646.webp" alt="" /></div></div><div className="detail-meta"><div><span>Categoria</span><strong>{competition.category}</strong></div><div><span>Formato</span><strong>{competition.format}</strong></div><div>{seasons.length > 1 ? <label className="form-field"><span>Edição</span><select aria-label="Selecionar edição" value={activeSeason?.id ?? ''} onChange={(event) => setSelectedSeasonId(event.target.value)}>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label> : <><span>Edição</span><strong>{activeSeason ? activeSeason.name : 'A definir'}</strong></>}</div><div><span>Equipes</span><strong>{teamCount > 0 ? teamCount : '—'}</strong></div></div><div className="detail-tabs">{['Visão geral', 'Classificação', 'Jogos', 'Times', 'Artilharia', 'Assistências', 'Goleiros / CS'].map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {seasonsError || stagesError ? <EmptyState icon={<CalendarDays />} title="Não foi possível carregar as edições" description="Tente novamente mais tarde." /> : tab === 'Visão geral' ? (activeSeason ? <div className="detail-overview"><div className="overview-card"><span className="section-kicker">Edição selecionada</span><h2>{activeSeason.name}</h2><p>{activeSeason.starts_at ? `Início: ${new Date(activeSeason.starts_at).toLocaleDateString('pt-BR')}` : 'Data a definir'}{activeSeason.ends_at ? ` — Fim: ${new Date(activeSeason.ends_at).toLocaleDateString('pt-BR')}` : ''}</p></div>{stLoading ? <LoadingCard /> : seasonTeamsError ? <EmptyState icon={<Users />} title="Não foi possível carregar os times" description="Tente novamente mais tarde." /> : teamCount > 0 && <div className="overview-teams"><h3>Equipes inscritas</h3><div className="team-chips">{seasonTeams.map((st) => <Link key={st.id} to={`/times/${st.team_id}`} className="team-chip"><TeamLogo src={st.team?.logo_url || null} name={st.team?.name || ''} size={28} /><span>{st.team?.name}</span></Link>)}</div></div>}</div> : <EmptyState icon={<CalendarDays />} title="Edição ainda não iniciada" description="Esta competição já está cadastrada na FBF. Assim que uma temporada for criada, jogos, times e estatísticas aparecerão nesta página." />)
    : tab === 'Times' ? (stLoading ? <LoadingCard /> : seasonTeamsError ? <EmptyState icon={<Users />} title="Não foi possível carregar os times" description="Tente novamente mais tarde." /> : teamCount > 0 ? <div className="team-grid">{seasonTeams.map((st) => <Link key={st.id} to={`/times/${st.team_id}`} className="team-card"><div className="team-card-logo"><TeamLogo src={st.team?.logo_url || null} name={st.team?.name || ''} size={56} /></div><h3>{st.team?.name}</h3></Link>)}</div> : <EmptyState icon={<Users />} title="Nenhum time inscrito" description="Os times serão exibidos aqui assim que forem inscritos nesta temporada." />)
    : tab === 'Classificação' ? (dataLoading ? <LoadingCard /> : dataError ? <EmptyState icon={<BarChart3 />} title="Não foi possível carregar a classificação" description="Tente novamente mais tarde." /> : <StageStandings stages={stages} />)
    : tab === 'Jogos' ? (dataLoading ? <LoadingCard /> : dataError ? <EmptyState icon={<Goal />} title="Não foi possível carregar as partidas" description="Tente novamente mais tarde." /> : allMatches.length === 0 ? <EmptyState icon={<Goal />} title="Sem partidas agendadas" description="As partidas aparecerão aqui assim que forem criadas no painel administrativo." /> : <><KnockoutBracket matches={allMatches} stages={stages} /><div className="matches-list">{allMatches.filter((match) => match.round?.phase_type !== 'KNOCKOUT').map((m) => <Link key={m.id} to={`/partidas/${m.id}`} className="match-card"><div className="match-date">{m.round?.stage_group?.name ? `${m.round.stage_group.name} · ` : ''}{m.round?.name || ''}{m.scheduled_at ? ` · ${new Date(m.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</div><div className="match-teams"><div className="match-team-side"><TeamLogo src={m.home_team?.team?.logo_url || null} name={m.home_team?.team?.name || ''} size={28} /><span>{m.home_team?.team?.name || 'A definir'}</span></div><div className="match-score-display">{(m.status === 'FINISHED' || m.status === 'LIVE') && m.home_score !== null && m.away_score !== null ? `${m.home_score} × ${m.away_score}` : <span className="match-vs">vs</span>}</div><div className="match-team-side"><TeamLogo src={m.away_team?.team?.logo_url || null} name={m.away_team?.team?.name || ''} size={28} /><span>{m.away_team?.team?.name || 'A definir'}</span></div></div></Link>)}</div></>)
    : tab === 'Artilharia' ? (dataLoading ? <LoadingCard /> : dataError ? <EmptyState icon={<Goal />} title="Não foi possível carregar a artilharia" description="Tente novamente mais tarde." /> : scorers.length === 0 ? <EmptyState icon={<Goal />} title="Sem gols registrados" description="A artilharia será calculada automaticamente a partir dos eventos das partidas." /> : <div className="stats-table">{scorers.map((s, i) => <Link to={`/jogadores/${s.player.id}`} key={s.player.id} className="stats-row"><span className="stats-pos">{i + 1}</span><PlayerPhoto src={s.player.photo_url} name={s.player.nickname} size={32} /><div className="stats-info"><strong>{s.player.nickname}</strong><span>{s.team_name || '—'}</span></div><span className="stats-count">{s.count}</span></Link>)}</div>)
    : tab === 'Assistências' ? (dataLoading ? <LoadingCard /> : dataError ? <EmptyState icon={<BarChart3 />} title="Não foi possível carregar as assistências" description="Tente novamente mais tarde." /> : assisters.length === 0 ? <EmptyState icon={<BarChart3 />} title="Sem assistências registradas" description="As assistências serão calculadas automaticamente a partir dos eventos das partidas." /> : <div className="stats-table">{assisters.map((a, i) => <Link to={`/jogadores/${a.player.id}`} key={a.player.id} className="stats-row"><span className="stats-pos">{i + 1}</span><PlayerPhoto src={a.player.photo_url} name={a.player.nickname} size={32} /><div className="stats-info"><strong>{a.player.nickname}</strong><span>{a.team_name || '—'}</span></div><span className="stats-count">{a.count}</span></Link>)}</div>)
    : <GoalkeeperRanking competitionId={competition.id} />}</section>;
}

function TeamsPage() {
  const { teams, loading, error } = useTeams();
  return <><PageIntro eyebrow="Universo FBF" title="Times" description="Conheça as equipes que fazem parte da história da FBF." /><section className="container directory-section"><div className="directory-toolbar"><div><span className="section-kicker">Base pública</span><h2>Todos os times</h2></div></div>{loading ? <LoadingCard /> : error ? <EmptyState icon={<Users />} title="Não foi possível carregar os times" description="Tente novamente mais tarde." /> : teams.length === 0 ? <EmptyState icon={<Users />} title="Ainda não há times cadastrados" description="Assim que os organizadores cadastrarem os primeiros times, eles aparecerão aqui com logo e elenco." /> : <div className="team-grid">{teams.map((team) => <Link key={team.id} to={`/times/${team.id}`} className="team-card"><div className="team-card-logo"><TeamLogo src={team.logo_url} name={team.name} size={56} /></div><h3>{team.name}</h3></Link>)}</div>}</section></>;
}

function TeamDetail() {
  const { id } = useParams();
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [seasonTeamId, setSeasonTeamId] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState('');
  const [seasonLoading, setSeasonLoading] = useState(true);
  const [seasonError, setSeasonError] = useState(false);
  const { rosters, loading: rostersLoading, error: rostersError } = useRosters(seasonTeamId || undefined);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setSeasonLoading(false);
      setTeam(null);
      setSeasonTeamId(null);
      setSeasonName('');
      return;
    }
    let active = true;
    setLoading(true);
    setSeasonLoading(true);
    setTeam(null);
    setSeasonTeamId(null);
    setSeasonName('');
    setError(false);
    setSeasonError(false);
    Promise.all([
      supabase.from('teams').select('id, name, logo_url').eq('id', id).maybeSingle(),
      supabase.from('season_teams').select('id, season_id, created_at, season:season_id ( id, name, starts_at, ends_at )').eq('team_id', id).order('created_at', { ascending: false }),
    ]).then(([teamResult, seasonTeamResult]) => {
      if (!active) return;
      setError(Boolean(teamResult.error));
      setTeam(teamResult.error ? null : teamResult.data as Team | null);
      setLoading(false);
      setSeasonError(Boolean(seasonTeamResult.error));
      const latest = (seasonTeamResult.data || [])[0] as unknown as { id: string; season: { name: string }[] } | undefined;
      setSeasonTeamId(seasonTeamResult.error ? null : latest?.id ?? null);
      setSeasonName(latest?.season[0]?.name ?? '');
      setSeasonLoading(false);
    });
    return () => { active = false; };
  }, [id, refreshVersion]);

  if (loading) return <section className="container detail-section"><LoadingCard /></section>;
  if (error) return <section className="container detail-section"><EmptyState icon={<Users />} title="Não foi possível carregar o time" description="Tente novamente mais tarde." actionLabel="Ver todos os times" actionTo="/times" /></section>;
  if (!team) return <section className="container detail-section"><EmptyState icon={<Users />} title="Time não encontrado" description="O time que você procura ainda não está cadastrado." actionLabel="Ver todos os times" actionTo="/times" /></section>;

  return <section className="container detail-section"><Link to="/times" className="back-link">← Todos os times</Link><div className="detail-hero"><div><h1>{team.name}</h1><p>Elenco e informações oficiais do time na FBF.</p></div><div className="detail-emblem"><TeamLogo src={team.logo_url} name={team.name} size={74} /></div></div><TeamRecordStats teamId={team.id} /><div className="detail-tabs"><button className="active">Elenco{seasonName ? ` · ${seasonName}` : ''}</button></div>{seasonLoading || rostersLoading ? <LoadingCard /> : seasonError || rostersError ? <EmptyState icon={<Users />} title="Não foi possível carregar o elenco" description="Tente novamente mais tarde." /> : rosters.length === 0 ? <EmptyState icon={<CircleUserRound />} title="Elenco não definido" description="Os jogadores deste time aparecerão aqui assim que um elenco for registrado em uma temporada." /> : <div className="roster-grid">{rosters.map((r) => <div key={r.id} className="roster-card"><div className="roster-number">{r.shirt_number ?? '—'}</div><div className="roster-photo"><PlayerPhoto src={r.player?.photo_url || null} name={r.player?.nickname || ''} size={44} /></div><div className="roster-info"><strong>{r.player?.nickname}</strong><span>{r.player?.position}</span></div></div>)}</div>}</section>;
}

function PlayersPage() {
  const { players, loading, error } = usePlayers();
  return <><PageIntro eyebrow="Universo FBF" title="Jogadores" description="Talentos, capitães e goleiros do futsal brasileiro." /><section className="container directory-section"><div className="directory-toolbar"><div><span className="section-kicker">Base pública</span><h2>Todos os jogadores</h2></div></div>{loading ? <LoadingCard /> : error ? <EmptyState icon={<CircleUserRound />} title="Não foi possível carregar os jogadores" description="Tente novamente mais tarde." /> : players.length === 0 ? <EmptyState icon={<CircleUserRound />} title="Os jogadores aparecerão quando as primeiras edições forem criadas" description="Assim que a administração cadastrar os jogadores, eles aparecerão aqui com posição, nacionalidade e time atual." /> : <div className="player-grid">{players.map((player) => <Link key={player.id} to={`/jogadores/${player.id}`} className="player-card"><div className="player-card-photo"><PlayerPhoto src={player.photo_url} name={player.nickname} size={52} /></div><div className="player-card-info"><strong>{player.nickname}</strong><span>{player.position}{player.nationality ? ` · ${player.nationality}` : ''}</span></div></Link>)}</div>}</section></>;
}

function PlayerDetail() {
  const { id } = useParams();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamHistory, setTeamHistory] = useState<{ team_id: string; team_name: string; team_logo: string | null; season_name: string }[]>([]);
  const [error, setError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setPlayer(null);
      setTeamHistory([]);
      return;
    }
    let active = true;
    setLoading(true);
    setPlayer(null);
    setTeamHistory([]);
    setError(false);
    setHistoryError(false);
    Promise.all([
      supabase.from('players').select('id, nickname, full_name, photo_url, nationality, position').eq('id', id).maybeSingle(),
      supabase.from('rosters').select('season_team:season_team_id ( id, season_id, season:season_id ( id, name ), team:team_id ( id, name, logo_url ) )').eq('player_id', id),
    ]).then(([playerResult, rosterResult]) => {
      if (!active) return;
      setError(Boolean(playerResult.error));
      setPlayer(playerResult.error ? null : playerResult.data as Player | null);
      setLoading(false);
      setHistoryError(Boolean(rosterResult.error));
      const rows = (rosterResult.data || []) as unknown as {
        season_team: {
          season: { name: string }[];
          team: { id: string; name: string; logo_url: string | null }[];
        }[];
      }[];
      setTeamHistory(rosterResult.error ? [] : rows.flatMap((row) => {
        const seasonTeam = row.season_team[0];
        const season = seasonTeam?.season[0];
        const team = seasonTeam?.team[0];
        return season && team
          ? [{ team_id: team.id, team_name: team.name, team_logo: team.logo_url, season_name: season.name }]
          : [];
      }));
    });
    return () => { active = false; };
  }, [id, refreshVersion]);

  if (loading) return <section className="container detail-section"><LoadingCard /></section>;
  if (error) return <section className="container detail-section"><EmptyState icon={<CircleUserRound />} title="Não foi possível carregar o jogador" description="Tente novamente mais tarde." actionLabel="Ver todos os jogadores" actionTo="/jogadores" /></section>;
  if (!player) return <section className="container detail-section"><EmptyState icon={<CircleUserRound />} title="Jogador não encontrado" description="O jogador que você procura ainda não está cadastrado." actionLabel="Ver todos os jogadores" actionTo="/jogadores" /></section>;

  return <section className="container detail-section"><Link to="/jogadores" className="back-link">← Todos os jogadores</Link><div className="detail-hero"><div><h1>{player.nickname}</h1><p>{player.full_name || ''}{player.nationality ? ` · ${player.nationality}` : ''}</p></div><div className="detail-emblem"><PlayerPhoto src={player.photo_url} name={player.nickname} size={74} /></div></div><div className="detail-meta"><div><span>Posição</span><strong>{player.position}</strong></div><div><span>Nacionalidade</span><strong>{player.nationality || '—'}</strong></div></div><PlayerCareerStats playerId={player.id} /><div className="detail-tabs"><button className="active">Carreira</button></div>{historyError ? <EmptyState icon={<Users />} title="Não foi possível carregar o histórico" description="Tente novamente mais tarde." /> : teamHistory.length === 0 ? <EmptyState icon={<Users />} title="Sem histórico de times" description="Este jogador ainda não foi vinculado a nenhum time em uma temporada." /> : <div className="team-grid">{teamHistory.map((h) => <Link key={`${h.team_id}-${h.season_name}`} to={`/times/${h.team_id}`} className="team-card"><div className="team-card-logo"><TeamLogo src={h.team_logo} name={h.team_name} size={56} /></div><h3>{h.team_name}</h3><span className="team-card-season">{h.season_name}</span></Link>)}</div>}</section>;
}

function Stats() {
  const [totals, setTotals] = useState<{ goals: number; assists: number; cleanSheetTime: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    Promise.all([
      supabase.from('player_career_statistics').select('goals, assists'),
      supabase.from('goalkeeper_clean_sheet_statistics').select('total_seconds'),
    ]).then(([statsResult, keeperResult]) => {
      if (!active) return;
      if (statsResult.error || keeperResult.error) {
        setError(true);
        setLoading(false);
        return;
      }
      const statsRows = (statsResult.data || []) as { goals: number; assists: number }[];
      const keeperRows = (keeperResult.data || []) as { total_seconds: number }[];
      setTotals({
        goals: statsRows.reduce((total, row) => total + row.goals, 0),
        assists: statsRows.reduce((total, row) => total + row.assists, 0),
        cleanSheetTime: keeperRows.reduce((total, row) => total + row.total_seconds, 0),
      });
      setLoading(false);
    });
    return () => { active = false; };
  }, [refreshVersion]);

  return (
    <>
      <PageIntro eyebrow="Dados do jogo" title="Estatísticas" description="Os números oficiais da FBF são calculados a partir de partidas finalizadas, eventos e participações registradas." />
      <section className="container stats-section">
        <div className="stats-intro"><div className="stats-mark"><BarChart3 /></div><h2>Estatísticas oficiais</h2><p>Somente placares oficiais e eventos de partidas finalizadas entram nos totais.</p></div>
        {error ? <EmptyState icon={<BarChart3 />} title="Não foi possível carregar as estatísticas" description="Tente atualizar a página em instantes." /> : loading ? <LoadingCard /> : (
          <div className="stat-preview-grid">
            <div className="stat-preview"><span>Artilharia</span><strong>{totals?.goals ?? 0}</strong><small>Gols em partidas finalizadas</small></div>
            <div className="stat-preview"><span>Assistências</span><strong>{totals?.assists ?? 0}</strong><small>Assistências em partidas finalizadas</small></div>
            <div className="stat-preview"><span>Goleiros / CS</span><strong>{formatClock(totals?.cleanSheetTime ?? 0)}</strong><small>Tempo calculável sem sofrer gol</small></div>
          </div>
        )}
      </section>
      <section className="container content-section">
        <div className="section-heading"><div><span className="section-kicker">Goleiros / CS</span><h2>Tempo sem sofrer gol</h2></div></div>
        {loading ? <LoadingCard /> : error ? <EmptyState icon={<BarChart3 />} title="Não foi possível carregar os goleiros" description="Tente atualizar a página em instantes." /> : <GoalkeeperRanking />}
      </section>
    </>
  );
}

function Login() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (session) return <section className="container auth-section"><div className="auth-card"><Check className="success-icon" /><h1>Você já está conectado</h1><p>Acesse o painel para acompanhar as áreas disponíveis para sua conta.</p><button className="button button-primary" onClick={() => navigate('/painel')}>Ir para o painel <ArrowRight size={17} /></button></div></section>;
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setMessage(''); const result = mode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } }); setBusy(false); if (result.error) { setMessage('Não foi possível concluir. Confira seus dados e tente novamente.'); return; } if (mode === 'login') { setMessage('Login realizado.'); navigate('/'); } else { setMessage(result.data.session ? 'Conta criada. Você já pode acessar a plataforma.' : 'Conta criada. Confira seu e-mail para confirmar o cadastro antes de entrar.'); } }
  return <section className="container auth-section"><div className="auth-card"><div className="auth-logo"><img src="/1389286770004463646.webp" alt="Logo FBF" /></div><span className="section-kicker">Área restrita</span><h1>{mode === 'login' ? 'Bem-vindo de volta' : 'Criar uma conta'}</h1><p>{mode === 'login' ? 'Entre para acompanhar sua área na plataforma FBF.' : 'Crie seu acesso para acompanhar novidades e competições.'}</p><form onSubmit={submit}>{mode === 'signup' && <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Como devemos chamar você?" /></label>}<label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="voce@email.com" /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} placeholder="Mínimo de 6 caracteres" /></label>{message && <div className="form-message">{message}</div>}<button className="button button-primary full-width" disabled={busy}>{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar na plataforma' : 'Criar minha conta'} <ArrowRight size={17} /></button></form><button className="switch-auth" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Ainda não tenho uma conta' : 'Já tenho uma conta'}</button></div></section>;
}

function Dashboard() {
  const { session, profile, profileLoading, profileError } = useAuth();
  if (!session) return <section className="container auth-section"><div className="auth-card"><Shield className="success-icon" /><h1>Entre para acessar o painel</h1><p>O painel é reservado para usuários autorizados pela FBF.</p><Link to="/login" className="button button-primary">Fazer login <ArrowRight size={17} /></Link></div></section>;
  if (shouldBlockOnProfile(profileLoading, Boolean(profile))) return <section className="container auth-section"><LoadingCard /></section>;
  if (profileError || !profile) return <section className="container auth-section"><EmptyState icon={<Shield />} title="Não foi possível confirmar seu perfil" description="As permissões não foram carregadas. Tente novamente mais tarde ou contate a administração da FBF." /></section>;
  const isManager = profile?.role === 'ADMIN' || profile?.role === 'ORGANIZER';
  if (!isManager) return <section className="container dashboard-section"><div className="dashboard-heading"><div><span className="section-kicker">Área administrativa</span><h1>{profile?.display_name || 'Sua conta'}</h1><p>Acompanhe seu acesso e as novidades da FBF.</p></div><span className="role-badge">{profile?.role || 'USER'}</span></div><div className="admin-empty"><div className="admin-empty-icon"><Shield /></div><div><h2>Acesso de visualização</h2><p>Seu perfil pode acompanhar todas as informações públicas da plataforma. A gestão é reservada a administradores e organizadores.</p></div></div></section>;
  return <AdminPanel profile={profile} />;
}

function CompetitionGrid({ competitions }: { competitions: Competition[] }) {
  return <div className="competition-grid">{competitions.map((competition) => <Link to={`/competicoes/${competition.id}`} className="competition-card" key={competition.id}><div className="card-top"><span className="category-label">{competition.category}</span><span className={`status-dot status-${competition.status.toLowerCase()}`}><span />{statusLabels[competition.status]}</span></div><div className="card-symbol"><img src="/1389286770004463646.webp" alt="" /></div><h3>{competition.name}</h3><div className="card-bottom"><span>Ver detalhes e edições</span><ChevronRight size={17} /></div></Link>)}</div>;
}

export default App;
