/*
# Scope organizer write access to their assigned competitions

1. New Functions
- `can_manage_competition`, `can_manage_season`, `can_manage_stage`, `can_manage_round`, `can_manage_match`: decide whether the current user may change a competition's content. Administrators can manage everything; organizers only the competitions assigned to them.

2. Security Changes
- Seasons, stages, rounds, season teams, rosters, matches, match events, goalkeeper participations and match streamer links now use these checks for insert, update and delete instead of "any manager".
- Teams and players stay shared records that any manager (administrator or organizer) can create and edit.
- Administrators keep full access to everything.

3. Important notes
- Public read access is unchanged: everyone can still see the competition content.
- No data is removed or altered; only the policies that decide who may write are replaced.
*/

CREATE OR REPLACE FUNCTION public.can_manage_competition(p_competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_fbf_admin() OR EXISTS (
    SELECT 1 FROM public.competition_organizers co
    WHERE co.competition_id = p_competition_id AND co.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_season(p_season_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_competition((SELECT s.competition_id FROM public.seasons s WHERE s.id = p_season_id));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_stage(p_stage_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_season((SELECT st.season_id FROM public.stages st WHERE st.id = p_stage_id));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_round(p_round_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_stage((SELECT r.stage_id FROM public.rounds r WHERE r.id = p_round_id));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_match(p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_round((SELECT m.round_id FROM public.matches m WHERE m.id = p_match_id));
$$;

REVOKE EXECUTE ON FUNCTION public.can_manage_competition(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_season(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_stage(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_round(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_season(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_stage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_match(uuid) TO authenticated;

DROP POLICY IF EXISTS "seasons_manager_insert" ON public.seasons;
DROP POLICY IF EXISTS "seasons_manager_update" ON public.seasons;
DROP POLICY IF EXISTS "seasons_admin_delete" ON public.seasons;
CREATE POLICY "seasons_scoped_insert" ON public.seasons FOR INSERT TO authenticated WITH CHECK (public.can_manage_competition(competition_id));
CREATE POLICY "seasons_scoped_update" ON public.seasons FOR UPDATE TO authenticated USING (public.can_manage_competition(competition_id)) WITH CHECK (public.can_manage_competition(competition_id));
CREATE POLICY "seasons_scoped_delete" ON public.seasons FOR DELETE TO authenticated USING (public.can_manage_competition(competition_id));

DROP POLICY IF EXISTS "stages_manager_insert" ON public.stages;
DROP POLICY IF EXISTS "stages_manager_update" ON public.stages;
DROP POLICY IF EXISTS "stages_admin_delete" ON public.stages;
CREATE POLICY "stages_scoped_insert" ON public.stages FOR INSERT TO authenticated WITH CHECK (public.can_manage_season(season_id));
CREATE POLICY "stages_scoped_update" ON public.stages FOR UPDATE TO authenticated USING (public.can_manage_season(season_id)) WITH CHECK (public.can_manage_season(season_id));
CREATE POLICY "stages_scoped_delete" ON public.stages FOR DELETE TO authenticated USING (public.can_manage_season(season_id));

DROP POLICY IF EXISTS "rounds_manager_insert" ON public.rounds;
DROP POLICY IF EXISTS "rounds_manager_update" ON public.rounds;
DROP POLICY IF EXISTS "rounds_admin_delete" ON public.rounds;
CREATE POLICY "rounds_scoped_insert" ON public.rounds FOR INSERT TO authenticated WITH CHECK (public.can_manage_stage(stage_id));
CREATE POLICY "rounds_scoped_update" ON public.rounds FOR UPDATE TO authenticated USING (public.can_manage_stage(stage_id)) WITH CHECK (public.can_manage_stage(stage_id));
CREATE POLICY "rounds_scoped_delete" ON public.rounds FOR DELETE TO authenticated USING (public.can_manage_stage(stage_id));

DROP POLICY IF EXISTS "season_teams_manager_insert" ON public.season_teams;
DROP POLICY IF EXISTS "season_teams_manager_update" ON public.season_teams;
DROP POLICY IF EXISTS "season_teams_admin_delete" ON public.season_teams;
CREATE POLICY "season_teams_scoped_insert" ON public.season_teams FOR INSERT TO authenticated WITH CHECK (public.can_manage_season(season_id));
CREATE POLICY "season_teams_scoped_update" ON public.season_teams FOR UPDATE TO authenticated USING (public.can_manage_season(season_id)) WITH CHECK (public.can_manage_season(season_id));
CREATE POLICY "season_teams_scoped_delete" ON public.season_teams FOR DELETE TO authenticated USING (public.can_manage_season(season_id));

DROP POLICY IF EXISTS "rosters_manager_insert" ON public.rosters;
DROP POLICY IF EXISTS "rosters_manager_update" ON public.rosters;
DROP POLICY IF EXISTS "rosters_admin_delete" ON public.rosters;
CREATE POLICY "rosters_scoped_insert" ON public.rosters FOR INSERT TO authenticated WITH CHECK (public.can_manage_season((SELECT st.season_id FROM public.season_teams st WHERE st.id = season_team_id)));
CREATE POLICY "rosters_scoped_update" ON public.rosters FOR UPDATE TO authenticated USING (public.can_manage_season((SELECT st.season_id FROM public.season_teams st WHERE st.id = season_team_id))) WITH CHECK (public.can_manage_season((SELECT st.season_id FROM public.season_teams st WHERE st.id = season_team_id)));
CREATE POLICY "rosters_scoped_delete" ON public.rosters FOR DELETE TO authenticated USING (public.can_manage_season((SELECT st.season_id FROM public.season_teams st WHERE st.id = season_team_id)));

DROP POLICY IF EXISTS "matches_manager_insert" ON public.matches;
DROP POLICY IF EXISTS "matches_manager_update" ON public.matches;
DROP POLICY IF EXISTS "matches_admin_delete" ON public.matches;
CREATE POLICY "matches_scoped_insert" ON public.matches FOR INSERT TO authenticated WITH CHECK (public.can_manage_round(round_id));
CREATE POLICY "matches_scoped_update" ON public.matches FOR UPDATE TO authenticated USING (public.can_manage_round(round_id)) WITH CHECK (public.can_manage_round(round_id));
CREATE POLICY "matches_scoped_delete" ON public.matches FOR DELETE TO authenticated USING (public.can_manage_round(round_id));

DROP POLICY IF EXISTS "match_events_manager_insert" ON public.match_events;
DROP POLICY IF EXISTS "match_events_manager_update" ON public.match_events;
DROP POLICY IF EXISTS "match_events_admin_delete" ON public.match_events;
CREATE POLICY "match_events_scoped_insert" ON public.match_events FOR INSERT TO authenticated WITH CHECK (public.can_manage_match(match_id));
CREATE POLICY "match_events_scoped_update" ON public.match_events FOR UPDATE TO authenticated USING (public.can_manage_match(match_id)) WITH CHECK (public.can_manage_match(match_id));
CREATE POLICY "match_events_scoped_delete" ON public.match_events FOR DELETE TO authenticated USING (public.can_manage_match(match_id));

DROP POLICY IF EXISTS "goalkeeper_participations_manager_insert" ON public.goalkeeper_participations;
DROP POLICY IF EXISTS "goalkeeper_participations_manager_update" ON public.goalkeeper_participations;
DROP POLICY IF EXISTS "goalkeeper_participations_admin_delete" ON public.goalkeeper_participations;
CREATE POLICY "goalkeeper_participations_scoped_insert" ON public.goalkeeper_participations FOR INSERT TO authenticated WITH CHECK (public.can_manage_match(match_id));
CREATE POLICY "goalkeeper_participations_scoped_update" ON public.goalkeeper_participations FOR UPDATE TO authenticated USING (public.can_manage_match(match_id)) WITH CHECK (public.can_manage_match(match_id));
CREATE POLICY "goalkeeper_participations_scoped_delete" ON public.goalkeeper_participations FOR DELETE TO authenticated USING (public.can_manage_match(match_id));

DROP POLICY IF EXISTS "match_streamers_manager_insert" ON public.match_streamers;
DROP POLICY IF EXISTS "match_streamers_manager_delete" ON public.match_streamers;
CREATE POLICY "match_streamers_scoped_insert" ON public.match_streamers FOR INSERT TO authenticated WITH CHECK (public.can_manage_match(match_id));
CREATE POLICY "match_streamers_scoped_delete" ON public.match_streamers FOR DELETE TO authenticated USING (public.can_manage_match(match_id));
