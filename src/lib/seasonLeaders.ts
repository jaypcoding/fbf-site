export type SeasonStatRow = { player_id: string; goals: number; assists: number };

export type LeaderPlayer = {
  id: string;
  nickname: string;
  photo_url: string | null;
  position: string;
};

export type SeasonLeader = { player: LeaderPlayer; team_name: string | null; count: number };

/**
 * Builds a season ranking from the official `player_competition_statistics`
 * rows (already filtered to one season). The database decides what counts —
 * finished matches, event-derived scores, valid assists — so the page only
 * orders the result and attaches display data.
 */
export function buildSeasonLeaders(
  rows: SeasonStatRow[],
  metric: 'goals' | 'assists',
  players: Map<string, LeaderPlayer>,
  teamByPlayer: Map<string, string>,
): SeasonLeader[] {
  const leaders: SeasonLeader[] = [];
  for (const row of rows) {
    const count = row[metric];
    const player = players.get(row.player_id);
    if (!player || !count || count <= 0) continue;
    leaders.push({ player, team_name: teamByPlayer.get(row.player_id) ?? null, count });
  }
  return leaders.sort((a, b) => b.count - a.count
    || a.player.nickname.localeCompare(b.player.nickname, 'pt-BR', { sensitivity: 'base' }));
}
