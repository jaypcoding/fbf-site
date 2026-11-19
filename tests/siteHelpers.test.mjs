import test from 'node:test';
import assert from 'node:assert/strict';
import { one } from '../src/lib/relations.ts';
import { matchesSearch, normalizeSearch } from '../src/lib/search.ts';
import { buildMatchFeed } from '../src/lib/matchFeed.ts';
import { pageTitle, SITE_NAME } from '../src/lib/pageTitle.ts';

test('one() reads many-to-one embeds returned as objects or arrays', () => {
  assert.deepEqual(one({ name: 'Temporada 1' }), { name: 'Temporada 1' });
  assert.deepEqual(one([{ name: 'Temporada 1' }]), { name: 'Temporada 1' });
  assert.equal(one([]), null);
  assert.equal(one(null), null);
  assert.equal(one(undefined), null);
});

test('search ignores case and accents', () => {
  assert.equal(normalizeSearch('  Pivô ÁGUIA '), 'pivo aguia');
  assert.equal(matchesSearch('aguia', 'Águia Dourada'), true);
  assert.equal(matchesSearch('PIVO', 'Jogador', 'Pivô'), true);
  assert.equal(matchesSearch('zz', 'Águia', null, undefined), false);
  assert.equal(matchesSearch('   ', 'qualquer'), true);
});

test('match feed separates live, upcoming and recent matches', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const matches = [
    { id: 'past-scheduled', status: 'SCHEDULED', scheduled_at: '2026-11-18T12:00:00Z' },
    { id: 'next-2', status: 'SCHEDULED', scheduled_at: '2026-11-21T12:00:00Z' },
    { id: 'next-1', status: 'SCHEDULED', scheduled_at: '2026-11-20T12:00:00Z' },
    { id: 'undated', status: 'SCHEDULED', scheduled_at: null },
    { id: 'live', status: 'LIVE', scheduled_at: '2026-11-19T11:50:00Z' },
    { id: 'old', status: 'FINISHED', scheduled_at: '2026-11-10T12:00:00Z' },
    { id: 'new', status: 'FINISHED', scheduled_at: '2026-11-17T12:00:00Z' },
    { id: 'cancelled', status: 'CANCELLED', scheduled_at: '2026-11-20T12:00:00Z' },
  ];
  const feed = buildMatchFeed(matches, now, 6);
  assert.deepEqual(feed.live.map((m) => m.id), ['live']);
  assert.deepEqual(feed.upcoming.map((m) => m.id), ['next-1', 'next-2']);
  assert.deepEqual(feed.recent.map((m) => m.id), ['new', 'old']);
  assert.deepEqual(buildMatchFeed(matches, now, 1).upcoming.map((m) => m.id), ['next-1']);
});

test('page titles carry the site suffix', () => {
  assert.equal(pageTitle('Jogadores'), 'Jogadores · FBF');
  assert.equal(pageTitle(''), SITE_NAME);
  assert.equal(pageTitle(undefined), SITE_NAME);
});

test('dates use Brasília time and keep plain dates on the same calendar day', async () => {
  const { formatLongDate, formatMatchDate, plural } = await import('../src/lib/format.ts');
  assert.equal(formatLongDate('2026-11-20'), '20 de novembro de 2026');
  assert.equal(formatLongDate('2026-11-21T01:00:00Z'), '20 de novembro de 2026');
  assert.equal(formatLongDate(null), null);
  assert.equal(formatLongDate('não é data'), null);
  assert.equal(formatMatchDate('2026-11-20T23:30:00Z'), 'sex, 20/11, 20:30');
  assert.equal(formatMatchDate(null), 'Data a definir');
  assert.equal(plural(1, 'time', 'times'), '1 time');
  assert.equal(plural(3, 'time', 'times'), '3 times');
});

test('auth errors become actionable messages', async () => {
  const { authErrorMessage } = await import('../src/lib/authErrors.ts');
  assert.equal(authErrorMessage({ code: 'invalid_credentials' }, 'login'), 'E-mail ou senha incorretos.');
  assert.equal(authErrorMessage({ message: 'Email not confirmed' }, 'login'), 'Confirme seu e-mail pelo link enviado antes de entrar.');
  assert.equal(authErrorMessage({ code: 'user_already_exists' }, 'signup'), 'Já existe uma conta com este e-mail. Tente entrar.');
  assert.equal(authErrorMessage({ status: 429 }, 'login'), 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.');
  assert.match(authErrorMessage({ message: 'something internal' }, 'signup'), /criar a conta/);
  assert.doesNotMatch(authErrorMessage({ message: 'something internal' }, 'login'), /internal/);
});
