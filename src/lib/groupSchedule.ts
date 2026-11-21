// Group stage table with SHARED rounds: round N holds the matches of every
// group. Each group of n teams (n even) plays n-1 first-leg rounds and n-1
// second-leg rounds; the second leg repeats every pairing with home and away
// inverted.
//
// The planner only prepares the preview. It never invents data silently:
// every match is labelled as `existing` (already stored), `entered` (given by
// the organizer) or `proposed` (filled in by the planner and shown as such).
// The database function apply_group_schedule() validates everything again.

export type ScheduleGroup = { name: string; teamIds: string[] };
export type EnteredFixture = { group: number; round: number; homeId: string; awayId: string };
export type ExistingMatch = {
  id: string;
  round: number;
  homeId: string | null;
  awayId: string | null;
  status: string;
  scheduledAt: string | null;
};
export type PlannedMatch = {
  group: number;
  round: number;
  homeId: string;
  awayId: string;
  source: 'existing' | 'entered' | 'proposed';
  existingId?: string;
  status?: string;
  scheduledAt?: string | null;
};
export type SchedulePlan = { roundCount: number; matches: PlannedMatch[]; conflicts: string[] };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const fixtureKey = (round: number, homeId: string, awayId: string) => `${round}:${homeId}:${awayId}`;

// Every way of splitting the teams into pairs (one round of a group).
export function perfectMatchings(teams: string[]): string[][] {
  if (teams.length === 0) return [[]];
  const [first, ...rest] = teams;
  const result: string[][] = [];
  rest.forEach((partner, index) => {
    const remaining = rest.filter((_, other) => other !== index);
    for (const matching of perfectMatchings(remaining)) result.push([pairKey(first, partner), ...matching]);
  });
  return result;
}

function assignRounds(
  rounds: number[],
  matchings: string[][],
  required: Map<number, Set<string>>,
  preferred: Map<number, Set<string>>,
): Map<number, string[]> | null {
  const solution = new Map<number, string[]>();
  const used = new Set<string>();
  const search = (index: number): boolean => {
    if (index === rounds.length) return true;
    const round = rounds[index];
    const needed = required.get(round) ?? new Set<string>();
    const wanted = preferred.get(round) ?? new Set<string>();
    const candidates = matchings
      .filter((matching) => [...needed].every((pair) => matching.includes(pair)) && matching.every((pair) => !used.has(pair)))
      .sort((a, b) => b.filter((pair) => wanted.has(pair)).length - a.filter((pair) => wanted.has(pair)).length);
    for (const matching of candidates) {
      matching.forEach((pair) => used.add(pair));
      solution.set(round, matching);
      if (search(index + 1)) return true;
      matching.forEach((pair) => used.delete(pair));
      solution.delete(round);
    }
    return false;
  };
  return search(0) ? solution : null;
}

export function planGroupSchedule({
  groups,
  entered,
  existing,
  teamName = (id) => id,
}: {
  groups: ScheduleGroup[];
  entered: EnteredFixture[];
  existing: ExistingMatch[];
  teamName?: (id: string) => string;
}): SchedulePlan {
  const conflicts: string[] = [];
  const sizes = new Set(groups.map((group) => group.teamIds.length));
  const allTeams = groups.flatMap((group) => group.teamIds);
  if (groups.length < 2) conflicts.push('São necessários ao menos dois grupos.');
  if (sizes.size !== 1 || [...sizes][0] < 2 || [...sizes][0] % 2 === 1) {
    conflicts.push('Todos os grupos precisam ter o mesmo número par de equipes.');
  }
  if (new Set(allTeams).size !== allTeams.length) conflicts.push('Uma equipe aparece em mais de um grupo.');
  if (conflicts.length) return { roundCount: 0, matches: [], conflicts };

  const size = groups[0].teamIds.length;
  const half = size - 1;
  const roundCount = 2 * half;
  const legOf = (round: number) => (round <= half ? 1 : 2);
  const groupOf = new Map<string, number>();
  groups.forEach((group, index) => group.teamIds.forEach((id) => groupOf.set(id, index)));
  const label = (homeId: string, awayId: string) => `${teamName(homeId)} × ${teamName(awayId)}`;

  type Known = { group: number; round: number; homeId: string; awayId: string; source: 'existing' | 'entered'; match?: ExistingMatch };
  const known: Known[] = [];
  const occupied = new Map<string, Known>(); // `${round}:${team}`
  const legPairs = new Map<string, Known>(); // `${leg}:${pair}`

  const accept = (fixture: Known): boolean => {
    const { round, homeId, awayId } = fixture;
    for (const team of [homeId, awayId]) {
      const other = occupied.get(`${round}:${team}`);
      if (other) {
        conflicts.push(`Rodada ${round}: ${teamName(team)} aparece em ${label(other.homeId, other.awayId)} e em ${label(homeId, awayId)}.`);
        return false;
      }
    }
    const pairSlot = `${legOf(round)}:${pairKey(homeId, awayId)}`;
    const repeated = legPairs.get(pairSlot);
    if (repeated) {
      conflicts.push(`${label(homeId, awayId)} aparece duas vezes no ${legOf(round) === 1 ? 'turno' : 'returno'} (rodadas ${repeated.round} e ${round}).`);
      return false;
    }
    occupied.set(`${round}:${homeId}`, fixture);
    occupied.set(`${round}:${awayId}`, fixture);
    legPairs.set(pairSlot, fixture);
    known.push(fixture);
    return true;
  };

  for (const match of existing) {
    if (!match.homeId || !match.awayId) {
      conflicts.push('Há uma partida cadastrada sem as duas equipes definidas.');
      continue;
    }
    const group = groupOf.get(match.homeId);
    if (match.round < 1 || match.round > roundCount) {
      conflicts.push(`${label(match.homeId, match.awayId)} está cadastrada fora das rodadas 1 a ${roundCount}.`);
    } else if (group === undefined || group !== groupOf.get(match.awayId)) {
      conflicts.push(`${label(match.homeId, match.awayId)}, já cadastrada, reúne equipes de grupos diferentes.`);
    } else {
      accept({ group, round: match.round, homeId: match.homeId, awayId: match.awayId, source: 'existing', match });
    }
  }
  for (const fixture of entered) {
    const sameAsExisting = known.some((item) => item.source === 'existing' && item.round === fixture.round
      && item.homeId === fixture.homeId && item.awayId === fixture.awayId);
    if (sameAsExisting) continue;
    const group = groupOf.get(fixture.homeId);
    if (fixture.homeId === fixture.awayId || group === undefined || group !== groupOf.get(fixture.awayId) || group !== fixture.group) {
      conflicts.push(`Rodada ${fixture.round}: ${label(fixture.homeId, fixture.awayId)} não é um confronto válido dentro do grupo.`);
    } else if (fixture.round < 1 || fixture.round > roundCount) {
      conflicts.push(`${label(fixture.homeId, fixture.awayId)} está fora das rodadas 1 a ${roundCount}.`);
    } else {
      accept({ ...fixture, group, source: 'entered' });
    }
  }

  // Home team of each pairing in the FIRST leg, from what is known.
  const firstLegHome = new Map<string, string>();
  for (const fixture of known) {
    const key = pairKey(fixture.homeId, fixture.awayId);
    const home = legOf(fixture.round) === 1 ? fixture.homeId : fixture.awayId;
    const current = firstLegHome.get(key);
    if (current && current !== home) {
      conflicts.push(`O returno precisa inverter o mando de ${label(fixture.homeId, fixture.awayId)}.`);
    } else {
      firstLegHome.set(key, home);
    }
  }

  const matches: PlannedMatch[] = [];
  groups.forEach((group, groupIndex) => {
    const matchings = perfectMatchings(group.teamIds);
    const requiredByRound = new Map<number, Set<string>>();
    for (const fixture of known.filter((item) => item.group === groupIndex)) {
      const set = requiredByRound.get(fixture.round) ?? new Set<string>();
      set.add(pairKey(fixture.homeId, fixture.awayId));
      requiredByRound.set(fixture.round, set);
    }
    const firstRounds = Array.from({ length: half }, (_, index) => index + 1);
    const secondRounds = firstRounds.map((round) => round + half);
    const mirrorOfSecond = new Map(firstRounds.map((round) => [round, requiredByRound.get(round + half) ?? new Set<string>()]));
    const firstLeg = assignRounds(firstRounds, matchings, requiredByRound, mirrorOfSecond);
    if (!firstLeg) {
      conflicts.push(`${group.name}: não é possível completar o turno com os confrontos informados.`);
      return;
    }
    const mirrorOfFirst = new Map(secondRounds.map((round) => [round, new Set(firstLeg.get(round - half) ?? [])]));
    const secondLeg = assignRounds(secondRounds, matchings, requiredByRound, mirrorOfFirst);
    if (!secondLeg) {
      conflicts.push(`${group.name}: não é possível completar o returno com os confrontos informados.`);
      return;
    }

    // Unknown home teams (known ones are never changed): balance first-leg
    // home games; on a tie, alternate (the team that played at home in the
    // previous round plays away); then earlier seed first.
    const homeCount = new Map(group.teamIds.map((id) => [id, 0]));
    const playedHome = new Map<string, boolean>(); // `${round}:${team}`
    for (const round of firstRounds) {
      for (const pair of firstLeg.get(round) ?? []) {
        const home = firstLegHome.get(pair);
        if (!home) continue;
        const [a, b] = pair.split('|');
        homeCount.set(home, (homeCount.get(home) ?? 0) + 1);
        playedHome.set(`${round}:${home}`, true);
        playedHome.set(`${round}:${home === a ? b : a}`, false);
      }
    }
    for (const round of firstRounds) {
      for (const pair of firstLeg.get(round) ?? []) {
        if (firstLegHome.has(pair)) continue;
        const [a, b] = pair.split('|');
        const wasHome = (id: string) => (playedHome.get(`${round - 1}:${id}`) ? 1 : 0);
        const ordered = [a, b].sort((x, y) => (homeCount.get(x)! - homeCount.get(y)!)
          || wasHome(x) - wasHome(y)
          || group.teamIds.indexOf(x) - group.teamIds.indexOf(y));
        firstLegHome.set(pair, ordered[0]);
        homeCount.set(ordered[0], homeCount.get(ordered[0])! + 1);
        playedHome.set(`${round}:${ordered[0]}`, true);
        playedHome.set(`${round}:${ordered[1]}`, false);
      }
    }

    for (const round of [...firstRounds, ...secondRounds]) {
      const leg = (round <= half ? firstLeg : secondLeg).get(round) ?? [];
      for (const pair of leg) {
        const [a, b] = pair.split('|');
        const firstHome = firstLegHome.get(pair)!;
        const firstAway = firstHome === a ? b : a;
        const homeId = round <= half ? firstHome : firstAway;
        const awayId = round <= half ? firstAway : firstHome;
        const match = known.find((item) => item.round === round && item.homeId === homeId && item.awayId === awayId);
        matches.push({
          group: groupIndex,
          round,
          homeId,
          awayId,
          source: match?.source ?? 'proposed',
          existingId: match?.match?.id,
          status: match?.match?.status,
          scheduledAt: match?.match?.scheduledAt ?? null,
        });
      }
    }
  });

  matches.sort((x, y) => x.round - y.round || x.group - y.group
    || groups[x.group].teamIds.indexOf(x.homeId) - groups[y.group].teamIds.indexOf(y.homeId));
  return { roundCount, matches, conflicts };
}

// "<id>:<status>,..." ordered by id — the same text apply_group_schedule()
// computes, so a table changed after the preview is detected.
export function existingFingerprint(existing: Pick<ExistingMatch, 'id' | 'status'>[]): string {
  return [...existing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((match) => `${match.id}:${match.status}`).join(',');
}

export function buildSchedulePayload(
  groups: ScheduleGroup[],
  plan: SchedulePlan,
  dates: Record<string, string | null | undefined>,
) {
  return {
    p_groups: groups.map((group) => ({ name: group.name, team_ids: group.teamIds })),
    p_matches: plan.matches.map((match) => ({
      round_order: match.round,
      home_team_id: match.homeId,
      away_team_id: match.awayId,
      scheduled_at: match.source === 'existing' ? null : dates[fixtureKey(match.round, match.homeId, match.awayId)] || null,
    })),
  };
}
