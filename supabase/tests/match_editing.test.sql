BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Editing registered matches, own goals and theme preference
-- (migration 20261122130000_match_editing_own_goals_theme.sql).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edit-admin@example.invalid', '', now()),
  ('1c000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edit-user@example.invalid', '', now()),
  ('1c000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edit-org@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1c000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'USER' WHERE id = '1c000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET role = 'ORGANIZER' WHERE id = '1c000000-0000-0000-0000-000000000003';

INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('2c000000-0000-0000-0000-000000000001', 'Edit test', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id) VALUES ('2c000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000003');
INSERT INTO public.seasons (id, competition_id, name) VALUES ('3c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000001', 'Edit');
INSERT INTO public.teams (id, name) VALUES ('4c000000-0000-0000-0000-000000000001', 'Edit Home'), ('4c000000-0000-0000-0000-000000000002', 'Edit Away');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001', '4c000000-0000-0000-0000-000000000001'),
  ('5c000000-0000-0000-0000-000000000002', '3c000000-0000-0000-0000-000000000001', '4c000000-0000-0000-0000-000000000002');
INSERT INTO public.players (id, nickname, position) VALUES
  ('7c000000-0000-0000-0000-000000000001', 'edit home gk', 'Goleiro'),
  ('7c000000-0000-0000-0000-000000000002', 'edit home a', 'Pivô'),
  ('7c000000-0000-0000-0000-000000000003', 'edit home b', 'Volante'),
  ('7c000000-0000-0000-0000-000000000004', 'edit away gk', 'Goleiro'),
  ('7c000000-0000-0000-0000-000000000005', 'edit away a', 'Pivô');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('5c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000001'),
  ('5c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000002'),
  ('5c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000003'),
  ('5c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000004'),
  ('5c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000005');
INSERT INTO public.stages (id, season_id, name, format) VALUES ('6c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001', 'Edit stage', 'Pontos corridos');
INSERT INTO public.rounds (id, stage_id, name, round_order, leg_number) VALUES
  ('8c000000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000001', 'R1', 1, 1),
  ('8c000000-0000-0000-0000-000000000002', '6c000000-0000-0000-0000-000000000001', 'R2', 2, 2);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status) VALUES
  ('9c000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000002', 'SCHEDULED'),
  ('9c000000-0000-0000-0000-000000000002', '8c000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000001', 'SCHEDULED');
UPDATE public.competitions SET status = 'REGISTRATION' WHERE id = '2c000000-0000-0000-0000-000000000001';

CREATE FUNCTION pg_temp.fp(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT public.match_sheet_fingerprint(p) $$;
CREATE FUNCTION pg_temp.g(team text, player text, own boolean, minute integer, assist text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('team_id', team, 'player_id', player, 'is_own_goal', own, 'minute_seconds', minute, 'assist_player_id', assist)
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SELECT plan(40);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
-- a result registered with team-only goals (like the dX x SF record): 2 x 1
SELECT lives_ok($$SELECT public.record_retroactive_match_result('9c000000-0000-0000-0000-000000000001', NULL, 840,
  jsonb_build_array(jsonb_build_object('team_id', '5c000000-0000-0000-0000-000000000001'), jsonb_build_object('team_id', '5c000000-0000-0000-0000-000000000001'), jsonb_build_object('team_id', '5c000000-0000-0000-0000-000000000002')), 2, 1)$$,
  'a finished match registered without authors');
SELECT is((SELECT points FROM public.stage_standings WHERE season_team_id = '5c000000-0000-0000-0000-000000000001'), 3, 'standings before the edit: home won');

-- permissions and guards
SELECT set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$SELECT pg_temp.fp('9c000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'a common user cannot read the edit version');
SELECT throws_ok($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', 'x', '{"goals":[],"score":{"home":0,"away":0}}', 'teste')$$, '42501', NULL, 'a common user cannot edit a result');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history), 0, 'a common user sees no edit history');
SELECT set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000003', true);
SELECT ok(pg_temp.fp('9c000000-0000-0000-0000-000000000001') ~ '^[0-9a-f]{32}$', 'the organizer of the competition can edit');
SELECT set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', 'stale', '{"goals":[],"score":{"home":0,"away":0}}', 'teste')$$, '55000', NULL, 'a stale version (concurrent edit) is refused');
SELECT throws_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', %L, '{"goals":[],"score":{"home":0,"away":0}}', '')$$, pg_temp.fp('9c000000-0000-0000-0000-000000000001')), '22023', NULL, 'the reason is mandatory');
SELECT throws_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000002', %L, '{"goals":[],"score":{"home":0,"away":0}}', 'teste')$$, pg_temp.fp('9c000000-0000-0000-0000-000000000002')), '23514', NULL, 'only finished matches are edited here');

-- invalid corrections change nothing
SELECT throws_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', %L, %L, 'placar errado')$$,
  pg_temp.fp('9c000000-0000-0000-0000-000000000001'),
  jsonb_build_object('score', jsonb_build_object('home', 3, 'away', 1), 'goals', jsonb_build_array(pg_temp.g('5c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000002', false, 60, NULL)))),
  '23514', NULL, 'goals that do not add up to the corrected score are refused');
SELECT throws_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', %L, %L, 'gc com assistência')$$,
  pg_temp.fp('9c000000-0000-0000-0000-000000000001'),
  jsonb_build_object('score', jsonb_build_object('home', 1, 'away', 0), 'goals', jsonb_build_array(pg_temp.g('5c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000005', true, 60, '7c000000-0000-0000-0000-000000000004')))),
  '23514', NULL, 'an own goal cannot have an assist');
SELECT throws_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', %L, %L, 'autor de fora')$$,
  pg_temp.fp('9c000000-0000-0000-0000-000000000001'),
  jsonb_build_object('score', jsonb_build_object('home', 1, 'away', 0), 'goals', jsonb_build_array(pg_temp.g('5c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000005', false, 60, NULL)))),
  '23514', NULL, 'an author outside the roster of the team is refused');
SELECT is((SELECT count(*)::integer FROM public.match_events WHERE match_id = '9c000000-0000-0000-0000-000000000001'), 3, 'refused corrections left the 3 original goals');

-- the correction: authors, an assist, an own goal and goalkeepers (still 2 x 1)
SELECT lives_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', %L, %L, 'súmula conferida com a organização')$$,
  pg_temp.fp('9c000000-0000-0000-0000-000000000001'),
  jsonb_build_object('score', jsonb_build_object('home', 2, 'away', 1), 'duration_seconds', 840,
    'goals', jsonb_build_array(
      pg_temp.g('5c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000002', false, 100, '7c000000-0000-0000-0000-000000000003'),
      pg_temp.g('5c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000005', true, 300, NULL),
      pg_temp.g('5c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000005', false, 500, NULL)),
    'goalkeepers', jsonb_build_array(
      jsonb_build_object('team_id', '5c000000-0000-0000-0000-000000000001', 'player_id', '7c000000-0000-0000-0000-000000000001', 'started_at_seconds', 0),
      jsonb_build_object('team_id', '5c000000-0000-0000-0000-000000000002', 'player_id', '7c000000-0000-0000-0000-000000000004', 'started_at_seconds', 0)))),
  'a complete correction is saved');
SELECT is((SELECT home_score || 'x' || away_score || ' ' || status FROM public.matches WHERE id = '9c000000-0000-0000-0000-000000000001'), '2x1 FINISHED', 'the own goal counts for the opponent');
SELECT is((SELECT string_agg(event_type || ':' || minute_seconds || ':' || is_own_goal, ',' ORDER BY minute_seconds, event_type) FROM public.match_events WHERE match_id = '9c000000-0000-0000-0000-000000000001'),
  'GOALKEEPER_IN:0:false,GOALKEEPER_IN:0:false,ASSIST:100:false,GOAL:100:false,GOAL:300:true,GOAL:500:false', 'events replaced once, nothing duplicated');
SELECT is((SELECT goals || '/' || assists || '/' || own_goals FROM public.player_competition_statistics WHERE player_id = '7c000000-0000-0000-0000-000000000005'), '1/0/1',
  'own goal counted apart: not a normal goal of its author');
SELECT is((SELECT goals || '/' || assists || '/' || own_goals FROM public.player_career_statistics WHERE player_id = '7c000000-0000-0000-0000-000000000003'), '0/1/0', 'career statistics follow');
SELECT is((SELECT count(*)::integer FROM public.goalkeeper_participations WHERE match_id = '9c000000-0000-0000-0000-000000000001' AND ended_at_seconds = 840), 2, 'goalkeepers added after the match are closed at the final whistle');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9c000000-0000-0000-0000-000000000001' AND source = 'MANUAL'
  AND jsonb_array_length(before->'events') = 3 AND jsonb_array_length(after->'events') = 6 AND actor = '1c000000-0000-0000-0000-000000000001'), 1, 'history keeps who, when, the reason and both states');

-- goals sent back with the metadata they already had (as the editor does)
SELECT lives_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', %L, %L, 'mantém metadados')$$,
  pg_temp.fp('9c000000-0000-0000-0000-000000000001'),
  jsonb_build_object('score', jsonb_build_object('home', 2, 'away', 1), 'goals', (
    SELECT jsonb_agg(jsonb_build_object('team_id', team_id, 'player_id', player_id, 'is_own_goal', is_own_goal, 'minute_seconds', minute_seconds, 'period', period, 'metadata', metadata))
    FROM public.match_events WHERE match_id = '9c000000-0000-0000-0000-000000000001' AND event_type = 'GOAL'))),
  'goals carrying their previous metadata are accepted');
SELECT is((SELECT count(*)::integer FROM public.match_events WHERE match_id = '9c000000-0000-0000-0000-000000000001' AND event_type = 'GOAL' AND metadata->>'previous_source' = 'EDIT'), 3, 'the previous origin of each goal is kept in its metadata');

-- a second correction changes the result: standings follow
SELECT lives_ok(format($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', %L, %L, 'gol anulado')$$,
  pg_temp.fp('9c000000-0000-0000-0000-000000000001'),
  jsonb_build_object('score', jsonb_build_object('home', 1, 'away', 1), 'goals', jsonb_build_array(
      pg_temp.g('5c000000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000002', false, 100, NULL),
      pg_temp.g('5c000000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000005', false, 500, NULL)))),
  'a correction of the score');
SELECT is((SELECT string_agg(points::text, ',' ORDER BY season_team_id) FROM public.stage_standings WHERE stage_id = '6c000000-0000-0000-0000-000000000001'), '1,1', 'standings updated to a draw');
SELECT is((SELECT count(*)::integer FROM public.match_events WHERE match_id = '9c000000-0000-0000-0000-000000000001' AND event_type = 'GOALKEEPER_IN'), 2, 'goalkeepers kept when not part of the correction');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9c000000-0000-0000-0000-000000000001'), 3, 'every correction is a new history entry');
SELECT throws_ok($$SELECT public.edit_match_sheet('9c000000-0000-0000-0000-000000000001', public.match_sheet_fingerprint('9c000000-0000-0000-0000-000000000001'), '{"goals":[{"team_id":"5c000000-0000-0000-0000-000000000001","player_id":"7c000000-0000-0000-0000-000000000002"},{"team_id":"5c000000-0000-0000-0000-000000000002","player_id":"7c000000-0000-0000-0000-000000000005"}],"score":{"home":1,"away":1},"report_patch":{"players":[]}}', 'stats')$$,
  '23514', NULL, 'replay statistics can only be corrected when the match has them');

-- replay sheets of finished matches: two-argument confirmation still refuses, reopening needs a validated sheet
SELECT throws_ok($$SELECT public.confirm_match_replay_review('9c000000-0000-0000-0000-000000000001', 'x')$$, 'P0002', NULL, 'no replay review: nothing to confirm');
SELECT throws_ok($$SELECT public.reopen_match_replay_review('9c000000-0000-0000-0000-000000000001', 'teste')$$, 'P0002', NULL, 'only a validated replay sheet can be reopened');

-- a finished match corrected from recordings: replacement only when asked, history kept
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('match-replays', '9c000000-0000-0000-0000-000000000001/' || repeat('d', 64) || '.hbr2');
  END IF;
END $$;
SELECT lives_ok($$SELECT public.register_match_replay('9c000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000001/' || repeat('d', 64) || '.hbr2', 'tempo1.hbr2', 100, repeat('d', 64), NULL)$$,
  'recordings can be sent for a finished match');
RESET ROLE;
UPDATE public.match_replays SET status = 'ANALYZED', analysis = '{}'::jsonb WHERE match_id = '9c000000-0000-0000-0000-000000000001';
UPDATE public.match_replay_reviews SET sheet = '{"canConfirm":true,"analyzer":"fbf-replay-1.0.0"}', report = '{"version":1}', sheet_hash = 'h-replace',
  official = jsonb_build_object('matchId', '9c000000-0000-0000-0000-000000000001', 'durationSeconds', 840, 'score', jsonb_build_object('home', 0, 'away', 2),
    'goals', jsonb_build_array(
      jsonb_build_object('minute_seconds', 50, 'team_id', '5c000000-0000-0000-0000-000000000002', 'player_id', '7c000000-0000-0000-0000-000000000005', 'is_own_goal', false, 'side', 'away', 'source', 'replay'),
      jsonb_build_object('minute_seconds', 70, 'team_id', '5c000000-0000-0000-0000-000000000001', 'player_id', '7c000000-0000-0000-0000-000000000003', 'is_own_goal', true, 'side', 'away', 'source', 'replay')),
    'goalkeepers', '[]'::jsonb, 'files', (SELECT jsonb_agg(id) FROM public.match_replays WHERE match_id = '9c000000-0000-0000-0000-000000000001'), 'aliases', '[]'::jsonb)
WHERE match_id = '9c000000-0000-0000-0000-000000000001' AND status = 'DRAFT';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$SELECT public.confirm_match_replay_review('9c000000-0000-0000-0000-000000000001', 'h-replace')$$, '23514', NULL, 'without asking for replacement a finished match is not overwritten');
SELECT lives_ok($$SELECT public.confirm_match_replay_review('9c000000-0000-0000-0000-000000000001', 'h-replace', true)$$, 'confirmation with replacement');
SELECT is((SELECT home_score || 'x' || away_score || ' ' || count(e.*) FILTER (WHERE e.event_type = 'GOAL') || ' ' || count(e.*) FILTER (WHERE e.event_type = 'GOALKEEPER_IN')
  FROM public.matches m LEFT JOIN public.match_events e ON e.match_id = m.id WHERE m.id = '9c000000-0000-0000-0000-000000000001' GROUP BY m.home_score, m.away_score),
  '0x2 2 0', 'goals and goalkeepers replaced by the recording, nothing duplicated');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9c000000-0000-0000-0000-000000000001' AND source = 'REPLAY' AND before->'match'->>'home_score' = '1'), 1, 'the replaced state is in the history');
SELECT lives_ok($$SELECT public.reopen_match_replay_review('9c000000-0000-0000-0000-000000000001', 'faltou o segundo tempo')$$, 'a validated replay sheet can be reopened');
SELECT is((SELECT string_agg(status, ',' ORDER BY status) FROM public.match_replay_reviews WHERE match_id = '9c000000-0000-0000-0000-000000000001'), 'DRAFT,SUPERSEDED', 'old sheet superseded, new draft open');

-- theme preference
SELECT lives_ok($$SELECT public.set_my_theme_preference('dark')$$, 'a user saves the dark theme');
SELECT is((SELECT theme_preference FROM public.profiles WHERE id = '1c000000-0000-0000-0000-000000000001'), 'dark', 'saved on the own profile');
SELECT throws_ok($$SELECT public.set_my_theme_preference('neon')$$, '22023', NULL, 'invalid theme refused');

RESET ROLE;
SELECT throws_ok($$DELETE FROM public.match_edit_history$$, '42501', NULL, 'the edit history cannot be deleted');

SELECT * FROM finish();
ROLLBACK;
