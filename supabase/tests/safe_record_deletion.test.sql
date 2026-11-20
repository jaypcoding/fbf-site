BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(60);

-- ------------------------------------------------------------ fixtures
-- Users: admin, the competitions' organizer, an organizer of nothing here, a visitor.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('19000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'del-admin@example.invalid', '', now()),
  ('19000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'del-organizer@example.invalid', '', now()),
  ('19000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'del-outsider@example.invalid', '', now()),
  ('19000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'del-visitor@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = CASE id
  WHEN '19000000-0000-0000-0000-000000000001'::uuid THEN 'ADMIN'
  WHEN '19000000-0000-0000-0000-000000000002'::uuid THEN 'ORGANIZER'
  WHEN '19000000-0000-0000-0000-000000000003'::uuid THEN 'ORGANIZER'
  ELSE 'USER' END
WHERE id IN ('19000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000002',
             '19000000-0000-0000-0000-000000000003', '19000000-0000-0000-0000-000000000004');

-- Global records that must never be touched.
INSERT INTO public.teams (id, name)
SELECT ('49000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Deletion team ' || n FROM generate_series(1, 8) AS n;
INSERT INTO public.players (id, nickname, position)
VALUES ('99000000-0000-0000-0000-000000000001', 'Del player 1', 'Pivô'), ('99000000-0000-0000-0000-000000000002', 'Del player 2', 'Volante');
INSERT INTO public.streamers (id, display_name, platform, channel)
VALUES ('a9000000-0000-0000-0000-000000000001', 'Del streamer', 'TWITCH', 'del');

-- T: complete test competition (archived): groups, never-played matches,
-- status history, pair claims, registrations, rosters, organizer.
-- F: official replica of the FBF 20 (active, groups, finished match with event).
-- H: archived competition with game history (a match that went LIVE) and a streamer.
-- E: empty draft competition. P: published (registration) competition.
INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('29000000-0000-0000-0000-000000000001', 'Teste completo', 'Test', 'Grupos + Mata-mata', 'DRAFT'),
  ('29000000-0000-0000-0000-000000000002', 'Oficial', 'Test', 'Grupos + Mata-mata', 'DRAFT'),
  ('29000000-0000-0000-0000-000000000003', 'Historico', 'Test', 'Pontos corridos', 'DRAFT'),
  ('29000000-0000-0000-0000-000000000004', 'Vazia', 'Test', 'Pontos corridos', 'DRAFT'),
  ('29000000-0000-0000-0000-000000000005', 'Publicada', 'Test', 'Grupos + Mata-mata', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id)
SELECT id, '19000000-0000-0000-0000-000000000002' FROM public.competitions WHERE id::text LIKE '29000000-%';
INSERT INTO public.seasons (id, competition_id, name) VALUES
  ('39000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', 'T season'),
  ('39000000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000002', 'F season'),
  ('39000000-0000-0000-0000-000000000003', '29000000-0000-0000-0000-000000000003', 'H season'),
  ('39000000-0000-0000-0000-000000000004', '29000000-0000-0000-0000-000000000004', 'E empty season'),
  ('39000000-0000-0000-0000-000000000005', '29000000-0000-0000-0000-000000000004', 'E season with stage'),
  ('39000000-0000-0000-0000-000000000006', '29000000-0000-0000-0000-000000000005', 'P season');
-- T and F share the same four teams (like the test season and the FBF 20).
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('59000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000001'),
  ('59000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000002'),
  ('59000000-0000-0000-0000-000000000003', '39000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000003'),
  ('59000000-0000-0000-0000-000000000004', '39000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000004'),
  ('59000000-0000-0000-0000-000000000005', '39000000-0000-0000-0000-000000000002', '49000000-0000-0000-0000-000000000001'),
  ('59000000-0000-0000-0000-000000000006', '39000000-0000-0000-0000-000000000002', '49000000-0000-0000-0000-000000000002'),
  ('59000000-0000-0000-0000-000000000007', '39000000-0000-0000-0000-000000000002', '49000000-0000-0000-0000-000000000003'),
  ('59000000-0000-0000-0000-000000000008', '39000000-0000-0000-0000-000000000002', '49000000-0000-0000-0000-000000000004'),
  ('59000000-0000-0000-0000-000000000009', '39000000-0000-0000-0000-000000000003', '49000000-0000-0000-0000-000000000005'),
  ('59000000-0000-0000-0000-000000000010', '39000000-0000-0000-0000-000000000003', '49000000-0000-0000-0000-000000000006'),
  ('59000000-0000-0000-0000-000000000011', '39000000-0000-0000-0000-000000000003', '49000000-0000-0000-0000-000000000007'),
  ('59000000-0000-0000-0000-000000000012', '39000000-0000-0000-0000-000000000003', '49000000-0000-0000-0000-000000000008');
INSERT INTO public.team_registrations (season_id, team_id, status)
SELECT season_id, team_id, 'APPROVED' FROM public.season_teams WHERE season_id IN ('39000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000002');
INSERT INTO public.team_registrations (season_id, team_id, status)
VALUES ('39000000-0000-0000-0000-000000000006', '49000000-0000-0000-0000-000000000007', 'PENDING');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('59000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001'),
  ('59000000-0000-0000-0000-000000000002', '99000000-0000-0000-0000-000000000002'),
  ('59000000-0000-0000-0000-000000000005', '99000000-0000-0000-0000-000000000001');

INSERT INTO public.stages (id, season_id, name, format, settings) VALUES
  ('69000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', 'T groups', 'Grupos + Mata-mata', '{"group_count":1,"group_legs":1,"qualifiers_per_group":2}'),
  ('69000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000001', 'T empty stage', 'Grupos + Mata-mata', '{"group_count":1,"group_legs":1,"qualifiers_per_group":2}'),
  ('69000000-0000-0000-0000-000000000003', '39000000-0000-0000-0000-000000000002', 'F groups', 'Grupos + Mata-mata', '{"group_count":1,"group_legs":1,"qualifiers_per_group":2}'),
  ('69000000-0000-0000-0000-000000000004', '39000000-0000-0000-0000-000000000003', 'H league', 'Pontos corridos', '{"legs":1}'),
  ('69000000-0000-0000-0000-000000000005', '39000000-0000-0000-0000-000000000005', 'E stage', 'Pontos corridos', '{"legs":1}'),
  ('69000000-0000-0000-0000-000000000006', '39000000-0000-0000-0000-000000000006', 'P stage without groups', 'Grupos + Mata-mata', '{"group_count":1,"group_legs":1,"qualifiers_per_group":2}'),
  ('69000000-0000-0000-0000-000000000007', '39000000-0000-0000-0000-000000000006', 'P stage with groups', 'Grupos + Mata-mata', '{"group_count":1,"group_legs":1,"qualifiers_per_group":2}');
-- Groups first (they cannot change once rounds exist).
INSERT INTO public.stage_groups (id, stage_id, name, group_order) VALUES
  ('79000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'Grupo A', 1),
  ('79000000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000003', 'Grupo A', 1),
  ('79000000-0000-0000-0000-000000000003', '69000000-0000-0000-0000-000000000007', 'Grupo A', 1);
INSERT INTO public.stage_group_teams (stage_group_id, stage_id, season_team_id, seed_order)
SELECT '79000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', id, row_number() OVER (ORDER BY id)
FROM public.season_teams WHERE season_id = '39000000-0000-0000-0000-000000000001';
INSERT INTO public.stage_group_teams (stage_group_id, stage_id, season_team_id, seed_order)
SELECT '79000000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000003', id, row_number() OVER (ORDER BY id)
FROM public.season_teams WHERE season_id = '39000000-0000-0000-0000-000000000002';
INSERT INTO public.rounds (id, stage_id, name, round_order) VALUES
  ('89000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'T R1', 1),
  ('89000000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000001', 'T R2', 2),
  ('89000000-0000-0000-0000-000000000003', '69000000-0000-0000-0000-000000000002', 'T empty round', 1),
  ('89000000-0000-0000-0000-000000000004', '69000000-0000-0000-0000-000000000003', 'F R1', 1),
  ('89000000-0000-0000-0000-000000000005', '69000000-0000-0000-0000-000000000003', 'F R2', 2),
  ('89000000-0000-0000-0000-000000000006', '69000000-0000-0000-0000-000000000003', 'F R3', 3),
  ('89000000-0000-0000-0000-000000000007', '69000000-0000-0000-0000-000000000004', 'H R1', 1),
  ('89000000-0000-0000-0000-000000000009', '69000000-0000-0000-0000-000000000005', 'E round', 1),
  ('89000000-0000-0000-0000-000000000010', '69000000-0000-0000-0000-000000000006', 'P R1', 1),
  ('89000000-0000-0000-0000-000000000011', '69000000-0000-0000-0000-000000000006', 'P R2', 2),
  ('89000000-0000-0000-0000-000000000012', '69000000-0000-0000-0000-000000000007', 'P grouped round', 1);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id) VALUES
  ('a8000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000002'),
  ('a8000000-0000-0000-0000-000000000002', '89000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000003', '59000000-0000-0000-0000-000000000004'),
  ('a8000000-0000-0000-0000-000000000003', '89000000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000003'),
  ('a8000000-0000-0000-0000-000000000004', '89000000-0000-0000-0000-000000000004', '59000000-0000-0000-0000-000000000005', '59000000-0000-0000-0000-000000000006'),
  ('a8000000-0000-0000-0000-000000000005', '89000000-0000-0000-0000-000000000007', '59000000-0000-0000-0000-000000000009', '59000000-0000-0000-0000-000000000010'),
  ('a8000000-0000-0000-0000-000000000006', '89000000-0000-0000-0000-000000000007', '59000000-0000-0000-0000-000000000011', '59000000-0000-0000-0000-000000000012');
-- T: one cancelled, one postponed, never played.
UPDATE public.matches SET status = 'CANCELLED' WHERE id = 'a8000000-0000-0000-0000-000000000002';
UPDATE public.matches SET status = 'POSTPONED' WHERE id = 'a8000000-0000-0000-0000-000000000003';
-- F: finished with a goal.
UPDATE public.matches SET status = 'LIVE' WHERE id = 'a8000000-0000-0000-0000-000000000004';
INSERT INTO public.match_events (match_id, event_type, minute_seconds, team_id, player_id)
VALUES ('a8000000-0000-0000-0000-000000000004', 'GOAL', 60, '59000000-0000-0000-0000-000000000005', '99000000-0000-0000-0000-000000000001');
UPDATE public.matches SET status = 'FINISHED' WHERE id = 'a8000000-0000-0000-0000-000000000004';
-- H: went LIVE and was postponed (no score); another match has a streamer.
UPDATE public.matches SET status = 'LIVE' WHERE id = 'a8000000-0000-0000-0000-000000000005';
UPDATE public.matches SET status = 'POSTPONED' WHERE id = 'a8000000-0000-0000-0000-000000000005';
INSERT INTO public.match_streamers (match_id, streamer_id) VALUES ('a8000000-0000-0000-0000-000000000006', 'a9000000-0000-0000-0000-000000000001');

UPDATE public.competitions SET status = 'CANCELLED' WHERE id IN ('29000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000003');
UPDATE public.competitions SET status = 'REGISTRATION' WHERE id IN ('29000000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000005');
UPDATE public.competitions SET status = 'ACTIVE' WHERE id = '29000000-0000-0000-0000-000000000002';

-- ------------------------------------------------------------- helpers
-- Hash of every row that belongs to a competition (all dependent tables).
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
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.stage_id, x.leg_number, x.team_low_id, x.team_high_id) FROM public.round_robin_pair_claims x WHERE x.match_id IN (SELECT id FROM m)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.match_events x WHERE x.match_id IN (SELECT id FROM m)),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.match_id) FROM public.match_streamers x WHERE x.match_id IN (SELECT id FROM m))
  ));
$$;
CREATE FUNCTION pg_temp.global_hash() RETURNS text LANGUAGE sql AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.teams x),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.players x),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.profiles x),
    (SELECT string_agg(to_jsonb(x)::text, ',' ORDER BY x.id) FROM public.streamers x),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM auth.users)));
$$;
-- Rows anywhere whose parent no longer exists.
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
       + (SELECT count(*) FROM public.competition_organizers x WHERE NOT EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = x.competition_id));
$$;
GRANT EXECUTE ON FUNCTION pg_temp.comp_hash(uuid), pg_temp.global_hash(), pg_temp.orphans() TO authenticated;

CREATE TEMP TABLE t_state (k text PRIMARY KEY, v text);
GRANT ALL ON t_state TO authenticated;
INSERT INTO t_state VALUES ('global', pg_temp.global_hash()), ('F', pg_temp.comp_hash('29000000-0000-0000-0000-000000000002'));

-- --------------------------------------------------------- permissions
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT public.deletion_preview('ROUND', '89000000-0000-0000-0000-000000000009') $$, '42501', NULL,
  'anon cannot call the preview');
SELECT throws_ok($$ SELECT public.delete_competition_record('ROUND', '89000000-0000-0000-0000-000000000009', 'E round', 'x') $$, '42501', NULL,
  'anon cannot call the deletion');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.deletion_preview('ROUND', '89000000-0000-0000-0000-000000000009') $$, '42501',
  'Sem permissão para excluir registros desta competição', 'a visitor gets no preview');
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000003', true);
SELECT throws_ok($$ SELECT public.deletion_preview('SEASON', '39000000-0000-0000-0000-000000000004') $$, '42501',
  'Sem permissão para excluir registros desta competição', 'an organizer of another competition gets no preview');
SELECT throws_ok($$ SELECT public.delete_competition_record('SEASON', '39000000-0000-0000-0000-000000000004', 'E empty season', 'x') $$, '42501',
  'Sem permissão para excluir registros desta competição', 'an organizer of another competition cannot delete');
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$ SELECT public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000004') $$, '42501',
  'Somente administradores podem excluir competições', 'the organizer cannot preview a competition deletion');
SELECT throws_ok($$ SELECT public.delete_competition_record('COMPETITION', '29000000-0000-0000-0000-000000000004', 'Vazia', 'x') $$, '42501',
  'Somente administradores podem excluir competições', 'the organizer cannot delete a competition');
SELECT throws_ok($$ DELETE FROM public.rounds WHERE id = '89000000-0000-0000-0000-000000000009' $$, '42501', NULL,
  'direct DELETE on rounds is no longer allowed (organizer)');
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ DELETE FROM public.seasons WHERE id = '39000000-0000-0000-0000-000000000004' $$, '42501', NULL,
  'direct DELETE on seasons is no longer allowed (admin)');
SELECT throws_ok($$ DELETE FROM public.competitions WHERE id = '29000000-0000-0000-0000-000000000004' $$, '42501', NULL,
  'direct DELETE on competitions is no longer allowed (admin)');
SELECT throws_ok($$ DELETE FROM public.stages WHERE id = '69000000-0000-0000-0000-000000000005' $$, '42501', NULL,
  'direct DELETE on stages is no longer allowed (admin)');
SELECT set_config('fbf.purge_match_ids', 'a8000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ DELETE FROM public.matches WHERE id = 'a8000000-0000-0000-0000-000000000001' $$, '42501', NULL,
  'a forged purge list does not let an admin delete matches directly');
SELECT set_config('fbf.purge_match_ids', '', true);
SELECT throws_ok($$ SELECT public.restore_deleted_records(gen_random_uuid()) $$, '42501', NULL,
  'the restore procedure is not available to API users');
SELECT throws_ok($$ SELECT public._deletion_plan('ROUND', '89000000-0000-0000-0000-000000000009', true) $$, '42501', NULL,
  'the internal plan function is not exposed');
SELECT throws_ok($$ SELECT public.deletion_preview('ROUND', gen_random_uuid()) $$, 'P0002', 'Registro não encontrado', 'unknown record');
SELECT throws_ok($$ SELECT public.deletion_preview('TEAM', '49000000-0000-0000-0000-000000000001') $$, '22023', NULL,
  'teams (or any other kind) cannot be deleted through this function');
RESET ROLE;

-- ------------------------------------------- empty records (organizer)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
SELECT is(public.deletion_preview('SEASON', '39000000-0000-0000-0000-000000000004')->'counts',
  '{"competitions":0,"competition_organizers":0,"seasons":1,"season_teams":0,"team_registrations":0,"rosters":0,"stages":0,"stage_groups":0,"stage_group_teams":0,"rounds":0,"matches":0,"match_status_history":0,"round_robin_pair_claims":0}'::jsonb,
  'the preview of an empty season lists only the season');
SELECT is((public.delete_competition_record('SEASON', '39000000-0000-0000-0000-000000000004', 'E empty season',
  public.deletion_preview('SEASON', '39000000-0000-0000-0000-000000000004')->>'fingerprint'))->'counts'->>'seasons', '1',
  'the organizer deletes an empty season');
SELECT is((public.delete_competition_record('ROUND', '89000000-0000-0000-0000-000000000009', 'E round',
  public.deletion_preview('ROUND', '89000000-0000-0000-0000-000000000009')->>'fingerprint'))->'counts'->>'rounds', '1',
  'the organizer deletes an empty round of a stage without groups or matches');
SELECT is((public.delete_competition_record('STAGE', '69000000-0000-0000-0000-000000000005', 'E stage',
  public.deletion_preview('STAGE', '69000000-0000-0000-0000-000000000005')->>'fingerprint'))->'counts'->>'stages', '1',
  'the organizer deletes an empty stage');
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
SELECT is((public.delete_competition_record('COMPETITION', '29000000-0000-0000-0000-000000000004', 'Vazia',
  public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000004')->>'fingerprint'))->'counts',
  '{"competitions":1,"competition_organizers":1,"seasons":1,"season_teams":0,"team_registrations":0,"rosters":0,"stages":0,"stage_groups":0,"stage_group_teams":0,"rounds":0,"matches":0,"match_status_history":0,"round_robin_pair_claims":0}'::jsonb,
  'the admin deletes an empty draft competition (with its empty season and organizer link)');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.competitions WHERE id = '29000000-0000-0000-0000-000000000004'), 0::bigint,
  'the empty competition and its records are gone');

-- -------------------------------- complete test competition (admin)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
INSERT INTO t_state SELECT 'T_preview', public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000001')::text;
SELECT is((SELECT v::jsonb->'counts' FROM t_state WHERE k = 'T_preview'),
  '{"competitions":1,"competition_organizers":1,"seasons":1,"season_teams":4,"team_registrations":4,"rosters":2,"stages":2,"stage_groups":1,"stage_group_teams":4,"rounds":3,"matches":3,"match_status_history":5,"round_robin_pair_claims":3}'::jsonb,
  'the preview lists exactly every row of the test competition');
SELECT ok((SELECT (v::jsonb->>'can_delete')::boolean AND jsonb_array_length(v::jsonb->'blockers') = 0 FROM t_state WHERE k = 'T_preview'),
  'an archived competition with never-played matches can be deleted');
SELECT ok((SELECT v::jsonb->'warnings' ? '3 partida(s) nunca disputada(s) serão removidas definitivamente, com seu histórico de status e reservas de confronto'
  FROM t_state WHERE k = 'T_preview'), 'the preview warns that never-played matches will be removed');
SELECT throws_ok(format($$ SELECT public.delete_competition_record('COMPETITION', '29000000-0000-0000-0000-000000000001', 'teste completo', %L) $$,
  (SELECT v::jsonb->>'fingerprint' FROM t_state WHERE k = 'T_preview')), '22023', 'A confirmação não corresponde ao nome do registro',
  'the typed name must match exactly');
-- Someone adds a round after the preview: the preview is now stale.
INSERT INTO public.rounds (id, stage_id, name, round_order)
VALUES ('89000000-0000-0000-0000-000000000099', '69000000-0000-0000-0000-000000000002', 'Late round', 2);
SELECT throws_ok(format($$ SELECT public.delete_competition_record('COMPETITION', '29000000-0000-0000-0000-000000000001', 'Teste completo', %L) $$,
  (SELECT v::jsonb->>'fingerprint' FROM t_state WHERE k = 'T_preview')), '22023',
  'Os dados mudaram desde a prévia. Abra a prévia novamente antes de excluir.', 'a stale preview is refused');
SELECT is((public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000001')->'counts'->>'rounds'), '4',
  'a new preview shows the extra round');
RESET ROLE;
DELETE FROM public.rounds WHERE id = '89000000-0000-0000-0000-000000000099';
INSERT INTO t_state VALUES ('T_hash', pg_temp.comp_hash('29000000-0000-0000-0000-000000000001'));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
SELECT is(public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000001')->>'fingerprint',
  (SELECT v::jsonb->>'fingerprint' FROM t_state WHERE k = 'T_preview'), 'the fingerprint is deterministic for the same rows');
INSERT INTO t_state SELECT 'T_result', public.delete_competition_record('COMPETITION', '29000000-0000-0000-0000-000000000001', 'Teste completo',
  (SELECT v::jsonb->>'fingerprint' FROM t_state WHERE k = 'T_preview'))::text;
SELECT is((SELECT v::jsonb->'counts' FROM t_state WHERE k = 'T_result'), (SELECT v::jsonb->'counts' FROM t_state WHERE k = 'T_preview'),
  'the deletion removed exactly what the preview showed');
SELECT is((SELECT count(*) FROM public.deletion_log WHERE competition_id::text LIKE '29000000-%'), 5::bigint,
  'the admin can read the deletion log (empty season, round, stage, empty competition, test competition)');
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT count(*) FROM public.deletion_log), 0::bigint, 'organizers cannot read any entry of the deletion log');
RESET ROLE;

SELECT is(pg_temp.comp_hash('29000000-0000-0000-0000-000000000001'), md5(''), 'no row of the test competition remains');
SELECT is((SELECT count(*) FROM public.matches WHERE id IN ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000003'))
  + (SELECT count(*) FROM public.match_status_history WHERE match_id IN ('a8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000002', 'a8000000-0000-0000-0000-000000000003'))
  + (SELECT count(*) FROM public.round_robin_pair_claims WHERE stage_id = '69000000-0000-0000-0000-000000000001')
  + (SELECT count(*) FROM public.season_teams WHERE season_id = '39000000-0000-0000-0000-000000000001')
  + (SELECT count(*) FROM public.rosters WHERE season_team_id IN ('59000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000002')),
  0::bigint, 'matches, history, claims, season teams and rosters of the test competition are gone');
SELECT is(pg_temp.orphans(), 0::bigint, 'no orphan rows anywhere');
SELECT is(pg_temp.global_hash(), (SELECT v FROM t_state WHERE k = 'global'), 'teams, players, profiles, streamers and accounts are untouched');
SELECT is(pg_temp.comp_hash('29000000-0000-0000-0000-000000000002'), (SELECT v FROM t_state WHERE k = 'F'),
  'the official competition (same teams) is untouched');
SELECT is((SELECT jsonb_build_object('kind', record_kind, 'name', record_name, 'by', deleted_by_role, 'counts', counts = (SELECT v::jsonb->'counts' FROM t_state WHERE k = 'T_preview'),
    'matches', jsonb_array_length(snapshot->'matches'), 'history', jsonb_array_length(snapshot->'match_status_history'))
  FROM public.deletion_log WHERE record_id = '29000000-0000-0000-0000-000000000001'),
  '{"kind":"COMPETITION","name":"Teste completo","by":"ADMIN","counts":true,"matches":3,"history":5}'::jsonb,
  'the audit log records who deleted what, with a full copy of the rows');
SELECT throws_ok($$ DELETE FROM public.deletion_log $$, '55000', 'O registro de exclusões não pode ser apagado', 'the audit log cannot be deleted');

-- ----------------------------------------------------------- restore
SELECT is(public.restore_deleted_records((SELECT id FROM public.deletion_log WHERE record_id = '29000000-0000-0000-0000-000000000001')),
  (SELECT v::jsonb->'counts' FROM t_state WHERE k = 'T_preview'), 'the database owner restores every deleted row');
SELECT is(pg_temp.comp_hash('29000000-0000-0000-0000-000000000001'), (SELECT v FROM t_state WHERE k = 'T_hash'),
  'the restored rows are identical to the originals (ids, values and timestamps)');
SELECT is(pg_temp.orphans(), 0::bigint, 'no orphan rows after the restore');
SELECT ok((SELECT restored_at IS NOT NULL FROM public.deletion_log WHERE record_id = '29000000-0000-0000-0000-000000000001'),
  'the log marks the deletion as restored');
SELECT throws_ok($$ SELECT public.restore_deleted_records((SELECT id FROM public.deletion_log WHERE record_id = '29000000-0000-0000-0000-000000000001')) $$,
  '55000', NULL, 'a deletion cannot be restored twice');
SELECT throws_ok($$ DELETE FROM public.matches WHERE id = 'a8000000-0000-0000-0000-000000000001' $$, '55000',
  'Partidas não podem ser excluídas; use o status CANCELLED para preservar o histórico',
  'after the restore, the protection triggers are active again');

-- --------------------------------------------- official data (admin)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT array_agg(b->>'code' ORDER BY b->>'code') FROM jsonb_array_elements(public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000002')->'blockers') AS b),
  ARRAY['MATCH_EVENTS', 'MATCH_HISTORY', 'MATCH_PLAYED', 'MATCH_RESULT', 'PUBLISHED_COMPETITION'],
  'the official competition is blocked, with every reason listed');
SELECT throws_ok($$ SELECT public.delete_competition_record('COMPETITION', '29000000-0000-0000-0000-000000000002', 'Oficial', 'x') $$, '55000', NULL,
  'the official competition cannot be deleted');
SELECT throws_ok($$ SELECT public.delete_competition_record('SEASON', '39000000-0000-0000-0000-000000000002', 'F season', 'x') $$, '55000', NULL,
  'the official season cannot be deleted');
SELECT throws_ok($$ SELECT public.delete_competition_record('STAGE', '69000000-0000-0000-0000-000000000003', 'F groups', 'x') $$, '55000', NULL,
  'the official stage cannot be deleted');
SELECT is((SELECT array_agg(b->>'code' ORDER BY b->>'code') FROM jsonb_array_elements(public.deletion_preview('ROUND', '89000000-0000-0000-0000-000000000006')->'blockers') AS b),
  ARRAY['STAGE_HAS_GROUPS', 'STAGE_HAS_MATCHES'], 'even an empty round of the official stage is blocked');
SELECT throws_ok($$ SELECT public.delete_competition_record('ROUND', '89000000-0000-0000-0000-000000000006', 'F R3', 'x') $$, '55000', NULL,
  'the empty official round cannot be deleted');
RESET ROLE;
SELECT is(pg_temp.comp_hash('29000000-0000-0000-0000-000000000002'), (SELECT v FROM t_state WHERE k = 'F'),
  'after every attempt, the official competition is still identical');
UPDATE public.competitions SET status = 'CANCELLED' WHERE id = '29000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
SELECT ok(NOT (public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000002')->>'can_delete')::boolean,
  'archiving does not unlock a competition with a played match');

-- ---------------------------------------------------- game history
SELECT is((SELECT array_agg(b->>'code' ORDER BY b->>'code') FROM jsonb_array_elements(public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000003')->'blockers') AS b),
  ARRAY['MATCH_HISTORY', 'STREAMERS'], 'an archived competition is blocked by a match that went live and by a streamer link');
SELECT throws_ok($$ SELECT public.delete_competition_record('COMPETITION', '29000000-0000-0000-0000-000000000003', 'Historico', 'x') $$, '55000', NULL,
  'a competition with game history cannot be deleted');
RESET ROLE;
SELECT set_config('fbf.purge_match_ids', 'a8000000-0000-0000-0000-000000000005', true);
SELECT throws_ok($$ DELETE FROM public.match_status_history WHERE match_id = 'a8000000-0000-0000-0000-000000000005' $$, '55000', NULL,
  'even listed for purge, a LIVE history entry cannot be deleted (trigger defense)');
SELECT set_config('fbf.purge_match_ids', '', true);

-- -------------------------------------------- published competition
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT array_agg(b->>'code' ORDER BY b->>'code') FROM jsonb_array_elements(public.deletion_preview('SEASON', '39000000-0000-0000-0000-000000000006')->'blockers') AS b),
  ARRAY['PUBLISHED_GROUPS', 'PUBLISHED_TEAMS'], 'a published season with a registration and groups is blocked, with both reasons');
SELECT is((public.delete_competition_record('ROUND', '89000000-0000-0000-0000-000000000011', 'P R2',
  public.deletion_preview('ROUND', '89000000-0000-0000-0000-000000000011')->>'fingerprint'))->'counts'->>'rounds', '1',
  'an empty round of a published stage without groups or matches can be deleted');
SELECT is((SELECT array_agg(b->>'code') FROM jsonb_array_elements(public.deletion_preview('ROUND', '89000000-0000-0000-0000-000000000012')->'blockers') AS b),
  ARRAY['STAGE_HAS_GROUPS'], 'a round of a stage with groups is blocked');
SELECT set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT array_agg(b->>'code') FROM jsonb_array_elements(public.deletion_preview('COMPETITION', '29000000-0000-0000-0000-000000000005')->'blockers') AS b),
  ARRAY['PUBLISHED_COMPETITION'], 'a published competition with seasons is blocked');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
