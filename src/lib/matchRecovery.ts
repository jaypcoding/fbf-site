// Helpers for results recorded after the match (record_retroactive_match_result).

export const PRESUMED_DURATION_SECONDS = 14 * 60;

// Value for <input type="datetime-local"> in the browser's time zone.
export function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export type GoalSide = 'home' | 'away';

// Score produced by the goals: an own goal counts for the other team.
export function scoreFromGoals(goals: { side: GoalSide; ownGoal: boolean }[]) {
  let home = 0;
  let away = 0;
  for (const goal of goals) {
    const forHome = goal.side === 'home' ? !goal.ownGoal : goal.ownGoal;
    if (forHome) home += 1; else away += 1;
  }
  return { home, away };
}
