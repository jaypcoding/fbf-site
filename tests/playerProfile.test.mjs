// Player profile aggregation (src/lib/stats/profile.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, bySeason } from '../src/lib/stats/profile.ts';

const row = (over) => ({ match_id: 'm', competition_id: 'c1', season_id: 's1', team_id: 't1', season_team_id: 'st1', side: 'home', result: 'W', goals: 0, assists: 0, own_goals: 0, was_goalkeeper: false, in_lineup: false, scheduled_at: '2026-11-01T20:00:00Z', ...over });

test('totals: results, goals, contributions and aproveitamento (win 3, draw 1)', () => {
  const t = summarize([row({ match_id: 'a', goals: 2, assists: 1 }), row({ match_id: 'b', result: 'D', own_goals: 1 }), row({ match_id: 'c', result: 'L', assists: 2, was_goalkeeper: true })], new Set(['a']));
  assert.deepEqual({ m: t.matches, w: t.wins, d: t.draws, l: t.losses, g: t.goals, a: t.assists, og: t.ownGoals, ga: t.contributions, mvp: t.mvps, gk: t.keeperMatches }, { m: 3, w: 1, d: 1, l: 1, g: 2, a: 3, og: 1, ga: 5, mvp: 1, gk: 1 });
  assert.equal(t.points, 4);
  assert.equal(t.pointsPct, 44.4, '4 of 9 points');
});

test('a player without matches has no aproveitamento (not 0%)', () => {
  const t = summarize([]);
  assert.equal(t.matches, 0);
  assert.equal(t.pointsPct, null);
});

test('matches without a result count as played but not in the aproveitamento', () => {
  const t = summarize([row({ match_id: 'a', result: null }), row({ match_id: 'b', result: 'W' })]);
  assert.equal(t.matches, 2);
  assert.equal(t.pointsPct, 100);
});

test('by season: one line per competition × season × club, most recent first; a transfer gives two lines', () => {
  const lines = bySeason([
    row({ match_id: 'a', goals: 1, scheduled_at: '2026-10-01T20:00:00Z' }),
    row({ match_id: 'b', goals: 2, season_id: 's2', scheduled_at: '2026-11-10T20:00:00Z' }),
    row({ match_id: 'c', goals: 3, season_id: 's2', team_id: 't2', season_team_id: 'st2', scheduled_at: '2026-11-20T20:00:00Z' }),
  ], new Set(['c']));
  assert.deepEqual(lines.map((l) => `${l.seasonId}/${l.teamId}:${l.goals}:${l.mvps}`), ['s2/t2:3:1', 's2/t1:2:0', 's1/t1:1:0']);
});
