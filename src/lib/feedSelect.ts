// Shared select of the public match lists (home page agenda, Central ao Vivo).
// Matches from archived (old CANCELLED) or draft competitions never appear in
// public lists. The competition embed is !inner, so rows the visitor is not
// allowed to see are dropped by the database itself.
import type { Match } from '@/lib/supabase';
import { one } from '@/lib/relations';

export type FeedRow = Match & {
  round?: Match['round'] & {
    stage?: { season?: { competition?: { id: string; name: string; status: string } | null } | null } | null;
  };
};

export const HIDDEN_COMPETITION_STATUSES = new Set(['DRAFT', 'CANCELLED']);

export const FEED_SELECT = 'id, round_id, home_team_id, away_team_id, scheduled_at, home_score, away_score, status, series_id, series_leg, home_source_match_id, home_source_outcome, away_source_match_id, away_source_outcome, home_team:home_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), away_team:away_team_id ( id, season_id, team_id, team:team_id ( id, name, logo_url ) ), round:round_id!inner ( id, stage_id, name, round_order, phase_type, stage_group_id, leg_number, bracket_round, stage_group:stage_group_id ( id, name, group_order ), stage:stage_id!inner ( id, season:season_id!inner ( id, competition:competition_id!inner ( id, name, status ) ) ) )';

export function competitionOf(match: FeedRow) {
  return one(one(one(match.round?.stage)?.season)?.competition);
}

export function isPublicFeedRow(match: FeedRow) {
  const competition = competitionOf(match);
  return Boolean(competition && !HIDDEN_COMPETITION_STATUSES.has(competition.status));
}
