import assert from 'node:assert/strict';
import test from 'node:test';
import { resetLocalSupabase, runLocalSupabase } from '../scripts/supabase-local.mjs';

test('local database helpers reject remote target selectors', () => {
  assert.throws(
    () => runLocalSupabase(['db', 'query', '--remote=production'], 'Test remote selector'),
    /remote database selectors are not allowed/,
  );
  assert.throws(
    () => runLocalSupabase(['db', 'reset', '--db-url', 'postgres://production'], 'Test URL selector'),
    /remote database selectors are not allowed/,
  );
});

test('local reset accepts only a migration timestamp or no extra options', () => {
  assert.throws(
    () => resetLocalSupabase(['--remote=production']),
    /only --version followed by a 14-digit migration timestamp/,
  );
  assert.throws(
    () => resetLocalSupabase(['--version', 'latest']),
    /only --version followed by a 14-digit migration timestamp/,
  );
});
