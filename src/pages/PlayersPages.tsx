import { Link, useSearchParams } from 'react-router-dom';
import { CircleUserRound } from 'lucide-react';
import { type Player } from '@/lib/supabase';
import { usePlayers } from '@/lib/hooks';
import { usePageTitle } from '@/lib/pageTitle';
import { matchesSearch } from '@/lib/search';
import { plural } from '@/lib/format';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto } from '@/components/ui';
import { SearchField } from '@/components/site';

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
          <Link key={player.id} to={`/jogadores/${player.slug ?? player.id}`} className="player-card">
            <div className="player-card-photo"><PlayerPhoto src={player.photo_url} name={player.nickname} size={52} /></div>
            <div className="player-card-info"><strong>{player.nickname}</strong><span>{player.position}{player.nationality ? ` · ${player.nationality}` : ''}</span></div>
          </Link>
        ))}</div>}
    </section>
  </>;
}

// The full profile lives in its own file; re-exported so routes stay the same.
export { PlayerDetailPage } from './PlayerProfilePage';
