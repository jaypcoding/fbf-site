BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Match sheets from recordings (migration 20261122100000_match_replay_sheets.sql):
-- registration of files, server-only analysis columns, audited decisions,
-- confirmation that re-validates everything and writes the official result in
-- one transaction, duplicate prevention, permissions and public report.

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'replay-admin@example.invalid', '', now()),
  ('1b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'replay-user@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1b000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'USER' WHERE id = '1b000000-0000-0000-0000-000000000002';

INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('2b000000-0000-0000-0000-000000000001', 'Replay sheet test', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.seasons (id, competition_id, name) VALUES
  ('3b000000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-000000000001', 'Replay');
INSERT INTO public.teams (id, name) VALUES
  ('4b000000-0000-0000-0000-000000000001', 'Replay Home FC'),
  ('4b000000-0000-0000-0000-000000000002', 'Replay Away FC');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000001', '4b000000-0000-0000-0000-000000000001'),
  ('5b000000-0000-0000-0000-000000000002', '3b000000-0000-0000-0000-000000000001', '4b000000-0000-0000-0000-000000000002');
INSERT INTO public.players (id, nickname, position) VALUES
  ('7b000000-0000-0000-0000-000000000001', 'replay home gk', 'Goleiro'),
  ('7b000000-0000-0000-0000-000000000002', 'replay home a', 'Pivô'),
  ('7b000000-0000-0000-0000-000000000003', 'replay home b', 'Volante'),
  ('7b000000-0000-0000-0000-000000000004', 'replay away gk', 'Goleiro'),
  ('7b000000-0000-0000-0000-000000000005', 'replay away a', 'Pivô'),
  ('7b000000-0000-0000-0000-000000000006', 'replay outsider', 'Pivô');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('5b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000001'),
  ('5b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000002'),
  ('5b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000003'),
  ('5b000000-0000-0000-0000-000000000002', '7b000000-0000-0000-0000-000000000004'),
  ('5b000000-0000-0000-0000-000000000002', '7b000000-0000-0000-0000-000000000005');
INSERT INTO public.stages (id, season_id, name, format) VALUES
  ('6b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000001', 'Replay stage', 'Pontos corridos');
INSERT INTO public.rounds (id, stage_id, name, round_order, leg_number) VALUES
  ('8b000000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-000000000001', 'Rodada 1', 1, 1),
  ('8b000000-0000-0000-0000-000000000002', '6b000000-0000-0000-0000-000000000001', 'Rodada 2', 2, 2);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status) VALUES
  ('9b000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000002', 'SCHEDULED'),
  ('9b000000-0000-0000-0000-000000000002', '8b000000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-000000000001', 'SCHEDULED');
UPDATE public.competitions SET status = 'REGISTRATION' WHERE id = '2b000000-0000-0000-0000-000000000001';

-- stored objects (the Storage service is not part of the local test stack)
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.objects (bucket_id, name) VALUES
      ('match-replays', '9b000000-0000-0000-0000-000000000001/' || repeat('a', 64) || '.hbr2'),
      ('match-replays', '9b000000-0000-0000-0000-000000000001/' || repeat('b', 64) || '.hbr2'),
      ('match-replays', '9b000000-0000-0000-0000-000000000002/' || repeat('a', 64) || '.hbr2');
  END IF;
END $$;

CREATE FUNCTION pg_temp.official(p_files jsonb, p_goals jsonb, p_home integer, p_away integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'version', 1, 'matchId', '9b000000-0000-0000-0000-000000000001', 'durationSeconds', 840,
    'score', jsonb_build_object('home', p_home, 'away', p_away),
    'goals', p_goals,
    'goalkeepers', jsonb_build_array(
      jsonb_build_object('side', 'home', 'player_id', '7b000000-0000-0000-0000-000000000001', 'started_at_seconds', 0),
      jsonb_build_object('side', 'away', 'player_id', '7b000000-0000-0000-0000-000000000004', 'started_at_seconds', 0)),
    'files', p_files,
    'aliases', jsonb_build_array(jsonb_build_object('player_id', '7b000000-0000-0000-0000-000000000002', 'alias', 'HomeA tmv')))
$$;
CREATE FUNCTION pg_temp.goals_ok() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('minute_seconds', 100, 'team_id', '5b000000-0000-0000-0000-000000000001', 'player_id', '7b000000-0000-0000-0000-000000000002', 'is_own_goal', false, 'assist_player_id', '7b000000-0000-0000-0000-000000000003', 'side', 'home', 'source', 'replay'),
    jsonb_build_object('minute_seconds', 500, 'team_id', '5b000000-0000-0000-0000-000000000002', 'player_id', '7b000000-0000-0000-0000-000000000005', 'is_own_goal', false, 'assist_player_id', null, 'side', 'away', 'source', 'replay'),
    jsonb_build_object('minute_seconds', 700, 'team_id', '5b000000-0000-0000-0000-000000000002', 'player_id', null, 'is_own_goal', true, 'assist_player_id', null, 'side', 'home', 'source', 'replay'))
$$;
-- what the Edge Function (service role) writes after analysing and consolidating
CREATE FUNCTION pg_temp.server_sheet(p_official jsonb, p_can boolean, p_hash text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.match_replays SET status = 'ANALYZED', analysis = '{"schema":1}'::jsonb, analyzer_version = 'fbf-replay-1.0.0', analyzed_at = now()
  WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND status = 'PENDING';
  UPDATE public.match_replay_reviews
  SET sheet = jsonb_build_object('canConfirm', p_can, 'analyzer', 'fbf-replay-1.0.0'), official = p_official,
      report = '{"version":1,"teams":{}}'::jsonb, sheet_hash = p_hash, sheet_built_at = now()
  WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND status = 'DRAFT';
$$;
CREATE FUNCTION pg_temp.files() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(id) FROM public.match_replays WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND status <> 'REMOVED'
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SELECT plan(31);

-- permissions ---------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000002', true);
SELECT throws_ok(
  $$SELECT public.register_match_replay('9b000000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000001/' || repeat('a', 64) || '.hbr2', 'a.hbr2', 1000, repeat('a', 64), NULL)$$,
  '42501', NULL, 'a common user cannot send recordings');

SELECT set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$SELECT public.register_match_replay('9b000000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000001/' || repeat('a', 64) || '.hbr2', 'LENDAS-1.hbr2', 26365, repeat('a', 64), now())$$,
  'the admin registers the first recording');
SELECT is((SELECT status FROM public.match_replays WHERE sha256 = repeat('a', 64) AND match_id = '9b000000-0000-0000-0000-000000000001'), 'PENDING', 'the file waits for the server analysis');
SELECT is((SELECT count(*)::integer FROM public.match_replay_reviews WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND status = 'DRAFT'), 1, 'one draft sheet per match');
SELECT throws_ok(
  $$SELECT public.register_match_replay('9b000000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000001/' || repeat('a', 64) || '.hbr2', 'copy.hbr2', 26365, repeat('a', 64), NULL)$$,
  '23505', 'Este arquivo já foi enviado para esta partida', 'the same file cannot be sent twice to the same match');
SELECT throws_ok(
  $$SELECT public.register_match_replay('9b000000-0000-0000-0000-000000000001', 'outro/' || repeat('c', 64) || '.hbr2', 'x.hbr2', 10, repeat('c', 64), NULL)$$,
  '22023', NULL, 'the storage path must be <match>/<sha256>.hbr2');
SELECT lives_ok(
  $$SELECT public.register_match_replay('9b000000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000001/' || repeat('b', 64) || '.hbr2', 'LENDAS-2.hbr2', 30000, repeat('b', 64), NULL)$$,
  'a second file of the same match (second half) is accepted');
SELECT is(
  (SELECT (public.register_match_replay('9b000000-0000-0000-0000-000000000002', '9b000000-0000-0000-0000-000000000002/' || repeat('a', 64) || '.hbr2', 'LENDAS-1.hbr2', 26365, repeat('a', 64), NULL))->>'used_in_other_match'),
  'true', 'a file already sent for another match is flagged');

-- server-only columns
SELECT throws_ok(
  $$UPDATE public.match_replays SET status = 'ANALYZED', analysis = '{}' WHERE match_id = '9b000000-0000-0000-0000-000000000001'$$,
  '42501', NULL, 'the browser cannot write analyses');
SELECT throws_ok(
  $$UPDATE public.match_replay_reviews SET sheet_hash = 'x', official = '{}' WHERE match_id = '9b000000-0000-0000-0000-000000000001'$$,
  '42501', NULL, 'the browser cannot write the consolidated sheet');

-- confirmation guards ---------------------------------------------------------
RESET ROLE;
SELECT pg_temp.server_sheet(pg_temp.official(pg_temp.files(), pg_temp.goals_ok(), 2, 1), false, 'hash-1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$SELECT public.confirm_match_replay_review('9b000000-0000-0000-0000-000000000001', 'other')$$, '55000', NULL, 'a stale sheet (different hash) is refused');
SELECT throws_ok($$SELECT public.confirm_match_replay_review('9b000000-0000-0000-0000-000000000001', 'hash-1')$$, '23514', 'Resolva as pendências da súmula antes de confirmar', 'blocking issues prevent the confirmation');

SELECT lives_ok($$SELECT public.save_match_replay_decisions('9b000000-0000-0000-0000-000000000001', '{"players":{"homea tmv":"7b000000-0000-0000-0000-000000000002"}}')$$, 'decisions are saved');
SELECT ok((SELECT sheet_hash IS NULL FROM public.match_replay_reviews WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND status = 'DRAFT'), 'a decision invalidates the sheet until the server rebuilds it');
SELECT is((SELECT count(*)::integer FROM public.match_replay_audit WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND action = 'DECISIONS'), 1, 'manual decisions are audited');

RESET ROLE;
SELECT pg_temp.server_sheet(pg_temp.official(pg_temp.files(), pg_temp.goals_ok() || jsonb_build_array(
  jsonb_build_object('minute_seconds', 800, 'team_id', '5b000000-0000-0000-0000-000000000001', 'player_id', '7b000000-0000-0000-0000-000000000006', 'is_own_goal', false, 'assist_player_id', null, 'side', 'home', 'source', 'replay')), 3, 1), true, 'hash-2');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$SELECT public.confirm_match_replay_review('9b000000-0000-0000-0000-000000000001', 'hash-2')$$, '23514', 'Um autor de gol não pertence ao elenco da equipe', 'a player outside the rosters is refused at confirmation');
SELECT is((SELECT status FROM public.matches WHERE id = '9b000000-0000-0000-0000-000000000001'), 'SCHEDULED', 'a refused confirmation writes nothing');

RESET ROLE;
SELECT pg_temp.server_sheet(pg_temp.official('[]'::jsonb || (pg_temp.files() -> 0), pg_temp.goals_ok(), 2, 1), true, 'hash-3');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$SELECT public.confirm_match_replay_review('9b000000-0000-0000-0000-000000000001', 'hash-3')$$, '55000', NULL, 'a sheet that ignores one of the files is refused');

-- confirmation ------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.server_sheet(pg_temp.official(pg_temp.files(), pg_temp.goals_ok(), 2, 1), true, 'hash-4');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000001', true);
SELECT lives_ok($$SELECT public.confirm_match_replay_review('9b000000-0000-0000-0000-000000000001', 'hash-4')$$, 'a complete sheet is confirmed');
SELECT is(
  (SELECT status || ' ' || home_score || 'x' || away_score || ' ' || duration_seconds || ' ' || score_source FROM public.matches WHERE id = '9b000000-0000-0000-0000-000000000001'),
  'FINISHED 2x1 840 EVENTS', 'the match is finished with the score built from the goal events');
SELECT is(
  (SELECT string_agg(event_type || ':' || minute_seconds, ',' ORDER BY minute_seconds, event_type) FROM public.match_events WHERE match_id = '9b000000-0000-0000-0000-000000000001'),
  'GOALKEEPER_IN:0,GOALKEEPER_IN:0,ASSIST:100,GOAL:100,GOAL:500,GOAL:700', 'goals, the assist and both goalkeepers are recorded once');
SELECT is(
  (SELECT goals || '/' || assists FROM public.player_competition_statistics WHERE player_id = '7b000000-0000-0000-0000-000000000002'),
  '1/0', 'the scorer appears in the competition statistics');
SELECT is((SELECT count(*)::integer FROM public.goalkeeper_participations WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND ended_at_seconds IS NOT NULL), 2, 'goalkeeper participations are closed at the final whistle');
SELECT is((SELECT count(*)::integer FROM public.player_aliases WHERE player_id = '7b000000-0000-0000-0000-000000000002' AND alias_normalized = 'homea tmv'), 1, 'the manual association is saved as an alias');
SELECT is((SELECT status FROM public.match_replay_reviews WHERE match_id = '9b000000-0000-0000-0000-000000000001' AND confirmed_at IS NOT NULL), 'CONFIRMED', 'the review is closed');
SELECT throws_ok($$SELECT public.confirm_match_replay_review('9b000000-0000-0000-0000-000000000001', 'hash-4')$$, 'P0002', NULL, 'a validated match cannot be confirmed twice');
SELECT throws_ok(
  $$SELECT public.register_match_replay('9b000000-0000-0000-0000-000000000001', '9b000000-0000-0000-0000-000000000001/' || repeat('c', 64) || '.hbr2', 'late.hbr2', 10, repeat('c', 64), NULL)$$,
  '23514', NULL, 'no new file after validation');
SELECT throws_ok(
  $$SELECT public.remove_match_replay((SELECT id FROM public.match_replays WHERE match_id = '9b000000-0000-0000-0000-000000000001' LIMIT 1), 'x')$$,
  '23514', NULL, 'files of a validated match stay as evidence');

-- other match: removal and cancellation
SELECT lives_ok($$SELECT public.cancel_match_replay_review('9b000000-0000-0000-0000-000000000002', 'teste')$$, 'a draft analysis can be cancelled');

-- public report and private files
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::integer FROM public.match_replay_reports WHERE match_id = '9b000000-0000-0000-0000-000000000001'), 1, 'visitors read the statistics of the validated match');
SELECT throws_ok($$SELECT count(*) FROM public.match_replays$$, '42501', NULL, 'visitors cannot see the recording files');

SELECT * FROM finish();
ROLLBACK;
