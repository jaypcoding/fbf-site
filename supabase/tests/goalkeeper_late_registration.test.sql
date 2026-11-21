BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(25);

-- ------------------------------------------------------------ fixtures
-- One competition; each scenario has its own stage (round-robin pairs are
-- claimed per stage). Home = "New Jeans"-like, away = "Winners Long"-like.
INSERT INTO public.competitions (id, name, category, format, status)
VALUES ('2a000000-0000-0000-0000-000000000001', 'GK late', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.seasons (id, competition_id, name) VALUES ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', 'GK season');
INSERT INTO public.teams (id, name) VALUES ('4a000000-0000-0000-0000-000000000001', 'GK home'), ('4a000000-0000-0000-0000-000000000002', 'GK away');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000002', '3a000000-0000-0000-0000-000000000001', '4a000000-0000-0000-0000-000000000002');
INSERT INTO public.players (id, nickname, position) VALUES
  ('9a000000-0000-0000-0000-000000000001', 'home keeper', 'Goleiro'),
  ('9a000000-0000-0000-0000-000000000002', 'away keeper', 'Goleiro'),
  ('9a000000-0000-0000-0000-000000000003', 'home scorer', 'Pivô'),
  ('9a000000-0000-0000-0000-000000000004', 'away scorer', 'Pivô'),
  ('9a000000-0000-0000-0000-000000000005', 'home keeper 2', 'Goleiro'),
  ('9a000000-0000-0000-0000-000000000006', 'jabu', 'Goleiro'),
  ('9a000000-0000-0000-0000-000000000007', 'Cave', 'Goleiro');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000002'),
  ('5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000003'),
  ('5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000004'),
  ('5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000005'),
  ('5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000006'),
  ('5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000007');
INSERT INTO public.stages (id, season_id, name, format)
SELECT ('6a000000-0000-0000-0000-00000000000' || n)::uuid, '3a000000-0000-0000-0000-000000000001', 'GK stage ' || n, 'Pontos corridos'
FROM generate_series(1, 6) AS n;
INSERT INTO public.rounds (id, stage_id, name, round_order)
SELECT ('7a000000-0000-0000-0000-00000000000' || n)::uuid, ('6a000000-0000-0000-0000-00000000000' || n)::uuid, 'GK round ' || n, 1
FROM generate_series(1, 6) AS n;
-- A: replica of New Jeans 8 x 1 Winners Long (first home goal 17 s, away goal 154 s, 558 s)
-- B: home clean sheet (600 s)   C: normal flow with a goalkeeper change (600 s)
-- D: change recorded by an event before the starter is registered (600 s)
-- E: period left open by the bug (500 s)   F: live match with an open period
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status, duration_seconds)
SELECT ('8a000000-0000-0000-0000-00000000000' || n)::uuid, ('7a000000-0000-0000-0000-00000000000' || n)::uuid,
       '5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000002', 'SCHEDULED',
       (ARRAY[558, 600, 600, 600, 500, 600])[n]
FROM generate_series(1, 6) AS n;

-- C and F: starter registered before the match ends (normal flow).
INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001'),
       ('8a000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001');
UPDATE public.matches SET status = 'LIVE' WHERE id::text LIKE '8a000000-%';

INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 17, '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000003');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 154, '5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000004');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 300, '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000003');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000002', 'GOAL', 'REGULATION', 100, '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000003');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000003', 'GOALKEEPER_OUT', 'REGULATION', 300, '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000003', 'GOALKEEPER_IN', 'REGULATION', 301, '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000005');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000003', 'GOAL', 'REGULATION', 400, '5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000004');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000004', 'GOALKEEPER_IN', 'REGULATION', 300, '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000005');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('8a000000-0000-0000-0000-000000000005', 'GOAL', 'REGULATION', 50, '5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000004');

SELECT is((SELECT ended_at_seconds FROM public.goalkeeper_participations
  WHERE match_id = '8a000000-0000-0000-0000-000000000003' AND player_id = '9a000000-0000-0000-0000-000000000001'), 300,
  'normal flow: a goalkeeper change event closes the starter period while the match is live');
UPDATE public.matches SET status = 'FINISHED' WHERE id::text LIKE '8a000000-%' AND id <> '8a000000-0000-0000-0000-000000000006';

-- Snapshot of everything that must not change (matches, events, rosters, other periods).
CREATE TEMP TABLE t_snap (k text PRIMARY KEY, v text);
INSERT INTO t_snap SELECT 'matches', md5(string_agg(to_jsonb(m)::text, ',' ORDER BY m.id)) FROM public.matches m;
INSERT INTO t_snap SELECT 'events', md5(string_agg((to_jsonb(e) - 'created_at')::text, ',' ORDER BY e.id)) FROM public.match_events e;
INSERT INTO t_snap SELECT 'rosters', md5(string_agg(to_jsonb(r)::text, ',' ORDER BY r.id)) FROM public.rosters r;

-- ------------------------------------- A: the New Jeans x Winners Long case
SELECT lives_ok($$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id)
  VALUES ('8a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000006')$$,
  'a starting goalkeeper can be registered after the match was finished');
SELECT lives_ok($$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id)
  VALUES ('8a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000007')$$,
  'the other team goalkeeper too');
SELECT results_eq($$SELECT player_id::text, ended_at_seconds, first_conceded_at_seconds FROM public.goalkeeper_participations
    WHERE match_id = '8a000000-0000-0000-0000-000000000001' ORDER BY player_id$$,
  $$VALUES ('9a000000-0000-0000-0000-000000000006', 558, 154), ('9a000000-0000-0000-0000-000000000007', 558, 17)$$,
  'both periods are closed at the end of the match, with the first goal conceded');

-- ------------------------------------------------ B: a real clean sheet
SELECT lives_ok($$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id)
  VALUES ('8a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001')$$,
  'late registration in a match the goalkeeper did not concede');
SELECT results_eq($$SELECT clean_sheet, total_seconds FROM public.goalkeeper_match_clean_sheet_statistics
    WHERE match_id = '8a000000-0000-0000-0000-000000000002' AND player_id = '9a000000-0000-0000-0000-000000000001'$$,
  $$VALUES (true, 600)$$, 'it counts as a clean sheet with the whole match');

-- ----------------------------------------- C: normal flow is unchanged
SELECT results_eq($$SELECT player_id::text, started_at_seconds, ended_at_seconds, first_conceded_at_seconds, exit_event_id IS NOT NULL, source_event_id IS NOT NULL
    FROM public.goalkeeper_participations WHERE match_id = '8a000000-0000-0000-0000-000000000003' ORDER BY started_at_seconds$$,
  $$VALUES ('9a000000-0000-0000-0000-000000000001', 0, 300, NULL::integer, true, false), ('9a000000-0000-0000-0000-000000000005', 301, 600, 400, false, true)$$,
  'normal flow: starter until the change (event), substitute until the end, goal against the substitute');
SELECT is((SELECT ended_at_seconds FROM public.goalkeeper_participations
    WHERE match_id = '8a000000-0000-0000-0000-000000000006'), NULL::integer,
  'normal flow: a period registered before the end stays open while the match is live');

-- ------------- D: goalkeeper change recorded by an event, starter registered later
SELECT lives_ok($$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id)
  VALUES ('8a000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001')$$,
  'the starter can be registered after a recorded goalkeeper change');
SELECT results_eq($$SELECT started_at_seconds, ended_at_seconds FROM public.goalkeeper_participations
    WHERE match_id = '8a000000-0000-0000-0000-000000000004' ORDER BY started_at_seconds$$,
  $$VALUES (0, 300), (300, 600)$$, 'the starter period ends when the substitute starts (no overlap)');

-- ------------------------------- manual ended_at_seconds is still forbidden
SELECT throws_ok($$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id, ended_at_seconds)
  VALUES ('8a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000002', 300)$$,
  '42501', NULL, 'users cannot send ended_at_seconds on insert');
SELECT throws_ok($$UPDATE public.goalkeeper_participations SET ended_at_seconds = 100
  WHERE match_id = '8a000000-0000-0000-0000-000000000001' AND player_id = '9a000000-0000-0000-0000-000000000007'$$,
  '42501', NULL, 'users cannot change ended_at_seconds on update (Cave period)');
SELECT throws_ok($$UPDATE public.goalkeeper_participations SET ended_at_seconds = 100
  WHERE match_id = '8a000000-0000-0000-0000-000000000006'$$,
  '42501', NULL, 'not even on an open period of a live match');
SELECT throws_ok($$INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id, started_at_seconds)
  VALUES ('8a000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000002', 10)$$,
  '42501', NULL, 'nor a start other than 0');

-- --------------------- E: backfill of a period left open by the old behavior
ALTER TABLE public.goalkeeper_participations DISABLE TRIGGER goalkeeper_participations_validate;
INSERT INTO public.goalkeeper_participations (id, match_id, team_id, player_id, first_conceded_at_seconds)
VALUES ('aa000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', NULL);
ALTER TABLE public.goalkeeper_participations ENABLE TRIGGER goalkeeper_participations_validate;
SELECT is((SELECT count(*) FROM public.goalkeeper_match_clean_sheet_statistics WHERE match_id = '8a000000-0000-0000-0000-000000000005'), 0::bigint,
  'before the backfill, the open period is invisible (the reported bug)');
INSERT INTO t_snap SELECT 'periods_before', md5(string_agg(to_jsonb(g)::text, ',' ORDER BY g.id))
FROM public.goalkeeper_participations g WHERE g.id <> 'aa000000-0000-0000-0000-000000000001';
-- Same statement as the migration's backfill.
UPDATE public.goalkeeper_participations gp
SET started_at_seconds = gp.started_at_seconds
FROM public.matches m
WHERE m.id = gp.match_id
  AND m.status = 'FINISHED'
  AND m.duration_seconds IS NOT NULL
  AND gp.ended_at_seconds IS NULL
  AND gp.source_event_id IS NULL;
SELECT results_eq($$SELECT ended_at_seconds, first_conceded_at_seconds FROM public.goalkeeper_participations WHERE id = 'aa000000-0000-0000-0000-000000000001'$$,
  $$VALUES (500, 50)$$, 'the backfill closes the open period and computes the first goal conceded');
SELECT results_eq($$SELECT clean_sheet, total_seconds FROM public.goalkeeper_match_clean_sheet_statistics
    WHERE match_id = '8a000000-0000-0000-0000-000000000005'$$,
  $$VALUES (false, 50)$$, 'after the backfill it appears: no clean sheet, 50 s without conceding');
SELECT is((SELECT md5(string_agg(to_jsonb(g)::text, ',' ORDER BY g.id)) FROM public.goalkeeper_participations g WHERE g.id <> 'aa000000-0000-0000-0000-000000000001'),
  (SELECT v FROM t_snap WHERE k = 'periods_before'), 'the backfill touches no other period (closed ones, event ones, live match)');
SELECT is((SELECT ended_at_seconds FROM public.goalkeeper_participations WHERE match_id = '8a000000-0000-0000-0000-000000000006'), NULL::integer,
  'the open period of the live match is not closed by the backfill');

-- ------------------------------------------- nothing else changed
SELECT is((SELECT md5(string_agg(to_jsonb(m)::text, ',' ORDER BY m.id)) FROM public.matches m), (SELECT v FROM t_snap WHERE k = 'matches'),
  'matches (results, status, duration) are unchanged');
SELECT is((SELECT md5(string_agg((to_jsonb(e) - 'created_at')::text, ',' ORDER BY e.id)) FROM public.match_events e), (SELECT v FROM t_snap WHERE k = 'events'),
  'match events are unchanged');
SELECT is((SELECT md5(string_agg(to_jsonb(r)::text, ',' ORDER BY r.id)) FROM public.rosters r), (SELECT v FROM t_snap WHERE k = 'rosters'),
  'rosters are unchanged');

-- ----------------------------------------- the exact numbers requested
-- goalkeeper_clean_sheet_statistics is what the Goalkeepers tab and the
-- Statistics page read (GoalkeeperRanking).
SELECT results_eq($$SELECT games, clean_sheets, total_seconds FROM public.goalkeeper_clean_sheet_statistics
    WHERE competition_id = '2a000000-0000-0000-0000-000000000001' AND player_id = '9a000000-0000-0000-0000-000000000006'$$,
  $$VALUES (1, 0, 154)$$, 'jabu (home keeper of the 8 x 1): 1 game, 0 clean sheets, 154 s without conceding');
SELECT results_eq($$SELECT games, clean_sheets, total_seconds FROM public.goalkeeper_clean_sheet_statistics
    WHERE competition_id = '2a000000-0000-0000-0000-000000000001' AND player_id = '9a000000-0000-0000-0000-000000000007'$$,
  $$VALUES (1, 0, 17)$$, 'Cave (away keeper of the 8 x 1): 1 game, 0 clean sheets, 17 s without conceding');
SELECT results_eq($$SELECT nickname FROM public.goalkeeper_clean_sheet_statistics
    WHERE competition_id = '2a000000-0000-0000-0000-000000000001' ORDER BY nickname$$,
  $$VALUES ('Cave'::text), ('home keeper'::text), ('home keeper 2'::text), ('jabu'::text)$$,
  'the competition ranking lists every goalkeeper with a closed period');

SELECT * FROM finish();
ROLLBACK;
