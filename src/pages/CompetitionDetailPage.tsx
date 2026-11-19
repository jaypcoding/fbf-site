import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BarChart3, CalendarDays, Goal, Trophy, Users } from 'lucide-react';
import { supabase, type Match } from '@/lib/supabase';
import { useCompetitions, useSeasons, useSeasonTeams, useStages } from '@/lib/hooks';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { COMPETITION_TABS, DEFAULT_COMPETITION_TAB, slugFromTab, tabFromSlug, type CompetitionTab } from '@/lib/competitionTabs';
import { buildSeasonLeaders, type LeaderPlayer, type SeasonStatRow } from '@/lib/seasonLeaders';
import { competitionStatusLabels } from '@/lib/labels';
import { formatLongDate, plural } from '@/lib/format';
import { usePageTitle } from '@/lib/pageTitle';
import { one } from '@/lib/relations';
import { EmptyState, LoadingCard, PlayerPhoto, TeamLogo } from '@/components/ui';
import { FBF_LOGO, MatchCard } from '@/components/site';
import { GoalkeeperRanking } from '@/components/GoalkeeperRanking';
import { StageStandings } from '@/components/StageStandings';
import { KnockoutBracket } from '@/components/KnockoutBracket';

type LeaderData = { rows: SeasonStatRow[]; players: Map<string, LeaderPlayer>; teams: Map<string, string> };
const EMPTY_LEADER_DATA: LeaderData = { rows: [], players: new Map(), teams: new Map() };

const MATCH_LIST_SELECT = 'id, round_id, home_team_id, away_team_id, scheduled_at, home_score, away_score, status, series_id, series_leg, home_source_match_id, home_source_outcome, away_source_match_id, away_source_outcome, home_team:home_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), away_team:away_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), round:round_id ( id, stage_id, name, round_order, phase_type, stage_group_id, leg_number, bracket_round, stage_group:stage_group_id ( id, name, group_order ) )';

// Groups the non-knockout matches by round, keeping the round order.
function groupByRound(matches: Match[]) {
  const groups = new Map<string, { key: string; label: string; order: number; matches: Match[] }>();
  for (const match of matches) {
    const key = match.round_id;
    const group = groups.get(key) ?? {
      key,
      label: [match.round?.stage_group?.name, match.round?.name].filter(Boolean).join(' · ') || 'Partidas',
      order: (match.round?.stage_group?.group_order ?? 0) * 1000 + (match.round?.round_order ?? 0),
      matches: [],
    };
    group.matches.push(match);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

function LeaderTable({ leaders }: { leaders: ReturnType<typeof buildSeasonLeaders> }) {
  return (
    <div className="stats-table">
      {leaders.map((leader, index) => (
        <Link to={`/jogadores/${leader.player.id}`} key={leader.player.id} className={`stats-row${index < 3 ? ` podium podium-${index + 1}` : ''}`}>
          <span className="stats-pos">{index + 1}</span>
          <PlayerPhoto src={leader.player.photo_url} name={leader.player.nickname} size={34} />
          <div className="stats-info"><strong>{leader.player.nickname}</strong><span>{leader.team_name || '—'}</span></div>
          <span className="stats-count">{leader.count}</span>
        </Link>
      ))}
    </div>
  );
}

export function CompetitionDetailPage() {
  const { id } = useParams();
  const { competitions, loading, error: competitionsError } = useCompetitions();
  const competition = competitions.find((item) => item.id === id);
  usePageTitle(competition?.name ?? (loading ? null : 'Competição'));
  // Tab and edition live in the URL (?aba=…&edicao=…) so links can be shared
  // and the browser back button works.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromSlug(searchParams.get('aba'));
  const selectedSeasonId = searchParams.get('edicao') ?? '';
  const updateParams = (key: 'aba' | 'edicao', value: string, isDefault: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (isDefault || !value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const setTab = (nextTab: CompetitionTab) => updateParams('aba', slugFromTab(nextTab), nextTab === DEFAULT_COMPETITION_TAB);
  const { seasons, loading: seasonsLoading, error: seasonsError } = useSeasons(id);
  const setSelectedSeasonId = (seasonId: string) => updateParams('edicao', seasonId, seasonId === seasons[0]?.id);
  const activeSeason = seasons.find((season) => season.id === selectedSeasonId) ?? seasons[0];
  const { seasonTeams, loading: stLoading, error: seasonTeamsError } = useSeasonTeams(activeSeason?.id);
  const { stages, loading: stagesLoading, error: stagesError } = useStages(activeSeason?.id);
  const [allMatches, setAllMatches] = useState<Match[]>([]);
  const [leaderData, setLeaderData] = useState<LeaderData>(EMPTY_LEADER_DATA);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(false);
  const refreshVersion = useAdminDataVersion();

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
      const { data: matchData, error: matchesError } = await supabase.from('matches').select(MATCH_LIST_SELECT).in('round_id', roundIds).order('scheduled_at', { ascending: true });
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
        const seasonTeam = one(roster.season_team);
        const teamName = one(seasonTeam?.team)?.name;
        if (seasonTeam?.season_id === seasonId && teamName && !teams.has(roster.player_id)) {
          teams.set(roster.player_id, teamName);
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
  const groupMatches = allMatches.filter((match) => match.round?.phase_type !== 'KNOCKOUT');
  const finishedCount = allMatches.filter((match) => match.status === 'FINISHED').length;
  const nextMatch = allMatches.find((match) => match.status === 'LIVE') ?? allMatches.find((match) => match.status === 'SCHEDULED' && match.scheduled_at && Date.parse(match.scheduled_at) >= Date.now());
  const lastResult = [...allMatches].reverse().find((match) => match.status === 'FINISHED');
  const startsAt = formatLongDate(activeSeason?.starts_at);
  const endsAt = formatLongDate(activeSeason?.ends_at);
  const isArchived = competition.status === 'CANCELLED';

  function renderTab() {
    if (seasonsError || stagesError) return <EmptyState icon={<CalendarDays />} title="Não foi possível carregar as edições" description="Tente novamente mais tarde." />;
    switch (tab) {
      case 'Visão geral':
        if (!activeSeason) return <EmptyState icon={<CalendarDays />} title="Edição ainda não iniciada" description="Esta competição já está cadastrada na FBF. Assim que uma temporada for criada, jogos, times e estatísticas aparecerão nesta página." />;
        return (
          <div className="detail-overview">
            <div className="overview-grid">
              <div className="overview-card">
                <span className="section-kicker">Edição selecionada</span>
                <h2>{activeSeason.name}</h2>
                <p>{startsAt ? `Início em ${startsAt}` : 'Data de início a definir'}{endsAt ? ` · término em ${endsAt}` : ''}</p>
                {!dataLoading && !dataError && allMatches.length > 0 && (
                  <div className="overview-progress">
                    <div className="progress-track"><span style={{ width: `${Math.round((finishedCount / allMatches.length) * 100)}%` }} /></div>
                    <small>{finishedCount} de {plural(allMatches.length, 'partida disputada', 'partidas disputadas')}</small>
                  </div>
                )}
              </div>
              {!dataLoading && !dataError && (nextMatch || lastResult) && (
                <div className="overview-matches">
                  {nextMatch && <div><span className="section-kicker">{nextMatch.status === 'LIVE' ? 'Ao vivo' : 'Próximo jogo'}</span><MatchCard match={nextMatch} /></div>}
                  {lastResult && <div><span className="section-kicker">Último resultado</span><MatchCard match={lastResult} /></div>}
                </div>
              )}
            </div>
            {stLoading ? <LoadingCard />
              : seasonTeamsError ? <EmptyState icon={<Users />} title="Não foi possível carregar os times" description="Tente novamente mais tarde." />
              : teamCount > 0 && (
                <div className="overview-teams">
                  <h3>Equipes inscritas</h3>
                  <div className="team-chips">
                    {seasonTeams.map((st) => <Link key={st.id} to={`/times/${st.team_id}`} className="team-chip"><TeamLogo src={st.team?.logo_url || null} name={st.team?.name || ''} size={28} /><span>{st.team?.name}</span></Link>)}
                  </div>
                </div>
              )}
          </div>
        );
      case 'Times':
        if (stLoading) return <LoadingCard />;
        if (seasonTeamsError) return <EmptyState icon={<Users />} title="Não foi possível carregar os times" description="Tente novamente mais tarde." />;
        if (teamCount === 0) return <EmptyState icon={<Users />} title="Nenhum time inscrito" description="Os times serão exibidos aqui assim que forem inscritos nesta temporada." />;
        return <div className="team-grid">{seasonTeams.map((st) => <Link key={st.id} to={`/times/${st.team_id}`} className="team-card"><div className="team-card-logo"><TeamLogo src={st.team?.logo_url || null} name={st.team?.name || ''} size={56} /></div><h3>{st.team?.name}</h3></Link>)}</div>;
      case 'Classificação':
        if (dataLoading) return <LoadingCard />;
        if (dataError) return <EmptyState icon={<BarChart3 />} title="Não foi possível carregar a classificação" description="Tente novamente mais tarde." />;
        return <StageStandings stages={stages} />;
      case 'Jogos':
        if (dataLoading) return <LoadingCard />;
        if (dataError) return <EmptyState icon={<Goal />} title="Não foi possível carregar as partidas" description="Tente novamente mais tarde." />;
        if (allMatches.length === 0) return <EmptyState icon={<Goal />} title="Sem partidas agendadas" description="As partidas aparecerão aqui assim que forem criadas pela organização." />;
        return <>
          <KnockoutBracket matches={allMatches} stages={stages} />
          {groupByRound(groupMatches).map((group) => (
            <div className="round-block" key={group.key}>
              <h3 className="round-heading">{group.label}</h3>
              <div className="matches-list">{group.matches.map((match) => <MatchCard key={match.id} match={match} />)}</div>
            </div>
          ))}
        </>;
      case 'Artilharia':
        if (dataLoading) return <LoadingCard />;
        if (dataError) return <EmptyState icon={<Goal />} title="Não foi possível carregar a artilharia" description="Tente novamente mais tarde." />;
        if (scorers.length === 0) return <EmptyState icon={<Goal />} title="Sem gols registrados" description="A artilharia é calculada automaticamente a partir dos eventos das partidas finalizadas." />;
        return <LeaderTable leaders={scorers} />;
      case 'Assistências':
        if (dataLoading) return <LoadingCard />;
        if (dataError) return <EmptyState icon={<BarChart3 />} title="Não foi possível carregar as assistências" description="Tente novamente mais tarde." />;
        if (assisters.length === 0) return <EmptyState icon={<BarChart3 />} title="Sem assistências registradas" description="As assistências são calculadas automaticamente a partir dos eventos das partidas finalizadas." />;
        return <LeaderTable leaders={assisters} />;
      default:
        return <GoalkeeperRanking competitionId={competition!.id} />;
    }
  }

  return (
    <section className="container detail-section">
      <Link to="/competicoes" className="back-link">← Todas as competições</Link>
      <div className="detail-hero">
        <div>
          <span className="status-pill"><span /> {competitionStatusLabels[competition.status]}</span>
          <h1>{competition.name}</h1>
          <p>{competition.description || 'Uma competição oficial da Federação Brasileira de Futsal.'}</p>
        </div>
        <div className="detail-emblem"><img src={FBF_LOGO} alt="" /></div>
      </div>
      {isArchived && <p className="archived-note">Competição arquivada: as informações ficam disponíveis apenas para consulta.</p>}
      <div className="detail-meta">
        <div><span>Categoria</span><strong>{competition.category}</strong></div>
        <div><span>Formato</span><strong>{competition.format}</strong></div>
        <div>
          {seasons.length > 1
            ? <label className="form-field"><span>Edição</span><select aria-label="Selecionar edição" value={activeSeason?.id ?? ''} onChange={(event) => setSelectedSeasonId(event.target.value)}>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
            : <><span>Edição</span><strong>{activeSeason ? activeSeason.name : 'A definir'}</strong></>}
        </div>
        <div><span>Equipes</span><strong>{teamCount > 0 ? teamCount : '—'}</strong></div>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Seções da competição">
        {COMPETITION_TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}
      </div>
      <div role="tabpanel">{renderTab()}</div>
    </section>
  );
}
