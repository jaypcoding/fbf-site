BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(46);

-- ------------------------------------------------------------ fixtures
-- Users: admin, organizer of the competitions, visitor.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('1e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reset-admin@example.invalid', '', now()),
  ('1e000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reset-organizer@example.invalid', '', now()),
  ('1e000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reset-visitor@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = CASE id
  WHEN '1e000000-0000-0000-0000-000000000001'::uuid THEN 'ADMIN'
  WHEN '1e000000-0000-0000-0000-000000000002'::uuid THEN 'ORGANIZER'
  ELSE 'USER' END
WHERE id::text LIKE '1e000000-%';

INSERT INTO public.teams (id, name)
SELECT ('4e000000-0000-0000-0000-00000000000' || n)::uuid, 'Reset team ' || n FROM generate_series(1, 4) AS n;
INSERT INTO public.players (id, nickname, position) VALUES
  ('9e000000-0000-0000-0000-000000000001', 'reset scorer home', 'Pivô'),
  ('9e000000-0000-0000-0000-000000000002', 'reset scorer away', 'Pivô'),
  ('9e000000-0000-0000-0000-000000000003', 'reset aspirante', 'Volante'),
  ('9e000000-0000-0000-0000-000000000004', 'reset assist home', 'Volante'),
  ('9e000000-0000-0000-0000-000000000005', 'reset keeper home', 'Goleiro'),
  ('9e000000-0000-0000-0000-000000000006', 'reset keeper away', 'Goleiro'),
  ('9e000000-0000-0000-0000-000000000007', 'reset keeper home 2', 'Goleiro')
ON CONFLICT DO NOTHING;
INSERT INTO public.streamers (id, display_name, platform, channel)
VALUES ('ae000000-0000-0000-0000-000000000001', 'Reset streamer', 'TWITCH', 'reset');

-- 1 Oficial (FBF 20 PRINCIPAL replica)   2 Aspirantes (registration)
-- 3 Teste (archived, never played)       4 Fora (not selected)
-- 5 Ao vivo (a LIVE match)
INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('2e000000-0000-0000-0000-000000000001', 'Reset Oficial', 'Principal', 'Grupos + Mata-mata', 'DRAFT'),
  ('2e000000-0000-0000-0000-000000000002', 'Reset Aspirantes', 'Secundária', 'Pontos corridos', 'DRAFT'),
  ('2e000000-0000-0000-0000-000000000003', 'Reset Teste', 'Test', 'Pontos corridos', 'DRAFT'),
  ('2e000000-0000-0000-0000-000000000004', 'Reset Fora', 'Test', 'Pontos corridos', 'DRAFT'),
  ('2e000000-0000-0000-0000-000000000005', 'Reset Ao vivo', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id)
SELECT id, '1e000000-0000-0000-0000-000000000002' FROM public.competitions WHERE id::text LIKE '2e000000-%';
INSERT INTO public.seasons (id, competition_id, name)
SELECT ('3e000000-0000-0000-0000-00000000000' || n)::uuid, ('2e000000-0000-0000-0000-00000000000' || n)::uuid, 'Reset season ' || n
FROM generate_series(1, 5) AS n;
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000001', '4e000000-0000-0000-0000-000000000001'),
  ('5e000000-0000-0000-0000-000000000002', '3e000000-0000-0000-0000-000000000001', '4e000000-0000-0000-0000-000000000002'),
  ('5e000000-0000-0000-0000-000000000003', '3e000000-0000-0000-0000-000000000002', '4e000000-0000-0000-0000-000000000003'),
  ('5e000000-0000-0000-0000-000000000004', '3e000000-0000-0000-0000-000000000002', '4e000000-0000-0000-0000-000000000004'),
  ('5e000000-0000-0000-0000-000000000005', '3e000000-0000-0000-0000-000000000003', '4e000000-0000-0000-0000-000000000001'),
  ('5e000000-0000-0000-0000-000000000006', '3e000000-0000-0000-0000-000000000003', '4e000000-0000-0000-0000-000000000002'),
  ('5e000000-0000-0000-0000-000000000007', '3e000000-0000-0000-0000-000000000004', '4e000000-0000-0000-0000-000000000003'),
  ('5e000000-0000-0000-0000-000000000008', '3e000000-0000-0000-0000-000000000004', '4e000000-0000-0000-0000-000000000004'),
  ('5e000000-0000-0000-0000-000000000009', '3e000000-0000-0000-0000-000000000005', '4e000000-0000-0000-0000-000000000001'),
  ('5e000000-0000-0000-0000-000000000010', '3e000000-0000-0000-0000-000000000005', '4e000000-0000-0000-0000-000000000002');
INSERT INTO public.team_registrations (season_id, team_id, status)
SELECT season_id, team_id, 'APPROVED' FROM public.season_teams
WHERE season_id IN ('3e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000002', '3e000000-0000-0000-0000-000000000004');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001'),
  ('5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000004'),
  ('5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000005'),
  ('5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000007'),
  ('5e000000-0000-0000-0000-000000000002', '9e000000-0000-0000-0000-000000000002'),
  ('5e000000-0000-0000-0000-000000000002', '9e000000-0000-0000-0000-000000000006'),
  ('5e000000-0000-0000-0000-000000000003', '9e000000-0000-0000-0000-000000000003'),
  ('5e000000-0000-0000-0000-000000000007', '9e000000-0000-0000-0000-000000000003');

INSERT INTO public.stages (id, season_id, name, format, settings) VALUES
  ('6e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000001', 'Reset grupos', 'Grupos + Mata-mata', '{"group_count":1,"group_legs":1,"qualifiers_per_group":2}'),
  ('6e000000-0000-0000-0000-000000000003', '3e000000-0000-0000-0000-000000000003', 'Reset teste liga', 'Pontos corridos', '{"legs":1}'),
  ('6e000000-0000-0000-0000-000000000004', '3e000000-0000-0000-0000-000000000004', 'Reset fora liga', 'Pontos corridos', '{"legs":1}'),
  ('6e000000-0000-0000-0000-000000000005', '3e000000-0000-0000-0000-000000000005', 'Reset ao vivo liga', 'Pontos corridos', '{"legs":1}');
INSERT INTO public.stage_groups (id, stage_id, name, group_order)
VALUES ('7e000000-0000-0000-0000-000000000001', '6e000000-0000-0000-0000-000000000001', 'Grupo A', 1);
INSERT INTO public.stage_group_teams (stage_group_id, stage_id, season_team_id, seed_order)
SELECT '7e000000-0000-0000-0000-000000000001', '6e000000-0000-0000-0000-000000000001', id, row_number() OVER (ORDER BY id)
FROM public.season_teams WHERE season_id = '3e000000-0000-0000-0000-000000000001';
INSERT INTO public.rounds (id, stage_id, name, round_order) VALUES
  ('8e000000-0000-0000-0000-000000000001', '6e000000-0000-0000-0000-000000000001', 'Reset R1', 1),
  ('8e000000-0000-0000-0000-000000000003', '6e000000-0000-0000-0000-000000000003', 'Reset teste R1', 1),
  ('8e000000-0000-0000-0000-000000000004', '6e000000-0000-0000-0000-000000000004', 'Reset fora R1', 1),
  ('8e000000-0000-0000-0000-000000000005', '6e000000-0000-0000-0000-000000000005', 'Reset ao vivo R1', 1);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, duration_seconds) VALUES
  ('b8000000-0000-0000-0000-000000000001', '8e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000002', 600),
  ('b8000000-0000-0000-0000-000000000003', '8e000000-0000-0000-0000-000000000003', '5e000000-0000-0000-0000-000000000005', '5e000000-0000-0000-0000-000000000006', NULL),
  ('b8000000-0000-0000-0000-000000000004', '8e000000-0000-0000-0000-000000000004', '5e000000-0000-0000-0000-000000000007', '5e000000-0000-0000-0000-000000000008', NULL),
  ('b8000000-0000-0000-0000-000000000005', '8e000000-0000-0000-0000-000000000005', '5e000000-0000-0000-0000-000000000009', '5e000000-0000-0000-0000-000000000010', NULL);

-- Oficial: starters registered, then a real game with goals, an assist and a
-- goalkeeper change (event-controlled period), a streamer, finished 1 x 1.
INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id) VALUES
  ('b8000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000005'),
  ('b8000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000002', '9e000000-0000-0000-0000-000000000006');
UPDATE public.matches SET status = 'LIVE' WHERE id IN ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000005');
INSERT INTO public.match_events (id, match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('ce000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 60, '5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000001');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, goal_event_id)
VALUES ('b8000000-0000-0000-0000-000000000001', 'ASSIST', 'REGULATION', 60, '5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000004', 'ce000000-0000-0000-0000-000000000001');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('b8000000-0000-0000-0000-000000000001', 'GOALKEEPER_OUT', 'REGULATION', 200, '5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000005');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('b8000000-0000-0000-0000-000000000001', 'GOALKEEPER_IN', 'REGULATION', 201, '5e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000007');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
VALUES ('b8000000-0000-0000-0000-000000000001', 'GOAL', 'REGULATION', 300, '5e000000-0000-0000-0000-000000000002', '9e000000-0000-0000-0000-000000000002');
INSERT INTO public.match_streamers (match_id, streamer_id) VALUES ('b8000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000001');
UPDATE public.matches SET status = 'FINISHED' WHERE id = 'b8000000-0000-0000-0000-000000000001';
-- Teste: never played, cancelled.
UPDATE public.matches SET status = 'CANCELLED' WHERE id = 'b8000000-0000-0000-0000-000000000003';

UPDATE public.competitions SET status = 'REGISTRATION' WHERE id IN ('2e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000002', '2e000000-0000-0000-0000-000000000004');
UPDATE public.competitions SET status = 'ACTIVE' WHERE id IN ('2e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000004');
UPDATE public.competitions SET status = 'CANCELLED' WHERE id = '2e000000-0000-0000-0000-000000000003';

-- ------------------------------------------------------------- helpers
CREATE FUNCTION pg_temp.comp_hash(p uuid) RETURNS text LANGUAGE sql AS $$
  WITH s AS (SELECT id FROM public.seasons WHERE competition_id = p),
  st AS (SELECT id FROM public.stages WHERE season_id IN (SELECT id FROM s)),
  r AS (SELECT id FROM public.rounds WHERE stage_id IN (SELECT id FROM st)),
  m AS (SELECT id FROM public.matches WHERE round_id IN (SELECT id FROM r)),
  stm AS (SELECT id FROM public.season_teams WHERE season_id IN (SELECT id FROM s))
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.competitions x WHERE x.id = p),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.user_id) FROM public.competition_organizers x WHERE x.competition_id = p),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.seasons x WHERE x.id IN (SELECT id FROM s)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.season_teams x WHERE x.id IN (SELECT id FROM stm)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.team_registrations x WHERE x.season_id IN (SELECT id FROM s)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.rosters x WHERE x.season_team_id IN (SELECT id FROM stm)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.stages x WHERE x.id IN (SELECT id FROM st)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.stage_groups x WHERE x.stage_id IN (SELECT id FROM st)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.stage_group_teams x WHERE x.stage_id IN (SELECT id FROM st)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.rounds x WHERE x.id IN (SELECT id FROM r)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.matches x WHERE x.id IN (SELECT id FROM m)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.match_status_history x WHERE x.match_id IN (SELECT id FROM m)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.stage_id, x.leg_number, x.team_low_id, x.team_high_id) FROM public.round_robin_pair_claims x WHERE x.match_id IN (SELECT id FROM m) OR x.stage_id IN (SELECT id FROM st)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.match_events x WHERE x.match_id IN (SELECT id FROM m)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.goalkeeper_participations x WHERE x.match_id IN (SELECT id FROM m)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.match_id, x.streamer_id) FROM public.match_streamers x WHERE x.match_id IN (SELECT id FROM m))
  ));
$$;
-- Teams and players: ids and full content (names, logos, every column).
CREATE FUNCTION pg_temp.registry_hash() RETURNS text LANGUAGE sql AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.teams x),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.players x),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.streamers x),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.profiles x),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM auth.users)));
$$;
CREATE FUNCTION pg_temp.orphans() RETURNS bigint LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM public.seasons x WHERE NOT EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = x.competition_id))
       + (SELECT count(*) FROM public.season_teams x WHERE NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = x.season_id))
       + (SELECT count(*) FROM public.team_registrations x WHERE NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = x.season_id))
       + (SELECT count(*) FROM public.rosters x WHERE NOT EXISTS (SELECT 1 FROM public.season_teams s WHERE s.id = x.season_team_id))
       + (SELECT count(*) FROM public.stages x WHERE NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = x.season_id))
       + (SELECT count(*) FROM public.stage_groups x WHERE NOT EXISTS (SELECT 1 FROM public.stages s WHERE s.id = x.stage_id))
       + (SELECT count(*) FROM public.stage_group_teams x WHERE NOT EXISTS (SELECT 1 FROM public.stage_groups g WHERE g.id = x.stage_group_id))
       + (SELECT count(*) FROM public.rounds x WHERE NOT EXISTS (SELECT 1 FROM public.stages s WHERE s.id = x.stage_id))
       + (SELECT count(*) FROM public.matches x WHERE NOT EXISTS (SELECT 1 FROM public.rounds r WHERE r.id = x.round_id))
       + (SELECT count(*) FROM public.match_status_history x WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = x.match_id))
       + (SELECT count(*) FROM public.round_robin_pair_claims x WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = x.match_id))
       + (SELECT count(*) FROM public.match_events x WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = x.match_id))
       + (SELECT count(*) FROM public.goalkeeper_participations x WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = x.match_id))
       + (SELECT count(*) FROM public.match_streamers x WHERE NOT EXISTS (SELECT 1 FROM public.matches m WHERE m.id = x.match_id))
       + (SELECT count(*) FROM public.competition_organizers x WHERE NOT EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = x.competition_id));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.comp_hash(uuid), pg_temp.registry_hash(), pg_temp.orphans() TO authenticated;

CREATE TEMP TABLE t_state (k text PRIMARY KEY, v text);
GRANT ALL ON t_state TO authenticated;
INSERT INTO t_state
SELECT 'comp' || n, pg_temp.comp_hash(('2e000000-0000-0000-0000-00000000000' || n)::uuid) FROM generate_series(1, 5) AS n;
INSERT INTO t_state VALUES ('registry', pg_temp.registry_hash()),
  ('teams', (SELECT count(*)::text FROM public.teams)), ('players', (SELECT count(*)::text FROM public.players)),
  ('orphans', pg_temp.orphans()::text),
  ('history1', (SELECT count(*)::text FROM public.match_status_history WHERE match_id = 'b8000000-0000-0000-0000-000000000001')),
  ('history3', (SELECT count(*)::text FROM public.match_status_history WHERE match_id = 'b8000000-0000-0000-0000-000000000003')),
  ('claims', (SELECT count(*)::text FROM public.round_robin_pair_claims WHERE stage_id IN ('6e000000-0000-0000-0000-000000000001', '6e000000-0000-0000-0000-000000000003')));

SELECT is((SELECT count(*) FROM public.goalkeeper_participations WHERE match_id = 'b8000000-0000-0000-0000-000000000001'), 3::bigint,
  'fixture: two starters and one goalkeeper that came in by event');
SELECT is((SELECT home_score || 'x' || away_score FROM public.matches WHERE id = 'b8000000-0000-0000-0000-000000000001'), '1x1',
  'fixture: the official match was played and finished 1 x 1');

-- ------------------------------------------------------- permissions
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid]) $$, '42501', NULL,
  'visitors without login cannot preview a reset');
SELECT throws_ok($$ SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid], 'x', 'x') $$, '42501', NULL,
  'visitors without login cannot reset');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000003', true);
SELECT throws_ok($$ SELECT public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid]) $$, '42501', NULL,
  'a common user cannot preview a reset');
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$ SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000003'::uuid], 'RESETAR 1 COMPETIÇÕES', 'x') $$, '42501', NULL,
  'not even the organizer of the competition can reset it');
SELECT throws_ok($$ INSERT INTO public.reset_match_marks VALUES (txid_current(), 'b8000000-0000-0000-0000-000000000004') $$, '42501', NULL,
  'no API user can mark matches for the reset exception');
SELECT throws_ok($$ SELECT public.match_is_listed_for_reset('b8000000-0000-0000-0000-000000000004') $$, '42501', NULL,
  'nor call the internal check');
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT public._reset_plan(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid], true) $$, '42501', NULL,
  'the internal plan is not exposed, even to admins');
SELECT throws_ok($$ DELETE FROM public.matches WHERE id = 'b8000000-0000-0000-0000-000000000001' $$, '42501', NULL,
  'admins still cannot delete matches directly');
RESET ROLE;
SELECT is((SELECT has_function_privilege('authenticated', 'public.restore_deleted_records(uuid)', 'EXECUTE')), false,
  'restoring stays a database-owner procedure');

-- ------------------------------------------------- preview and blockers
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT public.reset_competitions_preview(ARRAY[]::uuid[]) $$, '22023', NULL, 'an empty selection is refused');
SELECT throws_ok($$ SELECT public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000003'::uuid, '2e000000-0000-0000-0000-000000000003'::uuid]) $$,
  '22023', NULL, 'a repeated competition is refused');
SELECT throws_ok($$ SELECT public.reset_competitions_preview(ARRAY[gen_random_uuid()]) $$, 'P0002', NULL, 'an unknown competition is refused');
SELECT is((public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000005'::uuid])->'blockers'->0->>'code'), 'MATCH_LIVE',
  'a competition with a live match is blocked');

CREATE TEMP TABLE t_preview AS
SELECT public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000003'::uuid,
  '2e000000-0000-0000-0000-000000000001'::uuid, '2e000000-0000-0000-0000-000000000002'::uuid]) AS p;
SELECT is((SELECT (p->>'can_reset')::boolean FROM t_preview), true,
  'Oficial (active, played), Aspirantes (registration) and Teste (archived) can be reset together');
SELECT is((SELECT p->>'confirmation' FROM t_preview), 'RESETAR 3 COMPETIÇÕES', 'the confirmation text names how many competitions');
SELECT is((SELECT p->'competitions'->0 ? 'ids' FROM t_preview), false, 'the preview does not expose internal id lists');
SELECT results_eq(
  $$ SELECT (p->'totals'->>'competitions')::int, (p->'totals'->>'seasons')::int, (p->'totals'->>'season_teams')::int,
            (p->'totals'->>'team_registrations')::int, (p->'totals'->>'rosters')::int, (p->'totals'->>'stage_groups')::int,
            (p->'totals'->>'stage_group_teams')::int, (p->'totals'->>'rounds')::int, (p->'totals'->>'matches')::int,
            (p->'totals'->>'match_events')::int, (p->'totals'->>'goalkeeper_participations')::int, (p->'totals'->>'match_streamers')::int,
            (p->'totals'->>'competition_organizers')::int
     FROM t_preview $$,
  $$ VALUES (3, 3, 6, 4, 7, 1, 2, 2, 2, 5, 3, 1, 3) $$,
  'the preview counts every dependent row of the three competitions');
SELECT is((SELECT (p->'totals'->>'match_status_history') FROM t_preview),
  ((SELECT v::int FROM t_state WHERE k = 'history1') + (SELECT v::int FROM t_state WHERE k = 'history3'))::text,
  'and the status history of both matches');
SELECT is((SELECT (p->'preserved'->>'teams') FROM t_preview), (SELECT v FROM t_state WHERE k = 'teams'), 'it reports the teams that are kept');

-- -------------------------------------------- refusals keep everything
SELECT throws_ok(format($$ SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000003'::uuid,
  '2e000000-0000-0000-0000-000000000001'::uuid, '2e000000-0000-0000-0000-000000000002'::uuid], 'RESETAR', %L) $$,
  (SELECT p->>'fingerprint' FROM t_preview)), '22023', NULL, 'a wrong confirmation is refused');
SELECT throws_ok($$ SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000003'::uuid,
  '2e000000-0000-0000-0000-000000000001'::uuid, '2e000000-0000-0000-0000-000000000002'::uuid], 'RESETAR 3 COMPETIÇÕES', 'stale') $$,
  '22023', NULL, 'a stale fingerprint is refused');
SELECT throws_ok($$ SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid, '2e000000-0000-0000-0000-000000000005'::uuid],
  'RESETAR 2 COMPETIÇÕES', (public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid, '2e000000-0000-0000-0000-000000000005'::uuid])->>'fingerprint')) $$,
  '55000', NULL, 'a selection with a live match is refused as a whole');
RESET ROLE;

-- Failure in the middle of the operation (after events, goalkeepers and
-- matches were already removed): nothing may be left half deleted.
CREATE FUNCTION pg_temp.fail_on_roster_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'falha simulada' USING ERRCODE = 'XX001'; END; $$;
CREATE TRIGGER t_fail_roster BEFORE DELETE ON public.rosters FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_on_roster_delete();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
SELECT throws_ok(format($$ SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000003'::uuid,
  '2e000000-0000-0000-0000-000000000001'::uuid, '2e000000-0000-0000-0000-000000000002'::uuid], 'RESETAR 3 COMPETIÇÕES', %L) $$,
  (SELECT p->>'fingerprint' FROM t_preview)), 'XX001', NULL, 'a failure in the middle aborts the reset');
RESET ROLE;
DROP TRIGGER t_fail_roster ON public.rosters;
SELECT is(pg_temp.comp_hash('2e000000-0000-0000-0000-000000000001'), (SELECT v FROM t_state WHERE k = 'comp1'),
  'after the failure the official competition is intact (match, events, goalkeepers, streamer)');
SELECT is((SELECT count(*) FROM public.deletion_log WHERE competition_id::text LIKE '2e000000-%'), 0::bigint,
  'and no log entry was kept');
SELECT is((SELECT count(*) FROM public.reset_match_marks), 0::bigint, 'and no reset mark was left behind');

-- ------------------------------------------------------------ the reset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
CREATE TEMP TABLE t_result AS
SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000003'::uuid,
  '2e000000-0000-0000-0000-000000000001'::uuid, '2e000000-0000-0000-0000-000000000002'::uuid],
  'RESETAR 3 COMPETIÇÕES', (SELECT p->>'fingerprint' FROM t_preview)) AS r;
RESET ROLE;

SELECT is((SELECT count(*) FROM public.competitions WHERE id IN ('2e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000002', '2e000000-0000-0000-0000-000000000003')),
  0::bigint, 'the three selected competitions are gone');
SELECT results_eq($$
  SELECT (SELECT count(*) FROM public.seasons WHERE competition_id IN ('2e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000002', '2e000000-0000-0000-0000-000000000003'))::int,
         (SELECT count(*) FROM public.season_teams WHERE id IN ('5e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000003', '5e000000-0000-0000-0000-000000000004', '5e000000-0000-0000-0000-000000000005', '5e000000-0000-0000-0000-000000000006'))::int,
         (SELECT count(*) FROM public.matches WHERE id IN ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000003'))::int,
         (SELECT count(*) FROM public.match_events WHERE match_id = 'b8000000-0000-0000-0000-000000000001')::int,
         (SELECT count(*) FROM public.goalkeeper_participations WHERE match_id = 'b8000000-0000-0000-0000-000000000001')::int,
         (SELECT count(*) FROM public.match_streamers WHERE match_id = 'b8000000-0000-0000-0000-000000000001')::int,
         (SELECT count(*) FROM public.match_status_history WHERE match_id IN ('b8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000003'))::int,
         (SELECT count(*) FROM public.stage_groups WHERE id = '7e000000-0000-0000-0000-000000000001')::int $$,
  $$ VALUES (0, 0, 0, 0, 0, 0, 0, 0) $$,
  'seasons, team links, matches, goals, assists, goalkeepers, streamers, history and groups are gone');
SELECT is(pg_temp.registry_hash(), (SELECT v FROM t_state WHERE k = 'registry'),
  'teams, players, streamers, profiles and accounts are identical (ids and content)');
SELECT is((SELECT count(*)::text FROM public.teams) || '/' || (SELECT count(*)::text FROM public.players),
  (SELECT v FROM t_state WHERE k = 'teams') || '/' || (SELECT v FROM t_state WHERE k = 'players'), 'same number of teams and players');
SELECT is(pg_temp.comp_hash('2e000000-0000-0000-0000-000000000004'), (SELECT v FROM t_state WHERE k = 'comp4'),
  'a competition that was not selected is untouched');
SELECT is(pg_temp.comp_hash('2e000000-0000-0000-0000-000000000005'), (SELECT v FROM t_state WHERE k = 'comp5'),
  'nor the one with the live match');
SELECT is(pg_temp.orphans()::text, (SELECT v FROM t_state WHERE k = 'orphans'), 'no orphan rows were created');
SELECT is((SELECT count(*) FROM public.deletion_log WHERE reset_batch_id = (SELECT (r->>'reset_batch_id')::uuid FROM t_result)), 3::bigint,
  'one log entry per competition, all in the same reset batch');
SELECT is((SELECT deleted_by FROM public.deletion_log WHERE record_id = '2e000000-0000-0000-0000-000000000001'),
  '1e000000-0000-0000-0000-000000000001'::uuid, 'the log records the admin who ran the reset');
SELECT is((SELECT jsonb_array_length(snapshot->'match_events') || '/' || jsonb_array_length(snapshot->'goalkeeper_participations')
  FROM public.deletion_log WHERE record_id = '2e000000-0000-0000-0000-000000000001'), '5/3',
  'the log keeps a copy of the events and goalkeeper periods');
SELECT is((SELECT r->'preserved'->>'teams_hash' FROM t_result), (SELECT p->'preserved'->>'teams_hash' FROM t_preview),
  'the result confirms the teams hash did not change');
SELECT is((SELECT count(*) FROM public.reset_match_marks), 0::bigint, 'the reset marks are cleaned up');

-- The protections are back to normal right after the reset.
SELECT throws_ok($$ DELETE FROM public.matches WHERE id = 'b8000000-0000-0000-0000-000000000004' $$, '55000', NULL,
  'outside the reset, a match still cannot be deleted (even by the owner)');

-- The same names can be registered again (new PRINCIPAL / ASPIRANTES).
SELECT lives_ok($$ INSERT INTO public.competitions (name, category, format, status) VALUES ('Reset Oficial', 'Principal', 'Grupos + Mata-mata', 'DRAFT') $$,
  'a new competition can be created after the reset');
DELETE FROM public.competitions WHERE name = 'Reset Oficial' AND status = 'DRAFT';

-- ------------------------------------------------------------- restore
SELECT lives_ok($$ SELECT public.restore_deleted_records(id) FROM public.deletion_log
  WHERE reset_batch_id = (SELECT (r->>'reset_batch_id')::uuid FROM t_result) $$, 'the owner restores the whole batch');
SELECT is(pg_temp.comp_hash('2e000000-0000-0000-0000-000000000001'), (SELECT v FROM t_state WHERE k = 'comp1'),
  'the official competition comes back identical: match, score, goals, assist, goalkeepers, streamer, history');
SELECT is(pg_temp.comp_hash('2e000000-0000-0000-0000-000000000002') || pg_temp.comp_hash('2e000000-0000-0000-0000-000000000003'),
  (SELECT v FROM t_state WHERE k = 'comp2') || (SELECT v FROM t_state WHERE k = 'comp3'), 'Aspirantes and Teste come back identical');
SELECT is(pg_temp.registry_hash(), (SELECT v FROM t_state WHERE k = 'registry'), 'teams and players are still identical after the restore');

SELECT * FROM finish();
ROLLBACK;
