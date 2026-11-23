// Central ao Vivo: pure helpers (no database access). Everything shown comes
// from what the organization records; these functions only order it and say,
// honestly, how recent it is. There is no clock: the HaxBall game time is not
// sent to the site, so the page never estimates the current minute.

export type LiveEventRow = {
  id: string; event_type: string; minute_seconds: number | null; created_at: string;
  team_id: string | null; player_id: string | null; is_own_goal: boolean | null; goal_event_id: string | null;
  player: { nickname: string } | null;
};
export type LiveGoal = {
  id: string; teamId: string | null; minuteSeconds: number | null; scorer: string | null; assist: string | null; ownGoal: boolean;
};

/** Goals in the order of the recorded minute (then registration), with their assists. */
export function liveGoals(events: LiveEventRow[]): LiveGoal[] {
  const assists = new Map<string, string>();
  for (const e of events) if (e.event_type === 'ASSIST' && e.goal_event_id && e.player) assists.set(e.goal_event_id, e.player.nickname);
  return events
    .filter((e) => e.event_type === 'GOAL')
    .sort((a, b) => (a.minute_seconds ?? Number.MAX_SAFE_INTEGER) - (b.minute_seconds ?? Number.MAX_SAFE_INTEGER) || a.created_at.localeCompare(b.created_at))
    .map((e) => ({ id: e.id, teamId: e.team_id, minuteSeconds: e.minute_seconds, scorer: e.player?.nickname ?? null, assist: assists.get(e.id) ?? null, ownGoal: Boolean(e.is_own_goal) }));
}

/** The last moment something of this match was registered: put live, an event or a score change. */
export function lastRegisteredAt(liveSince: string | null, events: { created_at: string }[], matchUpdatedAt: string | null): string | null {
  const times = [liveSince, matchUpdatedAt, ...events.map((e) => e.created_at)].filter((t): t is string => Boolean(t));
  if (times.length === 0) return null;
  return times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

export const STALE_AFTER_MINUTES = 20;

/** "fresh" while something was registered in the last minutes; "stale" otherwise (the score may be out of date). */
export function freshness(lastIso: string | null, nowMs: number, staleAfterMinutes = STALE_AFTER_MINUTES): { state: 'fresh' | 'stale' | 'unknown'; minutes: number | null } {
  if (!lastIso) return { state: 'unknown', minutes: null };
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(lastIso)) / 60000));
  return { state: minutes >= staleAfterMinutes ? 'stale' : 'fresh', minutes };
}

export type AgendaMatch = { id: string; status: string; scheduled_at: string | null };

/**
 * The day around now:
 * - upcoming: SCHEDULED in the next 24 hours;
 * - waiting: SCHEDULED whose time has passed in the last 3 hours (not started in the system yet);
 * - finished: FINISHED scheduled in the last 24 hours.
 */
export function agenda<T extends AgendaMatch>(matches: T[], nowMs: number) {
  const h = 3600000;
  const at = (m: T) => (m.scheduled_at ? Date.parse(m.scheduled_at) : NaN);
  const byTime = (a: T, b: T) => at(a) - at(b);
  const upcoming = matches.filter((m) => m.status === 'SCHEDULED' && at(m) >= nowMs && at(m) <= nowMs + 24 * h).sort(byTime);
  const waiting = matches.filter((m) => m.status === 'SCHEDULED' && at(m) < nowMs && at(m) >= nowMs - 3 * h).sort(byTime);
  const finished = matches.filter((m) => m.status === 'FINISHED' && at(m) <= nowMs && at(m) >= nowMs - 24 * h).sort((a, b) => byTime(b, a));
  return { upcoming, waiting, finished };
}
