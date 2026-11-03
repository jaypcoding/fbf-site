import assert from 'node:assert/strict';
import test from 'node:test';
import { availableMatchStatuses, canTransitionMatchStatus } from '../src/lib/matchRules.ts';

test('allows only valid transitions from scheduled matches', () => {
  assert.equal(canTransitionMatchStatus('SCHEDULED', 'LIVE'), true);
  assert.equal(canTransitionMatchStatus('SCHEDULED', 'POSTPONED'), true);
  assert.equal(canTransitionMatchStatus('SCHEDULED', 'CANCELLED'), true);
  assert.equal(canTransitionMatchStatus('SCHEDULED', 'FINISHED'), false);
});

test('allows postponement and rescheduling before play', () => {
  assert.equal(canTransitionMatchStatus('LIVE', 'POSTPONED'), true);
  assert.equal(canTransitionMatchStatus('POSTPONED', 'SCHEDULED'), true);
  assert.equal(canTransitionMatchStatus('POSTPONED', 'LIVE'), false);
});

test('keeps finished and cancelled matches terminal', () => {
  for (const status of ['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED']) {
    assert.equal(canTransitionMatchStatus('FINISHED', status), status === 'FINISHED');
    assert.equal(canTransitionMatchStatus('CANCELLED', status), status === 'CANCELLED');
  }
});

test('returns only the current and allowed statuses for the editor', () => {
  assert.deepEqual(availableMatchStatuses('LIVE'), ['LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED']);
});
