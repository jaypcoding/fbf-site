// THEHAX Replay links (src/lib/replay/thehax.ts): link validation (no other
// host, scheme, port, credentials or path), download built from the id only,
// redirects refused, timeout, size limit, HBR2 signature and version checks.
// The network is replaced by a fake fetch; the real service is exercised by
// a manual script, never by the automated tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTheHaxLink, downloadTheHaxReplay, replayFileName, theHaxDownloadUrl, THEHAX_ERROR_STATUS } from '../src/lib/replay/thehax.ts';
import { analyzeReplay } from '../src/lib/replay/analyze.ts';
import { fileNameTimestamp } from '../src/lib/replay/consolidate.ts';
import { buildReplay, goalScenario } from './helpers/hbr2Builder.mjs';

const ID = '3e2441ec-fe87-4468-a857-d09ad580dce5';
const MAX = 20 * 1024 * 1024;
const code = (c) => (e) => { assert.equal(e.name, 'TheHaxError'); assert.equal(e.code, c); return true; };

test('accepts the public link forms of a THEHAX replay', () => {
  for (const link of [
    `https://replay.thehax.pl/${ID}`,
    `https://replay.thehax.pl/${ID}/`,
    `https://replay.thehax.pl/${ID}/download`,
    `  https://REPLAY.THEHAX.PL/${ID.toUpperCase()}  `,
    `replay.thehax.pl/${ID}`,
    `https://replay.thehax.pl/${ID}?utm=discord#top`,
    // dot segments are resolved by the URL standard before the check: this IS the replay address
    `https://replay.thehax.pl/x/../${ID}`,
    `https://replay.thehax.pl/%2e%2e/${ID}`,
  ]) assert.equal(parseTheHaxLink(link), ID, link);
});

test('refuses other hosts, schemes, ports, credentials, paths and ids', () => {
  for (const link of [
    '', '   ',
    `http://replay.thehax.pl/${ID}`,
    `ftp://replay.thehax.pl/${ID}`,
    `https://thehax.pl/${ID}`,
    `https://evil.replay.thehax.pl/${ID}`,
    `https://replay.thehax.pl.evil.com/${ID}`,
    `https://replay.thehax.pl@evil.com/${ID}`,
    `https://user:pw@replay.thehax.pl/${ID}`,
    `https://replay.thehax.pl:8443/${ID}`,
    'https://replay.thehax.pl/',
    'https://replay.thehax.pl/apiKeys',
    'https://replay.thehax.pl/123',
    `https://replay.thehax.pl/${ID}/edit`,
    `https://replay.thehax.pl/${ID}/download/../../admin`,
    'javascript:alert(1)',
    'https://127.0.0.1/' + ID,
    `https://replay.thehax.pl/${ID}` + 'a'.repeat(400),
  ]) assert.throws(() => parseTheHaxLink(link), code('invalid_link'), link);
  assert.throws(() => theHaxDownloadUrl('../etc'), code('invalid_link'));
});

test('file name comes from Content-Disposition, reduced to safe characters', () => {
  assert.equal(replayFileName('attachment; filename=HBReplay-2026-11-22-22h13m-6b035b310db094.87080459.hbr2', ID), 'HBReplay-2026-11-22-22h13m-6b035b310db094.87080459.hbr2');
  assert.equal(replayFileName('attachment; filename="Final 2T.hbr2"', ID), 'Final 2T.hbr2');
  assert.equal(replayFileName("attachment; filename*=UTF-8''Jogo%20%C3%A1.hbr2", ID), 'Jogo _.hbr2');
  assert.equal(replayFileName('attachment; filename="../../etc/x.hbr2"', ID), 'x.hbr2');
  assert.equal(replayFileName('attachment; filename=page.html', ID), `thehax-${ID}.hbr2`);
  assert.equal(replayFileName(null, ID), `thehax-${ID}.hbr2`);
  // the original THEHAX name keeps the recording time used to order the parts of a match
  assert.equal(fileNameTimestamp('HBReplay-2026-11-22-22h13m-6b035b310db094.87080459.hbr2'), Date.UTC(2026, 10, 22, 22, 13));
});

// ---- fake network -------------------------------------------------------
function respond(body, { status = 200, headers = {}, chunk = 0 } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const stream = new ReadableStream({
    start(c) {
      if (!chunk) { c.enqueue(bytes); c.close(); return; }
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.subarray(i, i + chunk));
      c.close();
    },
  });
  return new Response(status === 204 || (status >= 300 && status < 400) ? null : stream, { status, headers });
}
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { impl, calls };
}
const valid = () => goalScenario();

test('downloads from the address built from the id, without following redirects', async () => {
  const bytes = valid();
  const { impl, calls } = fakeFetch(() => respond(bytes, { headers: {
    'content-type': 'application/octet-stream', 'content-length': String(bytes.length),
    'content-disposition': 'attachment; filename=HBReplay-2026-11-22-22h13m-6b0.hbr2', 'last-modified': 'Sun, 22 Nov 2026 21:14:25 GMT',
  } }));
  const r = await downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: impl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://replay.thehax.pl/${ID}/download`);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.method, 'GET');
  assert.deepEqual([...r.bytes], [...bytes], 'bytes are passed on untouched');
  assert.equal(r.name, 'HBReplay-2026-11-22-22h13m-6b0.hbr2');
  assert.equal(r.lastModified, Date.parse('Sun, 22 Nov 2026 21:14:25 GMT'));
  assert.equal(r.header.version, 3);
  // the imported bytes give exactly the analysis of the same file sent directly
  const strip = ({ simulateMs, ...rest }) => rest; // simulateMs is a time measurement
  assert.deepEqual(strip(await analyzeReplay(r.bytes)), strip(await analyzeReplay(bytes)));
});

test('Content-Type is not trusted: an HBR2 file served as text is accepted, an HTML page is not', async () => {
  const bytes = valid();
  const ok = await downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond(bytes, { headers: { 'content-type': 'text/html' } }) });
  assert.equal(ok.header.version, 3);
  // unknown ids: THEHAX answers 200 with an HTML page
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond('\n  <!DOCTYPE html><html><body>Replay</body></html>', { headers: { 'content-type': 'application/octet-stream' } }) }), code('not_found'));
});

test('missing, unavailable and redirecting answers', async () => {
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond('nope', { status: 404 }) }), code('not_found'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond('gone', { status: 410 }) }), code('not_found'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond('busy', { status: 503 }) }), code('unavailable'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond('slow down', { status: 429 }) }), code('unavailable'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }) }), code('redirect'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond(null, { status: 307, headers: { location: 'https://evil.example/x.hbr2' } }) }), code('redirect'));
  // browsers report manual redirects as an opaque response
  const opaque = { type: 'opaqueredirect', status: 0, headers: new Headers(), body: null };
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => opaque }), code('redirect'));
});

test('size limit: declared and real size (Content-Length is not trusted)', async () => {
  const big = new Uint8Array(1024 * 64); big.set([0x48, 0x42, 0x52, 0x32, 0, 0, 0, 3]);
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: 1024, fetchImpl: async () => respond(big, { headers: { 'content-length': String(big.length) } }) }), code('too_large'));
  // no Content-Length, streamed in chunks: stops while reading
  let pulled = 0;
  const endless = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(4096)); } });
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: 64 * 1024, fetchImpl: async () => new Response(endless, { status: 200 }) }), code('too_large'));
  assert.ok(pulled < 40, `stopped early (${pulled} chunks)`);
  // lying Content-Length
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: 1024, fetchImpl: async () => respond(big, { headers: { 'content-length': '10' }, chunk: 512 }) }), code('too_large'));
  assert.equal(THEHAX_ERROR_STATUS.too_large, 413);
});

test('timeout while connecting and while the body is stalled; network failure', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, timeoutMs: 50, fetchImpl: hang }), code('timeout'));
  const stalled = (url, init) => {
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x48, 0x42])); init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); } });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, timeoutMs: 50, fetchImpl: stalled }), code('timeout'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), code('network'));
});

test('incompatible content: empty, not HBR2, other versions', async () => {
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond(new Uint8Array(0)) }), code('invalid_file'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])) }), code('invalid_file'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond(buildReplay({ totalFrames: 10, events: [], version: 2 })) }), code('unsupported_version'));
  await assert.rejects(downloadTheHaxReplay(ID, { maxBytes: MAX, fetchImpl: async () => respond(buildReplay({ totalFrames: 10, events: [], version: 9999 })) }), code('invalid_file'));
});
