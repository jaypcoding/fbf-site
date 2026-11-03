BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fbf-admin-test@example.invalid', '', now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fbf-organizer-test@example.invalid', '', now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fbf-outsider-test@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles
SET role = CASE id
  WHEN '10000000-0000-0000-0000-000000000001'::uuid THEN 'ADMIN'
  WHEN '10000000-0000-0000-0000-000000000002'::uuid THEN 'ORGANIZER'
  ELSE 'USER'
END
WHERE id IN (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003'
);

INSERT INTO public.competitions (id, name, category, format, status)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'Integration assigned', 'Test', 'Pontos corridos', 'DRAFT'),
  ('20000000-0000-0000-0000-000000000002', 'Integration unassigned', 'Test', 'Pontos corridos', 'DRAFT');

UPDATE public.competitions
SET status = 'REGISTRATION'
WHERE id = '20000000-0000-0000-0000-000000000001';

INSERT INTO public.seasons (id, competition_id, name)
VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Integration season'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Unassigned season');

INSERT INTO public.competition_organizers (competition_id, user_id)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

INSERT INTO public.teams (id, name)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'Integration home'),
  ('40000000-0000-0000-0000-000000000002', 'Integration away'),
  ('40000000-0000-0000-0000-000000000003', 'Integration third'),
  ('40000000-0000-0000-0000-000000000004', 'Unassigned home'),
  ('40000000-0000-0000-0000-000000000005', 'Unassigned away');

INSERT INTO public.season_teams (id, season_id, team_id)
VALUES
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000004'),
  ('50000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000005');

INSERT INTO public.stages (id, season_id, name, format)
VALUES
  ('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Event stage', 'Grupos'),
  ('60000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Round robin stage', 'Pontos corridos'),
  ('60000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'Unassigned stage', 'Pontos corridos');

INSERT INTO public.rounds (id, stage_id, name, round_order)
VALUES
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'Event round', 1),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'Goalkeeper return round', 2);

INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status, duration_seconds)
VALUES (
  '80000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000002',
  'SCHEDULED',
  900
), (
  '80000000-0000-0000-0000-000000000002',
  '70000000-0000-0000-0000-000000000002',
  '50000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000002',
  'SCHEDULED',
  900
);

INSERT INTO public.players (id, nickname, position)
VALUES
  ('90000000-0000-0000-0000-000000000001', 'Home keeper starter', 'Goleiro'),
  ('90000000-0000-0000-0000-000000000002', 'Home keeper substitute', 'Goleiro'),
  ('90000000-0000-0000-0000-000000000003', 'Home scorer', 'Pivô'),
  ('90000000-0000-0000-0000-000000000004', 'Home assister', 'Volante'),
  ('90000000-0000-0000-0000-000000000005', 'Away scorer', 'Pivô');

INSERT INTO public.streamers (id, display_name, platform, channel)
VALUES ('a1000000-0000-0000-0000-000000000001', 'Integration streamer', 'TWITCH', 'fbf_test_stream');

INSERT INTO public.rosters (season_team_id, player_id)
VALUES
  ('50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003'),
  ('50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004'),
  ('50000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000005');

INSERT INTO public.team_registrations (id, season_id, team_id, submitted_by)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000002'
);

SELECT plan(80);

SELECT is(
  (SELECT count(*)::integer FROM public.profiles
   WHERE id IN (
     '10000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000003'
   )),
  3,
  'auth user insert trigger creates a profile for every new account'
);
SELECT is(
  (SELECT count(*)::integer FROM public.profiles
   WHERE id IN (
     '10000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000003'
   )
   AND role = 'USER'),
  3,
  'newly synchronized profiles receive the unprivileged USER role'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);

SELECT ok(public.can_manage_competition('20000000-0000-0000-0000-000000000001'), 'assigned organizer can manage their competition');
SELECT ok(NOT public.can_manage_competition('20000000-0000-0000-0000-000000000002'), 'organizer cannot manage an unassigned competition');
SELECT is(
  (WITH changed AS (
    UPDATE public.teams SET name = 'Organizer must not change global team'
    WHERE id = '40000000-0000-0000-0000-000000000001'
    RETURNING id
  ) SELECT count(*)::integer FROM changed),
  0,
  'organizer cannot update shared global team data'
);
SELECT throws_ok(
  $$INSERT INTO public.teams (name) VALUES ('Organizer cannot create shared team')$$,
  '42501',
  NULL,
  'organizer cannot insert a shared global team'
);
SELECT is(
  (WITH changed AS (
    UPDATE public.players SET nickname = 'Organizer must not change global player'
    WHERE id = '90000000-0000-0000-0000-000000000003'
    RETURNING id
  ) SELECT count(*)::integer FROM changed),
  0,
  'organizer cannot update shared global player data'
);
SELECT throws_ok(
  $$INSERT INTO public.players (nickname, position) VALUES ('Organizer cannot create shared player', 'Pivô')$$,
  '42501',
  NULL,
  'organizer cannot insert a shared global player'
);
SELECT is(
  (WITH changed AS (
    UPDATE public.streamers SET display_name = 'Organizer must not change global streamer'
    WHERE id = 'a1000000-0000-0000-0000-000000000001'
    RETURNING id
  ) SELECT count(*)::integer FROM changed),
  0,
  'organizer cannot update shared global streamer data'
);
SELECT throws_ok(
  $$INSERT INTO public.streamers (display_name, platform, channel) VALUES ('Organizer cannot create shared streamer', 'TWITCH', 'organizer_test')$$,
  '42501',
  NULL,
  'organizer cannot insert a shared global streamer'
);
SELECT throws_ok(
  $$INSERT INTO public.profiles (id, role) VALUES ('10000000-0000-0000-0000-000000000002', 'ADMIN')$$,
  '42501',
  NULL,
  'organizer cannot insert or promote a profile'
);
SELECT throws_ok(
  $$UPDATE public.profiles SET role = 'ADMIN' WHERE id = '10000000-0000-0000-0000-000000000002'$$,
  '42501',
  NULL,
  'organizer cannot change their own role'
);
SELECT throws_ok(
  $$SELECT public.generate_round_robin('60000000-0000-0000-0000-000000000003')$$,
  '42501',
  NULL,
  'organizer cannot generate fixtures in an unassigned competition'
);
SELECT throws_ok(
  $$SELECT public.review_team_registration('a0000000-0000-0000-0000-000000000001', 'APPROVED')$$,
  '42501',
  NULL,
  'registration RPC rejects an unassigned organizer'
);
SELECT lives_ok(
  $$SELECT public.register_team_for_season('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003')$$,
  'assigned organizer can register a team'
);
SELECT throws_ok(
  $$SELECT public.register_team_for_season('30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003')$$,
  '23505',
  NULL,
  'duplicate active registration is rejected'
);
SELECT lives_ok(
  $$SELECT public.review_team_registration('a0000000-0000-0000-0000-000000000001', 'APPROVED')$$,
  'assigned organizer can approve a registration'
);
SELECT is(
  (SELECT count(*)::integer FROM public.season_teams WHERE season_id = '30000000-0000-0000-0000-000000000001'),
  3,
  'approval creates one season-team participation'
);
SELECT lives_ok(
  $$UPDATE public.matches SET status = 'LIVE' WHERE id = '80000000-0000-0000-0000-000000000001'$$,
  'scheduled match can transition to live without a score'
);
SELECT throws_ok(
  $$UPDATE public.matches SET status = 'SCHEDULED' WHERE id = '80000000-0000-0000-0000-000000000001'$$,
  '23514',
  NULL,
  'live match cannot transition back to scheduled'
);
SELECT throws_ok(
  $$UPDATE public.matches SET home_score = 9 WHERE id = '80000000-0000-0000-0000-000000000001'$$,
  '42501',
  NULL,
  'event-derived score cannot be edited directly'
);
SELECT lives_ok(
  $$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001')$$,
  'initial goalkeeper participation can be registered'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 100, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003')$$,
  'valid goal event is accepted'
);
SELECT is(
  (SELECT home_score FROM public.matches WHERE id = '80000000-0000-0000-0000-000000000001'),
  1,
  'official score is derived from goal events'
);
SELECT throws_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 100, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003')$$,
  '23505',
  NULL,
  'duplicate goal event is rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, goal_event_id)
    SELECT '80000000-0000-0000-0000-000000000001', 'ASSIST', 'REGULATION', 100, '50000000-0000-0000-0000-000000000001', player_id, id
    FROM public.match_events
    WHERE match_id = '80000000-0000-0000-0000-000000000001' AND event_type = 'GOAL'$$,
  '23514',
  NULL,
  'scorer cannot be registered as their own assist'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, goal_event_id)
    SELECT '80000000-0000-0000-0000-000000000001', 'ASSIST', 'REGULATION', 100, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', id
    FROM public.match_events
    WHERE match_id = '80000000-0000-0000-0000-000000000001' AND event_type = 'GOAL'$$,
  'valid assist is linked to a different player on the same goal'
);
SELECT throws_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, goal_event_id)
    SELECT '80000000-0000-0000-0000-000000000001', 'ASSIST', 'REGULATION', 100, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', id
    FROM public.match_events
    WHERE match_id = '80000000-0000-0000-0000-000000000001' AND event_type = 'GOAL'$$,
  '23505',
  NULL,
  'one goal cannot receive duplicate assist events'
);
SELECT lives_ok(
  $$UPDATE public.match_events SET minute_seconds = 110
    WHERE match_id = '80000000-0000-0000-0000-000000000001' AND event_type = 'GOAL' AND team_id = '50000000-0000-0000-0000-000000000001'$$,
  'correcting a goal event is allowed'
);
SELECT is(
  (SELECT count(*)::integer FROM public.match_events
   WHERE match_id = '80000000-0000-0000-0000-000000000001' AND event_type = 'ASSIST'),
  0,
  'correcting a goal invalidates its now-mismatched assist'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, goal_event_id)
    SELECT '80000000-0000-0000-0000-000000000001', 'ASSIST', 'REGULATION', 110, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', id
    FROM public.match_events
    WHERE match_id = '80000000-0000-0000-0000-000000000001' AND event_type = 'GOAL' AND team_id = '50000000-0000-0000-0000-000000000001'$$,
  'corrected goal can receive a new valid assist'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 200, '50000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000005')$$,
  'opponent goal is accepted'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', 'GOAL', 'PENALTY_SHOOTOUT', 450, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003')$$,
  'shootout goal is recorded separately'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', 'GOAL', 'PENALTY_SHOOTOUT', 480, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004')$$,
  'second shootout goal is recorded separately'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', 'GOAL', 'PENALTY_SHOOTOUT', 500, '50000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000005')$$,
  'opponent shootout goal is recorded separately'
);
SELECT is(
  (SELECT home_score FROM public.matches WHERE id = '80000000-0000-0000-0000-000000000001'),
  1,
  'shootout goals do not change the official match score'
);
SELECT is(
  (SELECT away_score FROM public.matches WHERE id = '80000000-0000-0000-0000-000000000001'),
  1,
  'normal-time opponent score remains separate from the shootout'
);
SELECT is(
  (SELECT home_penalty_score FROM public.matches WHERE id = '80000000-0000-0000-0000-000000000001'),
  2,
  'home shootout score is derived separately'
);
SELECT is(
  (SELECT away_penalty_score FROM public.matches WHERE id = '80000000-0000-0000-0000-000000000001'),
  1,
  'away shootout score is derived separately'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, related_player_id)
    VALUES ('80000000-0000-0000-0000-000000000001', 'SUBSTITUTION', 'REGULATION', 300, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001')$$,
  'goalkeeper substitution event is accepted'
);
SELECT is(
  (SELECT ended_at_seconds FROM public.goalkeeper_participations
   WHERE match_id = '80000000-0000-0000-0000-000000000001' AND player_id = '90000000-0000-0000-0000-000000000001'),
  300,
  'substitution automatically closes the outgoing goalkeeper interval'
);
SELECT is(
  (SELECT count(*)::integer FROM public.goalkeeper_participations
   WHERE match_id = '80000000-0000-0000-0000-000000000001'
     AND player_id = '90000000-0000-0000-0000-000000000002'
     AND started_at_seconds = 300
     AND ended_at_seconds IS NULL),
  1,
  'substitution starts the incoming goalkeeper interval'
);
SELECT is(
  (SELECT goals FROM public.player_competition_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000003'),
  NULL::integer,
  'unfinished match does not produce official player statistics'
);
SELECT lives_ok(
  $$UPDATE public.matches SET status = 'FINISHED' WHERE id = '80000000-0000-0000-0000-000000000001'$$,
  'live match can be finalized from its event-derived score'
);
SELECT is(
  (SELECT ended_at_seconds FROM public.goalkeeper_participations
   WHERE match_id = '80000000-0000-0000-0000-000000000001' AND player_id = '90000000-0000-0000-0000-000000000002'),
  900,
  'finishing the match closes the active goalkeeper interval'
);
SELECT is(
  (SELECT total_seconds FROM public.goalkeeper_match_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000002'
     AND match_id = '80000000-0000-0000-0000-000000000001'),
  600,
  'substitute receives 600 clean seconds in the match where they entered'
);
SELECT is(
  (SELECT clean_sheet FROM public.goalkeeper_match_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000002'
     AND match_id = '80000000-0000-0000-0000-000000000001'),
  true,
  'substitute earns a clean sheet for that specific match'
);
SELECT is(
  (SELECT total_seconds FROM public.goalkeeper_match_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000002'
     AND match_id = '80000000-0000-0000-0000-000000000002'),
  299,
  'return-match substitute interval contributes exactly 299 clean seconds'
);
SELECT is(
  (SELECT total_seconds FROM public.goalkeeper_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000002'),
  899,
  'substitute aggregate clean-sheet time is 899 seconds across both matches'
);
SELECT is(
  (SELECT clean_sheets FROM public.goalkeeper_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000002'),
  2,
  'substitute aggregate includes one clean sheet in each match'
);
SELECT lives_ok(
  $$UPDATE public.match_events SET minute_seconds = 250
    WHERE match_id = '80000000-0000-0000-0000-000000000001'
      AND event_type = 'GOAL'
      AND team_id = '50000000-0000-0000-0000-000000000002'
      AND period = 'REGULATION'$$,
  'correcting an opponent goal is allowed after finalization'
);
SELECT is(
  (SELECT total_seconds FROM public.goalkeeper_match_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000001'
     AND match_id = '80000000-0000-0000-0000-000000000001'),
  250,
  'correcting a goal recalculates the starter time in that specific match'
);
SELECT is(
  (SELECT total_seconds FROM public.goalkeeper_match_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000001'
     AND match_id = '80000000-0000-0000-0000-000000000002'),
  599,
  'returning starter accumulates 599 clean seconds across both spells in that match'
);
SELECT is(
  (SELECT total_seconds FROM public.goalkeeper_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000001'),
  849,
  'starter aggregate clean-sheet time is 849 seconds across both matches'
);
SELECT is(
  (SELECT goals FROM public.player_competition_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000003'),
  1,
  'finished match contributes official goal statistics'
);
SELECT is(
  (SELECT assists FROM public.player_competition_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000004'),
  1,
  'valid linked assist contributes official statistics'
);
SELECT is(
  (SELECT count(*)::integer FROM public.match_status_history
   WHERE match_id = '80000000-0000-0000-0000-000000000001'),
  3,
  'status history records creation, kickoff, and completion'
);
SELECT lives_ok(
  $$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id)
    VALUES ('80000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001')$$,
  'returning-goalkeeper match starts with the home goalkeeper'
);
SELECT lives_ok(
  $$UPDATE public.matches SET status = 'LIVE' WHERE id = '80000000-0000-0000-0000-000000000002'$$,
  'goalkeeper return match can start'
);
SELECT lives_ok(
  $$INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    VALUES
      ('80000000-0000-0000-0000-000000000002', 'GOALKEEPER_OUT', 'REGULATION', 300, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001'),
      ('80000000-0000-0000-0000-000000000002', 'GOALKEEPER_IN', 'REGULATION', 301, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002'),
      ('80000000-0000-0000-0000-000000000002', 'GOALKEEPER_OUT', 'REGULATION', 600, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002'),
      ('80000000-0000-0000-0000-000000000002', 'GOALKEEPER_IN', 'REGULATION', 601, '50000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001')$$,
  'same goalkeeper can leave and return with non-overlapping participation spells'
);
SELECT lives_ok(
  $$UPDATE public.matches SET status = 'FINISHED' WHERE id = '80000000-0000-0000-0000-000000000002'$$,
  'goalkeeper return match can finish'
);
SELECT is(
  (SELECT clean_sheets FROM public.goalkeeper_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000001'),
  1,
  'returning goalkeeper earns at most one clean sheet in the match despite two clean spells'
);
SELECT is(
  (SELECT clean_sheet FROM public.goalkeeper_match_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000001'
     AND match_id = '80000000-0000-0000-0000-000000000002'),
  true,
  'returning goalkeeper earns a single clean sheet in the identified match'
);
SELECT is(
  (SELECT games FROM public.goalkeeper_clean_sheet_statistics
   WHERE player_id = '90000000-0000-0000-0000-000000000001'),
  2,
  'goalkeeper appearances are counted by match rather than by participation spell'
);
SELECT lives_ok(
  $$SELECT public.generate_round_robin('60000000-0000-0000-0000-000000000002')$$,
  'assigned organizer can generate round-robin fixtures'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '60000000-0000-0000-0000-000000000002'),
  3,
  'odd-team round robin creates every unique pairing'
);
INSERT INTO public.matches (round_id, home_team_id, away_team_id, status)
VALUES (
  '70000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000003',
  'SCHEDULED'
);
SELECT lives_ok(
  $$UPDATE public.matches SET status = 'CANCELLED'
    WHERE round_id = '70000000-0000-0000-0000-000000000001'
      AND away_team_id = '50000000-0000-0000-0000-000000000003'$$,
  'scheduled match can be cancelled without a score'
);
SELECT is(
  (SELECT played FROM public.stage_standings
   WHERE stage_id = '60000000-0000-0000-0000-000000000001'
     AND team_id = '40000000-0000-0000-0000-000000000001'),
  1,
  'cancelled matches do not contribute to official standings'
);
SELECT is(
  (SELECT (public.generate_round_robin('60000000-0000-0000-0000-000000000002')->>'already_generated')::boolean),
  true,
  'repeated round-robin call is idempotent'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$INSERT INTO public.profiles (id, role) VALUES ('10000000-0000-0000-0000-000000000003', 'ADMIN')$$,
  '42501',
  NULL,
  'user cannot insert or self-promote a profile'
);
SELECT throws_ok(
  $$UPDATE public.profiles SET role = 'ADMIN' WHERE id = '10000000-0000-0000-0000-000000000003'$$,
  '42501',
  NULL,
  'user cannot change their own role'
);
SELECT throws_ok(
  $$SELECT public.set_user_role('10000000-0000-0000-0000-000000000003', 'ADMIN')$$,
  '42501',
  NULL,
  'user cannot call the privileged role-management RPC'
);
SELECT is(
  (WITH changed AS (
    UPDATE public.competitions SET name = 'User must not edit competition'
    WHERE id = '20000000-0000-0000-0000-000000000001'
    RETURNING id
  ) SELECT count(*)::integer FROM changed),
  0,
  'user cannot update a competition'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT throws_ok(
  $$INSERT INTO public.profiles (id, role) VALUES ('10000000-0000-0000-0000-000000000001', 'ADMIN')$$,
  '42501',
  NULL,
  'admin profile creation still uses trusted database synchronization'
);
SELECT lives_ok(
  $$UPDATE public.teams SET name = 'Admin may edit shared team'
    WHERE id = '40000000-0000-0000-0000-000000000001'$$,
  'admin can edit shared global team data'
);
SELECT lives_ok(
  $$SELECT public.set_user_role('10000000-0000-0000-0000-000000000003', 'ADMIN')$$,
  'admin can promote a user through the protected RPC'
);
SELECT is(
  (SELECT role FROM public.profiles WHERE id = '10000000-0000-0000-0000-000000000003'),
  'ADMIN',
  'protected role-management RPC persists the authorized role change'
);
SELECT is(
  (WITH deleted AS (
    DELETE FROM public.competitions
    WHERE id = '20000000-0000-0000-0000-000000000001'
    RETURNING id
  ) SELECT count(*)::integer FROM deleted),
  0,
  'admin cannot delete a competition that has match history'
);
SELECT lives_ok(
  $$UPDATE public.players SET nickname = 'Admin may edit shared player'
    WHERE id = '90000000-0000-0000-0000-000000000003'$$,
  'admin can edit shared global player data'
);
SELECT lives_ok(
  $$UPDATE public.streamers SET display_name = 'Admin may edit shared streamer'
    WHERE id = 'a1000000-0000-0000-0000-000000000001'$$,
  'admin can edit shared global streamer data'
);

SELECT * FROM finish();
ROLLBACK;
