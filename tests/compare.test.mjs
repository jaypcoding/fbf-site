import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/lib/stats/rankings.ts';
import { asSummaryRows, commonMatches, compareTotals, COMPARE_METRICS, headToHead, leaders } from '../src/lib/stats/compare.ts';

const r = (match, player, side, result, goals = 0, assists = 0, over = {}) => ({
  match_id: match, player_id: player, competition_id: 'C1', season_id: 'S1', team_id: side === 'home' ? 'TH' : 'TA', side, result, goals, assists, own_goals: 0, was_goalkeeper: false, ...over,
});
const rows = [
  r('m1', 'a', 'home', 'W', 2, 0), r('m1', 'b', 'away', 'L', 1, 0),
  r('m2', 'a', 'home', 'D', 0, 1), r('m2', 'b', 'home', 'D', 0, 0),
  r('m3', 'a', 'away', 'L', 1, 0),
  r('m4', 'b', 'home', 'W', 3, 1, { competition_id: 'C2', season_id: 'S2' }),
];

test('the comparator totals match the rankings aggregate (single source)', () => {
  const { totals } = compareTotals(rows, [], [], ['a', 'b'], {}, false);
  const summary = new Map(); // the same rows grouped like player_season_summary
  for (const s of asSummaryRows(rows)) {
    const key = `${s.player_id}|${s.competition_id}|${s.season_id}|${s.team_id}`;
    const acc = summary.get(key) ?? { ...s, matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, own_goals: 0, goalkeeper_matches: 0 };
    for (const k of ['matches', 'wins', 'draws', 'losses', 'goals', 'assists', 'own_goals', 'goalkeeper_matches']) acc[k] += s[k];
    summary.set(key, acc);
  }
  const ranking = aggregate([...summary.values()], [], {});
  for (const id of ['a', 'b']) {
    const { teamIds: _x, ...cmp } = totals.get(id); const { teamIds: _y, ...rk } = ranking.get(id);
    assert.deepEqual(cmp, rk);
  }
});

test('same scope for everybody, and "only common matches"', () => {
  assert.deepEqual([...commonMatches(rows, ['a', 'b'])].sort(), ['m1', 'm2']);
  const scoped = compareTotals(rows, [], [], ['a', 'b'], { competitionId: 'C1' }, false).totals;
  assert.equal(scoped.get('b').matches, 2);
  assert.equal(scoped.get('b').goals, 1);
  const common = compareTotals(rows, [], [], ['a', 'b'], {}, true).totals;
  assert.deepEqual([common.get('a').matches, common.get('a').goals, common.get('b').matches], [2, 2, 2]);
  const nobody = compareTotals(rows, [], [], ['a', 'z'], {}, false).totals;
  assert.equal(nobody.get('z').matches, 0);
});

test('head-to-head: against each other and together', () => {
  assert.deepEqual(headToHead(rows, 'a', 'b'), { matches: 1, aWins: 1, draws: 0, bWins: 0, together: 1, togetherWins: 0, togetherDraws: 1, togetherLosses: 0 });
});

test('leaders: rates only with the minimum sample; ties and context metrics have no leader', () => {
  const t = (id, matches, goals, keeperMatches = 0, goalsConceded = 0) => ({ playerId: id, teamIds: [], matches, wins: 0, draws: 0, losses: 0, goals, assists: 0, ownGoals: 0, mvps: 0, keeperMatches, goalsConceded });
  const m = (key) => COMPARE_METRICS.find((x) => x.key === key);
  assert.deepEqual(leaders(m('goals'), [t('a', 3, 4), t('b', 9, 2)]), { ids: ['a'], reason: 'ok' });
  assert.deepEqual(leaders(m('goalsPerMatch'), [t('a', 3, 4), t('b', 9, 2)]), { ids: [], reason: 'sample' });
  assert.deepEqual(leaders(m('goalsPerMatch'), [t('a', 5, 4), t('b', 10, 4)]), { ids: ['a'], reason: 'ok' });
  assert.deepEqual(leaders(m('goals'), [t('a', 5, 4), t('b', 10, 4)]), { ids: [], reason: 'tie' });
  assert.deepEqual(leaders(m('matches'), [t('a', 5, 4), t('b', 10, 4)]), { ids: [], reason: 'neutral' });
  assert.deepEqual(leaders(m('concededPerMatch'), [t('a', 6, 0, 6, 3), t('b', 6, 0, 6, 9)]), { ids: ['a'], reason: 'ok' });
  assert.deepEqual(leaders(m('concededPerMatch'), [t('a', 6, 0, 0, 0), t('b', 6, 0, 6, 9)]), { ids: [], reason: 'sample' });
});
