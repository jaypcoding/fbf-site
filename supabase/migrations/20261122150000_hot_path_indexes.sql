-- Indexes for the most used lookups that had no index on their foreign key
-- (found by the audit of 2026-11-22). Additive only: no data or behaviour
-- changes; the tables are small, so the build is immediate.
--   * statistics, profiles and top scorers group or filter match_events by player
--   * the match timeline, standings and team pages filter events and matches by team
--   * player pages look up rosters by player; goalkeeper ranking by player
CREATE INDEX IF NOT EXISTS match_events_player_id_idx ON public.match_events(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS match_events_team_id_idx ON public.match_events(team_id);
CREATE INDEX IF NOT EXISTS matches_home_team_id_idx ON public.matches(home_team_id);
CREATE INDEX IF NOT EXISTS matches_away_team_id_idx ON public.matches(away_team_id);
CREATE INDEX IF NOT EXISTS rosters_player_id_idx ON public.rosters(player_id);
CREATE INDEX IF NOT EXISTS season_teams_team_id_idx ON public.season_teams(team_id);
CREATE INDEX IF NOT EXISTS goalkeeper_participations_player_id_idx ON public.goalkeeper_participations(player_id);
