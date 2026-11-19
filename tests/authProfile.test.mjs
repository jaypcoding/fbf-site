import assert from 'node:assert/strict';
import test from 'node:test';
import { profileUserKey, shouldBlockOnProfile } from '../src/lib/authProfile.ts';

test('token refresh for the same user keeps the same profile key', () => {
  const before = { access_token: 'a', user: { id: 'user-1' } };
  const afterRefresh = { access_token: 'b', user: { id: 'user-1' } };
  assert.notEqual(before, afterRefresh);
  assert.equal(profileUserKey(before), profileUserKey(afterRefresh));
});

test('switching users changes the profile key', () => {
  assert.notEqual(profileUserKey({ user: { id: 'user-1' } }), profileUserKey({ user: { id: 'user-2' } }));
});

test('signed-out sessions have no profile key', () => {
  assert.equal(profileUserKey(null), null);
  assert.equal(profileUserKey(undefined), null);
  assert.equal(profileUserKey({ user: null }), null);
});

test('loader blocks only while no profile is available', () => {
  assert.equal(shouldBlockOnProfile(true, false), true);
  assert.equal(shouldBlockOnProfile(true, true), false);
  assert.equal(shouldBlockOnProfile(false, false), false);
  assert.equal(shouldBlockOnProfile(false, true), false);
});
