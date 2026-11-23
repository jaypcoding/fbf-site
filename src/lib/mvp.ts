// MVP of a match, read through the database function match_mvp (the MVP
// views are closed to visitors; the function answers only when the MVP is
// published, or to managers as a preview). The calculation happens in the
// database; nothing here decides the result.
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
/** NORMAL: calculated · PENDING_REVIEW: goal without author awaiting review · WALKOVER: official W.O. · UNAVAILABLE: result without events */
export type MvpStatus = 'NORMAL' | 'PENDING_REVIEW' | 'WALKOVER' | 'UNAVAILABLE';
export type MatchMvpData = {
  enabled: boolean; preview: boolean; status: MvpStatus | null;
  goalsWithoutAuthor: number; review: 'WALKOVER' | 'VALID' | null; rows: MvpRow[];
};
type PlayerInfo = { id: string; nickname: string; slug: string | null; photo_url: string | null };

export function parseMatchMvp(raw: unknown): MatchMvpData | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const rows = Array.isArray(j.rows) ? (j.rows as MvpRow[]) : [];
  return {
    enabled: j.enabled === true,
    preview: j.preview === true,
    status: (typeof j.status === 'string' ? j.status : null) as MvpStatus | null,
    goalsWithoutAuthor: typeof j.goals_without_author === 'number' ? j.goals_without_author : 0,
    review: (j.review === 'WALKOVER' || j.review === 'VALID' ? j.review : null),
    rows: [...rows].sort((a, b) => b.total - a.total || a.player_id.localeCompare(b.player_id)),
  };
}

export function useMatchMvp(matchId?: string, refreshKey = 0) {
  const [data, setData] = useState<MatchMvpData | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerInfo>>({});
  const [lineups, setLineups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let active = true;
    setData(null);
    if (!matchId) return () => { active = false; };
    (async () => {
      const [res, lineupRes] = await Promise.all([
        supabase.rpc('match_mvp', { p_match_id: matchId }),
        supabase.from('team_match_lineups').select('season_team_id, lineup_registered').eq('match_id', matchId),
      ]);
      if (!active || res.error) return;
      const parsed = parseMatchMvp(res.data);
      if (!parsed || (!parsed.enabled && !parsed.preview)) return; // not published: nothing to show
      const ids = [...new Set(parsed.rows.map((r) => r.player_id))];
      const { data: ps } = ids.length ? await supabase.from('players').select('id, nickname, slug, photo_url').in('id', ids) : { data: [] };
      if (!active) return;
      setPlayers(Object.fromEntries(((ps ?? []) as PlayerInfo[]).map((p) => [p.id, p])));
      setLineups(Object.fromEntries(((lineupRes.data ?? []) as { season_team_id: string; lineup_registered: boolean }[]).map((l) => [l.season_team_id, l.lineup_registered])));
      setData(parsed);
    })();
    return () => { active = false; };
  }, [matchId, refreshKey]);
  return { data, players, lineups };
}
