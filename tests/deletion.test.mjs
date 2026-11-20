import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELETION_COUNT_LABELS,
  confirmationMatches,
  deletionRows,
  deletionTotal,
  describeDeletionError,
  isStalePreviewError,
} from '../src/lib/deletion.ts';

// Counts as the database returns them for the production test competition ".".
const testCompetition = {
  competitions: 1, competition_organizers: 2, seasons: 1, season_teams: 16, team_registrations: 16, rosters: 4,
  stages: 1, stage_groups: 4, stage_group_teams: 16, rounds: 12, matches: 24, match_status_history: 28, round_robin_pair_claims: 24,
};

test('every count returned by the database has a label', () => {
  assert.deepEqual(DELETION_COUNT_LABELS.map(([key]) => key).sort(), Object.keys(testCompetition).sort());
});

test('the preview lists only what will actually be removed, with the total', () => {
  const rows = deletionRows({ ...testCompetition, rosters: 0 });
  assert.ok(!rows.some((row) => row.key === 'rosters'));
  assert.equal(rows.find((row) => row.key === 'matches').label, 'Partidas nunca disputadas');
  assert.equal(deletionTotal(testCompetition), 149);
  assert.equal(deletionTotal({ seasons: 1 }), 1);
});

test('the confirmation must be the exact record name', () => {
  assert.ok(confirmationMatches('.', '.'));
  assert.ok(!confirmationMatches(' .', '.'));
  assert.ok(!confirmationMatches('teste completo', 'Teste completo'));
});

test('database messages are shown for known cases, nothing internal otherwise', () => {
  assert.equal(describeDeletionError({ code: '55000', message: 'Exclusão bloqueada: 1 partida(s) ao vivo ou finalizada(s)' }),
    'Exclusão bloqueada: 1 partida(s) ao vivo ou finalizada(s)');
  assert.equal(describeDeletionError({ code: '42501', message: 'permission denied for function deletion_preview' }),
    'Sua conta não tem permissão para esta exclusão.');
  assert.equal(describeDeletionError({ code: '42501', message: 'Somente administradores podem excluir competições' }),
    'Somente administradores podem excluir competições');
  assert.equal(describeDeletionError({ code: 'XX000', message: 'internal detail' }), 'Não foi possível concluir a exclusão. Nada foi removido.');
  assert.ok(isStalePreviewError('Os dados mudaram desde a prévia. Abra a prévia novamente antes de excluir.'));
  assert.ok(!isStalePreviewError('Exclusão bloqueada'));
});
