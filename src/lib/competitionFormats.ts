import { buildRoundRobin, type Pairing } from './roundRobin.ts';

export type GroupAssignment = {
  name: string;
  teamIds: string[];
};

export type GroupCrossoverMode = 'RANKED' | 'DRAW';

export type GroupTeamStanding = {
  teamId: string;
  groupName: string;
  rank: number;
};

export type KnockoutSlot =
  | { kind: 'team'; teamId: string }
  | { kind: 'winner'; sourceKey: string }
  | { kind: 'loser'; sourceKey: string };

export type KnockoutSeries = {
  key: string;
  round: number;
  matchNumber: number;
  home: KnockoutSlot;
  away: KnockoutSlot;
  legs: 1 | 2;
  thirdPlace?: boolean;
};

export type KnockoutPlan = {
  rounds: KnockoutSeries[][];
  thirdPlace: KnockoutSeries | null;
};

export type StandingStats = {
  teamId: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

export type TieBreaker =
  | 'POINTS'
  | 'WINS'
  | 'DRAWS'
  | 'LOSSES'
  | 'GOAL_DIFF'
  | 'GOALS_FOR'
  | 'GOALS_AGAINST'
  | 'TEAM_NAME';

export function compareTeamNames(a: string, b: string): number {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function assertUniqueTeams(teamIds: string[]) {
  if (teamIds.some((id) => !id)) throw new Error('A lista contém um identificador de equipe vazio.');
  if (new Set(teamIds).size !== teamIds.length) throw new Error('A lista contém equipes duplicadas.');
}

export function distributeTeamsIntoGroups(teamIds: string[], groupCount: number): GroupAssignment[] {
  assertUniqueTeams(teamIds);
  if (!Number.isInteger(groupCount) || groupCount < 2 || groupCount > teamIds.length) {
    throw new Error('A quantidade de grupos precisa ser válida e permitir ao menos uma equipe por grupo.');
  }
  const groups = Array.from({ length: groupCount }, (_, index) => ({
    name: `Grupo ${String.fromCharCode(65 + index)}`,
    teamIds: [] as string[],
  }));
  teamIds.forEach((teamId, index) => groups[index % groupCount].teamIds.push(teamId));
  return groups;
}

export function buildGroupRoundRobin(groups: GroupAssignment[], legs: 1 | 2 = 1) {
  const allTeams = groups.flatMap((group) => group.teamIds);
  assertUniqueTeams(allTeams);
  if (groups.some((group) => group.teamIds.length < 2)) {
    throw new Error('Cada grupo precisa ter ao menos duas equipes.');
  }
  return groups.map((group) => ({
    groupName: group.name,
    rounds: buildRoundRobin(group.teamIds, legs),
  }));
}

// Row of the stage_standings view (snake_case) as StandingStats.
export function standingFromView<T extends {
  season_team_id: string; team_name: string; played: number; wins: number; draws: number;
  losses: number; goals_for: number; goals_against: number; points: number;
}>(row: T): T & StandingStats {
  return { ...row, teamId: row.season_team_id, teamName: row.team_name, goalsFor: row.goals_for, goalsAgainst: row.goals_against };
}

export function rankStandings(rows: StandingStats[], tieBreakers: TieBreaker[]): StandingStats[] {
  if (!tieBreakers.length || new Set(tieBreakers).size !== tieBreakers.length) {
    throw new Error('Os critérios de desempate precisam ser únicos e conter ao menos um item.');
  }
  return [...rows].sort((a, b) => {
    for (const criterion of tieBreakers) {
      if (criterion === 'TEAM_NAME') {
        const byName = compareTeamNames(a.teamName, b.teamName);
        if (byName) return byName;
        continue;
      }
      const value = (row: StandingStats) => {
        switch (criterion) {
          case 'POINTS': return row.points;
          case 'WINS': return row.wins;
          case 'DRAWS': return row.draws;
          case 'LOSSES': return -row.losses;
          case 'GOAL_DIFF': return row.goalsFor - row.goalsAgainst;
          case 'GOALS_FOR': return row.goalsFor;
          case 'GOALS_AGAINST': return -row.goalsAgainst;
        }
      };
      const difference = value(b) - value(a);
      if (difference) return difference;
    }
    return compareTeamNames(a.teamName, b.teamName);
  });
}

function seededPositions(size: number): number[] {
  let positions = [1, 2];
  for (let currentSize = 2; currentSize < size; currentSize *= 2) {
    positions = positions.flatMap((seed) => [seed, currentSize * 2 + 1 - seed]);
  }
  return positions;
}

function slotForTeam(teamId: string): KnockoutSlot {
  return { kind: 'team', teamId };
}

function buildKnockoutFromSeedSlots(
  seedSlots: (string | null)[],
  legs: 1 | 2 = 1,
  includeThirdPlace = false,
): KnockoutPlan {
  const teamIds = seedSlots.filter((teamId): teamId is string => teamId !== null);
  assertUniqueTeams(teamIds);
  if (teamIds.length < 2) throw new Error('O mata-mata precisa de ao menos duas equipes.');
  if (legs !== 1 && legs !== 2) throw new Error('O mata-mata aceita jogo único ou ida e volta.');

  const bracketSize = seedSlots.length;
  const seedOrder = seededPositions(bracketSize);
  let slots: (KnockoutSlot | null)[] = seedOrder.map((seed) => {
    const teamId = seedSlots[seed - 1];
    return teamId ? slotForTeam(teamId) : null;
  });
  const rounds: KnockoutSeries[][] = [];
  let round = 1;
  const semifinalKeys: string[] = [];

  while (slots.length > 1) {
    const fixtures: KnockoutSeries[] = [];
    const nextSlots: (KnockoutSlot | null)[] = [];
    for (let index = 0; index < slots.length; index += 2) {
      const home = slots[index];
      const away = slots[index + 1];
      if (!home && !away) {
        nextSlots.push(null);
        continue;
      }
      if (!home || !away) {
        nextSlots.push(home ?? away);
        continue;
      }

      const key = `R${round}M${fixtures.length + 1}`;
      fixtures.push({
        key,
        round,
        matchNumber: fixtures.length + 1,
        home,
        away,
        legs,
      });
      nextSlots.push({ kind: 'winner', sourceKey: key });
      if (slots.length === 4) semifinalKeys.push(key);
    }
    rounds.push(fixtures);
    slots = nextSlots;
    round += 1;
  }

  let thirdPlace: KnockoutSeries | null = null;
  if (includeThirdPlace && semifinalKeys.length === 2) {
    thirdPlace = {
      key: 'THIRD_PLACE',
      round: round - 1,
      matchNumber: 1,
      home: { kind: 'loser', sourceKey: semifinalKeys[0] },
      away: { kind: 'loser', sourceKey: semifinalKeys[1] },
      legs,
      thirdPlace: true,
    };
  }
  return { rounds, thirdPlace };
}

export function buildKnockoutBracket(
  teamIds: string[],
  legs: 1 | 2 = 1,
  includeThirdPlace = false,
): KnockoutPlan {
  assertUniqueTeams(teamIds);
  if (teamIds.length < 2) throw new Error('O mata-mata precisa de ao menos duas equipes.');
  const bracketSize = 2 ** Math.ceil(Math.log2(teamIds.length));
  const seedSlots: (string | null)[] = Array(bracketSize).fill(null);
  teamIds.forEach((teamId, index) => { seedSlots[index] = teamId; });
  return buildKnockoutFromSeedSlots(seedSlots, legs, includeThirdPlace);
}

function findCrossGroupPairings(
  teams: GroupTeamStanding[],
  pairCount: number,
  mode: GroupCrossoverMode,
  random: () => number,
): [GroupTeamStanding, GroupTeamStanding][] | null {
  if (pairCount === 0) return teams.length === 0 ? [] : null;
  if (teams.length !== pairCount * 2) return null;
  const [first, ...remaining] = teams;
  const candidates = remaining
    .map((team, index) => ({ team, index }))
    .filter(({ team }) => team.groupName !== first.groupName);
  if (mode === 'RANKED') {
    candidates.sort((a, b) => Math.abs(b.team.rank - first.rank) - Math.abs(a.team.rank - first.rank));
  } else {
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [candidates[index], candidates[target]] = [candidates[target], candidates[index]];
    }
  }
  for (const candidate of candidates) {
    const rest = remaining.filter((_, index) => index !== candidate.index);
    const restPairs = findCrossGroupPairings(rest, pairCount - 1, mode, random);
    if (restPairs) return [[first, candidate.team], ...restPairs];
  }
  return null;
}

export function buildGroupKnockoutBracket(
  rankedGroups: { name: string; teamIds: string[] }[],
  qualifiersPerGroup: number,
  legs: 1 | 2 = 1,
  includeThirdPlace = false,
  crossoverMode: GroupCrossoverMode = 'RANKED',
  crossoverSeed = 0,
): KnockoutPlan {
  const qualifiers = seedGroupQualifiers(rankedGroups, qualifiersPerGroup);
  const bracketSize = 2 ** Math.ceil(Math.log2(qualifiers.length));
  const byeCount = bracketSize - qualifiers.length;
  const byes = qualifiers.slice(0, byeCount);
  const participants = qualifiers.slice(byeCount);
  const pairCount = participants.length / 2;
  let randomState = (crossoverSeed >>> 0) || 0x6d2b79f5;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const pairings = findCrossGroupPairings(participants, pairCount, crossoverMode, random);
  if (!pairings) {
    throw new Error('Não foi possível cruzar os classificados sem repetir equipes do mesmo grupo.');
  }

  const seedOrder = seededPositions(bracketSize);
  const seedSlots: (string | null)[] = Array(bracketSize).fill(null);
  const usedSeeds = new Set<number>();
  pairings.forEach(([first, second], index) => {
    const firstSeed = seedOrder[index * 2];
    const secondSeed = seedOrder[index * 2 + 1];
    const [higher, lower] = first.rank <= second.rank ? [first, second] : [second, first];
    seedSlots[Math.min(firstSeed, secondSeed) - 1] = higher.teamId;
    seedSlots[Math.max(firstSeed, secondSeed) - 1] = lower.teamId;
    usedSeeds.add(firstSeed);
    usedSeeds.add(secondSeed);
  });
  const openSeeds = Array.from({ length: bracketSize }, (_, index) => index + 1)
    .filter((seed) => !usedSeeds.has(seed));
  byes.forEach((team, index) => { seedSlots[openSeeds[index] - 1] = team.teamId; });
  return buildKnockoutFromSeedSlots(seedSlots, legs, includeThirdPlace);
}

/**
 * Per-stage knockout options applied to a plan built by buildKnockoutBracket /
 * buildGroupKnockoutBracket:
 * - finalLegs: games of the final (e.g. two-legged semifinals, single-match final);
 * - betterSeedHostsSecondLeg: in two-legged ties between known teams the
 *   better-placed team (the plan's home side) plays the second leg at home, so
 *   the first leg is at the other team's home. Ties fed by previous winners keep
 *   their order, because the better-placed team is not known yet.
 */
export function applyKnockoutOptions(
  plan: KnockoutPlan,
  { finalLegs, betterSeedHostsSecondLeg = false }: { finalLegs?: 1 | 2; betterSeedHostsSecondLeg?: boolean },
): KnockoutPlan {
  const lastRound = plan.rounds.length - 1;
  const adjust = (series: KnockoutSeries, isFinal: boolean): KnockoutSeries => {
    const legs = isFinal && finalLegs ? finalLegs : series.legs;
    const swap = betterSeedHostsSecondLeg && legs === 2 && series.home.kind === 'team' && series.away.kind === 'team';
    return { ...series, legs, home: swap ? series.away : series.home, away: swap ? series.home : series.away };
  };
  return {
    rounds: plan.rounds.map((round, index) => round.map((series) => adjust(series, index === lastRound))),
    thirdPlace: plan.thirdPlace ? adjust(plan.thirdPlace, false) : null,
  };
}

export function seedGroupQualifiers(
  rankedGroups: { name: string; teamIds: string[] }[],
  qualifiersPerGroup: number,
): GroupTeamStanding[] {
  if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) {
    throw new Error('A quantidade de classificados por grupo precisa ser positiva.');
  }
  if (rankedGroups.length < 2) throw new Error('A fase precisa ter ao menos dois grupos.');
  const result: GroupTeamStanding[] = [];
  for (let rank = 0; rank < qualifiersPerGroup; rank += 1) {
    for (const group of rankedGroups) {
      const teamId = group.teamIds[rank];
      if (!teamId) throw new Error(`O ${group.name} não possui classificados suficientes.`);
      result.push({ teamId, groupName: group.name, rank: rank + 1 });
    }
  }
  assertUniqueTeams(result.map((team) => team.teamId));
  return result;
}

export type MatchResult = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
};

export type ResolvedSeries = {
  key: string;
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId: string | null;
  loserTeamId: string | null;
};

function resolveSlot(
  slot: KnockoutSlot,
  resolved: Map<string, ResolvedSeries>,
): string | null {
  if (slot.kind === 'team') return slot.teamId;
  const source = resolved.get(slot.sourceKey);
  if (!source) return null;
  return slot.kind === 'winner' ? source.winnerTeamId : source.loserTeamId;
}

export function resolveKnockoutPlan(
  plan: KnockoutPlan,
  resultsBySeries: Map<string, MatchResult[]>,
): ResolvedSeries[] {
  const resolved = new Map<string, ResolvedSeries>();
  const series = [...plan.rounds.flat(), ...(plan.thirdPlace ? [plan.thirdPlace] : [])];
  for (const fixture of series) {
    const homeTeamId = resolveSlot(fixture.home, resolved);
    const awayTeamId = resolveSlot(fixture.away, resolved);
    if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) continue;

    const results = resultsBySeries.get(fixture.key) ?? [];
    const winnerTeamId = results.length === fixture.legs
      ? fixture.legs === 1
        ? resolveMatchWinner(results[0])
        : resolveAggregateWinner(homeTeamId, awayTeamId, results, results[results.length - 1])
      : null;
    const result = {
      key: fixture.key,
      homeTeamId,
      awayTeamId,
      winnerTeamId,
      loserTeamId: winnerTeamId
        ? winnerTeamId === homeTeamId ? awayTeamId : homeTeamId
        : null,
    };
    resolved.set(fixture.key, result);
  }
  return series.map((fixture) => resolved.get(fixture.key)).filter((result): result is ResolvedSeries => Boolean(result));
}

export function resolveMatchWinner(result: MatchResult): string | null {
  if (result.homeScore > result.awayScore) return result.homeTeamId;
  if (result.awayScore > result.homeScore) return result.awayTeamId;
  if (result.homePenaltyScore == null || result.awayPenaltyScore == null
    || result.homePenaltyScore === result.awayPenaltyScore) return null;
  return result.homePenaltyScore > result.awayPenaltyScore ? result.homeTeamId : result.awayTeamId;
}

export function resolveAggregateWinner(
  homeTeamId: string,
  awayTeamId: string,
  legs: MatchResult[],
  penaltyResult?: MatchResult,
): string | null {
  if (legs.length === 0) return null;
  const goals = new Map([[homeTeamId, 0], [awayTeamId, 0]]);
  for (const leg of legs) {
    goals.set(leg.homeTeamId, (goals.get(leg.homeTeamId) ?? 0) + leg.homeScore);
    goals.set(leg.awayTeamId, (goals.get(leg.awayTeamId) ?? 0) + leg.awayScore);
  }
  const homeGoals = goals.get(homeTeamId) ?? 0;
  const awayGoals = goals.get(awayTeamId) ?? 0;
  if (homeGoals > awayGoals) return homeTeamId;
  if (awayGoals > homeGoals) return awayTeamId;
  if (!penaltyResult || penaltyResult.homePenaltyScore == null
    || penaltyResult.awayPenaltyScore == null
    || penaltyResult.homePenaltyScore === penaltyResult.awayPenaltyScore) return null;
  return penaltyResult.homePenaltyScore > penaltyResult.awayPenaltyScore
    ? penaltyResult.homeTeamId
    : penaltyResult.awayTeamId;
}

export function buildMatchPairings(rounds: Pairing[][]) {
  return rounds.flatMap((round, roundIndex) => round.map((pairing, matchIndex) => ({
    round: roundIndex + 1,
    matchNumber: matchIndex + 1,
    ...pairing,
  })));
}
