// Pure aggregation of a player's official match rows (player_match_stats) for
// the public profile and the comparator. No database access here.

export type ProfileMatchRow = {
  match_id: string; competition_id: string; season_id: string; team_id: string; season_team_id: string;
  side: 'home' | 'away'; result: 'W' | 'D' | 'L' | null; goals: number; assists: number; own_goals: number;
  was_goalkeeper: boolean; in_lineup: boolean; scheduled_at: string | null;
};

export type Totals = { matches: number; wins: number; draws: number; losses: number; goals: number; assists: number; ownGoals: number; contributions: number; points: number; pointsPct: number | null; mvps: number; keeperMatches: number };

/** Totals of a set of matches. Aproveitamento = points won / points possible (win 3, draw 1). */
export function summarize(rows: ProfileMatchRow[], mvpMatches: Set<string> = new Set()): Totals {
  const t = { matches: rows.length, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, ownGoals: 0, contributions: 0, points: 0, pointsPct: null as number | null, mvps: 0, keeperMatches: 0 };
  for (const r of rows) {
    if (r.result === 'W') t.wins += 1; else if (r.result === 'D') t.draws += 1; else if (r.result === 'L') t.losses += 1;
    t.goals += r.goals; t.assists += r.assists; t.ownGoals += r.own_goals;
    if (r.was_goalkeeper) t.keeperMatches += 1;
    if (mvpMatches.has(r.match_id)) t.mvps += 1;
  }
  t.contributions = t.goals + t.assists;
  t.points = t.wins * 3 + t.draws;
  const decided = t.wins + t.draws + t.losses;
  t.pointsPct = decided > 0 ? Math.round((t.points / (decided * 3)) * 1000) / 10 : null;
  return t;
}

export type SeasonLine = Totals & { key: string; competitionId: string; seasonId: string; teamId: string };

/** One line per competition × season × club, most recent first. */
export function bySeason(rows: ProfileMatchRow[], mvpMatches: Set<string>): SeasonLine[] {
  const groups = new Map<string, ProfileMatchRow[]>();
  for (const r of rows) {
    const key = `${r.competition_id}|${r.season_id}|${r.team_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const [competitionId, seasonId, teamId] = key.split('|');
    const latest = Math.max(...list.map((x) => (x.scheduled_at ? Date.parse(x.scheduled_at) : 0)));
    return { line: { key, competitionId, seasonId, teamId, ...summarize(list, mvpMatches) }, latest };
  }).sort((a, b) => b.latest - a.latest).map((x) => x.line);
}
