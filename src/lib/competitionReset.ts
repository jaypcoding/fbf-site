// Administrative reset of selected competitions. The database
// (reset_competitions_preview / reset_competitions) decides what is removed,
// checks the ADMIN role and revalidates everything under lock; this module
// only shapes what the panel shows.

export type ResetCounts = Record<string, number>;

export type ResetBlocker = { code: string; count: number; message: string };

export type ResetCompetition = {
  id: string;
  name: string;
  category: string;
  status: string;
  finished_matches: number;
  counts: ResetCounts;
};

export type ResetPreserved = { teams: number; players: number; teams_hash: string; players_hash: string };

export type ResetPreview = {
  competitions: ResetCompetition[];
  totals: ResetCounts;
  blockers: ResetBlocker[];
  can_reset: boolean;
  confirmation: string;
  preserved: ResetPreserved;
  fingerprint: string;
};

export type ResetResult = {
  reset_batch_id: string;
  logs: { log_id: string; competition_id: string; name: string; counts: ResetCounts }[];
  totals: ResetCounts;
  preserved: ResetPreserved;
};

// Parents first, for reading.
export const RESET_COUNT_LABELS: [string, string][] = [
  ['competitions', 'Competições'],
  ['competition_organizers', 'Designações de organizador'],
  ['seasons', 'Temporadas'],
  ['team_registrations', 'Inscrições'],
  ['season_teams', 'Vínculos de equipes com temporadas'],
  ['rosters', 'Vínculos de jogadores com elencos'],
  ['stages', 'Fases'],
  ['stage_groups', 'Grupos'],
  ['stage_group_teams', 'Equipes nos grupos'],
  ['rounds', 'Rodadas'],
  ['matches', 'Partidas (inclusive disputadas)'],
  ['match_events', 'Eventos (gols, assistências e outros)'],
  ['goalkeeper_participations', 'Participações de goleiros'],
  ['match_streamers', 'Transmissões vinculadas a partidas'],
  ['match_status_history', 'Histórico de status das partidas'],
  ['round_robin_pair_claims', 'Reservas de confronto'],
];

export function resetRows(counts: ResetCounts): { key: string; label: string; count: number }[] {
  return RESET_COUNT_LABELS
    .map(([key, label]) => ({ key, label, count: Number(counts[key] ?? 0) }))
    .filter((row) => row.count > 0);
}

export function resetTotal(counts: ResetCounts): number {
  return RESET_COUNT_LABELS.reduce((sum, [key]) => sum + Number(counts[key] ?? 0), 0);
}

// Same text the database expects ("RESETAR 6 COMPETIÇÕES").
export function resetConfirmationText(count: number): string {
  return `RESETAR ${count} COMPETIÇÕES`;
}

export function resetConfirmationMatches(typed: string, expected: string): boolean {
  return typed === expected;
}

export function isStaleResetError(message: string | undefined | null): boolean {
  return Boolean(message && message.includes('mudaram desde a prévia'));
}

// Database messages for these cases are written for the panel; anything else
// gets a generic text (no internal details).
export function describeResetError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return 'Não foi possível concluir o reset.';
  const known = ['42501', '55000', '22023', 'P0002'];
  if (error.code && known.includes(error.code) && error.message) {
    if (error.code === '42501' && /permission denied/i.test(error.message)) return 'Sua conta não tem permissão para o reset.';
    return error.message;
  }
  return 'Não foi possível concluir o reset. Nada foi removido.';
}
