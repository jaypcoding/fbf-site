import test from 'node:test';
import assert from 'node:assert/strict';
import { agenda, freshness, lastRegisteredAt, liveGoals } from '../src/lib/liveCenter.ts';

const ev = (id, type, minute, created, over = {}) => ({ id, event_type: type, minute_seconds: minute, created_at: created, team_id: 'H', player_id: null, is_own_goal: false, goal_event_id: null, player: null, ...over });

test('live goals: recorded minute order, assists attached, own goals and goals without author kept as such', () => {
  const goals = liveGoals([
    ev('g2', 'GOAL', 300, '2026-11-23T20:10:00Z', { player: { nickname: 'b' } }),
    ev('a2', 'ASSIST', 300, '2026-11-23T20:10:01Z', { goal_event_id: 'g2', player: { nickname: 'c' } }),
    ev('g1', 'GOAL', 60, '2026-11-23T20:12:00Z', { player: { nickname: 'a' }, is_own_goal: true }),
    ev('g3', 'GOAL', null, '2026-11-23T20:13:00Z'),
    ev('k', 'GOALKEEPER_IN', 0, '2026-11-23T20:00:00Z'),
  ]);
  assert.deepEqual(goals.map((g) => `${g.id}:${g.scorer}:${g.assist}:${g.ownGoal}`), ['g1:a:null:true', 'g2:b:c:false', 'g3:null:null:false']);
});

test('last registration: the latest of going live, the match update and the events', () => {
  assert.equal(lastRegisteredAt('2026-11-23T20:00:00Z', [{ created_at: '2026-11-23T20:30:00Z' }], '2026-11-23T20:20:00Z'), '2026-11-23T20:30:00Z');
  assert.equal(lastRegisteredAt(null, [], null), null);
});

test('freshness: stale after 20 minutes without any registration', () => {
  const now = Date.parse('2026-11-23T21:00:00Z');
  assert.deepEqual(freshness('2026-11-23T20:50:00Z', now), { state: 'fresh', minutes: 10 });
  assert.deepEqual(freshness('2026-11-23T20:40:00Z', now), { state: 'stale', minutes: 20 });
  assert.deepEqual(freshness(null, now), { state: 'unknown', minutes: null });
});

test('agenda: next 24 hours, waiting to start (time passed, not started) and finished today', () => {
  const now = Date.parse('2026-11-23T20:00:00Z');
  const m = (id, status, at) => ({ id, status, scheduled_at: at });
  const a = agenda([
    m('later', 'SCHEDULED', '2026-11-24T10:00:00Z'), m('soon', 'SCHEDULED', '2026-11-23T20:30:00Z'), m('far', 'SCHEDULED', '2026-11-25T10:00:00Z'),
    m('late', 'SCHEDULED', '2026-11-23T19:00:00Z'), m('old', 'SCHEDULED', '2026-11-23T10:00:00Z'),
    m('done', 'FINISHED', '2026-11-23T18:00:00Z'), m('yesterday', 'FINISHED', '2026-11-22T10:00:00Z'), m('live', 'LIVE', '2026-11-23T19:30:00Z'),
  ], now);
  assert.deepEqual(a.upcoming.map((x) => x.id), ['soon', 'later']);
  assert.deepEqual(a.waiting.map((x) => x.id), ['late']);
  assert.deepEqual(a.finished.map((x) => x.id), ['done']);
});
