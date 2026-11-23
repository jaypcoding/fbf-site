// Data of the MVP of a match (official view match_mvp_scores; calculated in the database).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type MvpRow = {
  player_id: string; side: 'home' | 'away'; season_team_id: string;
  goals: number; assists: number; own_goals: number;
  keeper_seconds: number; keeper_blocks: number; keeper_goals_conceded: number; keeper_time_unknown: boolean;
  won: boolean; in_lineup: boolean; was_goalkeeper: boolean;
  points_goals: number; points_assists: number; points_keeper: number; points_win: number; points_own_goals: number;
  total: number; top_total: number; is_mvp: boolean; mvp_count: number;
};
type PlayerInfo = { id: string; nickname: string; slug: string | null; photo_url: string | null };

export function useMatchMvp(matchId?: string) {
  const [rows, setRows] = useState<MvpRow[] | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [lineups, setLineups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    setRows(null);
    if (!matchId) return () => { active = false; };
    (async () => {
      const [scores, lineupRes] = await Promise.all([
        supabase.from('match_mvp_scores').select('*').eq('match_id', matchId),
        supabase.from('team_match_lineups').select('season_team_id, lineup_registered').eq('match_id', matchId),
      ]);
      if (!active || scores.error) return;
      const data = (scores.data ?? []) as MvpRow[];
      const ids = [...new Set(data.map((r) => r.player_id))];
      const { data: ps } = ids.length ? await supabase.from('players').select('id, nickname, slug, photo_url').in('id', ids) : { data: [] };
      if (!active) return;
      setPlayers(Object.fromEntries(((ps ?? []) as PlayerInfo[]).map((p) => [p.id, p])));
      setLineups(Object.fromEntries(((lineupRes.data ?? []) as { season_team_id: string; lineup_registered: boolean }[]).map((l) => [l.season_team_id, l.lineup_registered])));
      setRows(data.sort((a, b) => b.total - a.total || a.player_id.localeCompare(b.player_id)));
    })();
    return () => { active = false; };
  }, [matchId]);
  return { rows, players, lineups };
}
