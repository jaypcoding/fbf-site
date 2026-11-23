// Data of the Hall da Fama.
// - Competitions of the system: only FINISHED ones. Titles and awards are the
//   published official honours (season_honours, confirmed by the FBF); top
//   scorers come from the official totals (player_season_summary); MVP
//   leaders only when the MVP is published (mvp_results).
// - Editions before the system (historical_editions): everything is a record
//   confirmed and published by an admin, top scorer included (there are no
//   match sheets). The database only returns an edition once it has a
//   published record, and the page always marks it as before the system.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchMvpEnabled } from '@/lib/features';
import { one } from '@/lib/relations';
import { seasonTopScorers, type HonourKind, type ScorerRow, type SeasonTopScorers } from '@/lib/honours';

export type HofTeam = { id: string | null; name: string; logo_url: string | null };
export type HofPlayer = { id: string; nickname: string; slug: string | null; photo_url: string | null };
export type HofEdition = {
  id: string;
  historical: boolean;
  title: string;
  category: string | null;
  /** link to the competition page (system only) */
  competitionId: string | null;
  /** used to order newest first */
  sortKey: string;
  yearLabel: string | null;
  source: string | null;
  notes: string | null;
};
export type HofHonour = {
  id: string; editionId: string; kind: HonourKind; award: string | null; notes: string | null;
  team: HofTeam | null; player_id: string | null; player_name: string | null; goals: number | null;
};
export type HofMvpLeader = { seasonId: string; count: number; playerIds: string[] };
export type HallOfFame = {
  editions: HofEdition[]; honours: HofHonour[]; scorers: SeasonTopScorers[]; mvpLeaders: HofMvpLeader[] | null;
  players: Map<string, HofPlayer>; teams: Map<string, HofTeam>;
};

type TeamRaw = { id: string; name: string; logo_url: string | null };
type HonourRaw = {
  id: string; season_id: string | null; historical_edition_id: string | null; kind: HonourKind; notes: string | null;
  player_id: string | null; player_name: string | null; goals: number | null; team_name: string | null;
  award_category: { name: string } | { name: string }[] | null;
  team: TeamRaw | TeamRaw[] | null;
  season_team: { team: TeamRaw | TeamRaw[] | null } | { team: TeamRaw | TeamRaw[] | null }[] | null;
};
type SeasonRaw = { id: string; name: string; ends_at: string | null; competition: { id: string; name: string; category: string | null } | { id: string; name: string; category: string | null }[] | null };
type EditionRaw = { id: string; competition_name: string; edition_name: string | null; category: string | null; edition_year: number | null; started_on: string | null; ended_on: string | null; source: string; notes: string | null; created_at: string };

export const HONOUR_SELECT = 'id, season_id, historical_edition_id, kind, notes, player_id, player_name, goals, team_name, award_category:award_category_id ( name ), team:team_id ( id, name, logo_url ), season_team:season_team_id ( team:team_id ( id, name, logo_url ) )';

export function honourTeam(h: Pick<HonourRaw, 'team' | 'season_team' | 'team_name'>): HofTeam | null {
  const t = one(h.team) ?? one(one(h.season_team)?.team ?? null);
  if (t) return { id: t.id, name: t.name, logo_url: t.logo_url };
  return h.team_name ? { id: null, name: h.team_name, logo_url: null } : null;
}

export function editionTitle(e: Pick<EditionRaw, 'competition_name' | 'edition_name'>) {
  return e.edition_name ? `${e.competition_name} · ${e.edition_name}` : e.competition_name;
}

export function useHallOfFame(refreshVersion = 0) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; data: HallOfFame | null }>({ loading: true, error: false, data: null });
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    (async () => {
      const [seasonsRes, editionsRes] = await Promise.all([
        supabase.from('seasons').select('id, name, ends_at, competition:competition_id!inner ( id, name, category, status )').eq('competition.status', 'FINISHED'),
        supabase.from('historical_editions').select('id, competition_name, edition_name, category, edition_year, started_on, ended_on, source, notes, created_at'),
      ]);
      if (!active) return;
      if (seasonsRes.error || editionsRes.error) { setState({ loading: false, error: true, data: null }); return; }
      const seasons = ((seasonsRes.data ?? []) as unknown as SeasonRaw[]).map((s) => ({ ...s, competition: one(s.competition) })).filter((s) => s.competition);
      const historical = (editionsRes.data ?? []) as EditionRaw[];
      const ids = seasons.map((s) => s.id);
      const editionIds = historical.map((e) => e.id);
      const mvpEnabled = await fetchMvpEnabled();
      const empty = Promise.resolve({ data: [], error: null });
      const [honRes, hHonRes, sumRes, mvpRes] = await Promise.all([
        ids.length ? supabase.from('season_honours').select(HONOUR_SELECT).in('season_id', ids).eq('status', 'PUBLISHED') : empty,
        editionIds.length ? supabase.from('season_honours').select(HONOUR_SELECT).in('historical_edition_id', editionIds).eq('status', 'PUBLISHED') : empty,
        ids.length ? supabase.from('player_season_summary').select('player_id, season_id, team_id, goals').in('season_id', ids).gt('goals', 0) : empty,
        mvpEnabled && ids.length ? supabase.rpc('mvp_results') : empty,
      ]);
      if (!active) return;
      if (honRes.error || hHonRes.error || sumRes.error || mvpRes.error) { setState({ loading: false, error: true, data: null }); return; }
      const honours: HofHonour[] = ([...(honRes.data ?? []), ...(hHonRes.data ?? [])] as unknown as HonourRaw[]).map((h) => ({
        id: h.id, editionId: (h.season_id ?? h.historical_edition_id)!, kind: h.kind, award: one(h.award_category)?.name ?? null, notes: h.notes,
        team: honourTeam(h), player_id: h.player_id, player_name: h.player_name, goals: h.goals,
      }));
      const editions: HofEdition[] = [
        ...seasons.map((s) => ({
          id: s.id, historical: false,
          title: s.name && s.name !== s.competition!.name ? `${s.competition!.name} · ${s.name}` : s.competition!.name,
          category: s.competition!.category, competitionId: s.competition!.id,
          sortKey: s.ends_at ?? '', yearLabel: s.ends_at ? s.ends_at.slice(0, 4) : null, source: null, notes: null,
        })),
        ...historical.map((e) => ({
          id: e.id, historical: true, title: editionTitle(e), category: e.category, competitionId: null,
          sortKey: e.ended_on ?? e.started_on ?? (e.edition_year ? `${e.edition_year}-12-31` : ''),
          yearLabel: e.edition_year ? String(e.edition_year) : (e.ended_on ?? e.started_on)?.slice(0, 4) ?? null,
          source: e.source, notes: e.notes,
        })),
      ].sort((a, b) => b.sortKey.localeCompare(a.sortKey) || a.title.localeCompare(b.title, 'pt-BR'));
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
        playerIds.length ? supabase.from('players').select('id, nickname, slug, photo_url').in('id', playerIds) : empty,
        teamIds.length ? supabase.from('teams').select('id, name, logo_url').in('id', teamIds) : empty,
      ]);
      if (!active) return;
      const teams = new Map<string, HofTeam>(((ts.data ?? []) as TeamRaw[]).map((t) => [t.id, t]));
      for (const h of honours) if (h.team?.id) teams.set(h.team.id, h.team);
      setState({
        loading: false, error: false,
        data: { editions, honours, scorers, mvpLeaders, players: new Map(((ps.data ?? []) as HofPlayer[]).map((p) => [p.id, p])), teams },
      });
    })();
    return () => { active = false; };
  }, [refreshVersion]);
  return state;
}
