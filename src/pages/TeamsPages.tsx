import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CircleUserRound, Users } from 'lucide-react';
import { supabase, type Team } from '@/lib/supabase';
import { useRosters, useTeams } from '@/lib/hooks';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { matchesSearch } from '@/lib/search';
import { plural } from '@/lib/format';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto, TeamLogo } from '@/components/ui';
import { SearchField } from '@/components/site';
import { TeamRecordStats } from '@/components/TeamRecordStats';

export function TeamsPage() {
  usePageTitle('Times');
  const { teams, loading, error } = useTeams();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('busca') ?? '';
  const setQuery = (value: string) => setSearchParams(value ? { busca: value } : {}, { replace: true });
  const filtered = teams.filter((team) => matchesSearch(query, team.name));

  return <>
    <PageIntro eyebrow="Universo FBF" title="Times" description="Conheça as equipes que fazem parte da história da FBF." />
    <section className="container directory-section">
      <div className="directory-toolbar">
        <div><span className="section-kicker">Base pública</span><h2>Todos os times</h2>{!loading && !error && <p className="directory-count">{plural(filtered.length, 'time', 'times')}{query ? ' encontrados' : ''}</p>}</div>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar time" label="Buscar time" />
      </div>
      {loading ? <LoadingCard />
        : error ? <EmptyState icon={<Users />} title="Não foi possível carregar os times" description="Tente novamente mais tarde." />
        : teams.length === 0 ? <EmptyState icon={<Users />} title="Ainda não há times cadastrados" description="Assim que os organizadores cadastrarem os primeiros times, eles aparecerão aqui com logo e elenco." />
        : filtered.length === 0 ? <EmptyState icon={<Users />} title="Nenhum time encontrado" description={`Nenhum time corresponde a “${query}”.`} />
        : <div className="team-grid">{filtered.map((team) => <Link key={team.id} to={`/times/${team.id}`} className="team-card"><div className="team-card-logo"><TeamLogo src={team.logo_url} name={team.name} size={56} /></div><h3>{team.name}</h3></Link>)}</div>}
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
