// Streaming platforms (src/lib/streaming.ts): Twitch, YouTube and Kick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChannel, embedUrl, channelUrl, platformLabel, STREAM_PLATFORMS } from '../src/lib/streaming.ts';

const ok = (r) => { assert.equal(r.ok, true, r.message); return r.channel; };
const bad = (r) => { assert.equal(r.ok, false); return r.message; };

test('the three platforms are offered', () => {
  assert.deepEqual(STREAM_PLATFORMS.map((p) => p.value), ['TWITCH', 'YOUTUBE', 'KICK']);
  assert.equal(platformLabel('KICK'), 'Kick');
});

test('Kick: channel name or channel link', () => {
  assert.equal(ok(normalizeChannel('KICK', 'FBFOficial')), 'fbfoficial');
  assert.equal(ok(normalizeChannel('KICK', ' @fbf_oficial ')), 'fbf_oficial');
  assert.equal(ok(normalizeChannel('KICK', 'https://kick.com/fbf-oficial')), 'fbf-oficial');
  assert.equal(ok(normalizeChannel('KICK', 'kick.com/fbfoficial?ref=x')), 'fbfoficial');
  assert.equal(ok(normalizeChannel('KICK', 'https://www.kick.com/fbfoficial/videos')), 'fbfoficial');
  bad(normalizeChannel('KICK', ''));
  bad(normalizeChannel('KICK', 'https://twitch.tv/fbfoficial'));
  bad(normalizeChannel('KICK', 'https://kick.com.evil.example/fbf'));
  bad(normalizeChannel('KICK', 'nome com espaço'));
  bad(normalizeChannel('KICK', 'a/b'));
  bad(normalizeChannel('KICK', '<script>'));
});

test('Twitch and YouTube keep working (and accept links)', () => {
  assert.equal(ok(normalizeChannel('TWITCH', 'FBF_Oficial')), 'fbf_oficial');
  assert.equal(ok(normalizeChannel('TWITCH', 'https://www.twitch.tv/fbfoficial')), 'fbfoficial');
  bad(normalizeChannel('TWITCH', 'fbf-oficial'));
  const id = 'UC' + 'a'.repeat(22);
  assert.equal(ok(normalizeChannel('YOUTUBE', id)), id);
  assert.equal(ok(normalizeChannel('YOUTUBE', `https://www.youtube.com/channel/${id}`)), id);
  bad(normalizeChannel('YOUTUBE', 'https://www.youtube.com/@fbf'));
  bad(normalizeChannel('YOUTUBE', 'fbf'));
});

test('player and channel addresses', () => {
  assert.equal(embedUrl('KICK', 'fbfoficial', 'fbfhax.com'), 'https://player.kick.com/fbfoficial');
  assert.equal(embedUrl('TWITCH', 'fbfoficial', 'fbfhax.com'), 'https://player.twitch.tv/?channel=fbfoficial&parent=fbfhax.com');
  assert.equal(embedUrl('YOUTUBE', 'UCx', 'fbfhax.com'), 'https://www.youtube.com/embed/live_stream?channel=UCx');
  assert.equal(channelUrl('KICK', 'fbfoficial'), 'https://kick.com/fbfoficial');
  // the stored value is always encoded in the address
  assert.equal(embedUrl('KICK', 'a b', 'h'), 'https://player.kick.com/a%20b');
});
