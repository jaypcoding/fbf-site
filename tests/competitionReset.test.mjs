import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESET_COUNT_LABELS,
  describeResetError,
  isStaleResetError,
  resetConfirmationMatches,
  resetConfirmationText,
  resetRows,
  resetTotal,
} from '../src/lib/competitionReset.ts';

// Totals like the production preview of the six competitions.
const totals = {
  competitions: 6, competition_organizers: 4, seasons: 6, season_teams: 40, team_registrations: 40, rosters: 78,
  stages: 3, stage_groups: 8, stage_group_teams: 32, rounds: 13, matches: 25, match_events: 15,
  goalkeeper_participations: 2, match_streamers: 0, match_status_history: 30, round_robin_pair_claims: 24,
};

test('every table the database removes has a label, and nothing else', () => {
  assert.deepEqual(RESET_COUNT_LABELS.map(([key]) => key).sort(), Object.keys(totals).sort());
});

test('rows skip empty tables and keep the reading order', () => {
  const rows = resetRows(totals);
  assert.equal(rows.find((row) => row.key === 'match_streamers'), undefined);
  assert.equal(rows[0].key, 'competitions');
  assert.deepEqual(rows.find((row) => row.key === 'goalkeeper_participations'), { key: 'goalkeeper_participations', label: 'Participações de goleiros', count: 2 });
});

test('the total counts every removed row', () => {
  assert.equal(resetTotal(totals), 326);
  assert.equal(resetTotal({}), 0);
  assert.equal(resetTotal({ teams: 24, players: 80 }), 0, 'teams and players are never counted as removed');
});

test('the confirmation must be typed exactly as the database expects', () => {
  assert.equal(resetConfirmationText(6), 'RESETAR 6 COMPETIÇÕES');
  assert.equal(resetConfirmationMatches('RESETAR 6 COMPETIÇÕES', 'RESETAR 6 COMPETIÇÕES'), true);
  assert.equal(resetConfirmationMatches('resetar 6 competições', 'RESETAR 6 COMPETIÇÕES'), false);
  assert.equal(resetConfirmationMatches('RESETAR 6 COMPETIÇÕES ', 'RESETAR 6 COMPETIÇÕES'), false);
});

test('database messages are shown only for known cases', () => {
  assert.equal(isStaleResetError('Os dados mudaram desde a prévia. Abra a prévia novamente antes do reset.'), true);
  assert.equal(isStaleResetError(null), false);
  assert.equal(describeResetError({ code: '55000', message: 'Reset bloqueado: 1 partida(s) ao vivo' }), 'Reset bloqueado: 1 partida(s) ao vivo');
  assert.equal(describeResetError({ code: '42501', message: 'permission denied for function reset_competitions' }), 'Sua conta não tem permissão para o reset.');
  assert.equal(describeResetError({ code: 'XX000', message: 'internal detail' }), 'Não foi possível concluir o reset. Nada foi removido.');
  assert.equal(describeResetError(null), 'Não foi possível concluir o reset.');
});
