import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLiveStreams, pickActive, signature } from '../src/lib/liveStreams.ts';
import { isValidChannel, mutedEmbedUrl } from '../src/lib/streaming.ts';

const st = (id, over = {}) => ({ id, display_name: id.toUpperCase(), platform: 'TWITCH', channel: `canal_${id}`, is_live: true, live_since: null, ...over });
const match = (id, streamers, over = {}) => ({ id, home_score: 1, away_score: 0, home_team: { team: { name: 'Casa' } }, away_team: { team: { name: 'Fora' } }, match_streamers: streamers.map((s) => ({ streamer: s })), ...over });

test('nenhum ao vivo: lista vazia e nada ativo', () => {
  const e = mergeLiveStreams([], []);
  assert.deepEqual(e, []);
  assert.equal(pickActive(e, null), null);
});

test('streamer ao vivo aparece sem partida vinculada', () => {
  const e = mergeLiveStreams([st('a')], []);
  assert.equal(e.length, 1);
  assert.equal(e[0].match, null);
  assert.equal(pickActive(e, null).key, 'a');
});

test('streamer de partida LIVE continua aparecendo (comportamento anterior)', () => {
  const e = mergeLiveStreams([], [match('m1', [st('b', { is_live: false })])]);
  assert.equal(e.length, 1);
  assert.equal(e[0].match.matchId, 'm1');
  assert.equal(e[0].match.homeName, 'Casa');
});

test('sem duplicidade quando o streamer está ao vivo e numa partida LIVE', () => {
  const a = st('a', { live_since: '2026-11-23T10:00:00Z' });
  const e = mergeLiveStreams([a], [match('m1', [a])]);
  assert.equal(e.length, 1);
  assert.equal(e[0].match.matchId, 'm1');
  assert.equal(e[0].since, '2026-11-23T10:00:00Z');
});

test('canal inválido é ignorado (nada fora do padrão é incorporado)', () => {
  const e = mergeLiveStreams([st('x', { channel: 'javascript:alert(1)' }), st('y', { platform: 'YOUTUBE', channel: 'nao-e-id' })], [match('m', [st('z', { channel: '"><script>' })])]);
  assert.deepEqual(e, []);
});

test('ordem: quem entrou no ar primeiro, depois nome; partidas sem horário no fim', () => {
  const e = mergeLiveStreams([
    st('c', { live_since: '2026-11-23T12:00:00Z' }),
    st('a', { live_since: '2026-11-23T11:00:00Z' }),
  ], [match('m', [st('b', { is_live: false })])]);
  assert.deepEqual(e.map((x) => x.key), ['a', 'c', 'b']);
});

test('pickActive: mantém a escolha e cai para a primeira quando ela sai do ar', () => {
  const e = mergeLiveStreams([st('a', { live_since: '2026-11-23T10:00:00Z' }), st('b', { platform: 'KICK', live_since: '2026-11-23T11:00:00Z' })], []);
  assert.equal(pickActive(e, 'b').key, 'b');
  const semB = e.filter((x) => x.key !== 'b');
  assert.equal(pickActive(semB, 'b').key, 'a');
});

test('assinatura só muda quando o conteúdo muda', () => {
  const a = mergeLiveStreams([st('a')], []);
  const b = mergeLiveStreams([st('a')], []);
  assert.equal(signature(a), signature(b));
  assert.notEqual(signature(a), signature(mergeLiveStreams([st('a', { channel: 'outro' })], [])));
});

test('player do mini player começa sem som nas três plataformas', () => {
  assert.equal(mutedEmbedUrl('TWITCH', 'fbf', 'fbf.com.br'), 'https://player.twitch.tv/?channel=fbf&parent=fbf.com.br&muted=true&autoplay=true');
  assert.equal(mutedEmbedUrl('KICK', 'fbf', 'x'), 'https://player.kick.com/fbf?muted=true&autoplay=true');
  assert.equal(mutedEmbedUrl('YOUTUBE', 'UCabcdefghijklmnopqrstuv', 'x'), 'https://www.youtube.com/embed/live_stream?channel=UCabcdefghijklmnopqrstuv&autoplay=1&mute=1');
});

test('isValidChannel', () => {
  assert.equal(isValidChannel('TWITCH', 'fbf_oficial'), true);
  assert.equal(isValidChannel('KICK', 'fbf-oficial'), true);
  assert.equal(isValidChannel('YOUTUBE', 'UCabcdefghijklmnopqrstuv'), true);
  assert.equal(isValidChannel('YOUTUBE', '@fbf'), false);
  assert.equal(isValidChannel('OUTRA', 'fbf'), false);
  assert.equal(isValidChannel('TWITCH', 'a b'), false);
});
