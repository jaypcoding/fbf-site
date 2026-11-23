// Data of the Hall da Fama: only FINISHED competitions. Titles and awards come
// from the published official honours (season_honours, confirmed by the
// FBF); top scorers from the official totals (player_season_summary); MVP
// leaders only when the MVP is published (mvp_results).
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchMvpEnabled } from '@/lib/features';
import { seasonTopScorers, type HonourKind, type ScorerRow, type SeasonTopScorers } from '@/lib/honours';

export type HofSeason = { id: string; name: string; competition_id: string; ends_at: string | null; competition: { id: string; name: string; category: string | null } };
export type HofTeam = { id: string; name: string; logo_url: string | null };
export type HofPlayer = { id: string; nickname: string; slug: string | null; photo_url: string | null };
export type HofHonour = { id: string; season_id: string; kind: HonourKind; award_name: string | null; basis: string; notes: string | null; team: HofTeam | null; player_id: string | null };
export type HofMvpLeader = { seasonId: string; count: number; playerIds: string[] };
export type HallOfFame = {
  seasons: HofSeason[]; honours: HofHonour[]; scorers: SeasonTopScorers[]; mvpLeaders: HofMvpLeader[] | null;
  players: Map<string, HofPlayer>; teams: Map<string, HofTeam>;
};

type HonourRaw = { id: string; season_id: string; kind: HonourKind; award_name: string | null; basis: string; notes: string | null; player_id: string | null; season_team: { team: HofTeam | HofTeam[] | null } | { team: HofTeam | HofTeam[] | null }[] | null };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function useHallOfFame(refreshVersion = 0) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; data: HallOfFame | null }>({ loading: true, error: false, data: null });
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    (async () => {
      const seasonsRes = await supabase.from('seasons').select('id, name, competition_id, ends_at, competition:competition_id!inner ( id, name, category, status )').eq('competition.status', 'FINISHED');
      if (!active) return;
      if (seasonsRes.error) { setState({ loading: false, error: true, data: null }); return; }
      const seasons = ((seasonsRes.data ?? []) as unknown as (Omit<HofSeason, 'competition'> & { competition: HofSeason['competition'] | HofSeason['competition'][] })[])
        .map((s) => ({ ...s, competition: one(s.competition)! }))
        .filter((s) => s.competition);
      const ids = seasons.map((s) => s.id);
      const mvpEnabled = await fetchMvpEnabled();
      const [honRes, sumRes, mvpRes] = await Promise.all([
        ids.length ? supabase.from('season_honours').select('id, season_id, kind, award_name, basis, notes, player_id, season_team:season_team_id ( team:team_id ( id, name, logo_url ) )').in('season_id', ids).eq('status', 'PUBLISHED') : Promise.resolve({ data: [], error: null }),
        ids.length ? supabase.from('player_season_summary').select('player_id, season_id, team_id, goals').in('season_id', ids).gt('goals', 0) : Promise.resolve({ data: [], error: null }),
        mvpEnabled && ids.length ? supabase.rpc('mvp_results') : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      if (honRes.error || sumRes.error || mvpRes.error) { setState({ loading: false, error: true, data: null }); return; }
      const honours: HofHonour[] = ((honRes.data ?? []) as unknown as HonourRaw[]).map((h) => ({
        id: h.id, season_id: h.season_id, kind: h.kind, award_name: h.award_name, basis: h.basis, notes: h.notes, player_id: h.player_id,
        team: one(one(h.season_team)?.team ?? null),
      }));
      const scorers = seasonTopScorers((sumRes.data ?? []) as ScorerRow[], new Set(ids));
      let mvpLeaders: HofMvpLeader[] | null = null;
      if (mvpEnabled) {
        const per = new Map<string, Map<string, number>>();
        for (const r of (mvpRes.data ?? []) as { season_id: string; player_id: string }[]) {
          if (!ids.includes(r.season_id)) continue;
          const m = per.get(r.season_id) ?? new Map();
          m.set(r.player_id, (m.get(r.player_id) ?? 0) + 1);
          per.set(r.season_id, m);
        }
        mvpLeaders = [...per.entries()].map(([seasonId, m]) => {
          const top = Math.max(...m.values());
          return { seasonId, count: top, playerIds: [...m.entries()].filter(([, c]) => c === top).map(([p]) => p) };
        });
      }
      const playerIds = [...new Set([...honours.map((h) => h.player_id).filter(Boolean) as string[], ...scorers.flatMap((s) => s.players.map((p) => p.playerId)), ...(mvpLeaders ?? []).flatMap((m) => m.playerIds)])];
      const teamIds = [...new Set(scorers.flatMap((s) => s.players.flatMap((p) => p.teamIds)))];
      const [ps, ts] = await Promise.all([
        playerIds.length ? supabase.from('players').select('id, nickname, slug, photo_url').in('id', playerIds) : Promise.resolve({ data: [], error: null }),
        teamIds.length ? supabase.from('teams').select('id, name, logo_url').in('id', teamIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      const teams = new Map<string, HofTeam>(((ts.data ?? []) as HofTeam[]).map((t) => [t.id, t]));
      for (const h of honours) if (h.team) teams.set(h.team.id, h.team);
      setState({
        loading: false, error: false,
        data: { seasons, honours, scorers, mvpLeaders, players: new Map(((ps.data ?? []) as HofPlayer[]).map((p) => [p.id, p])), teams },
      });
    })();
    return () => { active = false; };
  }, [refreshVersion]);
  return state;
}
