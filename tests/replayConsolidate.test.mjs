// Consolidation of N recordings into one match sheet (src/lib/replay/consolidate.ts).
// The unit of validation is the match: the 12 required scenarios of the
// specification (single file, 2, 3 and more files, late uploads, files out of
// order, duplicate, overlapping stretches, reprocessing, a player scoring in
// different files, statistics spread over files, a file with more than one
// period) plus identification rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateMatch, officialPayload, publicReport, canonicalJson, sha256Hex } from '../src/lib/replay/consolidate.ts';

const HOME = 'st-home', AWAY = 'st-away';
const match = { id: 'match-1', homeTeamId: HOME, awayTeamId: AWAY, homeName: 'Casa FC', awayName: 'Visitantes EC' };
const roster = [
  { playerId: 'p-ana', seasonTeamId: HOME, nickname: 'Ana', position: 'Pivô' },
  { playerId: 'p-bia', seasonTeamId: HOME, nickname: 'Bia', position: 'Volante' },
  { playerId: 'p-gk1', seasonTeamId: HOME, nickname: 'Goleira Casa', position: 'Goleiro' },
  { playerId: 'p-caio', seasonTeamId: AWAY, nickname: 'Caio', position: 'Pivô' },
  { playerId: 'p-davi', seasonTeamId: AWAY, nickname: 'Davi', position: 'Volante' },
  { playerId: 'p-gk2', seasonTeamId: AWAY, nickname: 'Goleiro Fora', position: 'Goleiro' },
];
const HOME_NICKS = ['Ana', 'Bia', 'Goleira Casa'];
const AWAY_NICKS = ['Caio', 'Davi', 'Goleiro Fora'];

const grid = () => ({ cols: 4, rows: 2, cells: [0, 0, 0, 0, 0, 0, 0, 0] });
const sketch = { name: 'Futsal x3', width: 600, height: 300, bgWidth: 550, bgHeight: 240, kickOffRadius: 80, goals: [], lines: [], playerRadius: 15, ballRadius: 6.4 };

/** One HaxBall game inside a file. red/blue: nicknames by colour; goals: [time, team(1|2), scorer, assist]. */
function seg(index, { red, blue, start = 0, end = 420, initial = [0, 0], goals = [], stats = {}, timeLimit = 7, endReason = 'finished' }) {
  const score = [initial[0] + goals.filter((g) => g[1] === 1).length, initial[1] + goals.filter((g) => g[1] === 2).length];
  const ticks = Math.round((end - start) * 60);
  const player = (name, color) => {
    const s = stats[name] ?? {};
    const heat = grid();
    heat.cells[color === 1 ? 0 : 7] = ticks;
    return {
      key: name, name, country: 'br', ids: [1], ticksRed: color === 1 ? ticks : 0, ticksBlue: color === 2 ? ticks : 0,
      goals: goals.filter((g) => g[2] === name).length, assists: goals.filter((g) => g[3] === name).length, ownGoals: 0,
      kicks: s.kicks ?? 10, passes: s.passes ?? 3, shots: s.shots ?? 2, shotsOnTarget: s.shotsOnTarget ?? 1, possessionTicks: s.possession ?? 100,
      touches: 5, sumX: (color === 1 ? -100 : 100) * ticks, sumY: 0, heat,
    };
  };
  const players = [...red.map((n) => player(n, 1)), ...blue.map((n) => player(n, 2))];
  const sum = (names, key) => players.filter((p) => names.includes(p.key)).reduce((n, p) => n + (key === 'possession' ? p.possessionTicks : p[key]), 0);
  const totals = (names, team) => ({ kicks: sum(names, 'kicks'), passes: sum(names, 'passes'), shots: sum(names, 'shots'), shotsOnTarget: sum(names, 'shotsOnTarget'), possessionTicks: sum(names, 'possession'), goals: goals.filter((g) => g[1] === team).length });
  return {
    index, startFrame: 0, endFrame: ticks, endReason, startedMidGame: start > 0, scoreLimit: 0, timeLimit,
    clockStart: start, clockEnd: end, playingTicks: ticks, initialScore: initial, score, stadium: sketch,
    goals: goals.map(([time, team, scorer, assist, extra = {}]) => ({ time, frame: 0, team, scorer, assist: assist ?? null, ownGoal: false, lastTouch: scorer, ball: [team === 1 ? 560 : -560, 0], shotFrom: [0, 0], ...extra })),
    players, teams: { red: totals(red, 1), blue: totals(blue, 2) }, ballThirds: [10, 20, 30], ballHeat: grid(), shots: [], passes: [], teamChanges: [],
  };
}

function file(id, name, segments, extra = {}) {
  const goalCount = segments.reduce((n, s) => n + s.goals.length, 0);
  return {
    id, name, sha256: id.padEnd(64, '0'), sizeBytes: 1000, lastModified: null, uploadedAt: `2026-11-22T10:00:0${id.length % 10}Z`, status: 'ANALYZED',
    analysis: { schema: 1, analyzer: 'fbf-replay-1.0.0', stats: 'fbf-stats-1', header: { version: 3, totalFrames: 1, bytes: 1 }, durationSeconds: 420, roomName: 'x', goalMarkers: Array.from({ length: goalCount }, () => ({ frame: 0, kind: 1 })), segments, simulateMs: 1 },
    ...extra,
  };
}

const run = (files, decisions = {}) => consolidateMatch({ match, roster, aliases: [], files, decisions });
const blocks = (sheet) => sheet.issues.filter((i) => i.level === 'block').map((i) => i.code);

// first half: home is Red; second half: sides swapped (home is Blue)
const H1 = (i = 0, goals = [[60, 1, 'Ana', 'Bia'], [200, 2, 'Caio', null]]) => seg(i, { red: HOME_NICKS, blue: AWAY_NICKS, goals });
const H2 = (i = 0, goals = [[100, 2, 'Ana', null], [300, 1, 'Davi', 'Caio']]) => seg(i, { red: AWAY_NICKS, blue: HOME_NICKS, goals });

test('1. whole match in a single file (two games in it)', () => {
  const sheet = run([file('a', 'partida.hbr2', [H1(0), H2(1)])]);
  assert.deepEqual(sheet.score, { home: 2, away: 2 });
  assert.equal(sheet.games.length, 2);
  assert.deepEqual(sheet.games.map((g) => g.label), ['1º tempo', '2º tempo']);
  assert.deepEqual(sheet.games.map((g) => g.redIs), ['home', 'away'], 'colours mapped from the identified players, not from the home/away order');
  assert.equal(sheet.durationSeconds, 840);
  assert.deepEqual(sheet.goals.map((g) => g.minuteSeconds), [60, 200, 520, 720], 'second-half goals offset by the first half');
  assert.equal(sheet.canConfirm, true, JSON.stringify(sheet.issues));
});

test('2. match split in two files (one per half)', () => {
  const sheet = run([file('a', 'JOGO1.hbr2', [H1()]), file('b', 'JOGO2.hbr2', [H2()])]);
  assert.deepEqual(sheet.score, { home: 2, away: 2 });
  assert.equal(sheet.order.source, 'sequence');
  assert.equal(sheet.canConfirm, true);
});

test('3. three files: first half recorded in two pieces + second half', () => {
  const p1 = seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, end: 180, goals: [[60, 1, 'Ana', 'Bia']], endReason: 'recording_ended' });
  const p2 = seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, start: 180, initial: [1, 0], goals: [[200, 2, 'Caio', null]] });
  const sheet = run([file('a', 'JOGO1.hbr2', [p1]), file('b', 'JOGO2.hbr2', [p2]), file('c', 'JOGO3.hbr2', [H2()])]);
  assert.equal(sheet.games.length, 2, 'the two pieces form one half');
  assert.deepEqual(sheet.score, { home: 2, away: 2 });
  assert.equal(sheet.games[0].durationSeconds, 420);
  assert.equal(sheet.canConfirm, true, JSON.stringify(sheet.issues));
});

test('4. many files: each half in pieces, plus a short game without goals', () => {
  const pieces = [
    seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, end: 100, goals: [[60, 1, 'Ana', 'Bia']], endReason: 'recording_ended' }),
    seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, start: 100, end: 420, initial: [1, 0], goals: [[200, 2, 'Caio', null]] }),
    seg(0, { red: AWAY_NICKS, blue: HOME_NICKS, end: 250, goals: [[100, 2, 'Ana', null]], endReason: 'recording_ended' }),
    seg(0, { red: AWAY_NICKS, blue: HOME_NICKS, start: 250, end: 420, initial: [0, 1], goals: [[300, 1, 'Davi', 'Caio']] }),
  ];
  const junk = seg(1, { red: HOME_NICKS, blue: AWAY_NICKS, end: 20 });
  const files = pieces.map((p, i) => file(`f${i}`, `REC-0${i + 1}.hbr2`, i === 3 ? [p, junk] : [p]));
  const sheet = run(files);
  assert.equal(sheet.games.length, 2);
  assert.deepEqual(sheet.score, { home: 2, away: 2 });
  assert.equal(sheet.segments.find((s) => s.key === 'f3:1').include, false, 'a 20-second goalless game is left out by default');
  assert.equal(sheet.canConfirm, true, JSON.stringify(sheet.issues));
});

test('5 and 6. files uploaded at different times and out of order: order comes from the names, not the upload', () => {
  const late = file('b', 'HBReplay-2026-11-22-20h35m.hbr2', [H1()], { uploadedAt: '2026-11-22T12:00:00Z' });
  const early = file('a', 'HBReplay-2026-11-22-20h50m.hbr2', [H2()], { uploadedAt: '2026-11-22T09:00:00Z' });
  const sheet = run([early, late]);
  assert.equal(sheet.order.source, 'timestamp');
  assert.deepEqual(sheet.order.fileIds, ['b', 'a']);
  assert.deepEqual(sheet.games.map((g) => g.redIs), ['home', 'away']);
  // names without any order: the administrator must confirm (and can reorder)
  const noHints = run([file('x', 'segundo.hbr2', [H2()]), file('y', 'primeiro.hbr2', [H1()])]);
  assert.ok(blocks(noHints).includes('order_uncertain'));
  const fixed = run([file('x', 'segundo.hbr2', [H2()]), file('y', 'primeiro.hbr2', [H1()])], { order: ['y', 'x'], orderConfirmed: true });
  assert.equal(fixed.order.source, 'manual');
  assert.deepEqual(fixed.goals.map((g) => g.minuteSeconds), [60, 200, 520, 720]);
  assert.equal(fixed.canConfirm, true);
});

test('7. two recordings of the same half (another player recorded it too): counted once', () => {
  const sheet = run([file('a', 'JOGO1.hbr2', [H1()]), file('b', 'JOGO2.hbr2', [H1()]), file('c', 'JOGO3.hbr2', [H2()])]);
  assert.equal(sheet.games.length, 2);
  assert.deepEqual(sheet.score, { home: 2, away: 2 });
  assert.equal(sheet.segments.find((s) => s.key === 'b:0').role, 'repeat');
  assert.equal(sheet.players.find((p) => p.playerId === 'p-ana').stats.kicks, 20, 'kicks of the repeated recording are not added (10 per half)');
  assert.ok(sheet.issues.some((i) => i.code === 'overlap'));
});

test('8. overlapping pieces: repeated goals and statistics are not counted twice', () => {
  const a = seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, end: 250, goals: [[60, 1, 'Ana', 'Bia'], [200, 2, 'Caio', null]], endReason: 'recording_ended' });
  const b = seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, start: 150, end: 420, initial: [1, 0], goals: [[200, 2, 'Caio', null], [400, 1, 'Bia', 'Ana']] });
  const sheet = run([file('a', 'JOGO1.hbr2', [a]), file('b', 'JOGO2.hbr2', [b])]);
  assert.equal(sheet.games.length, 1);
  assert.deepEqual(sheet.score, { home: 2, away: 1 }, 'the goal at 3:20 appears in both files and counts once');
  assert.equal(sheet.goals.length, 3);
  assert.ok(sheet.issues.some((i) => i.code === 'overlap'));
});

test('9. reprocessing the same files gives exactly the same sheet and hash', async () => {
  const files = [file('a', 'JOGO1.hbr2', [H1()]), file('b', 'JOGO2.hbr2', [H2()])];
  const h = async () => { const s = run(files); return sha256Hex(canonicalJson({ official: officialPayload(s), report: publicReport(s, {}) })); };
  assert.equal(await h(), await h());
});

test('10 and 11. goals and statistics spread over files are added per player; possession uses raw ticks', () => {
  const h1 = seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, goals: [[60, 1, 'Ana', 'Bia'], [90, 1, 'Ana', 'Bia']], stats: { Ana: { kicks: 7, possession: 300 }, Caio: { possession: 100 } } });
  const h2 = seg(0, { red: AWAY_NICKS, blue: HOME_NICKS, goals: [[100, 2, 'Ana', 'Goleira Casa']], stats: { Ana: { kicks: 5, possession: 100 }, Caio: { possession: 500 } } });
  const sheet = run([file('a', 'JOGO1.hbr2', [h1]), file('b', 'JOGO2.hbr2', [h2])]);
  const ana = sheet.players.find((p) => p.playerId === 'p-ana');
  assert.equal(ana.stats.goals, 3);
  assert.equal(ana.stats.kicks, 12);
  assert.equal(sheet.players.find((p) => p.playerId === 'p-bia').stats.assists, 2);
  assert.equal(sheet.players.find((p) => p.playerId === 'p-gk1').stats.assists, 1);
  // home possession = Ana 300+100, Bia 100+100, Goleira 100+100 = 800; away = Caio 600, Davi 200, Goleiro 200 = 1000
  assert.equal(sheet.teams.home.possessionTicks, 800);
  assert.equal(sheet.teams.away.possessionTicks, 1000);
  assert.equal(sheet.teams.home.possessionPct, 44.4);
  // heat maps rotated to a common frame (home attacks right): home always on the left cells
  assert.equal(ana.heat.cells[0], 2 * 420 * 60);
});

test('12. a file with more than one period and a duplicate file content', () => {
  const sheet = run([file('a', 'tudo.hbr2', [H1(0), H2(1)])]);
  assert.equal(sheet.games.length, 2);
  // the database refuses the same SHA-256 twice for a match; a file already used in another match must be acknowledged
  const reused = run([file('a', 'tudo.hbr2', [H1(0), H2(1)], { usedInOtherMatch: true })]);
  assert.ok(blocks(reused).includes('file_reused'));
  assert.equal(run([file('a', 'tudo.hbr2', [H1(0), H2(1)], { usedInOtherMatch: true })], { acknowledgeReuse: ['a'] }).canConfirm, true);
});

test('identification: unknown, ambiguous and duplicated nicknames block only what needs a decision', () => {
  const g = seg(0, { red: ['Ana', 'Bia', 'Fulano'], blue: AWAY_NICKS, goals: [[60, 1, 'Fulano', 'Ana']] });
  const sheet = run([file('a', 'j.hbr2', [g])]);
  assert.ok(blocks(sheet).includes('player_unknown'), 'an unknown author blocks');
  assert.equal(sheet.goals[0].scorerPlayerId, null);
  const decided = run([file('a', 'j.hbr2', [g])], { players: { fulano: 'p-gk1' } });
  assert.equal(decided.goals[0].scorerPlayerId, 'p-gk1');
  assert.equal(decided.canConfirm, true);
  assert.deepEqual(officialPayload(decided).aliases, [{ player_id: 'p-gk1', alias: 'Fulano' }], 'a manual association becomes an alias');
  const unidentified = run([file('a', 'j.hbr2', [g])], { players: { fulano: 'none' } });
  assert.equal(unidentified.canConfirm, true);
  assert.equal(officialPayload(unidentified).goals[0].player_id, null, 'goal kept for the team only');
  assert.equal(officialPayload(unidentified).goals[0].assist_player_id, null, 'no assist without an author');
  // two people with nicknames differing only by case at the same time are never merged
  const dup = seg(0, { red: ['Ana', 'ana', 'Bia'], blue: AWAY_NICKS });
  const dupSheet = run([file('a', 'j.hbr2', [dup])]);
  assert.equal(dupSheet.players.filter((p) => p.names.some((n) => n.toLowerCase() === 'ana')).length, 2);
  assert.ok(dupSheet.issues.some((i) => i.code === 'player_ambiguous'));
});

test('a registered player on the wrong side blocks; RED/BLUE without identified players needs the administrator', () => {
  const wrong = seg(0, { red: ['Ana', 'Caio', 'Bia'], blue: ['Davi', 'Goleiro Fora'] });
  assert.ok(blocks(run([file('a', 'j.hbr2', [wrong])])).includes('player_wrong_team'));
  const strangers = seg(0, { red: ['X1', 'X2'], blue: ['Y1', 'Y2'] });
  const s = run([file('a', 'j.hbr2', [strangers])]);
  assert.ok(blocks(s).includes('side_unknown'));
  const sided = run([file('a', 'j.hbr2', [strangers])], { segments: { 'a:0': { redIs: 'away' } }, players: { x1: 'none', x2: 'none', y1: 'none', y2: 'none' } });
  assert.equal(sided.games[0].redIs, 'away');
  assert.equal(sided.canConfirm, true);
});

test('goals before the recording started become team goals without author; corrections are applied and validated', () => {
  const late = seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, start: 120, initial: [1, 0], goals: [[300, 2, 'Caio', null]] });
  const sheet = run([file('a', 'j.hbr2', [late])]);
  assert.deepEqual(sheet.score, { home: 1, away: 1 });
  assert.equal(sheet.goals.find((g) => g.source === 'not_recorded').scorerPlayerId, null);
  assert.ok(sheet.issues.some((i) => i.code === 'recording_started_late'));
  const g = seg(0, { red: HOME_NICKS, blue: AWAY_NICKS, goals: [[60, 1, 'Ana', 'Bia']] });
  const fixed = run([file('a', 'j.hbr2', [g])], { goals: { 'a:0:0': { scorer: 'p-bia', assist: 'p-ana' } } });
  assert.deepEqual([fixed.goals[0].scorerPlayerId, fixed.goals[0].assistPlayerId, fixed.goals[0].corrected], ['p-bia', 'p-ana', true]);
  const invalid = run([file('a', 'j.hbr2', [g])], { goals: { 'a:0:0': { scorer: 'p-caio' } } });
  assert.ok(blocks(invalid).includes('goal_invalid_author'), 'an author from the other team is refused');
  const own = run([file('a', 'j.hbr2', [g])], { goals: { 'a:0:0': { scorer: 'p-caio', ownGoal: true } } });
  assert.equal(own.goals[0].teamId, AWAY, 'an own goal is recorded for the team of its author');
  assert.equal(own.goals[0].side, 'home');
  assert.equal(own.canConfirm, true);
});

test('goalkeepers: registered goalkeepers who played are suggested; failed or pending files block', () => {
  const sheet = run([file('a', 'j.hbr2', [H1()])]);
  assert.deepEqual([sheet.goalkeepers.home, sheet.goalkeepers.away], ['p-gk1', 'p-gk2']);
  assert.deepEqual(officialPayload(sheet).goalkeepers.map((k) => k.player_id), ['p-gk1', 'p-gk2']);
  const none = run([file('a', 'j.hbr2', [H1()])], { goalkeepers: { home: '' } });
  assert.equal(none.goalkeepers.home, null);
  const failed = run([file('a', 'j.hbr2', [H1()]), { ...file('b', 'k.hbr2', []), status: 'FAILED', analysis: null, error: 'O arquivo não é uma gravação .hbr2' }]);
  assert.ok(blocks(failed).includes('file_failed'));
  assert.ok(blocks(run([])).includes('no_files'));
});
