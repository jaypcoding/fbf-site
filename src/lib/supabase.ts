import { createClient } from '@supabase/supabase-js';
import { getSupabaseBrowserConfig } from './supabaseConfig';
import { assertSupabaseUrlForMode } from './supabaseEnvironment';

const { url: supabaseUrl, anonKey: supabaseAnonKey } = getSupabaseBrowserConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
assertSupabaseUrlForMode(import.meta.env.MODE, supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  display_name: string | null;
  role: 'USER' | 'ORGANIZER' | 'ADMIN';
};

export type Competition = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  format: string;
  max_teams: number | null;
  registration_starts_at: string | null;
  registration_ends_at: string | null;
  status: 'DRAFT' | 'UPCOMING' | 'REGISTRATION' | 'ACTIVE' | 'FINISHED' | 'CANCELLED';
};

export type TeamRegistration = {
  id: string;
  season_id: string;
  team_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  team?: Team;
};

export type Season = {
  id: string;
  competition_id: string;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type Team = {
  id: string;
  name: string;
  logo_url: string | null;
};

export type Player = {
  id: string;
  nickname: string;
  full_name: string | null;
  photo_url: string | null;
  nationality: string | null;
  position: 'Goleiro' | 'Volante' | 'Pivô';
};

export type SeasonTeam = {
  id: string;
  season_id: string;
  team_id: string;
  team?: Team;
  season?: Season;
};

export type Roster = {
  id: string;
  season_team_id: string;
  player_id: string;
  shirt_number: number | null;
  player?: Player;
};

export type Stage = {
  id: string;
  season_id: string;
  name: string;
  stage_order: number;
  format: string;
  tie_breakers: string[];
  settings: {
    legs?: 1 | 2;
    group_legs?: 1 | 2;
    knockout_legs?: 1 | 2;
    group_count?: number;
    qualifiers_per_group?: number;
    group_crossing?: 'RANKED' | 'DRAW';
    third_place?: boolean;
  };
};

export type Round = {
  id: string;
  stage_id: string;
  name: string;
  round_order: number;
  phase_type: 'ROUND_ROBIN' | 'GROUP' | 'KNOCKOUT' | 'MANUAL';
  stage_group_id: string | null;
  leg_number: 1 | 2;
  bracket_round: number | null;
  stage_group?: { id: string; name: string; group_order: number } | null;
};

export type Match = {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  scheduled_at: string | null;
  duration_seconds: number | null;
  home_score: number | null;
  away_score: number | null;
  home_penalty_score: number | null;
  away_penalty_score: number | null;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  series_id: string | null;
  series_leg: 1 | 2;
  home_source_match_id: string | null;
  home_source_outcome: 'WINNER' | 'LOSER' | null;
  away_source_match_id: string | null;
  away_source_outcome: 'WINNER' | 'LOSER' | null;
  home_team?: SeasonTeam;
  away_team?: SeasonTeam;
  round?: Round;
};

export type MatchEvent = {
  id: string;
  match_id: string;
  event_type: 'GOAL' | 'ASSIST' | 'SUBSTITUTION' | 'GOALKEEPER_IN' | 'GOALKEEPER_OUT';
  period: 'REGULATION' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
  is_own_goal: boolean;
  goal_event_id: string | null;
  minute_seconds: number;
  team_id: string | null;
  player_id: string | null;
  related_player_id: string | null;
  player?: Player;
  related_player?: Player | null;
  team?: SeasonTeam | null;
};

export type GoalkeeperParticipation = {
  id: string;
  match_id: string;
  team_id: string;
  player_id: string;
  started_at_seconds: number;
  ended_at_seconds: number | null;
  first_conceded_at_seconds: number | null;
  source_event_id: string | null;
  exit_event_id: string | null;
};

export type Streamer = {
  id: string;
  display_name: string;
  platform: 'TWITCH' | 'YOUTUBE';
  channel: string;
};
