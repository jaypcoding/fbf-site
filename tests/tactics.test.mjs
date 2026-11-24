import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, defaultAvatar, demote, inkOn, move, normalizeRole, promote, reorderBench, resolveFormation, roleFromPosition, suggestStarters, swap } from '../src/lib/tactics.ts';

const roster = [
  { player_id: 'g', nickname: 'Goleirão', position: 'Goleiro', shirt_number: 1 },
  { player_id: 'v', nickname: 'vola', position: 'Volante', shirt_number: 5 },
  { player_id: 'p', nickname: 'piv o', position: 'Pivô', shirt_number: 9 },
  { player_id: 'r', nickname: 'reserva', position: 'Pivô', shirt_number: null },
];

test('without a saved formation nobody is invented: empty court, whole roster on the bench', () => {
  assert.deepEqual(resolveFormation(null, roster), { starters: [], bench: ['g', 'v', 'p', 'r'] });
});

test('a saved formation drops players who left the roster and benches the new ones', () => {
  const saved = { starters: [{ player_id: 'g', role: 'GK', x: 0.5, y: 0.9 }, { player_id: 'old', role: 'PV', x: 0.5, y: 0.2 }], bench: ['old', 'p'] };
  const f = resolveFormation(saved, roster);
  assert.deepEqual(f.starters.map((s) => s.player_id), ['g']);
  assert.deepEqual(f.bench, ['p', 'v', 'r']);
});

test('positions stay inside the court', () => {
  assert.equal(clamp(-1), 0.06);
  assert.equal(clamp(2), 0.94);
  assert.deepEqual(move({ starters: [{ player_id: 'g', role: 'GK', x: 0.5, y: 0.5 }], bench: [] }, 'g', 1.5, -0.3).starters[0], { player_id: 'g', role: 'GK', x: 0.94, y: 0.06 });
});

test('promote, demote and swap never duplicate a player; at most three starters', () => {
  let f = resolveFormation(null, roster);
  f = promote(f, 'g'); f = promote(f, 'v'); f = promote(f, 'p');
  assert.deepEqual(f.starters.map((s) => `${s.player_id}:${s.role}`), ['g:GK', 'v:VL', 'p:PV']);
  assert.equal(promote(f, 'r'), null, 'a fourth starter is refused');
  assert.equal(promote(f, 'g'), null, 'a starter cannot be promoted again');
  const s = swap(f, 'p', 'r');
  assert.deepEqual([s.starters.map((x) => x.player_id), s.bench], [['g', 'v', 'r'], ['p']]);
  const d = demote(s, 'v', 0);
  assert.deepEqual([d.starters.map((x) => x.player_id), d.bench], [['g', 'r'], ['v', 'p']]);
  const all = [...d.starters.map((x) => x.player_id), ...d.bench];
  assert.equal(new Set(all).size, all.length);
});

test('bench order can be changed', () => {
  assert.deepEqual(reorderBench({ starters: [], bench: ['a', 'b', 'c'] }, 'c', -1).bench, ['a', 'c', 'b']);
  assert.deepEqual(reorderBench({ starters: [], bench: ['a', 'b'] }, 'a', -1).bench, ['a', 'b']);
});

test('suggestion picks one goalkeeper, one volante and one pivô by registered position (only a suggestion)', () => {
  assert.deepEqual(suggestStarters(roster).starters.map((s) => `${s.player_id}:${s.role}`), ['g:GK', 'v:VL', 'p:PV']);
  assert.deepEqual(suggestStarters(roster.slice(0, 1)).starters.map((s) => s.player_id), ['g'], 'a short roster leaves empty places');
  assert.deepEqual(suggestStarters([roster[0], roster[2]]).starters.map((s) => `${s.player_id}:${s.role}`), ['g:GK', 'p:PV'], 'each keeps the role of his registered position');
  assert.deepEqual(suggestStarters([roster[2], roster[3], roster[0]]).starters.map((s) => `${s.player_id}:${s.role}`), ['g:GK', 'r:VL', 'p:PV'], 'a second pivô fills the open role');
});

test('roles and avatars', () => {
  assert.equal(roleFromPosition('Goleiro'), 'GK');
  assert.equal(roleFromPosition('Volante'), 'VL');
  assert.equal(normalizeRole(' ala '), 'ALA');
  assert.equal(normalizeRole('toolong'), null);
  const a = defaultAvatar(roster[0]);
  assert.equal(a.symbol, 'glove');
  assert.equal(a.label, 'GO');
  assert.equal(defaultAvatar(roster[1]).label, 'VO');
  assert.equal(inkOn('#ffffff'), '#1d1712');
  assert.equal(inkOn('#2e2219'), '#ffffff');
});
