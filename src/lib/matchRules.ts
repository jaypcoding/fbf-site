import type { Match } from './supabase';

const nextMatchStatuses: Record<Match['status'], Match['status'][]> = {
  SCHEDULED: ['LIVE', 'POSTPONED', 'CANCELLED'],
  LIVE: ['FINISHED', 'POSTPONED', 'CANCELLED'],
  FINISHED: [],
  POSTPONED: ['SCHEDULED', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransitionMatchStatus(
  current: Match['status'],
  next: Match['status'],
) {
  return current === next || nextMatchStatuses[current].includes(next);
}

export function availableMatchStatuses(current: Match['status']) {
  return [current, ...nextMatchStatuses[current]];
}
