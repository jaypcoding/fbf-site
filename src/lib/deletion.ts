// Safe deletion of competitions, seasons, stages and rounds. The database
// (deletion_preview / delete_competition_record) decides what can be removed
// and revalidates everything; this module only shapes what the panel shows.

export type DeletionKind = 'COMPETITION' | 'SEASON' | 'STAGE' | 'ROUND';

export type DeletionCounts = Record<string, number>;

export type DeletionBlocker = { code: string; count: number; message: string };

export type DeletionPreview = {
  kind: DeletionKind;
  id: string;
  name: string;
  path: string;
  competition: { id: string; name: string; status: string };
  can_delete: boolean;
  blockers: DeletionBlocker[];
  warnings: string[];
  counts: DeletionCounts;
  fingerprint: string;
};

export type DeletionResult = { log_id: string; kind: DeletionKind; name: string; counts: DeletionCounts };

export const DELETION_KIND_LABELS: Record<DeletionKind, string> = {
  COMPETITION: 'competição',
  SEASON: 'temporada',
  STAGE: 'fase',
  ROUND: 'rodada',
};

// Same order the database deletes in reverse: parents first, for reading.
export const DELETION_COUNT_LABELS: [string, string][] = [
  ['competitions', 'Competição'],
  ['competition_organizers', 'Designações de organizador'],
  ['seasons', 'Temporadas'],
  ['season_teams', 'Vínculos de equipes com a temporada'],
  ['team_registrations', 'Inscrições'],
  ['rosters', 'Vínculos de jogadores com elencos'],
  ['stages', 'Fases'],
  ['stage_groups', 'Grupos'],
  ['stage_group_teams', 'Equipes nos grupos'],
  ['rounds', 'Rodadas'],
  ['matches', 'Partidas nunca disputadas'],
  ['match_status_history', 'Histórico de status das partidas'],
  ['round_robin_pair_claims', 'Reservas de confronto'],
];

export function deletionRows(counts: DeletionCounts): { key: string; label: string; count: number }[] {
  return DELETION_COUNT_LABELS
    .map(([key, label]) => ({ key, label, count: Number(counts[key] ?? 0) }))
    .filter((row) => row.count > 0);
}

export function deletionTotal(counts: DeletionCounts): number {
  return DELETION_COUNT_LABELS.reduce((sum, [key]) => sum + Number(counts[key] ?? 0), 0);
}

// The typed confirmation must be exactly the record name (as the database checks).
export function confirmationMatches(typed: string, name: string): boolean {
  return typed === name;
}

export function isStalePreviewError(message: string | undefined | null): boolean {
  return Boolean(message && message.includes('mudaram desde a prévia'));
}

// Database messages for these cases are written for the panel; anything else
// gets a generic text (no internal details).
export function describeDeletionError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return 'Não foi possível concluir a exclusão.';
  const known = ['42501', '55000', '22023', 'P0002'];
  if (error.code && known.includes(error.code) && error.message) {
    if (error.code === '42501' && /permission denied/i.test(error.message)) return 'Sua conta não tem permissão para esta exclusão.';
    return error.message;
  }
  return 'Não foi possível concluir a exclusão. Nada foi removido.';
}
