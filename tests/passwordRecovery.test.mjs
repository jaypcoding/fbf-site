import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PASSWORD_MIN_LENGTH,
  RECOVERY_REQUEST_SENT,
  newPasswordError,
  parseRecoveryHash,
  recoveryRedirectUrl,
  recoveryRequestMessage,
  updatePasswordError,
} from '../src/lib/passwordRecovery.ts';

test('a valid recovery link (implicit flow fragment) opens the form', () => {
  assert.deepEqual(parseRecoveryHash('#access_token=abc.def.ghi&expires_at=1&refresh_token=r&token_type=bearer&type=recovery'), { kind: 'recovery' });
});

test('expired, used or invalid links are told apart from a missing token', () => {
  assert.deepEqual(parseRecoveryHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), { kind: 'error', reason: 'expired' });
  assert.deepEqual(parseRecoveryHash('#error=server_error&error_description=x'), { kind: 'error', reason: 'invalid' });
  assert.deepEqual(parseRecoveryHash(''), { kind: 'none' });
  assert.deepEqual(parseRecoveryHash(null), { kind: 'none' });
  assert.deepEqual(parseRecoveryHash('#type=recovery'), { kind: 'none' }, 'no token, no form');
  assert.deepEqual(parseRecoveryHash('#access_token=abc&type=signup'), { kind: 'none' }, 'a sign-up confirmation is not a recovery');
});

test('the e-mail link always points to the site reset page', () => {
  assert.equal(recoveryRedirectUrl('https://fbfhax.com'), 'https://fbfhax.com/redefinir-senha');
  assert.equal(recoveryRedirectUrl('https://www.fbfhax.com/'), 'https://www.fbfhax.com/redefinir-senha');
});

test('new password: minimum length, size limit and equal confirmation', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.match(newPasswordError('1234567', '1234567'), /pelo menos 8/);
  assert.equal(newPasswordError('12345678', '12345679'), 'As senhas não coincidem.');
  assert.match(newPasswordError('        ', '        '), /espaços/);
  assert.match(newPasswordError('a'.repeat(73), 'a'.repeat(73)), /longa demais/);
  assert.match(newPasswordError('ç'.repeat(40), 'ç'.repeat(40)), /longa demais/, '72 bytes, not characters');
  assert.equal(newPasswordError('nova-senha-forte', 'nova-senha-forte'), null);
});

test('the request answer never reveals whether the account exists', () => {
  const ok = recoveryRequestMessage(null);
  assert.deepEqual(ok, { tone: 'success', text: RECOVERY_REQUEST_SENT });
  for (const error of [
    { code: 'user_not_found', status: 400, message: 'User not found' },
    { code: 'email_address_not_authorized', status: 400, message: 'Email address not authorized' },
    { code: 'unexpected_failure', status: 500, message: 'Error sending recovery email' },
    { status: 422, message: 'Unable to validate email address: invalid format' },
  ]) {
    assert.deepEqual(recoveryRequestMessage(error), ok, `same answer for ${error.message}`);
  }
  assert.equal(recoveryRequestMessage({ code: 'over_email_send_rate_limit', status: 429 }).tone, 'error');
  assert.doesNotMatch(recoveryRequestMessage({ status: 429 }).text, /conta|cadastr/i);
});

test('saving the new password: known errors, expired session goes back to "invalid link"', () => {
  assert.deepEqual(updatePasswordError({ code: 'same_password', status: 422 }), { kind: 'retry', text: 'A nova senha precisa ser diferente da senha atual.' });
  assert.equal(updatePasswordError({ code: 'weak_password', status: 422 }).kind, 'retry');
  assert.deepEqual(updatePasswordError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' }), { kind: 'link-invalid' });
  assert.deepEqual(updatePasswordError({ code: 'session_not_found', status: 403 }), { kind: 'link-invalid' });
  assert.deepEqual(updatePasswordError({ code: 'bad_jwt', status: 401 }), { kind: 'link-invalid' });
  assert.equal(updatePasswordError({ status: 500, message: 'internal' }).kind, 'retry');
  assert.doesNotMatch(updatePasswordError({ status: 500, message: 'internal secret detail' }).text, /internal|secret/);
});
