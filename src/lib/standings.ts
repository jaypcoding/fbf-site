// How the public standings of a stage are laid out.
//
// The stage_standings view computes each team's numbers from the finished
// matches of the stage and tells which group the team belongs to. A group
// stage shows one independent table per group (ranked with the stage's
// tie-breakers inside the group); a league shows one table. A group stage whose
// groups were not registered yet is flagged, so the page can say the single
// table is provisional instead of looking like a league.
import { compareTeamNames } from './competitionFormats.ts';

export type StandingsRow = {
  stage_id: string;
  season_team_id: string;
  team_id: string;
  team_name: string;
  team_logo_url: string | null;
  stage_group_id: string | null;
  group_name: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  points: number;
};

export type StandingsTable = { key: string; name: string; rows: StandingsRow[] };
export type StandingsLayout = { mode: 'single' | 'groups' | 'groups-pending'; tables: StandingsTable[] };

const numericCriteria: Record<string, keyof Pick<StandingsRow, 'points' | 'wins' | 'draws' | 'losses' | 'goals_for' | 'goals_against'>> = {
  POINTS: 'points',
  WINS: 'wins',
  DRAWS: 'draws',
  LOSSES: 'losses',
  GOALS_FOR: 'goals_for',
  GOALS_AGAINST: 'goals_against',
};

export function sortStandings(rows: StandingsRow[], tieBreakers: string[]): StandingsRow[] {
  return [...rows].sort((a, b) => {
    for (const criterion of tieBreakers) {
      if (criterion === 'TEAM_NAME') {
        const result = compareTeamNames(a.team_name, b.team_name);
        if (result !== 0) return result;
        continue;
      }
      if (criterion === 'GOAL_DIFF') {
        const result = (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against);
        if (result !== 0) return result;
        continue;
      }
      const key = numericCriteria[criterion];
      if (key && a[key] !== b[key]) {
        return key === 'losses' || key === 'goals_against' ? a[key] - b[key] : b[key] - a[key];
      }
    }
    return compareTeamNames(a.team_name, b.team_name);
  });
}

export function buildStandingsLayout(rows: StandingsRow[], stage: { format: string; tie_breakers: string[] }): StandingsLayout {
  const hasGroups = rows.some((row) => row.stage_group_id);
  if (!hasGroups) {
    return {
      mode: stage.format === 'Grupos + Mata-mata' ? 'groups-pending' : 'single',
      tables: [{ key: '', name: 'Classificação', rows: sortStandings(rows, stage.tie_breakers) }],
    };
  }
  const byGroup = new Map<string, StandingsTable>();
  for (const row of rows) {
    const key = row.stage_group_id ?? '';
    const table = byGroup.get(key) ?? { key, name: row.group_name || 'Sem grupo', rows: [] };
    table.rows.push(row);
    byGroup.set(key, table);
  }
  const tables = [...byGroup.values()]
    .map((table) => ({ ...table, rows: sortStandings(table.rows, stage.tie_breakers) }))
    // Group order by name (Grupo A, B, C…); a team without group, if any, last.
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name, 'pt-BR', { numeric: true })));
  return { mode: 'groups', tables };
}
