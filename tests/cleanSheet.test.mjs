import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanSheetSeconds, isCleanSheet } from '../src/lib/cleanSheet.ts';

test('does not count an open or duration-less goalkeeper participation', () => {
  const incomplete = { started_at_seconds: 0, ended_at_seconds: null, first_conceded_at_seconds: null };
  assert.equal(cleanSheetSeconds(incomplete, 900), 0);
  assert.equal(isCleanSheet(incomplete, 900), false);
  assert.equal(cleanSheetSeconds({ ...incomplete, ended_at_seconds: 900 }, null), 0);
});

test('counts a clean sheet for a completed spell without a conceded goal', () => {
  const complete = { started_at_seconds: 0, ended_at_seconds: 900, first_conceded_at_seconds: null };
  assert.equal(cleanSheetSeconds(complete, 900), 900);
  assert.equal(isCleanSheet(complete, 900), true);
  assert.equal(isCleanSheet({ ...complete, started_at_seconds: 60 }, 900), true);
});

test('counts substitute clean-sheet time without requiring a full-match appearance', () => {
  const substitute = { started_at_seconds: 60, ended_at_seconds: 900, first_conceded_at_seconds: null };
  assert.equal(cleanSheetSeconds(substitute, 900), 840);
  assert.equal(isCleanSheet(substitute, 900), true);
  assert.equal(isCleanSheet({ ...substitute, ended_at_seconds: 901 }, 900), false);
});

test('cuts time at the first conceded goal and rejects an out-of-range event', () => {
  const conceded = { started_at_seconds: 120, ended_at_seconds: 900, first_conceded_at_seconds: 300 };
  assert.equal(cleanSheetSeconds(conceded, 900), 180);
  assert.equal(isCleanSheet(conceded, 900), false);
  assert.equal(cleanSheetSeconds({ ...conceded, first_conceded_at_seconds: 950 }, 900), 0);
  assert.equal(cleanSheetSeconds({ ...conceded, first_conceded_at_seconds: 100 }, 900), 0);
});
