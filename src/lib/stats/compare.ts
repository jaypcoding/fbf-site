// Player comparator: pure functions (no database access). The numbers come
// from the official per-match statistics (player_match_stats, the same view
// player_season_summary adds up) and are totalled by the SAME aggregate() of
// the rankings, so the comparator can never disagree with the rankings or the
// profiles. What is added here is only how to compare in equivalent
// conditions:
//   - the same scope for everybody (all, one competition or one season);
//   - optionally, only the matches in which ALL compared players took part;
//   - per-match rates are highlighted only when every player has the minimum
//     sample of the efficiency rankings;
//   - the head-to-head between two players, from the same matches.
import { aggregate, MIN_MATCHES_EFFICIENCY, type KeeperMatchRow, type MvpAwardRow, type PlayerTotals, type SummaryRow } from './rankings.ts';

/** one line per player per official match with proven participation (view player_match_stats) */
export type MatchStatRow = {
  match_id: string; player_id: string; competition_id: string; season_id: string; team_id: string;
  side: 'home' | 'away'; result: 'W' | 'D' | 'L' | null; goals: number; assists: number; own_goals: number; was_goalkeeper: boolean;
};
export type CompareScope = { competitionId?: string | null; seasonId?: string | null };

const inScope = (r: { competition_id: string; season_id: string }, s: CompareScope) =>
  (!s.competitionId || r.competition_id === s.competitionId) && (!s.seasonId || r.season_id === s.seasonId);

/** matches (inside the scope) in which every one of the players took part */
export function commonMatches(rows: MatchStatRow[], playerIds: string[], scope: CompareScope = {}): Set<string> {
  const per = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!playerIds.includes(r.player_id) || !inScope(r, scope)) continue;
    const s = per.get(r.match_id) ?? new Set<string>();
    s.add(r.player_id);
    per.set(r.match_id, s);
  }
  return new Set([...per.entries()].filter(([, s]) => playerIds.every((p) => s.has(p))).map(([m]) => m));
}

/** per-match rows as one-match summary rows, so aggregate() of the rankings totals them */
export function asSummaryRows(rows: MatchStatRow[]): SummaryRow[] {
  return rows.map((r) => ({
    player_id: r.player_id, competition_id: r.competition_id, season_id: r.season_id, team_id: r.team_id,
    matches: 1, wins: r.result === 'W' ? 1 : 0, draws: r.result === 'D' ? 1 : 0, losses: r.result === 'L' ? 1 : 0,
    goals: r.goals, assists: r.assists, own_goals: r.own_goals, goalkeeper_matches: r.was_goalkeeper ? 1 : 0,
  }));
}

export function compareTotals(
  rows: MatchStatRow[], keeperRows: KeeperMatchRow[], mvpRows: MvpAwardRow[],
  playerIds: string[], scope: CompareScope, onlyCommon: boolean,
): { totals: Map<string, PlayerTotals>; common: Set<string> } {
  const common = commonMatches(rows, playerIds, scope);
  const keep = (r: { match_id: string; player_id: string; competition_id: string; season_id: string }) =>
    playerIds.includes(r.player_id) && inScope(r, scope) && (!onlyCommon || common.has(r.match_id));
  const totals = aggregate(asSummaryRows(rows.filter(keep)), keeperRows.filter(keep), {}, mvpRows.filter(keep));
  for (const id of playerIds) if (!totals.has(id)) totals.set(id, { playerId: id, teamIds: [], matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, ownGoals: 0, mvps: 0, keeperMatches: 0, goalsConceded: 0 });
  return { totals, common };
}

export type HeadToHead = { matches: number; aWins: number; draws: number; bWins: number; together: number; togetherWins: number; togetherDraws: number; togetherLosses: number };

/** a against b (opposite sides of the same match) and a with b (same side), inside the scope */
export function headToHead(rows: MatchStatRow[], a: string, b: string, scope: CompareScope = {}): HeadToHead {
  const byMatch = new Map<string, { a?: MatchStatRow; b?: MatchStatRow }>();
  for (const r of rows) {
    if ((r.player_id !== a && r.player_id !== b) || !inScope(r, scope)) continue;
    const m = byMatch.get(r.match_id) ?? {};
    if (r.player_id === a) m.a = r; else m.b = r;
    byMatch.set(r.match_id, m);
  }
  const h: HeadToHead = { matches: 0, aWins: 0, draws: 0, bWins: 0, together: 0, togetherWins: 0, togetherDraws: 0, togetherLosses: 0 };
  for (const { a: ra, b: rb } of byMatch.values()) {
    if (!ra || !rb || !ra.result) continue;
    if (ra.side !== rb.side) {
      h.matches += 1;
      if (ra.result === 'W') h.aWins += 1; else if (ra.result === 'L') h.bWins += 1; else h.draws += 1;
    } else {
      h.together += 1;
      if (ra.result === 'W') h.togetherWins += 1; else if (ra.result === 'L') h.togetherLosses += 1; else h.togetherDraws += 1;
    }
  }
  return h;
}

export type CompareMetric = {
  key: string; label: string;
  value: (t: PlayerTotals) => number | null;
  format?: (v: number) => string;
  /** lower is better */
  ascending?: boolean;
  /** a rate: highlighted only when every player has the minimum sample */
  rate?: boolean;
  /** the sample of a rate (matches, or matches in goal) */
  sample?: (t: PlayerTotals) => number;
  /** shown only when the MVP is published */
  needsMvp?: boolean;
  /** no "best" highlight (context, not merit) */
  neutral?: boolean;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const dec = (v: number) => (Math.round(v * 100) / 100).toLocaleString('pt-BR');
const pct = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString('pt-BR')}%`;

export const COMPARE_METRICS: CompareMetric[] = [
  { key: 'matches', label: 'Partidas', value: (t) => t.matches, neutral: true },
  { key: 'wins', label: 'Vitórias', value: (t) => t.wins, neutral: true },
  { key: 'draws', label: 'Empates', value: (t) => t.draws, neutral: true },
  { key: 'losses', label: 'Derrotas', value: (t) => t.losses, neutral: true },
  { key: 'pointsPct', label: 'Aproveitamento', value: (t) => ratio(t.wins * 3 + t.draws, t.matches * 3), format: pct, rate: true },
  { key: 'goals', label: 'Gols', value: (t) => t.goals },
  { key: 'assists', label: 'Assistências', value: (t) => t.assists },
  { key: 'contributions', label: 'Participações em gols', value: (t) => t.goals + t.assists },
  { key: 'goalsPerMatch', label: 'Gols por partida', value: (t) => ratio(t.goals, t.matches), format: dec, rate: true },
  { key: 'assistsPerMatch', label: 'Assistências por partida', value: (t) => ratio(t.assists, t.matches), format: dec, rate: true },
  { key: 'contributionsPerMatch', label: 'Participações por partida', value: (t) => ratio(t.goals + t.assists, t.matches), format: dec, rate: true },
  { key: 'ownGoals', label: 'Gols contra', value: (t) => t.ownGoals, ascending: true, neutral: true },
  { key: 'keeperMatches', label: 'Partidas no gol', value: (t) => t.keeperMatches, neutral: true },
  { key: 'concededPerMatch', label: 'Gols sofridos por partida no gol', value: (t) => ratio(t.goalsConceded, t.keeperMatches), format: dec, ascending: true, rate: true, sample: (t) => t.keeperMatches },
  { key: 'mvps', label: 'MVPs', value: (t) => t.mvps, needsMvp: true },
];

/**
 * Which players lead a metric. Nobody leads when the values are all equal,
 * when a value is missing, or, for a rate, when someone is below the minimum
 * sample (the comparison would not be in equivalent conditions).
 */
export function leaders(metric: CompareMetric, totals: PlayerTotals[], minSample = MIN_MATCHES_EFFICIENCY): { ids: string[]; reason: 'ok' | 'tie' | 'sample' | 'missing' | 'neutral' } {
  if (metric.neutral) return { ids: [], reason: 'neutral' };
  if (metric.rate && totals.some((t) => (metric.sample ? metric.sample(t) : t.matches) < minSample)) return { ids: [], reason: 'sample' };
  const values = totals.map((t) => metric.value(t));
  if (values.some((v) => v === null)) return { ids: [], reason: 'missing' };
  const nums = values as number[];
  const best = metric.ascending ? Math.min(...nums) : Math.max(...nums);
  if (nums.every((v) => v === best)) return { ids: [], reason: 'tie' };
  return { ids: totals.filter((_, i) => nums[i] === best).map((t) => t.playerId), reason: 'ok' };
}

export { MIN_MATCHES_EFFICIENCY };
