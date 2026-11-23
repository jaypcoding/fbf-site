// Achievements of a player for his profile: titles of the teams he belonged
// to (published honours of a season team in which he was in the roster or
// played), his published individual awards, and the top-scorer titles of
// finished competitions (from the official totals). Nothing is stored here.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { one } from '@/lib/relations';
import { seasonTopScorers, type ScorerRow } from '@/lib/honours';

export type Achievement = {
  key: string;
  kind: 'CHAMPION' | 'RUNNER_UP' | 'THIRD_PLACE' | 'AWARD' | 'TOP_SCORER';
  title: string;
  competition: string;
  season: string;
  competitionId: string | null;
  team: string | null;
};

type HonourRaw = {
  id: string; kind: Achievement['kind']; award_name: string | null;
  season: { name: string; competition: { id: string; name: string } | { id: string; name: string }[] | null } | { name: string; competition: unknown }[] | null;
  season_team: { team: { name: string } | { name: string }[] | null } | { team: unknown }[] | null;
};
const ORDER: Achievement['kind'][] = ['CHAMPION', 'AWARD', 'TOP_SCORER', 'RUNNER_UP', 'THIRD_PLACE'];
const LABEL: Record<string, string> = { CHAMPION: 'Campeão', RUNNER_UP: 'Vice-campeão', THIRD_PLACE: 'Terceiro lugar', TOP_SCORER: 'Artilheiro' };

export function usePlayerHonours(playerId: string | undefined, seasonTeamIds: string[]) {
  const [items, setItems] = useState<Achievement[]>([]);
  const key = seasonTeamIds.slice().sort().join(',');
  useEffect(() => {
    let active = true;
    setItems([]);
    if (!playerId) return () => { active = false; };
    (async () => {
      const select = 'id, kind, award_name, season:season_id ( name, competition:competition_id ( id, name ) ), season_team:season_team_id ( team:team_id ( name ) )';
      const [awards, teamHonours, mine] = await Promise.all([
        supabase.from('season_honours').select(select).eq('player_id', playerId).eq('status', 'PUBLISHED'),
        seasonTeamIds.length ? supabase.from('season_honours').select(select).in('season_team_id', seasonTeamIds).neq('kind', 'AWARD').eq('status', 'PUBLISHED') : Promise.resolve({ data: [] }),
        supabase.from('player_season_summary').select('season_id').eq('player_id', playerId).gt('goals', 0),
      ]);
      // top scorer of a finished competition
      const candidateSeasons = [...new Set(((mine.data ?? []) as { season_id: string }[]).map((r) => r.season_id))];
      const finished = candidateSeasons.length
        ? ((await supabase.from('seasons').select('id, name, competition:competition_id!inner ( id, name, status )').in('id', candidateSeasons).eq('competition.status', 'FINISHED')).data ?? []) as unknown as { id: string; name: string; competition: { id: string; name: string } | { id: string; name: string }[] }[]
        : [];
      const all = finished.length ? ((await supabase.from('player_season_summary').select('player_id, season_id, team_id, goals').in('season_id', finished.map((s) => s.id)).gt('goals', 0)).data ?? []) as ScorerRow[] : [];
      if (!active) return;
      const out: Achievement[] = [];
      const push = (h: HonourRaw) => {
        const season = one(h.season as { name: string; competition: unknown } | null);
        const comp = one((season?.competition ?? null) as { id: string; name: string } | { id: string; name: string }[] | null);
        const team = one(one(h.season_team as { team: { name: string } | { name: string }[] | null } | null)?.team ?? null);
        if (out.some((o) => o.key === h.id)) return;
        out.push({ key: h.id, kind: h.kind, title: h.kind === 'AWARD' ? h.award_name ?? 'Premiação' : LABEL[h.kind], competition: comp?.name ?? '', season: season?.name ?? '', competitionId: comp?.id ?? null, team: team?.name ?? null });
      };
      for (const h of (awards.data ?? []) as unknown as HonourRaw[]) push(h);
      for (const h of (teamHonours.data ?? []) as unknown as HonourRaw[]) push(h);
      for (const top of seasonTopScorers(all, new Set(finished.map((s) => s.id)))) {
        if (!top.players.some((p) => p.playerId === playerId)) continue;
        const s = finished.find((x) => x.id === top.seasonId)!;
        const comp = one(s.competition);
        out.push({ key: `top-${s.id}`, kind: 'TOP_SCORER', title: `${LABEL.TOP_SCORER} (${top.goals} ${top.goals === 1 ? 'gol' : 'gols'}${top.players.length > 1 ? ', dividido' : ''})`, competition: comp?.name ?? '', season: s.name, competitionId: comp?.id ?? null, team: null });
      }
      out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.competition.localeCompare(b.competition, 'pt-BR'));
      setItems(out);
    })();
    return () => { active = false; };
  }, [playerId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return items;
}
