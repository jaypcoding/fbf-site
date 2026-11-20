import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSchedulePayload,
  existingFingerprint,
  fixtureKey,
  perfectMatchings,
  planGroupSchedule,
} from '../src/lib/groupSchedule.ts';

// Official FBF 20 groups (ids are the team names for readability).
const groups = [
  { name: 'Grupo A', teamIds: ['Aberração Neural', 'Envy', 'New Jeans', 'Winners Long'] },
  { name: 'Grupo B', teamIds: ['Press X', 'We Already Won', 'Vincere', 'OS4B'] },
  { name: 'Grupo C', teamIds: ['Forsaken', 'Botafogo', 'Domination X', 'Sem Firula'] },
  { name: 'Grupo D', teamIds: ['Hardy Boys', 'Xiamen Pandas Club', 'Wolverhampton', 'Flawless'] },
];
const fixture = (group, round, homeId, awayId) => ({ group, round, homeId, awayId });
// Rounds 1 and 2 as published by the organization.
const official = [
  fixture(0, 1, 'Aberração Neural', 'Envy'), fixture(0, 1, 'New Jeans', 'Winners Long'),
  fixture(1, 1, 'Press X', 'We Already Won'), fixture(1, 1, 'Vincere', 'OS4B'),
  fixture(2, 1, 'Forsaken', 'Botafogo'), fixture(2, 1, 'Domination X', 'Sem Firula'),
  fixture(3, 1, 'Hardy Boys', 'Xiamen Pandas Club'), fixture(3, 1, 'Wolverhampton', 'Flawless'),
  fixture(0, 2, 'New Jeans', 'Envy'), fixture(0, 2, 'Aberração Neural', 'Winners Long'),
  fixture(1, 2, 'Vincere', 'We Already Won'), fixture(1, 2, 'Press X', 'OS4B'),
  fixture(2, 2, 'Sem Firula', 'Botafogo'), fixture(2, 2, 'Forsaken', 'Domination X'),
  fixture(3, 2, 'Hardy Boys', 'Flawless'), fixture(3, 2, 'Wolverhampton', 'Xiamen Pandas Club'),
];
const existing = [{ id: 'm-nj-wl', round: 1, homeId: 'New Jeans', awayId: 'Winners Long', status: 'FINISHED', scheduledAt: '2026-11-16T03:00:00Z' }];

test('perfect matchings of four teams are the three possible rounds', () => {
  assert.equal(perfectMatchings(['a', 'b', 'c', 'd']).length, 3);
  assert.equal(perfectMatchings(['a', 'b', 'c', 'd', 'e', 'f']).length, 15);
});

test('completes the FBF 20 table from the official rounds 1-2 and the existing match', () => {
  const plan = planGroupSchedule({ groups, entered: official, existing });
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.roundCount, 6);
  assert.equal(plan.matches.length, 48);

  for (let round = 1; round <= 6; round += 1) {
    const teams = plan.matches.filter((m) => m.round === round).flatMap((m) => [m.homeId, m.awayId]);
    assert.equal(teams.length, 16, `round ${round} has 8 matches`);
    assert.equal(new Set(teams).size, 16, `every team plays once in round ${round}`);
  }
  for (const match of plan.matches) {
    const reverse = plan.matches.filter((m) => m.homeId === match.awayId && m.awayId === match.homeId);
    assert.equal(reverse.length, 1, `${match.homeId} x ${match.awayId} has exactly one return match`);
    assert.notEqual(reverse[0].round <= 3, match.round <= 3, 'the return match is in the other leg');
  }

  const sources = plan.matches.reduce((acc, m) => ({ ...acc, [m.source]: (acc[m.source] ?? 0) + 1 }), {});
  assert.deepEqual(sources, { existing: 1, entered: 15, proposed: 32 });
  const nj = plan.matches.find((m) => m.existingId === 'm-nj-wl');
  assert.deepEqual([nj.round, nj.homeId, nj.awayId, nj.status], [1, 'New Jeans', 'Winners Long', 'FINISHED']);

  // Round 3 of group A is forced by rounds 1-2; only the home team is proposed.
  const roundThreeA = plan.matches.filter((m) => m.round === 3 && m.group === 0);
  assert.deepEqual(roundThreeA.map((m) => [m.homeId, m.awayId].sort().join(' / ')).sort(),
    ['Aberração Neural / New Jeans', 'Envy / Winners Long']);
  assert.ok(roundThreeA.every((m) => m.source === 'proposed'));
  // The second leg mirrors the first in the same order by default.
  const roundFourA = plan.matches.filter((m) => m.round === 4 && m.group === 0).map((m) => `${m.homeId}>${m.awayId}`).sort();
  assert.deepEqual(roundFourA, ['Envy>Aberração Neural', 'Winners Long>New Jeans']);
});

test('the plan is deterministic', () => {
  const first = planGroupSchedule({ groups, entered: official, existing });
  const second = planGroupSchedule({ groups, entered: [...official].reverse(), existing });
  assert.deepEqual(first.matches, second.matches);
});

test('an empty stage gets a complete proposed table', () => {
  const plan = planGroupSchedule({ groups, entered: [], existing: [] });
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.matches.length, 48);
  assert.ok(plan.matches.every((m) => m.source === 'proposed'));
  const homeGames = new Map();
  for (const m of plan.matches) homeGames.set(m.homeId, (homeGames.get(m.homeId) ?? 0) + 1);
  assert.ok([...homeGames.values()].every((count) => count === 3), 'each team plays three home games');
});

test('explains conflicts instead of guessing', () => {
  const cases = [
    [[fixture(0, 1, 'Aberração Neural', 'Press X')], /não é um confronto válido/],
    [[fixture(0, 3, 'Aberração Neural', 'Envy')], /aparece duas vezes no turno/],
    [[fixture(0, 1, 'Envy', 'New Jeans')], /Rodada 1: (Envy|New Jeans) aparece/],
    [[fixture(0, 4, 'Aberração Neural', 'Envy')], /inverter o mando/],
    [[fixture(0, 7, 'Aberração Neural', 'New Jeans')], /fora das rodadas 1 a 6/],
  ];
  for (const [extra, pattern] of cases) {
    const plan = planGroupSchedule({ groups, entered: [...official, ...extra], existing });
    assert.ok(plan.conflicts.some((message) => pattern.test(message)), `${pattern} in ${plan.conflicts.join(' | ')}`);
  }
  const crossGroupExisting = planGroupSchedule({
    groups,
    entered: [],
    existing: [{ id: 'x', round: 1, homeId: 'Envy', awayId: 'OS4B', status: 'SCHEDULED', scheduledAt: null }],
  });
  assert.match(crossGroupExisting.conflicts.join(' '), /grupos diferentes/);
  assert.match(planGroupSchedule({ groups: [groups[0], { name: 'Grupo B', teamIds: ['Press X', 'OS4B', 'Vincere'] }], entered: [], existing: [] }).conflicts.join(' '), /mesmo número par/);
  assert.match(planGroupSchedule({ groups: [groups[0], { ...groups[1], teamIds: ['Envy', 'OS4B'] }], entered: [], existing: [] }).conflicts.join(' '), /mais de um grupo/);
});

test('fingerprint and payload match what the database expects', () => {
  assert.equal(existingFingerprint([{ id: 'b', status: 'SCHEDULED' }, { id: 'a', status: 'FINISHED' }]), 'a:FINISHED,b:SCHEDULED');
  assert.equal(existingFingerprint([]), '');
  const plan = planGroupSchedule({ groups, entered: official, existing });
  const dates = {
    [fixtureKey(1, 'Press X', 'We Already Won')]: '2026-11-21T23:00:00.000Z',
    [fixtureKey(1, 'New Jeans', 'Winners Long')]: '2026-12-01T00:00:00.000Z',
  };
  const payload = buildSchedulePayload(groups, plan, dates);
  assert.equal(payload.p_groups.length, 4);
  assert.deepEqual(payload.p_groups[0], { name: 'Grupo A', team_ids: groups[0].teamIds });
  assert.equal(payload.p_matches.length, 48);
  assert.equal(payload.p_matches.find((m) => m.home_team_id === 'Press X' && m.round_order === 1).scheduled_at, '2026-11-21T23:00:00.000Z');
  assert.equal(payload.p_matches.find((m) => m.home_team_id === 'New Jeans' && m.round_order === 1).scheduled_at, null, 'existing matches are never re-dated');
  assert.equal(payload.p_matches.filter((m) => m.scheduled_at).length, 1, 'no date is invented');
});

test('retroactive score counts own goals for the other team', async () => {
  const { scoreFromGoals, PRESUMED_DURATION_SECONDS } = await import('../src/lib/matchRecovery.ts');
  assert.equal(PRESUMED_DURATION_SECONDS, 840);
  assert.deepEqual(scoreFromGoals([]), { home: 0, away: 0 });
  assert.deepEqual(scoreFromGoals([
    { side: 'home', ownGoal: false }, { side: 'home', ownGoal: false },
    { side: 'away', ownGoal: true }, { side: 'away', ownGoal: false }, { side: 'home', ownGoal: true },
  ]), { home: 3, away: 2 });
});
