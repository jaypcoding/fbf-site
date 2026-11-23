BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Hall da Fama: official honours (migration 20261124100000_season_honours.sql).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1f000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hof-admin@example.invalid', '', now()),
  ('1f000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hof-org@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1f000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'ORGANIZER' WHERE id = '1f000000-0000-0000-0000-000000000002';

INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('2f000000-0000-0000-0000-000000000001', 'HoF test', 'Test', 'Pontos corridos', 'DRAFT'),
  ('2f000000-0000-0000-0000-000000000002', 'HoF other', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id) VALUES ('2f000000-0000-0000-0000-000000000001', '1f000000-0000-0000-0000-000000000002');
INSERT INTO public.seasons (id, competition_id, name) VALUES
  ('3f000000-0000-0000-0000-000000000001', '2f000000-0000-0000-0000-000000000001', 'HoF 1'),
  ('3f000000-0000-0000-0000-000000000002', '2f000000-0000-0000-0000-000000000002', 'HoF 2');
INSERT INTO public.teams (id, name) VALUES ('4f000000-0000-0000-0000-000000000001', 'HoF Alpha'), ('4f000000-0000-0000-0000-000000000002', 'HoF Beta');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5f000000-0000-0000-0000-000000000001', '3f000000-0000-0000-0000-000000000001', '4f000000-0000-0000-0000-000000000001'),
  ('5f000000-0000-0000-0000-000000000002', '3f000000-0000-0000-0000-000000000001', '4f000000-0000-0000-0000-000000000002'),
  ('5f000000-0000-0000-0000-000000000003', '3f000000-0000-0000-0000-000000000002', '4f000000-0000-0000-0000-000000000001');
INSERT INTO public.players (id, nickname, position) VALUES
  ('7f000000-0000-0000-0000-000000000001', 'hof star', 'Pivô'),
  ('7f000000-0000-0000-0000-000000000002', 'hof keeper', 'Goleiro'),
  ('7f000000-0000-0000-0000-000000000003', 'hof outsider', 'Volante');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('5f000000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-000000000001'),
  ('5f000000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-000000000002');
-- a competition only starts with a stage and a match
INSERT INTO public.stages (id, season_id, name, format, stage_order) VALUES
  ('6f000000-0000-0000-0000-000000000001', '3f000000-0000-0000-0000-000000000001', 'Fase', 'Pontos corridos', 1),
  ('6f000000-0000-0000-0000-000000000002', '3f000000-0000-0000-0000-000000000002', 'Fase', 'Pontos corridos', 1);
INSERT INTO public.rounds (id, stage_id, name, round_order, leg_number) VALUES
  ('8f000000-0000-0000-0000-000000000001', '6f000000-0000-0000-0000-000000000001', 'R1', 1, 1),
  ('8f000000-0000-0000-0000-000000000002', '6f000000-0000-0000-0000-000000000002', 'R1', 1, 1);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status) VALUES
  ('9f000000-0000-0000-0000-000000000001', '8f000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000002', 'SCHEDULED');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES ('5f000000-0000-0000-0000-000000000004', '3f000000-0000-0000-0000-000000000002', '4f000000-0000-0000-0000-000000000002');
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status) VALUES
  ('9f000000-0000-0000-0000-000000000002', '8f000000-0000-0000-0000-000000000002', '5f000000-0000-0000-0000-000000000003', '5f000000-0000-0000-0000-000000000004', 'SCHEDULED');
UPDATE public.competitions SET status = 'UPCOMING' WHERE id IN ('2f000000-0000-0000-0000-000000000001', '2f000000-0000-0000-0000-000000000002');
UPDATE public.competitions SET status = 'ACTIVE' WHERE id IN ('2f000000-0000-0000-0000-000000000001', '2f000000-0000-0000-0000-000000000002');

CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', uid, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated;

SELECT plan(24);

-- permissions
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000002'); END $$;
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000001"}', 'campeão')$$,
  '42501', NULL, 'an organizer cannot register honours (official decision of the FBF)');
SELECT throws_ok($$INSERT INTO public.season_honours (season_id, kind, season_team_id) VALUES ('3f000000-0000-0000-0000-000000000001', 'CHAMPION', '5f000000-0000-0000-0000-000000000001')$$,
  '42501', NULL, 'nobody writes the table directly');
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000001"}', '')$$,
  '22023', NULL, 'a reason is required');
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000003"}', 'campeão')$$,
  '23514', NULL, 'a team of another season is refused');

-- drafts
SELECT lives_ok($$SELECT set_config('hof.champion', public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000001","basis":"FINAL"}', 'final conferida')::text, true)$$,
  'admin registers the champion as a draft');
SELECT lives_ok($$SELECT set_config('hof.runner', public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"RUNNER_UP","season_team_id":"5f000000-0000-0000-0000-000000000002","basis":"FINAL"}', 'final conferida')::text, true)$$,
  'admin registers the runner-up as a draft');
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000002"}', 'outro campeão')$$,
  '23505', NULL, 'only one champion per season');
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_name":"Melhor jogador","player_id":"7f000000-0000-0000-0000-000000000003"}', 'prêmio')$$,
  '23514', NULL, 'an award goes only to someone who took part in the season');
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_name":"Melhor jogador","player_id":"7f000000-0000-0000-0000-000000000001","season_team_id":"5f000000-0000-0000-0000-000000000002"}', 'prêmio')$$,
  '23514', NULL, 'an award with a team requires the player in that team');
SELECT lives_ok($$SELECT set_config('hof.award', public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_name":"Melhor jogador","player_id":"7f000000-0000-0000-0000-000000000001","season_team_id":"5f000000-0000-0000-0000-000000000001"}', 'votação da organização')::text, true)$$,
  'admin registers an individual award');
SELECT lives_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_name":"Melhor goleiro","player_id":"7f000000-0000-0000-0000-000000000002"}', 'votação da organização')$$,
  'awards may have different names in the same season');

-- publication only after the competition is finished
SELECT throws_ok(format($$SELECT public.publish_season_honour(%L, true, 'publicar')$$, current_setting('hof.champion')), '23514', NULL, 'nothing is published while the competition is not finished');
RESET ROLE;
UPDATE public.matches SET status = 'CANCELLED' WHERE id = '9f000000-0000-0000-0000-000000000001';
UPDATE public.competitions SET status = 'FINISHED' WHERE id = '2f000000-0000-0000-0000-000000000001';
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM pg_temp.as_user(''); END $$;
SELECT is((SELECT count(*)::integer FROM public.season_honours WHERE season_id = '3f000000-0000-0000-0000-000000000001'), 0, 'visitors see no draft');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT is(public.publish_season_honour(current_setting('hof.champion')::uuid, true, 'competição encerrada'), 'PUBLISHED', 'the champion is published after the end');
SELECT is(public.publish_season_honour(current_setting('hof.award')::uuid, true, 'competição encerrada'), 'PUBLISHED', 'the award is published');
SELECT throws_ok(format($$SELECT public.save_season_honour(%L, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000002"}', 'trocar')$$, current_setting('hof.champion')),
  '55000', NULL, 'a published honour cannot be changed');
SELECT throws_ok(format($$SELECT public.delete_season_honour(%L, 'apagar')$$, current_setting('hof.champion')), '55000', NULL, 'a published honour cannot be deleted');
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM pg_temp.as_user(''); END $$;
SELECT is((SELECT string_agg(kind, ',' ORDER BY kind) FROM public.season_honours WHERE season_id = '3f000000-0000-0000-0000-000000000001'), 'AWARD,CHAMPION', 'visitors see only the published honours');
SELECT throws_ok($$SELECT count(*) FROM public.season_honour_changes$$, '42501', NULL, 'visitors do not read the history');
RESET ROLE;

-- unpublish, change and delete drafts, with history
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT is(public.publish_season_honour(current_setting('hof.champion')::uuid, false, 'conferir de novo'), 'DRAFT', 'admin unpublishes');
SELECT lives_ok(format($$SELECT public.save_season_honour(%L, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000001","notes":"decidido nos pênaltis"}', 'observação')$$, current_setting('hof.champion')),
  'a draft can be changed');
SELECT lives_ok(format($$SELECT public.delete_season_honour(%L, 'vice errado')$$, current_setting('hof.runner')), 'a draft can be deleted');
SELECT is((SELECT string_agg(action, ',' ORDER BY id) FROM public.season_honour_changes WHERE honour_id IN (current_setting('hof.champion')::uuid, current_setting('hof.runner')::uuid)),
  'CREATE,CREATE,PUBLISH,UNPUBLISH,UPDATE,DELETE', 'every change is in the history, in order');
SELECT is((SELECT count(*)::integer FROM public.season_honour_changes WHERE season_id = '3f000000-0000-0000-0000-000000000001' AND length(reason) >= 3), 9, 'every change keeps its reason');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
