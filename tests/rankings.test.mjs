// Rankings (src/lib/stats/rankings.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, rank, CATEGORIES, MIN_MATCHES_EFFICIENCY } from '../src/lib/stats/rankings.ts';

const cat = (k) => CATEGORIES.find((c) => c.key === k);
const S = (player, over = {}) => ({ player_id: player, competition_id: 'c1', season_id: 's1', team_id: 't1', matches: 1, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, own_goals: 0, goalkeeper_matches: 0, ...over });
const K = (player, match, over = {}) => ({ player_id: player, competition_id: 'c1', season_id: 's1', team_id: 't1', match_id: match, was_goalkeeper: false, keeper_goals_conceded: 0, keeper_time_unknown: false, is_mvp: false, ...over });
const names = { a: 'Ana', b: 'Bia', c: 'Caio', d: 'Duda', g: 'Gui' };
const nameOf = (id) => names[id] ?? id;

test('ties share the position (1, 1, 3) and are flagged; zero is left out of counting rankings', () => {
  const totals = aggregate([S('b', { goals: 5 }), S('a', { goals: 5 }), S('c', { goals: 2 }), S('d', { goals: 0 })], [], {});
  const r = rank(totals, cat('goals'), nameOf);
  assert.deepEqual(r.entries.map((e) => `${e.position}${e.tied ? '=' : ''} ${nameOf(e.totals.playerId)}`), ['1= Ana', '1= Bia', '3 Caio']);
});

test('historic ranking sums competitions and seasons; filters restrict competition, season and team', () => {
  const rows = [S('a', { goals: 3 }), S('a', { competition_id: 'c2', season_id: 's2', goals: 4 }), S('b', { team_id: 't2', goals: 5 })];
  assert.equal(aggregate(rows, [], {}).get('a').goals, 7);
  assert.equal(aggregate(rows, [], { competitionIds: new Set(['c2']) }).get('a').goals, 4);
  assert.equal(aggregate(rows, [], { seasonId: 's1' }).get('a').goals, 3);
  assert.equal(aggregate(rows, [], { teamId: 't2' }).has('a'), false);
  assert.deepEqual(aggregate(rows, [], {}).get('a').teamIds, ['t1']);
});

test(`efficiency rankings require ${MIN_MATCHES_EFFICIENCY} matches and report who was left out`, () => {
  const totals = aggregate([S('a', { matches: 5, goals: 5, wins: 5 }), S('b', { matches: 4, goals: 12, wins: 4 }), S('c', { matches: 6, goals: 3, wins: 2, draws: 1, losses: 3 })], [], {});
  const r = rank(totals, cat('goalsPerMatch'), nameOf);
  assert.deepEqual(r.entries.map((e) => [nameOf(e.totals.playerId), e.value]), [['Ana', 1], ['Caio', 0.5]]);
  assert.equal(r.belowMinimum, 1, 'Bia (4 matches) is below the minimum');
  const p = rank(totals, cat('pointsPct'), nameOf);
  assert.equal(p.entries[0].value, 1);
  assert.equal(Math.round(p.entries[1].value * 1000) / 10, 38.9, 'Caio: 7 of 18 points');
});

test('MVPs and goalkeeper averages come from the per-match rows, without counting a match twice', () => {
  const keeper = [
    K('g', 'm1', { was_goalkeeper: true, keeper_goals_conceded: 1, is_mvp: true }), K('g', 'm1', { was_goalkeeper: true, keeper_goals_conceded: 1, is_mvp: true }),
    ...['m2', 'm3', 'm4', 'm5'].map((m) => K('g', m, { was_goalkeeper: true, keeper_goals_conceded: 2 })),
    K('a', 'm1', { is_mvp: true }),
  ];
  const totals = aggregate([S('g', { matches: 5 }), S('a', { matches: 1 })], keeper, {});
  assert.equal(totals.get('g').mvps, 1, 'duplicated line ignored');
  assert.equal(totals.get('g').keeperMatches, 5);
  const mvps = rank(totals, cat('mvps'), nameOf);
  assert.deepEqual(mvps.entries.map((e) => `${e.position}${e.tied ? '=' : ''}`), ['1=', '1='], 'shared');
  const gk = rank(totals, cat('keeperConcededPerMatch'), nameOf);
  assert.equal(gk.entries[0].value, 9 / 5, 'lower is better, 9 conceded in 5 matches');
});

test('a goalkeeper with zero goals conceded ranks first (lower is better)', () => {
  const keeper = [...['1', '2', '3', '4', '5'].map((m) => K('g', m, { was_goalkeeper: true })), ...['1', '2', '3', '4', '5'].map((m) => K('a', 'x' + m, { was_goalkeeper: true, keeper_goals_conceded: 1 }))];
  const r = rank(aggregate([], keeper, {}), cat('keeperConcededPerMatch'), nameOf);
  assert.deepEqual(r.entries.map((e) => [nameOf(e.totals.playerId), e.value]), [['Gui', 0], ['Ana', 1]]);
});
