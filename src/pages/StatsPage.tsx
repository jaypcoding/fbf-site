import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Goal, Handshake } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { formatClock } from '@/lib/time';
import { usePageTitle } from '@/lib/pageTitle';
import { buildSeasonLeaders, type LeaderPlayer, type SeasonStatRow } from '@/lib/seasonLeaders';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto } from '@/components/ui';
import { GoalkeeperRanking } from '@/components/GoalkeeperRanking';

const TOP = 10;

type StatsData = {
  goals: number;
  assists: number;
  cleanSheetTime: number;
  rows: SeasonStatRow[];
  players: Map<string, LeaderPlayer>;
};

function Leaderboard({ title, icon, rows, kind, players, unit }: { title: string; icon: React.ReactNode; rows: SeasonStatRow[]; kind: 'goals' | 'assists'; players: Map<string, LeaderPlayer>; unit: [string, string] }) {
  const leaders = buildSeasonLeaders(rows, kind, players, new Map()).slice(0, TOP);
  return (
    <div className="leaderboard">
      <div className="leaderboard-heading">{icon}<h3>{title}</h3></div>
      {leaders.length === 0 ? <p className="feed-empty">Ainda não há registros.</p> : (
        <ol className="leaderboard-list">
          {leaders.map((leader, index) => (
            <li key={leader.player.id}>
              <Link to={`/jogadores/${leader.player.id}`} className={index < 3 ? `podium-${index + 1}` : ''}>
                <span className="stats-pos">{index + 1}</span>
                <PlayerPhoto src={leader.player.photo_url} name={leader.player.nickname} size={30} />
                <strong>{leader.player.nickname}</strong>
                <span className="leaderboard-count">{leader.count}<small> {leader.count === 1 ? unit[0] : unit[1]}</small></span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function StatsPage() {
  usePageTitle('Estatísticas');
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    async function load(): Promise<StatsData> {
      const [statsResult, keeperResult] = await Promise.all([
        supabase.from('player_career_statistics').select('player_id, goals, assists'),
        supabase.from('goalkeeper_clean_sheet_statistics').select('total_seconds'),
      ]);
      if (statsResult.error || keeperResult.error) throw statsResult.error ?? keeperResult.error;
      const rows = (statsResult.data || []) as SeasonStatRow[];
      const keeperRows = (keeperResult.data || []) as { total_seconds: number }[];
      // Every player with at least one goal or assist, so ties at the cut-off are
      // ordered correctly by name.
      const topIds = new Set(rows.filter((row) => row.goals > 0 || row.assists > 0).map((row) => row.player_id));
      const players = new Map<string, LeaderPlayer>();
      if (topIds.size > 0) {
        const { data: playerRows, error: playersError } = await supabase.from('players').select('id, nickname, photo_url, position').in('id', [...topIds]);
        if (playersError) throw playersError;
        for (const player of (playerRows || []) as LeaderPlayer[]) players.set(player.id, player);
      }
      return {
        goals: rows.reduce((total, row) => total + row.goals, 0),
        assists: rows.reduce((total, row) => total + row.assists, 0),
        cleanSheetTime: keeperRows.reduce((total, row) => total + row.total_seconds, 0),
        rows,
        players,
      };
    }
    load().then((result) => {
      if (!active) return;
      setData(result);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, [refreshVersion]);

  return (
    <>
      <PageIntro eyebrow="Dados do jogo" title="Estatísticas" description="Os números oficiais da FBF são calculados a partir de partidas finalizadas, eventos e participações registradas." />
      <section className="container stats-section">
        {error ? <EmptyState icon={<BarChart3 />} title="Não foi possível carregar as estatísticas" description="Tente atualizar a página em instantes." /> : loading || !data ? <LoadingCard /> : (
          <>
            <div className="stat-preview-grid">
              <div className="stat-preview"><span>Gols</span><strong>{data.goals}</strong><small>Em partidas finalizadas</small></div>
              <div className="stat-preview"><span>Assistências</span><strong>{data.assists}</strong><small>Em partidas finalizadas</small></div>
              <div className="stat-preview"><span>Goleiros / CS</span><strong>{formatClock(data.cleanSheetTime)}</strong><small>Tempo total sem sofrer gol</small></div>
            </div>
            <div className="leaderboard-grid">
              <Leaderboard title="Artilharia histórica" icon={<Goal size={18} />} rows={data.rows} kind="goals" players={data.players} unit={['gol', 'gols']} />
              <Leaderboard title="Garçons históricos" icon={<Handshake size={18} />} rows={data.rows} kind="assists" players={data.players} unit={['assist.', 'assist.']} />
            </div>
          </>
        )}
      </section>
      <section className="container content-section">
        <div className="section-heading"><div><span className="section-kicker">Goleiros / CS</span><h2>Tempo sem sofrer gol</h2></div></div>
        <GoalkeeperRanking />
      </section>
    </>
  );
}
