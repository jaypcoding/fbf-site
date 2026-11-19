import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeasonLeaders } from '../src/lib/seasonLeaders.ts';

const players = new Map([
  ['p1', { id: 'p1', nickname: 'Bruno', photo_url: null, position: 'Pivô' }],
  ['p2', { id: 'p2', nickname: 'Álvaro', photo_url: null, position: 'Volante' }],
  ['p3', { id: 'p3', nickname: 'Caio', photo_url: null, position: 'Goleiro' }],
]);
const teams = new Map([['p1', 'Time A'], ['p2', 'Time B']]);

test('orders by count and then by nickname using pt-BR collation', () => {
  const rows = [
    { player_id: 'p1', goals: 3, assists: 0 },
    { player_id: 'p2', goals: 3, assists: 1 },
    { player_id: 'p3', goals: 5, assists: 0 },
  ];
  assert.deepEqual(buildSeasonLeaders(rows, 'goals', players, teams).map((l) => l.player.id), ['p3', 'p2', 'p1']);
});

test('skips zero counts and players without display data', () => {
  const rows = [
    { player_id: 'p1', goals: 0, assists: 2 },
    { player_id: 'ghost', goals: 4, assists: 0 },
  ];
  assert.deepEqual(buildSeasonLeaders(rows, 'goals', players, teams), []);
  const assists = buildSeasonLeaders(rows, 'assists', players, teams);
  assert.equal(assists.length, 1);
  assert.equal(assists[0].count, 2);
  assert.equal(assists[0].team_name, 'Time A');
});

test('missing team mapping yields a null team name', () => {
  const [leader] = buildSeasonLeaders([{ player_id: 'p3', goals: 1, assists: 0 }], 'goals', players, teams);
  assert.equal(leader.team_name, null);
});
