// MVP calculation (src/lib/stats/mvp.ts) — proposal under evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMvp, keeperCleanBlocks, benefitingSide, PROPOSED_WEIGHTS } from '../src/lib/stats/mvp.ts';

const goal = (seconds, scorerSide, scorerId, assistId = null, ownGoal = false) => ({ seconds, scorerSide, scorerId, assistId, ownGoal });
const base = (over = {}) => ({ durationSeconds: 840, score: { home: 0, away: 0 }, participants: [], goals: [], keeperSpells: [], ...over });
const byId = (r) => Object.fromEntries(r.lines.map((l) => [l.playerId, l]));

test('example of the proposal: 4 goals, 2 assists, 4 clean minutes in goal, win = 20', () => {
  // A scores 4 and assists 2 for home; A also kept goal for the first 4 minutes (no goal conceded)
  const goals = [goal(300, 'home', 'A'), goal(320, 'home', 'A'), goal(400, 'home', 'A'), goal(500, 'home', 'A'), goal(600, 'home', 'B', 'A'), goal(700, 'home', 'B', 'A')];
  const r = computeMvp(base({ score: { home: 6, away: 0 }, participants: [{ playerId: 'A', side: 'home' }, { playerId: 'B', side: 'home' }], goals, keeperSpells: [{ playerId: 'A', side: 'home', start: 0, end: 240 }] }));
  const a = byId(r).A;
  assert.deepEqual(a.points, { goals: 12, assists: 4, keeper: 2, win: 2, ownGoals: 0 });
  assert.equal(a.total, 20);
  assert.deepEqual(r.mvps, ['A']);
});

test('own goal: -3 for the player, never a goal, and the goal counts for the opponent', () => {
  const og = goal(100, 'home', 'H1', null, true);
  assert.equal(benefitingSide(og), 'away');
  const r = computeMvp(base({ score: { home: 0, away: 1 }, participants: [{ playerId: 'H1', side: 'home' }, { playerId: 'V1', side: 'away' }], goals: [og] }));
  const l = byId(r);
  assert.equal(l.H1.goals, 0);
  assert.equal(l.H1.ownGoals, 1);
  assert.equal(l.H1.total, -3);
  assert.equal(l.V1.total, 2, 'away won: only the win bonus');
  assert.deepEqual(r.mvps, ['V1']);
});

test('own goal never earns an assist', () => {
  const r = computeMvp(base({ score: { home: 0, away: 1 }, participants: [{ playerId: 'H1', side: 'home' }, { playerId: 'H2', side: 'home' }], goals: [goal(100, 'home', 'H1', 'H2', true)] }));
  assert.equal(byId(r).H2.assists, 0);
});

test('draw: no win bonus; win bonus only for known participants of the winner', () => {
  const draw = computeMvp(base({ score: { home: 1, away: 1 }, participants: [{ playerId: 'H', side: 'home' }, { playerId: 'V', side: 'away' }], goals: [goal(10, 'home', 'H'), goal(20, 'away', 'V')] }));
  assert.equal(byId(draw).H.points.win, 0);
  assert.equal(byId(draw).V.points.win, 0);
  // a scorer who is not in the participants list still gets his goals, but not the win bonus
  const r = computeMvp(base({ score: { home: 1, away: 0 }, participants: [{ playerId: 'H2', side: 'home' }], goals: [goal(10, 'home', 'H1')] }));
  assert.equal(byId(r).H1.points.goals, 3);
  assert.equal(byId(r).H1.points.win, 0);
  assert.equal(byId(r).H2.points.win, 2);
});

test('goalkeeper: a conceded goal interrupts the clean period; only complete blocks count', () => {
  const spell = { playerId: 'G', side: 'home', start: 0, end: 840 };
  // conceded at 3:30 (210s) and 8:00 (480s): periods 210, 270, 360 -> 1 + 2 + 3 = 6 blocks
  const goals = [goal(210, 'away', 'V'), goal(480, 'away', 'V')];
  assert.deepEqual(keeperCleanBlocks(spell, goals, 120), { keeperSeconds: 840, blocks: 6 });
  // the keeper's own team scoring does not interrupt anything
  assert.equal(keeperCleanBlocks(spell, [goal(100, 'home', 'H')], 120).blocks, 7);
  // own goal by his own team does interrupt
  assert.equal(keeperCleanBlocks(spell, [goal(420, 'home', 'H', null, true)], 120).blocks, 3 + 3);
});

test('goalkeeper change: each keeper is credited only for his own spell', () => {
  const goals = [goal(500, 'away', 'V')];
  const r = computeMvp(base({ score: { home: 0, away: 1 }, participants: [{ playerId: 'G1', side: 'home' }, { playerId: 'G2', side: 'home' }], goals, keeperSpells: [{ playerId: 'G1', side: 'home', start: 0, end: 420 }, { playerId: 'G2', side: 'home', start: 420, end: 840 }] }));
  const l = byId(r);
  assert.equal(l.G1.keeperBlocks, 3, '420s clean -> 3 blocks');
  assert.equal(l.G2.keeperBlocks, 0 + 2, 'conceded at 500: 80s (0) + 340s (2)');
});

test('tie at the top shares the MVP; no MVP when nobody has a positive total', () => {
  const r = computeMvp(base({ score: { home: 1, away: 1 }, participants: [{ playerId: 'H', side: 'home' }, { playerId: 'V', side: 'away' }], goals: [goal(10, 'home', 'H'), goal(20, 'away', 'V')] }));
  assert.deepEqual(r.mvps.sort(), ['H', 'V']);
  const empty = computeMvp(base({ participants: [{ playerId: 'H', side: 'home' }] }));
  assert.deepEqual(empty.mvps, []);
});

test('incomplete match data: no participants and no keeper -> only event-based points', () => {
  const r = computeMvp(base({ score: { home: 2, away: 0 }, goals: [goal(10, 'home', 'H', 'H2'), goal(20, 'home', 'H')] }));
  assert.equal(byId(r).H.total, 6);
  assert.equal(byId(r).H2.total, 2);
});

test('deterministic: a corrected sheet gives the new result; same data gives the same result', () => {
  const input = base({ score: { home: 1, away: 0 }, participants: [{ playerId: 'H', side: 'home' }], goals: [goal(10, 'home', 'H')] });
  assert.deepEqual(computeMvp(input), computeMvp(structuredClone(input)));
  const corrected = { ...input, goals: [goal(10, 'home', 'H', null, true)], score: { home: 0, away: 1 } };
  assert.equal(byId(computeMvp(corrected)).H.total, -3);
  assert.equal(PROPOSED_WEIGHTS.goal, 3);
});
