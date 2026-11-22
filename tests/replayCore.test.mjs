// HaxBall recording analyzer (src/lib/replay): decoding, validation of
// malformed files, simulation and statistics. Synthetic recordings are built
// in the test; real recordings (supabase/fixtures/replays, kept out of git
// because they hold third-party nicknames and chat) are used when present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeReplay, ReplayError, DEFAULT_LIMITS } from '../src/lib/replay/analyze.ts';
import { buildReplay, goalScenario, action, INPUT } from './helpers/hbr2Builder.mjs';

const fixtures = fileURLToPath(new URL('../supabase/fixtures/replays/', import.meta.url));
const fixture = (name) => (existsSync(fixtures + name) ? new Uint8Array(readFileSync(fixtures + name)) : null);

async function rejects(bytes, code, limits) {
  await assert.rejects(analyzeReplay(bytes, limits ? { limits } : {}), (e) => e instanceof ReplayError && e.code === code);
}

test('synthetic game: a kick from the centre goes in, with author, shot on target and possession', async () => {
  const r = await analyzeReplay(goalScenario());
  assert.equal(r.header.version, 3);
  assert.equal(r.segments.length, 1);
  const s = r.segments[0];
  assert.deepEqual(s.score, [1, 0]);
  assert.equal(s.endReason, 'stopped');
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].scorer, 'Atacante');
  assert.equal(s.goals[0].assist, null);
  assert.equal(s.goals[0].team, 1);
  assert.equal(s.teams.red.kicks, 1);
  assert.equal(s.teams.red.shotsOnTarget, 1);
  assert.equal(s.teams.red.possessionTicks, s.playingTicks);
  const attacker = s.players.find((p) => p.key === 'Atacante');
  assert.equal(attacker.goals, 1);
  assert.equal(attacker.heat.cells.reduce((a, b) => a + b, 0), s.playingTicks, 'one heat sample per playing tick');
  assert.equal(s.stadium.name, 'Classic');
});

test('a recording with two games (both halves in one file) gives two segments', async () => {
  const bytes = buildReplay({
    totalFrames: 2200,
    events: [
      { frame: 0, action: action.join(1, 'Atacante') }, { frame: 0, action: action.join(2, 'Defensor') },
      { frame: 0, action: action.team(1, 'red') }, { frame: 0, action: action.team(2, 'blue') },
      { frame: 1, action: action.start() },
      { frame: 2, by: 1, action: action.input(INPUT.right | INPUT.kick) },
      { frame: 2, by: 2, action: action.input(INPUT.up) },
      { frame: 900, action: action.stop() },
      { frame: 950, action: action.team(1, 'blue') }, { frame: 950, action: action.team(2, 'red') },
      { frame: 1000, action: action.start() },
      // kick-off belongs to Red at the start of a game: the player now in Red kicks off
      { frame: 1001, by: 2, action: action.input(INPUT.right | INPUT.kick) },
      { frame: 1001, by: 1, action: action.input(INPUT.down) },
      { frame: 2100, action: action.stop() },
    ],
  });
  const r = await analyzeReplay(bytes);
  assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments.map((s) => s.score), [[1, 0], [1, 0]]);
  assert.deepEqual(r.segments.map((s) => s.goals[0].scorer), ['Atacante', 'Defensor'], 'teams swapped colours between the games');
  assert.deepEqual(r.segments.map((s) => s.players.find((p) => p.key === 'Atacante').ticksBlue > 0), [false, true]);
});

test('a recording without any game is valid and has no segment', async () => {
  const r = await analyzeReplay(buildReplay({ totalFrames: 100, events: [{ frame: 0, action: action.join(1, 'Sozinho') }, { frame: 5, by: 1, action: action.chat('oi') }] }));
  assert.equal(r.segments.length, 0);
  const empty = await analyzeReplay(buildReplay({ totalFrames: 10, events: [] }));
  assert.equal(empty.segments.length, 0);
});

test('invalid files are refused with clear errors', async () => {
  const good = goalScenario();
  await rejects(new Uint8Array(0), 'empty_file');
  await rejects(new TextEncoder().encode('isto não é um replay qualquer'), 'bad_signature');
  const v2 = good.slice(); v2[7] = 2;
  await rejects(v2, 'unsupported_version');
  await rejects(good.slice(0, 12), 'malformed');
  const corrupt = good.slice();
  for (let i = 14; i < corrupt.length; i += 3) corrupt[i] ^= 0x5a;
  await assert.rejects(analyzeReplay(corrupt), (e) => e instanceof ReplayError && ['malformed', 'truncated'].includes(e.code));
  await rejects(good.slice(0, good.length - 20), 'malformed');
});

test('size, duration and decompression limits', async () => {
  const good = goalScenario();
  await rejects(good, 'too_large', { ...DEFAULT_LIMITS, maxFileBytes: 100 });
  await rejects(good, 'too_long', { ...DEFAULT_LIMITS, maxFrames: 10 });
  await rejects(good, 'too_large', { ...DEFAULT_LIMITS, maxInflatedBytes: 64 });
  // a small file that inflates to a huge block ("zip bomb") stops at the budget
  const { deflateRawSync } = await import('node:zlib');
  const bomb = deflateRawSync(Buffer.alloc(80 * 1024 * 1024));
  const head = Buffer.from([0x48, 0x42, 0x52, 0x32, 0, 0, 0, 3, 0, 0, 0, 10]);
  const file = new Uint8Array(Buffer.concat([head, bomb]));
  assert.ok(file.byteLength < 200 * 1024);
  await rejects(file, 'too_large');
});

test('the Edge Function runs exactly the same analyzer as the site', () => {
  const src = fileURLToPath(new URL('../src/lib/replay/', import.meta.url));
  const shared = fileURLToPath(new URL('../supabase/functions/_shared/replay/', import.meta.url));
  const files = readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.worker.ts'));
  assert.deepEqual(readdirSync(shared).sort(), files.sort(), 'run node scripts/sync-replay-core.mjs');
  for (const f of files) assert.equal(readFileSync(shared + f, 'utf8'), readFileSync(src + f, 'utf8'), `${f} differs: run node scripts/sync-replay-core.mjs`);
});

// Reference recording (LENDAS-08-11-2026-11h03m-04s-kltt.hbr2). Expected values
// were checked against the reference Haxball Replay Analyzer run locally.
const reference = fixture('LENDAS-08-11-2026-11h03m-04s-kltt.hbr2');
test('reference recording: header, score, goals, assists and statistics', { skip: !reference && 'fixture not present (kept out of git)' }, async () => {
  const r = await analyzeReplay(reference);
  assert.deepEqual(r.header, { version: 3, totalFrames: 18474, bytes: 26365 });
  assert.equal(r.durationSeconds, 307.9);
  assert.equal(r.segments.length, 1);
  const s = r.segments[0];
  assert.equal(s.stadium.name, 'FUTSAL X3 - AMEBAS');
  assert.deepEqual(s.score, [2, 1]);
  assert.equal(s.playingTicks, 17053);
  assert.deepEqual(s.goals.map((g) => [g.team, g.scorer, g.assist]), [
    [2, 'punpun', 'tceary kvaratskhelia'],
    [1, 'riv', 'lavs fodase'],
    [1, 'jpz tmv', 'lavs fodase'],
  ]);
  assert.deepEqual([s.teams.red.kicks, s.teams.blue.kicks], [136, 142]);
  assert.deepEqual([s.teams.red.passes, s.teams.blue.passes], [36, 37]);
  assert.deepEqual([s.teams.red.shotsOnTarget, s.teams.blue.shotsOnTarget], [8, 6]);
  assert.deepEqual([s.teams.red.possessionTicks, s.teams.blue.possessionTicks], [8304, 8738]);
  assert.equal(r.goalMarkers.length, 3, 'the timeline markers of the file agree with the goals found');
  for (const p of s.players.filter((x) => x.ticksRed + x.ticksBlue > 0)) {
    assert.equal(p.heat.cells.reduce((a, b) => a + b, 0), 17053, `${p.key}: heat map has one sample per playing tick`);
  }
});

const half1 = fixture('KIAZZURAX1.hbr2');
test('real recordings with emoji nicknames decode the text like the game', { skip: !half1 && 'fixture not present' }, async () => {
  const r = await analyzeReplay(half1);
  assert.ok(r.segments[0].players.length > 0);
  assert.ok(!r.segments[0].players.some((p) => p.name.includes('�')));
});
