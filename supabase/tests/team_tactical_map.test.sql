BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Mapa tático dos clubes (migration 20261125100000_team_tactical_map.sql).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tac-admin@example.invalid', '', now()),
  ('1b000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tac-org@example.invalid', '', now()),
  ('1b000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tac-manager@example.invalid', '', now()),
  ('1b000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tac-player@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1b000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'ORGANIZER' WHERE id = '1b000000-0000-0000-0000-000000000002';

INSERT INTO public.teams (id, name) VALUES ('4b000000-0000-0000-0000-000000000001', 'Tac Alpha'), ('4b000000-0000-0000-0000-000000000002', 'Tac Beta');
INSERT INTO public.players (id, nickname, position) VALUES
  ('7b000000-0000-0000-0000-000000000001', 'tac gk', 'Goleiro'),
  ('7b000000-0000-0000-0000-000000000002', 'tac vl', 'Volante'),
  ('7b000000-0000-0000-0000-000000000003', 'tac pv', 'Pivô'),
  ('7b000000-0000-0000-0000-000000000004', 'tac res', 'Pivô'),
  ('7b000000-0000-0000-0000-000000000005', 'tac beta', 'Pivô');
INSERT INTO public.competitions (id, name, category, format, status) VALUES ('2b000000-0000-0000-0000-000000000001', 'Tac Liga', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id) VALUES ('2b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002');
INSERT INTO public.seasons (id, competition_id, name) VALUES
  ('3b000000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-000000000001', 'Tac T1'),
  ('3b000000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-000000000001', 'Tac T2');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000001', '4b000000-0000-0000-0000-000000000001'),
  ('5b000000-0000-0000-0000-000000000002', '3b000000-0000-0000-0000-000000000001', '4b000000-0000-0000-0000-000000000002'),
  ('5b000000-0000-0000-0000-000000000003', '3b000000-0000-0000-0000-000000000002', '4b000000-0000-0000-0000-000000000001');
INSERT INTO public.rosters (season_team_id, player_id, shirt_number) VALUES
  ('5b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000001', 1),
  ('5b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000002', 5),
  ('5b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000003', 9),
  ('5b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000004', 11),
  ('5b000000-0000-0000-0000-000000000002', '7b000000-0000-0000-0000-000000000005', 10),
  ('5b000000-0000-0000-0000-000000000003', '7b000000-0000-0000-0000-000000000001', 1);

CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', uid, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated;
CREATE TEMP TABLE official_before AS SELECT
  (SELECT count(*) FROM public.match_participations) AS participations, (SELECT count(*) FROM public.rosters) AS rosters,
  (SELECT md5(string_agg(to_jsonb(r)::text, ',' ORDER BY r.id)) FROM public.rosters r) AS rosters_fp,
  (SELECT md5(string_agg((to_jsonb(p) - 'slug')::text, ',' ORDER BY p.id)) FROM public.players p) AS players_fp;
GRANT SELECT ON official_before TO authenticated;

SELECT plan(30);

-- visitors read, never write
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 0, '{"starters":[],"bench":[]}')$$, '42501', NULL, 'visitors cannot save a formation');
SELECT throws_ok($$SELECT public.set_team_manager('4b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000003', true, 'x')$$, '42501', NULL, 'visitors cannot appoint managers');
SELECT throws_ok($$INSERT INTO public.team_formations (season_team_id) VALUES ('5b000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'nobody writes the tables directly');
RESET ROLE;

SET LOCAL ROLE authenticated;
-- a common user (player) and an organizer of the competition cannot edit
DO $$ BEGIN PERFORM pg_temp.as_user('1b000000-0000-0000-0000-000000000004'); END $$;
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 0, '{"starters":[],"bench":[]}')$$, '42501', NULL, 'a common user cannot edit a club');
DO $$ BEGIN PERFORM pg_temp.as_user('1b000000-0000-0000-0000-000000000002'); END $$;
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 0, '{"starters":[],"bench":[]}')$$, '42501', NULL, 'an organizer is not a club manager');
SELECT throws_ok($$SELECT public.set_team_manager('4b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', true, 'eu mesmo')$$, '42501', NULL, 'nobody appoints himself: only admins appoint');
SELECT throws_ok($$INSERT INTO public.team_managers (team_id, user_id, reason) VALUES ('4b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000002', 'x')$$, '42501', NULL, 'nobody writes the manager table directly');

-- the admin appoints a manager for Alpha
DO $$ BEGIN PERFORM pg_temp.as_user('1b000000-0000-0000-0000-000000000001'); END $$;
SELECT throws_ok($$SELECT public.set_team_manager('4b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000003', true, '')$$, '22023', NULL, 'a reason is required');
SELECT is(public.set_team_manager('4b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000003', true, 'capitão indicado pelo clube'), true, 'the admin appoints the club manager');

-- the manager edits his club, only his club, only with its roster
DO $$ BEGIN PERFORM pg_temp.as_user('1b000000-0000-0000-0000-000000000003'); END $$;
SELECT is(public.save_team_formation('5b000000-0000-0000-0000-000000000001', 0,
  '{"starters":[{"player_id":"7b000000-0000-0000-0000-000000000001","role":"gk","x":0.5,"y":0.86},{"player_id":"7b000000-0000-0000-0000-000000000002","role":"VL","x":0.32,"y":0.55},{"player_id":"7b000000-0000-0000-0000-000000000003","role":"PV","x":0.62,"y":0.24}],"bench":["7b000000-0000-0000-0000-000000000004"]}'),
  1, 'the manager saves the formation of his club');
SELECT is((SELECT starters->0->>'role' FROM public.team_formations WHERE season_team_id = '5b000000-0000-0000-0000-000000000001'), 'GK', 'roles are normalized');
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000002', 0, '{"starters":[],"bench":["7b000000-0000-0000-0000-000000000005"]}')$$,
  '42501', NULL, 'the manager cannot edit another club');
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 1, '{"starters":[{"player_id":"7b000000-0000-0000-0000-000000000005","role":"PV","x":0.5,"y":0.5}],"bench":[]}')$$,
  '23514', NULL, 'a player outside the roster is refused');
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 1, '{"starters":[{"player_id":"7b000000-0000-0000-0000-000000000004","role":"PV","x":0.5,"y":0.5}],"bench":["7b000000-0000-0000-0000-000000000004"]}')$$,
  '22023', NULL, 'a player cannot be starter and reserve at once');
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 1, '{"starters":[{"player_id":"7b000000-0000-0000-0000-000000000001","role":"GK","x":0.5,"y":0.5},{"player_id":"7b000000-0000-0000-0000-000000000002","role":"VL","x":0.5,"y":0.5},{"player_id":"7b000000-0000-0000-0000-000000000003","role":"PV","x":0.5,"y":0.5},{"player_id":"7b000000-0000-0000-0000-000000000004","role":"PV","x":0.5,"y":0.5}],"bench":[]}')$$,
  '22023', NULL, 'at most three starters');
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 1, '{"starters":[{"player_id":"7b000000-0000-0000-0000-000000000001","role":"GK","x":1.2,"y":0.5}],"bench":[]}')$$,
  '22023', NULL, 'positions outside the court are refused');
SELECT throws_ok($$SELECT public.save_team_formation('5b000000-0000-0000-0000-000000000001', 0, '{"starters":[],"bench":[]}')$$,
  '55000', NULL, 'a stale save (formation changed meanwhile) is refused');
SELECT is(public.save_team_formation('5b000000-0000-0000-0000-000000000001', 1,
  '{"starters":[{"player_id":"7b000000-0000-0000-0000-000000000001","role":"GK","x":0.5,"y":0.86}],"bench":["7b000000-0000-0000-0000-000000000003","7b000000-0000-0000-0000-000000000002"]}'),
  2, 'a formation with fewer than three starters is allowed (empty places stay empty)');
SELECT is((SELECT count(*)::integer FROM public.team_formations WHERE season_team_id = '5b000000-0000-0000-0000-000000000003'), 0, 'each season keeps its own formation');

-- avatars
SELECT lives_ok($$SELECT public.save_team_player_avatar('4b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000001', '{"background":"#C2560F","border":"#ffffff","symbol":"glove","label":"gk","show_number":true,"style":"ring"}')$$,
  'the manager configures a player avatar');
SELECT is((SELECT (config->>'background') || (config->>'label') FROM public.team_player_avatars WHERE player_id = '7b000000-0000-0000-0000-000000000001'), '#c2560fGK', 'avatar values are normalized');
SELECT throws_ok($$SELECT public.save_team_player_avatar('4b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000002', '{"background":"red","border":"#ffffff","symbol":"star","label":"","show_number":false,"style":"solid"}')$$,
  '22023', NULL, 'invalid colors are refused');
SELECT throws_ok($$SELECT public.save_team_player_avatar('4b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000002', '{"background":"#000000","border":"#ffffff","symbol":"<script>","label":"","show_number":false,"style":"solid"}')$$,
  '22023', NULL, 'unknown symbols are refused');
SELECT throws_ok($$SELECT public.save_team_player_avatar('4b000000-0000-0000-0000-000000000002', '7b000000-0000-0000-0000-000000000005', '{"background":"#000000","border":"#ffffff","symbol":"star","label":"","show_number":false,"style":"solid"}')$$,
  '42501', NULL, 'the manager cannot change avatars of another club');
SELECT throws_ok($$SELECT public.save_team_player_avatar('4b000000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-000000000005', '{"background":"#000000","border":"#ffffff","symbol":"star","label":"","show_number":false,"style":"solid"}')$$,
  '23514', NULL, 'an avatar only for a player of the club');
RESET ROLE;

-- the admin edits any club
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1b000000-0000-0000-0000-000000000001'); END $$;
SELECT is(public.save_team_formation('5b000000-0000-0000-0000-000000000002', 0, '{"starters":[{"player_id":"7b000000-0000-0000-0000-000000000005","role":"PV","x":0.5,"y":0.3}],"bench":[]}'),
  1, 'an admin edits any club');
RESET ROLE;

-- history, and nothing official touched
SELECT is((SELECT string_agg(entity, ',' ORDER BY id) FROM public.team_presentation_changes WHERE team_id = '4b000000-0000-0000-0000-000000000001'),
  'MANAGER,FORMATION,FORMATION,AVATAR', 'every change is in the history');
SELECT ok((SELECT bool_and(actor IS NOT NULL AND changed_at IS NOT NULL) FROM public.team_presentation_changes WHERE team_id = '4b000000-0000-0000-0000-000000000001'), '... with who and when');
SELECT throws_ok($$DELETE FROM public.team_presentation_changes$$, '55000', NULL, 'the history is append-only');
SELECT ok((SELECT participations = (SELECT count(*) FROM public.match_participations) AND rosters = (SELECT count(*) FROM public.rosters)
  AND rosters_fp = (SELECT md5(string_agg(to_jsonb(r)::text, ',' ORDER BY r.id)) FROM public.rosters r)
  AND players_fp = (SELECT md5(string_agg((to_jsonb(p) - 'slug')::text, ',' ORDER BY p.id)) FROM public.players p) FROM official_before),
  'official lineups, rosters and players are untouched');

SELECT * FROM finish();
ROLLBACK;
