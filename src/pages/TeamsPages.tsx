import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CircleUserRound, Users } from 'lucide-react';
import { supabase, type Team } from '@/lib/supabase';
import { useRosters, useTeamParticipation, useTeams } from '@/lib/hooks';
import {
  DEFAULT_TEAM_VIEW,
  NO_COMPETITION_LABEL,
  TEAM_VIEWS,
  teamCategoryLabels,
  teamsForView,
  viewDefinition,
  viewFromParam,
  type TeamView,
} from '@/lib/teamCategories';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { matchesSearch } from '@/lib/search';
import { plural } from '@/lib/format';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto, TeamLogo } from '@/components/ui';
import { SearchField } from '@/components/site';
import { TeamRecordStats } from '@/components/TeamRecordStats';

export function TeamsPage() {
  usePageTitle('Times');
  const { teams, loading: teamsLoading, error: teamsError } = useTeams();
  const { links, loading: linksLoading, error: linksError } = useTeamParticipation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('busca') ?? '';
  const view = viewFromParam(searchParams.get('categoria'));
  // Old links (/times, /times?busca=...) keep opening TODOS; only other views add ?categoria=.
  const updateParams = (next: { busca?: string; categoria?: TeamView }) => {
    const busca = next.busca ?? query;
    const categoria = next.categoria ?? view;
    const params: Record<string, string> = {};
    if (categoria !== DEFAULT_TEAM_VIEW) params.categoria = categoria;
    if (busca) params.busca = busca;
    setSearchParams(params, { replace: true });
  };
  const loading = teamsLoading || linksLoading;
  const error = teamsError || linksError;
  const labels = useMemo(() => teamCategoryLabels(links), [links]);
  const counts = useMemo(() => Object.fromEntries(TEAM_VIEWS.map((item) => [item.slug, teamsForView(teams, links, item.slug).teams.length])), [teams, links]);
  const { teams: inView, edition } = teamsForView(teams, links, view);
  const filtered = inView.filter((team) => matchesSearch(query, team.name));
  const definition = viewDefinition(view);
  const heading = view === 'todos' ? 'Todos os times' : `Times ${definition.label}`;

  return <>
    <PageIntro eyebrow="Universo FBF" title="Times" description="Conheça as equipes que fazem parte da história da FBF." />
    <section className="container directory-section">
      <div className="detail-tabs team-view-tabs" role="tablist" aria-label="Categorias de times">
        {TEAM_VIEWS.map((item) => (
          <button key={item.slug} type="button" role="tab" aria-selected={view === item.slug} className={view === item.slug ? 'active' : ''}
            onClick={() => updateParams({ categoria: item.slug })}>
            {item.label}{!loading && !error && <span className="team-view-count">{counts[item.slug]}</span>}
          </button>
        ))}
      </div>
      <div className="directory-toolbar">
        <div>
          <span className="section-kicker">{edition ? `${edition.competitionName} · ${edition.seasonName}` : 'Base pública'}</span>
          <h2>{heading}</h2>
          {!loading && !error && <p className="directory-count">{plural(filtered.length, 'time', 'times')}{query ? ' encontrados' : ''}</p>}
        </div>
        <SearchField value={query} onChange={(value) => updateParams({ busca: value })} placeholder="Buscar time" label="Buscar time" />
      </div>
      <div role="tabpanel">
        {loading ? <LoadingCard />
          : error ? <EmptyState icon={<Users />} title="Não foi possível carregar os times" description="Tente novamente mais tarde." />
          : teams.length === 0 ? <EmptyState icon={<Users />} title="Ainda não há times cadastrados" description="Assim que os organizadores cadastrarem os primeiros times, eles aparecerão aqui com logo e elenco." />
          : view !== 'todos' && !edition ? <EmptyState icon={<Users />} title={`Nenhuma competição ${definition.label} em andamento`} description="Quando a próxima edição for publicada, os times inscritos aparecerão aqui." />
          : inView.length === 0 ? <EmptyState icon={<Users />} title="Ainda não há times nesta categoria" description="Os times aparecem aqui assim que forem aprovados na temporada." />
          : filtered.length === 0 ? <EmptyState icon={<Users />} title="Nenhum time encontrado" description={`Nenhum time desta aba corresponde a “${query}”.`} />
          : <div className="team-grid">{filtered.map((team) => (
            <Link key={team.id} to={`/times/${team.id}`} className="team-card">
              <div className="team-card-logo"><TeamLogo src={team.logo_url} name={team.name} size={56} /></div>
              <h3>{team.name}</h3>
              {view === 'todos' && <span className="team-card-category">{(labels.get(team.id) ?? [NO_COMPETITION_LABEL]).join(' · ')}</span>}
            </Link>
          ))}</div>}
      </div>
    </section>
  </>;
}

type SeasonTeamRow = { id: string; season: { id: string; name: string } | null };

export function TeamDetailPage() {
  const { id } = useParams();
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [seasonTeams, setSeasonTeams] = useState<SeasonTeamRow[]>([]);
  const [selectedSeasonTeamId, setSelectedSeasonTeamId] = useState<string | null>(null);
  const [seasonError, setSeasonError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  const seasonTeamId = selectedSeasonTeamId ?? seasonTeams[0]?.id ?? null;
  const { rosters, loading: rostersLoading, error: rostersError } = useRosters(seasonTeamId || undefined);
  usePageTitle(team?.name ?? (loading ? null : 'Time'));

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setTeam(null);
      setSeasonTeams([]);
      return;
    }
    let active = true;
    setLoading(true);
    setTeam(null);
    setSeasonTeams([]);
    setSelectedSeasonTeamId(null);
    setError(false);
    setSeasonError(false);
    // Season names are fetched separately: the roster must still load if the
    // seasons table is not readable for this visitor.
    Promise.all([
      supabase.from('teams').select('id, name, logo_url').eq('id', id).maybeSingle(),
      supabase.from('season_teams').select('id, season_id, created_at').eq('team_id', id).order('created_at', { ascending: false }),
    ]).then(async ([teamResult, seasonTeamResult]) => {
      if (!active) return;
      const rows = (seasonTeamResult.data || []) as { id: string; season_id: string }[];
      const seasonNames = new Map<string, string>();
      if (rows.length > 0) {
        const { data: seasonRows } = await supabase.from('seasons').select('id, name').in('id', rows.map((row) => row.season_id));
        for (const season of (seasonRows || []) as { id: string; name: string }[]) seasonNames.set(season.id, season.name);
      }
      if (!active) return;
      setError(Boolean(teamResult.error));
      setTeam(teamResult.error ? null : teamResult.data as Team | null);
      setSeasonError(Boolean(seasonTeamResult.error));
      setSeasonTeams(seasonTeamResult.error ? [] : rows.map((row) => ({
        id: row.id,
        season: seasonNames.has(row.season_id) ? { id: row.season_id, name: seasonNames.get(row.season_id)! } : null,
      })));
      setLoading(false);
    });
    return () => { active = false; };
  }, [id, refreshVersion]);

  if (loading) return <section className="container detail-section"><LoadingCard /></section>;
  if (error) return <section className="container detail-section"><EmptyState icon={<Users />} title="Não foi possível carregar o time" description="Tente novamente mais tarde." actionLabel="Ver todos os times" actionTo="/times" /></section>;
  if (!team) return <section className="container detail-section"><EmptyState icon={<Users />} title="Time não encontrado" description="O time que você procura ainda não está cadastrado." actionLabel="Ver todos os times" actionTo="/times" /></section>;

  return (
    <section className="container detail-section">
      <Link to="/times" className="back-link">← Todos os times</Link>
      <div className="detail-hero">
        <div><span className="status-pill"><span /> Time FBF</span><h1>{team.name}</h1><p>Elenco e números oficiais do time na FBF.</p></div>
        <div className="detail-emblem"><TeamLogo src={team.logo_url} name={team.name} size={74} /></div>
      </div>
      <TeamRecordStats teamId={team.id} />
      <div className="section-toolbar">
        <h2 className="match-page-heading">Elenco</h2>
        {seasonTeams.length > 1 && (
          <select className="inline-select" aria-label="Selecionar temporada do elenco" value={seasonTeamId ?? ''} onChange={(event) => setSelectedSeasonTeamId(event.target.value)}>
            {seasonTeams.map((row) => <option key={row.id} value={row.id}>{row.season?.name ?? 'Temporada'}</option>)}
          </select>
        )}
        {seasonTeams.length === 1 && seasonTeams[0].season && <span className="section-toolbar-note">{seasonTeams[0].season.name}</span>}
      </div>
      {rostersLoading && seasonTeamId ? <LoadingCard />
        : seasonError || rostersError ? <EmptyState icon={<Users />} title="Não foi possível carregar o elenco" description="Tente novamente mais tarde." />
        : rosters.length === 0 ? <EmptyState icon={<CircleUserRound />} title="Elenco não definido" description="Os jogadores deste time aparecerão aqui assim que um elenco for registrado em uma temporada." />
        : <div className="roster-grid">{rosters.map((r) => (
          <Link key={r.id} to={`/jogadores/${r.player_id}`} className="roster-card">
            <div className="roster-number">{r.shirt_number ?? '—'}</div>
            <div className="roster-photo"><PlayerPhoto src={r.player?.photo_url || null} name={r.player?.nickname || ''} size={44} /></div>
            <div className="roster-info"><strong>{r.player?.nickname}</strong><span>{r.player?.position}</span></div>
          </Link>
        ))}</div>}
    </section>
  );
}
