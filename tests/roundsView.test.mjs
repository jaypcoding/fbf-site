import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRoundsView,
  currentRoundIndex,
  isEditableMatch,
  matchAttention,
  mirrorMatch,
  roundState,
  summarizeMatches,
} from '../src/lib/roundsView.ts';

const round = (id, order, extra = {}) => ({ id, stage_id: 's1', name: `Rodada ${order}`, round_order: order, phase_type: 'ROUND_ROBIN', leg_number: order <= 3 ? 1 : 2, ...extra });
const match = (id, roundId, status, home, away, scheduled_at = null) => ({ id, round_id: roundId, status, home_team_id: home, away_team_id: away, scheduled_at });
const NOW = Date.parse('2026-11-21T12:00:00Z');

test('round state covers empty, future, in progress, live and finished', () => {
  assert.equal(roundState([]), 'empty');
  assert.equal(roundState([{ status: 'SCHEDULED' }, { status: 'POSTPONED' }]), 'future');
  assert.equal(roundState([{ status: 'FINISHED' }, { status: 'SCHEDULED' }]), 'in_progress');
  assert.equal(roundState([{ status: 'FINISHED' }, { status: 'LIVE' }]), 'live');
  assert.equal(roundState([{ status: 'FINISHED' }, { status: 'CANCELLED' }]), 'finished');
});

test('every round is listed, also future rounds without matches, in order', () => {
  const rounds = [round('r3', 3), round('r1', 1), round('r2', 2)];
  const matches = [match('m1', 'r1', 'FINISHED', 'a', 'b'), match('m2', 'r2', 'SCHEDULED', 'a', 'c')];
  const view = buildRoundsView(rounds, matches);
  assert.deepEqual(view.map((v) => [v.label, v.state, v.total]), [
    ['Rodada 1', 'finished', 1], ['Rodada 2', 'future', 1], ['Rodada 3', 'empty', 0],
  ]);
});

test('matches of a shared round are ordered by group, then date', () => {
  const groupOf = new Map([['a', { name: 'Grupo A', order: 1 }], ['b', { name: 'Grupo A', order: 1 }], ['c', { name: 'Grupo B', order: 2 }], ['d', { name: 'Grupo B', order: 2 }]]);
  const matches = [
    match('m-b', 'r1', 'SCHEDULED', 'c', 'd', '2026-11-20T20:00:00Z'),
    match('m-a2', 'r1', 'SCHEDULED', 'b', 'a', '2026-11-21T20:00:00Z'),
    match('m-a1', 'r1', 'SCHEDULED', 'a', 'b', '2026-11-20T21:00:00Z'),
  ];
  const [view] = buildRoundsView([round('r1', 1)], matches, { groupOf });
  assert.deepEqual(view.matches.map((m) => [m.match.id, m.group]), [['m-a1', 'Grupo A'], ['m-a2', 'Grupo A'], ['m-b', 'Grupo B']]);
});

test('rounds of a single group keep the group in the label instead of each match', () => {
  const rounds = [round('g2r1', 1, { stage_group: { name: 'Grupo B', group_order: 2 } }), round('g1r1', 1, { stage_group: { name: 'Grupo A', group_order: 1 } })];
  const view = buildRoundsView(rounds, [match('m', 'g1r1', 'SCHEDULED', 'a', 'b')]);
  assert.deepEqual(view.map((v) => v.label), ['Grupo A · Rodada 1', 'Grupo B · Rodada 1']);
  assert.equal(view[0].matches[0].group, null);
});

test('stages keep their order', () => {
  const rounds = [round('k1', 1, { stage_id: 'knockout' }), round('g1', 1, { stage_id: 'groups' })];
  const view = buildRoundsView(rounds, [], { stageOrder: new Map([['groups', 1], ['knockout', 2]]) });
  assert.deepEqual(view.map((v) => v.round.id), ['g1', 'k1']);
});

test('the current round is the live one, else the first not completely played, else the last', () => {
  assert.equal(currentRoundIndex([]), -1);
  assert.equal(currentRoundIndex([{ state: 'finished' }, { state: 'future' }, { state: 'live' }]), 2);
  assert.equal(currentRoundIndex([{ state: 'finished' }, { state: 'in_progress' }, { state: 'future' }]), 1);
  assert.equal(currentRoundIndex([{ state: 'future' }, { state: 'future' }]), 0);
  assert.equal(currentRoundIndex([{ state: 'finished' }, { state: 'finished' }]), 1);
});

test('admin attention: finished/live/cancelled matches are locked; past dates without result are overdue', () => {
  assert.equal(matchAttention({ status: 'FINISHED', scheduled_at: null }, NOW), 'locked');
  assert.equal(matchAttention({ status: 'LIVE', scheduled_at: null }, NOW), 'locked');
  assert.equal(matchAttention({ status: 'CANCELLED', scheduled_at: null }, NOW), 'locked');
  assert.equal(matchAttention({ status: 'SCHEDULED', scheduled_at: '2026-11-20T00:00:00Z' }, NOW), 'overdue');
  assert.equal(matchAttention({ status: 'POSTPONED', scheduled_at: '2026-11-20T00:00:00Z' }, NOW), 'overdue');
  assert.equal(matchAttention({ status: 'SCHEDULED', scheduled_at: null }, NOW), 'undated');
  assert.equal(matchAttention({ status: 'SCHEDULED', scheduled_at: '2026-11-22T00:00:00Z' }, NOW), 'ok');
  assert.equal(isEditableMatch({ status: 'SCHEDULED' }), true);
  assert.equal(isEditableMatch({ status: 'POSTPONED' }), true);
  assert.equal(isEditableMatch({ status: 'FINISHED' }), false);
  assert.equal(isEditableMatch({ status: 'LIVE' }), false);
});

test('summary counts finished, live, overdue, undated and upcoming matches', () => {
  const summary = summarizeMatches([
    { status: 'FINISHED', scheduled_at: '2026-11-16T03:00:00Z' },
    { status: 'LIVE', scheduled_at: null },
    { status: 'SCHEDULED', scheduled_at: '2026-11-17T02:00:00Z' },
    { status: 'SCHEDULED', scheduled_at: null },
    { status: 'SCHEDULED', scheduled_at: '2026-11-30T23:00:00Z' },
  ], NOW);
  assert.deepEqual(summary, { total: 5, finished: 1, live: 1, overdue: 1, undated: 1, upcoming: 1 });
});

test('the return match is the same pairing in the other leg of the same stage', () => {
  const rounds = [round('r1', 1), round('r4', 4), round('x4', 4, { stage_id: 'other' })];
  const first = match('m1', 'r1', 'SCHEDULED', 'a', 'b');
  const back = match('m4', 'r4', 'SCHEDULED', 'b', 'a');
  const otherStage = match('x', 'x4', 'SCHEDULED', 'b', 'a');
  const unrelated = match('m5', 'r4', 'SCHEDULED', 'a', 'c');
  assert.equal(mirrorMatch(first, [otherStage, unrelated, back, first], rounds)?.id, 'm4');
  assert.equal(mirrorMatch(back, [first, back], rounds)?.id, 'm1');
  assert.equal(mirrorMatch(unrelated, [first, back, unrelated], rounds), null);
});
