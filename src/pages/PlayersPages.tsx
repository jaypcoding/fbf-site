import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CircleUserRound, Users } from 'lucide-react';
import { supabase, type Player } from '@/lib/supabase';
import { usePlayers } from '@/lib/hooks';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { matchesSearch } from '@/lib/search';
import { one } from '@/lib/relations';
import { plural } from '@/lib/format';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto, TeamLogo } from '@/components/ui';
import { SearchField } from '@/components/site';
import { PlayerCareerStats } from '@/components/PlayerCareerStats';

const POSITIONS: Player['position'][] = ['Goleiro', 'Volante', 'Pivô'];

export function PlayersPage() {
  usePageTitle('Jogadores');
  const { players, loading, error } = usePlayers();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('busca') ?? '';
  const position = searchParams.get('posicao') ?? '';
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const filtered = players.filter((player) => (!position || player.position === position)
    && matchesSearch(query, player.nickname, player.full_name, player.nationality));

  return <>
    <PageIntro eyebrow="Universo FBF" title="Jogadores" description="Talentos, capitães e goleiros do futsal brasileiro." />
    <section className="container directory-section">
      <div className="directory-toolbar">
        <div><span className="section-kicker">Base pública</span><h2>Todos os jogadores</h2>{!loading && !error && <p className="directory-count">{plural(filtered.length, 'jogador', 'jogadores')}{query || position ? ' encontrados' : ''}</p>}</div>
        <div className="filter-controls">
          <SearchField value={query} onChange={(value) => setParam('busca', value)} placeholder="Buscar por apelido ou nome" label="Buscar jogador" />
          <select value={position} onChange={(event) => setParam('posicao', event.target.value)} aria-label="Filtrar por posição">
            <option value="">Todas as posições</option>
            {POSITIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>
      {loading ? <LoadingCard />
        : error ? <EmptyState icon={<CircleUserRound />} title="Não foi possível carregar os jogadores" description="Tente novamente mais tarde." />
        : players.length === 0 ? <EmptyState icon={<CircleUserRound />} title="Os jogadores aparecerão quando as primeiras edições forem criadas" description="Assim que a administração cadastrar os jogadores, eles aparecerão aqui com posição, nacionalidade e time atual." />
        : filtered.length === 0 ? <EmptyState icon={<CircleUserRound />} title="Nenhum jogador encontrado" description="Ajuste a busca ou o filtro de posição." />
        : <div className="player-grid">{filtered.map((player) => (
          <Link key={player.id} to={`/jogadores/${player.id}`} className="player-card">
            <div className="player-card-photo"><PlayerPhoto src={player.photo_url} name={player.nickname} size={52} /></div>
            <div className="player-card-info"><strong>{player.nickname}</strong><span>{player.position}{player.nationality ? ` · ${player.nationality}` : ''}</span></div>
          </Link>
        ))}</div>}
    </section>
  </>;
}

type HistoryEntry = { key: string; team_id: string; team_name: string; team_logo: string | null; season_name: string | null; shirt_number: number | null };

type RosterHistoryRow = {
  shirt_number: number | null;
  season_team: { id: string; season_id: string; created_at: string; team: { id: string; name: string; logo_url: string | null } | null } | null;
};

export function PlayerDetailPage() {
  const { id } = useParams();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamHistory, setTeamHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const refreshVersion = useAdminDataVersion();
  usePageTitle(player?.nickname ?? (loading ? null : 'Jogador'));

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
    // Season names are fetched separately so the history still shows the teams
    // if the seasons table is not readable for this visitor.
    Promise.all([
      supabase.from('players').select('id, nickname, full_name, photo_url, nationality, position').eq('id', id).maybeSingle(),
      supabase.from('rosters').select('shirt_number, season_team:season_team_id ( id, season_id, created_at, team:team_id ( id, name, logo_url ) )').eq('player_id', id),
    ]).then(async ([playerResult, rosterResult]) => {
      if (!active) return;
      const rows = ((rosterResult.data || []) as unknown as RosterHistoryRow[])
        .map((row) => ({ shirt: row.shirt_number, seasonTeam: one(row.season_team) }))
        .filter((row) => row.seasonTeam && one(row.seasonTeam.team));
      const seasonNames = new Map<string, string>();
      if (rows.length > 0) {
        const { data: seasonRows } = await supabase.from('seasons').select('id, name').in('id', rows.map((row) => row.seasonTeam!.season_id));
        for (const season of (seasonRows || []) as { id: string; name: string }[]) seasonNames.set(season.id, season.name);
      }
      if (!active) return;
      setError(Boolean(playerResult.error));
      setPlayer(playerResult.error ? null : playerResult.data as Player | null);
      setHistoryError(Boolean(rosterResult.error));
      setTeamHistory(rosterResult.error ? [] : rows
        .sort((a, b) => Date.parse(b.seasonTeam!.created_at) - Date.parse(a.seasonTeam!.created_at))
        .map((row) => {
          const team = one(row.seasonTeam!.team)!;
          return {
            key: row.seasonTeam!.id,
            team_id: team.id,
            team_name: team.name,
            team_logo: team.logo_url,
            season_name: seasonNames.get(row.seasonTeam!.season_id) ?? null,
            shirt_number: row.shirt,
          };
        }));
      setLoading(false);
    });
    return () => { active = false; };
  }, [id, refreshVersion]);

  if (loading) return <section className="container detail-section"><LoadingCard /></section>;
  if (error) return <section className="container detail-section"><EmptyState icon={<CircleUserRound />} title="Não foi possível carregar o jogador" description="Tente novamente mais tarde." actionLabel="Ver todos os jogadores" actionTo="/jogadores" /></section>;
  if (!player) return <section className="container detail-section"><EmptyState icon={<CircleUserRound />} title="Jogador não encontrado" description="O jogador que você procura ainda não está cadastrado." actionLabel="Ver todos os jogadores" actionTo="/jogadores" /></section>;

  const currentTeam = teamHistory[0];

  return (
    <section className="container detail-section">
      <Link to="/jogadores" className="back-link">← Todos os jogadores</Link>
      <div className="detail-hero">
        <div><span className="status-pill"><span /> {player.position}</span><h1>{player.nickname}</h1><p>{[player.full_name, player.nationality].filter(Boolean).join(' · ') || 'Jogador registrado na FBF.'}</p></div>
        <div className="detail-emblem"><PlayerPhoto src={player.photo_url} name={player.nickname} size={74} /></div>
      </div>
      <div className="detail-meta">
        <div><span>Posição</span><strong>{player.position}</strong></div>
        <div><span>Nacionalidade</span><strong>{player.nationality || '—'}</strong></div>
        <div><span>Time mais recente</span><strong>{currentTeam ? <Link to={`/times/${currentTeam.team_id}`} className="inline-link">{currentTeam.team_name}</Link> : '—'}</strong></div>
        <div><span>Camisa</span><strong>{currentTeam?.shirt_number ?? '—'}</strong></div>
      </div>
      <PlayerCareerStats playerId={player.id} />
      <h2 className="match-page-heading">Carreira</h2>
      {historyError ? <EmptyState icon={<Users />} title="Não foi possível carregar o histórico" description="Tente novamente mais tarde." />
        : teamHistory.length === 0 ? <EmptyState icon={<Users />} title="Sem histórico de times" description="Este jogador ainda não foi vinculado a nenhum time em uma temporada." />
        : <div className="team-grid">{teamHistory.map((h) => (
          <Link key={h.key} to={`/times/${h.team_id}`} className="team-card">
            <div className="team-card-logo"><TeamLogo src={h.team_logo} name={h.team_name} size={56} /></div>
            <h3>{h.team_name}</h3>
            {h.season_name && <span className="team-card-season">{h.season_name}</span>}
          </Link>
        ))}</div>}
    </section>
  );
}
