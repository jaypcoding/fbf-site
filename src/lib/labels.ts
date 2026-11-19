import type { Competition, Match } from './supabase';

export const competitionStatusLabels: Record<Competition['status'], string> = {
  DRAFT: 'Em preparação',
  UPCOMING: 'Próxima',
  REGISTRATION: 'Inscrições abertas',
  ACTIVE: 'Em andamento',
  FINISHED: 'Finalizada',
  CANCELLED: 'Arquivada',
};

export const matchStatusLabels: Record<Match['status'], string> = {
  SCHEDULED: 'Agendada',
  LIVE: 'Ao vivo',
  FINISHED: 'Finalizada',
  POSTPONED: 'Adiada',
  CANCELLED: 'Cancelada',
};
