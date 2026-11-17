import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGroupRoundRobin,
  buildGroupKnockoutBracket,
  buildKnockoutBracket,
  distributeTeamsIntoGroups,
  rankStandings,
  resolveAggregateWinner,
  resolveKnockoutPlan,
  resolveMatchWinner,
  seedGroupQualifiers,
} from '../src/lib/competitionFormats.ts';
import { buildRoundRobin } from '../src/lib/roundRobin.ts';

const teams = (count) => Array.from({ length: count }, (_, index) => `team-${index + 1}`);

test('round robin gives odd-sized leagues one bye per team and return fixtures', () => {
  const singleTurn = buildRoundRobin(teams(5));
  assert.equal(singleTurn.length, 5);
  assert.equal(singleTurn.reduce((total, round) => total + round.length, 0), 10);
  assert.ok(singleTurn.every((round) => round.length === 2));
  const homeAway = buildRoundRobin(teams(5), 2);
  assert.equal(homeAway.length, 10);
  assert.equal(homeAway.reduce((total, round) => total + round.length, 0), 20);
  for (let index = 0; index < 5; index += 1) {
    for (const firstLegMatch of singleTurn[index]) {
      assert.deepEqual(homeAway[index + 5].find((match) => match.home === firstLegMatch.away), {
        home: firstLegMatch.away,
        away: firstLegMatch.home,
      });
    }
  }
});

test('round robin rejects duplicate teams and produces unique pairings in each leg', () => {
  assert.throws(() => buildRoundRobin(['a', 'a']), /duplicados/);
  for (const legCount of [1, 2]) {
    const rounds = buildRoundRobin(teams(6), legCount);
    const count = rounds.reduce((total, round) => total + round.length, 0);
    assert.equal(count, 15 * legCount);
  }
});

test('knockout brackets for 4, 8 and 16 teams have complete rounds and unique opening fixtures', () => {
  for (const count of [4, 8, 16]) {
    const plan = buildKnockoutBracket(teams(count));
    assert.equal(plan.rounds[0].length, count / 2);
    assert.equal(plan.rounds.at(-1).length, 1);
    assert.equal(plan.rounds.flat().length, count - 1);
    const openingParticipants = plan.rounds[0].flatMap(({ home, away }) => [home.teamId, away.teamId]);
    assert.equal(new Set(openingParticipants).size, count);
  }
});

test('knockout bracket handles byes and preserves two-leg series metadata', () => {
  const plan = buildKnockoutBracket(teams(5), 2, true);
  assert.equal(plan.rounds[0].length, 1);
  assert.equal(plan.rounds[0][0].legs, 2);
  assert.equal(plan.rounds[1].length, 2);
  assert.ok(plan.thirdPlace);
});

test('group distribution is balanced, deterministic and includes each team once', () => {
  const groups = distributeTeamsIntoGroups(teams(10), 3);
  assert.deepEqual(groups.map((group) => group.teamIds.length), [4, 3, 3]);
  assert.deepEqual(groups.flatMap((group) => group.teamIds).sort(), teams(10).sort());
  assert.equal(buildGroupRoundRobin(groups, 2).length, 3);
});

test('group rankings honor configured tiebreakers and qualifiers cross group ranks', () => {
  const ranked = rankStandings([
    { teamId: 'b1', teamName: 'Beta', played: 2, wins: 1, draws: 1, losses: 0, goalsFor: 4, goalsAgainst: 1, points: 4 },
    { teamId: 'a1', teamName: 'Alpha', played: 2, wins: 1, draws: 1, losses: 0, goalsFor: 5, goalsAgainst: 2, points: 4 },
    { teamId: 'c1', teamName: 'Gamma', played: 2, wins: 0, draws: 0, losses: 2, goalsFor: 1, goalsAgainst: 6, points: 0 },
  ], ['POINTS', 'GOAL_DIFF', 'GOALS_FOR', 'TEAM_NAME']);
  assert.deepEqual(ranked.map((row) => row.teamId), ['a1', 'b1', 'c1']);
  const defenseRanked = rankStandings([
    { teamId: 'conceded-more', teamName: 'Alpha', played: 2, wins: 1, draws: 1, losses: 0, goalsFor: 4, goalsAgainst: 3, points: 4 },
    { teamId: 'conceded-less', teamName: 'Beta', played: 2, wins: 1, draws: 1, losses: 0, goalsFor: 4, goalsAgainst: 1, points: 4 },
  ], ['POINTS', 'GOALS_AGAINST']);
  assert.deepEqual(defenseRanked.map((row) => row.teamId), ['conceded-less', 'conceded-more']);
  const qualifiers = seedGroupQualifiers([
    { name: 'Grupo A', teamIds: ['a1', 'a2'] },
    { name: 'Grupo B', teamIds: ['b1', 'b2'] },
  ], 2);
  assert.deepEqual(qualifiers.map((item) => item.teamId), ['a1', 'b1', 'a2', 'b2']);
  assert.throws(() => seedGroupQualifiers([
    { name: 'Grupo A', teamIds: ['a1'] },
    { name: 'Grupo B', teamIds: ['b1'] },
  ], 2), /classificados suficientes/);
});

test('ranked and drawn group crossovers keep each opening pairing from the same group', () => {
  const rankedGroups = [
    { name: 'Grupo A', teamIds: ['a1', 'a2'] },
    { name: 'Grupo B', teamIds: ['b1', 'b2'] },
    { name: 'Grupo C', teamIds: ['c1', 'c2'] },
  ];
  const groups = new Map([
    ['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['b2', 'B'], ['c1', 'C'], ['c2', 'C'],
  ]);
  for (const mode of ['RANKED', 'DRAW']) {
    const plan = buildGroupKnockoutBracket(rankedGroups, 2, 1, false, mode);
    for (const match of plan.rounds[0]) {
      if (match.home.kind === 'team' && match.away.kind === 'team') {
        assert.notEqual(groups.get(match.home.teamId), groups.get(match.away.teamId));
      }
    }
  }
});

test('single-match draws require a decisive penalty result', () => {
  assert.equal(resolveMatchWinner({
    homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 2,
  }), null);
  assert.equal(resolveMatchWinner({
    homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 2,
    homePenaltyScore: 4, awayPenaltyScore: 3,
  }), 'a');
  assert.equal(resolveMatchWinner({
    homeTeamId: 'a', awayTeamId: 'b', homeScore: 2, awayScore: 2,
    homePenaltyScore: 3, awayPenaltyScore: 3,
  }), null);
});

test('two-leg ties resolve on aggregate, penalties decide aggregate equality', () => {
  const legs = [
    { homeTeamId: 'a', awayTeamId: 'b', homeScore: 1, awayScore: 0 },
    { homeTeamId: 'b', awayTeamId: 'a', homeScore: 1, awayScore: 0 },
  ];
  assert.equal(resolveAggregateWinner('a', 'b', legs), null);
  assert.equal(resolveAggregateWinner('a', 'b', legs, {
    homeTeamId: 'b', awayTeamId: 'a', homeScore: 1, awayScore: 0,
    homePenaltyScore: 3, awayPenaltyScore: 5,
  }), 'a');
  assert.equal(resolveAggregateWinner('a', 'b', [
    ...legs,
    { homeTeamId: 'a', awayTeamId: 'b', homeScore: 3, awayScore: 0 },
  ]), 'a');
});

test('changing a knockout result recalculates all dependent rounds', () => {
  const plan = buildKnockoutBracket(teams(4));
  const [first, second] = plan.rounds[0];
  const final = plan.rounds[1][0];
  const results = new Map([
    [first.key, [{
      homeTeamId: first.home.teamId,
      awayTeamId: first.away.teamId,
      homeScore: 1,
      awayScore: 0,
    }]],
    [second.key, [{
      homeTeamId: second.home.teamId,
      awayTeamId: second.away.teamId,
      homeScore: 0,
      awayScore: 1,
    }]],
  ]);
  const initialFinal = resolveKnockoutPlan(plan, results).find((row) => row.key === final.key);
  assert.ok(initialFinal);
  results.set(first.key, [{
    homeTeamId: first.home.teamId,
    awayTeamId: first.away.teamId,
    homeScore: 0,
    awayScore: 2,
  }]);
  const recalculatedFinal = resolveKnockoutPlan(plan, results).find((row) => row.key === final.key);
  assert.notEqual(recalculatedFinal?.homeTeamId, initialFinal?.homeTeamId);
  assert.equal(recalculatedFinal?.winnerTeamId, null);
});

test('third-place match uses semifinal losers', () => {
  const plan = buildKnockoutBracket(teams(4), 1, true);
  assert.ok(plan.thirdPlace);
  assert.equal(plan.thirdPlace.home.kind, 'loser');
  assert.equal(plan.thirdPlace.away.kind, 'loser');
});
