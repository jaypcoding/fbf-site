// Data for the rankings page: the official totals and the names to show.
// A handful of queries for the whole page, whatever the filter (filters run
// locally). MVP awards come only from mvp_results, empty while unpublished.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchMvpEnabled } from '@/lib/features';
import type { KeeperMatchRow, MvpAwardRow, SummaryRow } from '@/lib/stats/rankings';

export type RankPlayer = { id: string; nickname: string; slug: string | null; photo_url: string | null; position: string };
export type RankCompetition = { id: string; name: string; category: string | null; status: string };
export type RankSeason = { id: string; name: string; competition_id: string };
export type RankTeam = { id: string; name: string; logo_url: string | null };
export type RankingsData = {
  summary: SummaryRow[]; keeper: KeeperMatchRow[]; mvps: MvpAwardRow[]; mvpEnabled: boolean;
  players: Map<string, RankPlayer>; competitions: RankCompetition[]; seasons: RankSeason[]; teams: Map<string, RankTeam>;
};

export function useRankingsData(refreshVersion = 0) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; data: RankingsData | null }>({ loading: true, error: false, data: null });
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    (async () => {
      const mvpEnabled = await fetchMvpEnabled();
      const [sum, keep, mvp, comps, seas] = await Promise.all([
        supabase.from('player_season_summary').select('player_id, competition_id, season_id, team_id, matches, wins, draws, losses, goals, assists, own_goals, goalkeeper_matches'),
        supabase.from('player_match_keeping').select('player_id, competition_id, season_id, team_id, match_id, goals_conceded'),
        mvpEnabled ? supabase.rpc('mvp_results') : Promise.resolve({ data: [], error: null }),
        supabase.from('competitions').select('id, name, category, status').neq('status', 'DRAFT'),
        supabase.from('seasons').select('id, name, competition_id'),
      ]);
      if (!active) return;
      if (sum.error || keep.error || mvp.error || comps.error || seas.error) { setState({ loading: false, error: true, data: null }); return; }
      const summary = (sum.data ?? []) as SummaryRow[];
      const keeper = (keep.data ?? []) as KeeperMatchRow[];
      const mvps = (mvp.data ?? []) as MvpAwardRow[];
      const playerIds = [...new Set([...summary.map((r) => r.player_id), ...keeper.map((r) => r.player_id), ...mvps.map((r) => r.player_id)])];
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
          summary, keeper, mvps, mvpEnabled,
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
