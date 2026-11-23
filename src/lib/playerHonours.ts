// Achievements of a player for his profile: titles of the teams he belonged
// to (published honours of a season team in which he was in the roster or
// played), his published individual awards, and the top-scorer titles of
// finished competitions (from the official totals). Records of editions
// before the system appear only when they name the player himself (an award
// or a confirmed top-scorer record): without rosters of those editions, a
// team title is never attributed to a player. Nothing is stored here.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { one } from '@/lib/relations';
import { seasonTopScorers, type ScorerRow } from '@/lib/honours';
import { editionTitle } from '@/lib/hallOfFameData';

export type Achievement = {
  key: string;
  kind: 'CHAMPION' | 'RUNNER_UP' | 'THIRD_PLACE' | 'AWARD' | 'TOP_SCORER';
  title: string;
  competition: string;
  season: string;
  competitionId: string | null;
  team: string | null;
  /** record of an edition before the system */
  historical: boolean;
};

type Named = { name: string };
type HonourRaw = {
  id: string; kind: Achievement['kind']; goals: number | null; team_name: string | null;
  award_category: Named | Named[] | null;
  season: { name: string; competition: { id: string; name: string } | { id: string; name: string }[] | null } | { name: string; competition: unknown }[] | null;
  edition: { competition_name: string; edition_name: string | null; edition_year: number | null } | { competition_name: string; edition_name: string | null; edition_year: number | null }[] | null;
  season_team: { team: Named | Named[] | null } | { team: unknown }[] | null;
  team: Named | Named[] | null;
};
const ORDER: Achievement['kind'][] = ['CHAMPION', 'AWARD', 'TOP_SCORER', 'RUNNER_UP', 'THIRD_PLACE'];
const LABEL: Record<string, string> = { CHAMPION: 'Campeão', RUNNER_UP: 'Vice-campeão', THIRD_PLACE: 'Terceiro lugar', TOP_SCORER: 'Artilheiro' };
const goalsText = (n: number) => `${n} ${n === 1 ? 'gol' : 'gols'}`;

export function usePlayerHonours(playerId: string | undefined, seasonTeamIds: string[]) {
  const [items, setItems] = useState<Achievement[]>([]);
  const key = seasonTeamIds.slice().sort().join(',');
  useEffect(() => {
    let active = true;
    setItems([]);
    if (!playerId) return () => { active = false; };
    (async () => {
      const select = 'id, kind, goals, team_name, award_category:award_category_id ( name ), season:season_id ( name, competition:competition_id ( id, name ) ), edition:historical_edition_id ( competition_name, edition_name, edition_year ), season_team:season_team_id ( team:team_id ( name ) ), team:team_id ( name )';
      const [mineRes, teamHonours, mine] = await Promise.all([
        supabase.from('season_honours').select(select).eq('player_id', playerId).eq('status', 'PUBLISHED'),
        seasonTeamIds.length ? supabase.from('season_honours').select(select).in('season_team_id', seasonTeamIds).in('kind', ['CHAMPION', 'RUNNER_UP', 'THIRD_PLACE']).eq('status', 'PUBLISHED') : Promise.resolve({ data: [] }),
        supabase.from('player_season_summary').select('season_id').eq('player_id', playerId).gt('goals', 0),
      ]);
      // top scorer of a finished competition of the system
      const candidateSeasons = [...new Set(((mine.data ?? []) as { season_id: string }[]).map((r) => r.season_id))];
      const finished = candidateSeasons.length
        ? ((await supabase.from('seasons').select('id, name, competition:competition_id!inner ( id, name, status )').in('id', candidateSeasons).eq('competition.status', 'FINISHED')).data ?? []) as unknown as { id: string; name: string; competition: { id: string; name: string } | { id: string; name: string }[] }[]
        : [];
      const all = finished.length ? ((await supabase.from('player_season_summary').select('player_id, season_id, team_id, goals').in('season_id', finished.map((s) => s.id)).gt('goals', 0)).data ?? []) as ScorerRow[] : [];
      if (!active) return;
      const out: Achievement[] = [];
      const push = (h: HonourRaw) => {
        if (out.some((o) => o.key === h.id)) return;
        const team = one(h.team)?.name ?? one(one(h.season_team as { team: Named | Named[] | null } | null)?.team ?? null)?.name ?? h.team_name ?? null;
        const edition = one(h.edition);
        const title = h.kind === 'AWARD' ? one(h.award_category)?.name ?? 'Premiação'
          : h.kind === 'TOP_SCORER' && h.goals != null ? `${LABEL.TOP_SCORER} (${goalsText(h.goals)})` : LABEL[h.kind];
        if (edition) {
          out.push({ key: h.id, kind: h.kind, title, competition: editionTitle(edition), season: edition.edition_year ? String(edition.edition_year) : '', competitionId: null, team, historical: true });
          return;
        }
        const season = one(h.season as { name: string; competition: unknown } | null);
        const comp = one((season?.competition ?? null) as { id: string; name: string } | { id: string; name: string }[] | null);
        out.push({ key: h.id, kind: h.kind, title, competition: comp?.name ?? '', season: season?.name ?? '', competitionId: comp?.id ?? null, team, historical: false });
      };
      for (const h of (mineRes.data ?? []) as unknown as HonourRaw[]) push(h);
      for (const h of (teamHonours.data ?? []) as unknown as HonourRaw[]) push(h);
      for (const top of seasonTopScorers(all, new Set(finished.map((s) => s.id)))) {
        if (!top.players.some((p) => p.playerId === playerId)) continue;
        const s = finished.find((x) => x.id === top.seasonId)!;
        const comp = one(s.competition);
        out.push({ key: `top-${s.id}`, kind: 'TOP_SCORER', title: `${LABEL.TOP_SCORER} (${goalsText(top.goals)}${top.players.length > 1 ? ', dividido' : ''})`, competition: comp?.name ?? '', season: s.name, competitionId: comp?.id ?? null, team: null, historical: false });
      }
      out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || Number(a.historical) - Number(b.historical) || a.competition.localeCompare(b.competition, 'pt-BR'));
      setItems(out);
    })();
    return () => { active = false; };
  }, [playerId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return items;
}
