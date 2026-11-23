// Data for the rankings page: the official totals and the names to show.
// Five queries for the whole page, whatever the filter (filters run locally).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { KeeperMatchRow, SummaryRow } from '@/lib/stats/rankings';

export type RankPlayer = { id: string; nickname: string; slug: string | null; photo_url: string | null; position: string };
export type RankCompetition = { id: string; name: string; category: string | null; status: string };
export type RankSeason = { id: string; name: string; competition_id: string };
export type RankTeam = { id: string; name: string; logo_url: string | null };
export type RankingsData = {
  summary: SummaryRow[]; keeper: KeeperMatchRow[];
  players: Map<string, RankPlayer>; competitions: RankCompetition[]; seasons: RankSeason[]; teams: Map<string, RankTeam>;
};

export function useRankingsData(refreshVersion = 0) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; data: RankingsData | null }>({ loading: true, error: false, data: null });
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    (async () => {
      const [sum, keep, comps, seas] = await Promise.all([
        supabase.from('player_season_summary').select('player_id, competition_id, season_id, team_id, matches, wins, draws, losses, goals, assists, own_goals, goalkeeper_matches'),
        supabase.from('match_mvp_scores').select('player_id, competition_id, season_id, team_id, match_id, was_goalkeeper, keeper_goals_conceded, keeper_time_unknown, is_mvp').or('is_mvp.eq.true,was_goalkeeper.eq.true'),
        supabase.from('competitions').select('id, name, category, status').neq('status', 'DRAFT'),
        supabase.from('seasons').select('id, name, competition_id'),
      ]);
      if (!active) return;
      if (sum.error || keep.error || comps.error || seas.error) { setState({ loading: false, error: true, data: null }); return; }
      const summary = (sum.data ?? []) as SummaryRow[];
      const keeper = (keep.data ?? []) as KeeperMatchRow[];
      const playerIds = [...new Set([...summary.map((r) => r.player_id), ...keeper.map((r) => r.player_id)])];
      const teamIds = [...new Set(summary.map((r) => r.team_id))];
      const [ps, ts] = await Promise.all([
        playerIds.length ? supabase.from('players').select('id, nickname, slug, photo_url, position').in('id', playerIds) : Promise.resolve({ data: [], error: null }),
        teamIds.length ? supabase.from('teams').select('id, name, logo_url').in('id', teamIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      if (ps.error || ts.error) { setState({ loading: false, error: true, data: null }); return; }
      setState({
        loading: false, error: false,
        data: {
          summary, keeper,
          players: new Map(((ps.data ?? []) as RankPlayer[]).map((p) => [p.id, p])),
          competitions: (comps.data ?? []) as RankCompetition[],
          seasons: (seas.data ?? []) as RankSeason[],
          teams: new Map(((ts.data ?? []) as RankTeam[]).map((t) => [t.id, t])),
        },
      });
    })();
    return () => { active = false; };
  }, [refreshVersion]);
  return state;
}
