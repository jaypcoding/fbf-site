// Whole-competition view of the rounds (public "Rodadas" tab and the admin
// rounds overview). Pure functions, no Supabase access, so they are unit tested.
//
// A round is shown even when it has no matches yet (future rounds created by
// the table generator always have matches; manual rounds may be empty).

export type RoundMatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';

export type RoundInfo = {
  id: string;
  stage_id: string;
  name: string;
  round_order: number;
  phase_type: string;
  leg_number?: number | null;
  stage_group?: { name: string; group_order: number } | null;
};

export type RoundMatch = {
  id: string;
  round_id: string;
  status: RoundMatchStatus;
  scheduled_at: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

export type GroupOfTeam = Map<string, { name: string; order: number }>;

export type RoundState = 'empty' | 'future' | 'in_progress' | 'live' | 'finished';

export const roundStateLabels: Record<RoundState, string> = {
  empty: 'Partidas a definir',
  future: 'Futura',
  in_progress: 'Em andamento',
  live: 'Ao vivo',
  finished: 'Disputada',
};

export type RoundView<M extends RoundMatch> = {
  round: RoundInfo;
  label: string;
  state: RoundState;
  matches: { match: M; group: string | null }[];
  finished: number;
  total: number;
};

const DONE: RoundMatchStatus[] = ['FINISHED', 'CANCELLED'];

export function roundState(matches: Pick<RoundMatch, 'status'>[]): RoundState {
  if (matches.length === 0) return 'empty';
  if (matches.some((match) => match.status === 'LIVE')) return 'live';
  if (matches.every((match) => DONE.includes(match.status))) return 'finished';
  if (matches.some((match) => DONE.includes(match.status))) return 'in_progress';
  return 'future';
}

function time(iso: string | null): number {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/**
 * Groups the matches by round, keeping every round (also the empty ones), in
 * stage order, then group order (rounds that belong to one group), then round
 * order. Inside a round, matches are ordered by group (from the teams), date
 * and id, so the list is stable.
 */
export function buildRoundsView<M extends RoundMatch>(
  rounds: RoundInfo[],
  matches: M[],
  { groupOf = new Map(), stageOrder = new Map() }: { groupOf?: GroupOfTeam; stageOrder?: Map<string, number> } = {},
): RoundView<M>[] {
  const byRound = new Map<string, M[]>();
  for (const match of matches) {
    const list = byRound.get(match.round_id) ?? [];
    list.push(match);
    byRound.set(match.round_id, list);
  }
  const groupFor = (match: M) => {
    const home = match.home_team_id ? groupOf.get(match.home_team_id) : undefined;
    const away = match.away_team_id ? groupOf.get(match.away_team_id) : undefined;
    return home && away && home.name === away.name ? home : home ?? away ?? null;
  };
  return [...rounds]
    .sort((a, b) => (stageOrder.get(a.stage_id) ?? 0) - (stageOrder.get(b.stage_id) ?? 0)
      || (a.stage_group?.group_order ?? 0) - (b.stage_group?.group_order ?? 0)
      || a.round_order - b.round_order
      || a.id.localeCompare(b.id))
    .map((round) => {
      const list = (byRound.get(round.id) ?? []).map((match) => ({ match, group: round.stage_group ? null : groupFor(match) }));
      list.sort((x, y) => (x.group?.order ?? 0) - (y.group?.order ?? 0)
        || time(x.match.scheduled_at) - time(y.match.scheduled_at)
        || x.match.id.localeCompare(y.match.id));
      const plain = list.map((item) => item.match);
      return {
        round,
        label: [round.stage_group?.name, round.name].filter(Boolean).join(' · '),
        state: roundState(plain),
        matches: list.map((item) => ({ match: item.match, group: item.group?.name ?? null })),
        finished: plain.filter((match) => DONE.includes(match.status)).length,
        total: plain.length,
      };
    });
}

/** Index of the round to open first: a live round, else the first one not yet completely played, else the last. */
export function currentRoundIndex(views: Pick<RoundView<RoundMatch>, 'state'>[]): number {
  if (views.length === 0) return -1;
  const live = views.findIndex((view) => view.state === 'live');
  if (live >= 0) return live;
  const open = views.findIndex((view) => view.state !== 'finished');
  return open >= 0 ? open : views.length - 1;
}

export type MatchAttention = 'locked' | 'overdue' | 'undated' | 'ok';

/**
 * Admin hint for one match:
 * - locked: live, finished or cancelled — teams, round and date can no longer change (the database refuses it);
 * - overdue: scheduled/postponed with a date in the past and no result yet;
 * - undated: scheduled without a date;
 * - ok: scheduled for the future.
 */
export function matchAttention(match: Pick<RoundMatch, 'status' | 'scheduled_at'>, now = Date.now()): MatchAttention {
  if (match.status === 'LIVE' || DONE.includes(match.status)) return 'locked';
  if (!match.scheduled_at) return 'undated';
  return time(match.scheduled_at) < now ? 'overdue' : 'ok';
}

export function isEditableMatch(match: Pick<RoundMatch, 'status'>): boolean {
  return match.status === 'SCHEDULED' || match.status === 'POSTPONED';
}

/**
 * The same pairing in the other leg of the stage (the return match), used to
 * keep home and away inverted between legs when the admin swaps one of them.
 */
export function mirrorMatch<M extends RoundMatch>(match: M, matches: M[], rounds: RoundInfo[]): M | null {
  const roundOf = new Map(rounds.map((round) => [round.id, round]));
  const round = roundOf.get(match.round_id);
  if (!round || !match.home_team_id || !match.away_team_id) return null;
  return matches.find((other) => {
    if (other.id === match.id) return false;
    const otherRound = roundOf.get(other.round_id);
    return otherRound?.stage_id === round.stage_id
      && (otherRound.leg_number ?? 1) !== (round.leg_number ?? 1)
      && ((other.home_team_id === match.home_team_id && other.away_team_id === match.away_team_id)
        || (other.home_team_id === match.away_team_id && other.away_team_id === match.home_team_id));
  }) ?? null;
}

export type RoundsSummary = { total: number; finished: number; live: number; overdue: number; undated: number; upcoming: number };

export function summarizeMatches(matches: Pick<RoundMatch, 'status' | 'scheduled_at'>[], now = Date.now()): RoundsSummary {
  const summary: RoundsSummary = { total: matches.length, finished: 0, live: 0, overdue: 0, undated: 0, upcoming: 0 };
  for (const match of matches) {
    if (match.status === 'LIVE') summary.live += 1;
    else if (DONE.includes(match.status)) summary.finished += 1;
    else {
      const attention = matchAttention(match, now);
      if (attention === 'overdue') summary.overdue += 1;
      else if (attention === 'undated') summary.undated += 1;
      else summary.upcoming += 1;
    }
  }
  return summary;
}
