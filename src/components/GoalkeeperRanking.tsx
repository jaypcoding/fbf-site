import { useEffect, useMemo, useState } from 'react';
import { Hand } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatClock } from '@/lib/time';
import { LoadingCard, EmptyState, PlayerPhoto, TeamLogo } from '@/components/ui';
import { useAdminDataVersion } from '@/lib/adminRefresh';

type KeeperRow = {
  player_id: string;
  nickname: string;
  photo_url: string | null;
  team_id: string;
  team_name: string;
  team_logo_url: string | null;
  games: number;
  clean_sheets: number;
  total_seconds: number;
};

type Keeper = {
  playerId: string;
  nickname: string;
  photo: string | null;
  teamName: string;
  teamLogo: string | null;
  games: number;
  cleanSheets: number;
  totalSeconds: number;
};

export function GoalkeeperRanking({ competitionId }: { competitionId?: string }) {
  const [rows, setRows] = useState<KeeperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    let query = supabase
      .from('goalkeeper_clean_sheet_statistics')
      .select('player_id, nickname, photo_url, team_id, team_name, team_logo_url, games, clean_sheets, total_seconds');
    if (competitionId) query = query.eq('competition_id', competitionId);
    query.then(({ data, error: queryError }) => {
      if (!active) return;
      setError(Boolean(queryError));
      setRows(queryError ? [] : ((data || []) as KeeperRow[]));
      setLoading(false);
    });
    return () => { active = false; };
  }, [competitionId, refreshVersion]);

  const keepers = useMemo(() => {
    const byPlayer = new Map<string, Keeper>();
    for (const row of rows) {
      const current = byPlayer.get(row.player_id) ?? {
        playerId: row.player_id,
        nickname: row.nickname,
        photo: row.photo_url,
        teamName: row.team_name,
        teamLogo: row.team_logo_url,
        games: 0,
        cleanSheets: 0,
        totalSeconds: 0,
      };
      if (current.teamName !== row.team_name) {
        current.teamName = 'Vários times';
        current.teamLogo = null;
      }
      current.games += row.games;
      current.cleanSheets += row.clean_sheets;
      current.totalSeconds += row.total_seconds;
      byPlayer.set(row.player_id, current);
    }
    return [...byPlayer.values()].sort((a, b) => b.totalSeconds - a.totalSeconds || b.cleanSheets - a.cleanSheets);
  }, [rows]);

  if (loading) return <LoadingCard />;
  if (error) return <EmptyState icon={<Hand />} title="Não foi possível carregar" description="Tente atualizar a página em instantes." />;
  if (keepers.length === 0) return <EmptyState icon={<Hand />} title="Sem dados de goleiros" description="O tempo de Clean Sheet é calculado quando a partida e o intervalo da participação têm dados oficiais suficientes." />;

  return (
    <div className="keeper-table-wrap">
      <table className="keeper-table">
        <thead>
          <tr><th>Goleiro</th><th>Jogos</th><th>Clean Sheets</th><th>Tempo sem sofrer gol</th></tr>
        </thead>
        <tbody>
          {keepers.map((keeper) => (
            <tr key={keeper.playerId}>
              <td>
                <div className="keeper-cell">
                  <PlayerPhoto src={keeper.photo} name={keeper.nickname} size={36} />
                  <div>
                    <strong>{keeper.nickname}</strong>
                    <span className="keeper-team"><TeamLogo src={keeper.teamLogo} name={keeper.teamName} size={16} /> {keeper.teamName}</span>
                  </div>
                </div>
              </td>
              <td>{keeper.games}</td>
              <td>{keeper.cleanSheets}</td>
              <td className="keeper-time">{formatClock(keeper.totalSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
