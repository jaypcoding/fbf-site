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

SELECT plan(52);

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
SELECT throws_ok($$SELECT public.save_season_honour(NULL, ('{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_category_id":"'||(SELECT id FROM public.award_categories WHERE name = 'Melhor jogador')||'","player_id":"7f000000-0000-0000-0000-000000000003"}')::jsonb, 'prêmio')$$,
  '23514', NULL, 'an award goes only to someone who took part in the season');
SELECT throws_ok($$SELECT public.save_season_honour(NULL, ('{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_category_id":"'||(SELECT id FROM public.award_categories WHERE name = 'Melhor jogador')||'","player_id":"7f000000-0000-0000-0000-000000000001","season_team_id":"5f000000-0000-0000-0000-000000000002"}')::jsonb, 'prêmio')$$,
  '23514', NULL, 'an award with a team requires the player in that team');
SELECT lives_ok($$SELECT set_config('hof.award', public.save_season_honour(NULL, ('{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_category_id":"'||(SELECT id FROM public.award_categories WHERE name = 'Melhor jogador')||'","player_id":"7f000000-0000-0000-0000-000000000001","season_team_id":"5f000000-0000-0000-0000-000000000001"}')::jsonb, 'votação da organização')::text, true)$$,
  'admin registers an individual award');
SELECT lives_ok($$SELECT public.save_season_honour(NULL, ('{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_category_id":"'||(SELECT id FROM public.award_categories WHERE name = 'Melhor goleiro')||'","player_id":"7f000000-0000-0000-0000-000000000002"}')::jsonb, 'votação da organização')$$,
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
SELECT throws_ok($$SELECT count(*) FROM public.hall_of_fame_changes$$, '42501', NULL, 'visitors do not read the history');
RESET ROLE;

-- unpublish, change and delete drafts, with history
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT is(public.publish_season_honour(current_setting('hof.champion')::uuid, false, 'conferir de novo'), 'DRAFT', 'admin unpublishes');
SELECT lives_ok(format($$SELECT public.save_season_honour(%L, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"CHAMPION","season_team_id":"5f000000-0000-0000-0000-000000000001","notes":"decidido nos pênaltis"}', 'observação')$$, current_setting('hof.champion')),
  'a draft can be changed');
SELECT lives_ok(format($$SELECT public.delete_season_honour(%L, 'vice errado')$$, current_setting('hof.runner')), 'a draft can be deleted');
SELECT is((SELECT string_agg(action, ',' ORDER BY id) FROM public.hall_of_fame_changes WHERE entity_id IN (current_setting('hof.champion')::uuid, current_setting('hof.runner')::uuid)),
  'CREATE,CREATE,PUBLISH,UNPUBLISH,UPDATE,DELETE', 'every change is in the history, in order');
SELECT is((SELECT count(*)::integer FROM public.hall_of_fame_changes WHERE season_id = '3f000000-0000-0000-0000-000000000001' AND length(reason) >= 3), 9, 'every change keeps its reason');
RESET ROLE;

-- system seasons: no parallel top-scorer records, no free-text names
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"TOP_SCORER","player_id":"7f000000-0000-0000-0000-000000000001","goals":9}', 'artilheiro')$$,
  '23514', NULL, 'the top scorer of a system season is never stored (it comes from the match sheets)');
SELECT throws_ok($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"THIRD_PLACE","team_name":"Equipe digitada"}', 'terceiro')$$,
  '23514', NULL, 'a system season uses its season teams, not typed names');

-- configurable award categories
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000002'); END $$;
SELECT throws_ok($$SELECT public.save_award_category(NULL, '{"name":"Melhor fixo"}', 'nova')$$, '42501', NULL, 'an organizer cannot create award categories');
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT is((SELECT count(*)::integer FROM public.award_categories WHERE name IN ('Melhor jogador', 'Melhor goleiro', 'Melhor volante', 'Melhor pivô', 'Revelação', 'Craque da final')), 6, 'the six approved categories exist');
SELECT lives_ok($$SELECT set_config('hof.cat', public.save_award_category(NULL, '{"name":"Melhor fixo","sort_order":70}', 'nova premiação da FBF')::text, true)$$, 'admin creates a new category without a migration');
SELECT throws_ok($$SELECT public.save_award_category(NULL, '{"name":"melhor FIXO"}', 'repetida')$$, '23505', NULL, 'category names are unique (case-insensitive)');
SELECT throws_ok($$SELECT public.save_award_category((SELECT id FROM public.award_categories WHERE name = 'Melhor jogador'), '{"name":"Craque"}', 'renomear')$$,
  '55000', NULL, 'a category already published cannot be renamed');
SELECT throws_ok($$SELECT public.delete_award_category((SELECT id FROM public.award_categories WHERE name = 'Melhor jogador'), 'apagar')$$,
  '55000', NULL, 'a category in use is never deleted');
SELECT lives_ok(format($$SELECT public.save_award_category(%L, '{"name":"Melhor fixo","active":false}', 'desativar')$$, current_setting('hof.cat')), 'admin deactivates a category');
SELECT throws_ok(format($$SELECT public.save_season_honour(NULL, '{"season_id":"3f000000-0000-0000-0000-000000000001","kind":"AWARD","award_category_id":"%s","player_id":"7f000000-0000-0000-0000-000000000002"}', 'prêmio')$$, current_setting('hof.cat')),
  '23514', NULL, 'a deactivated category is not offered for new awards');
SELECT lives_ok(format($$SELECT public.delete_award_category(%L, 'criada por engano')$$, current_setting('hof.cat')), 'an unused category can be deleted');

-- editions before the system
SELECT throws_ok($$SELECT public.save_historical_edition(NULL, '{"competition_name":"FBF Antiga","edition_year":2019}', 'cadastro')$$,
  '22023', NULL, 'an edition before the system needs the source where the FBF confirmed it');
SELECT throws_ok($$SELECT public.save_historical_edition(NULL, '{"competition_name":"FBF Antiga","ended_on":"2999-01-01","source":"ata"}', 'cadastro')$$,
  '22023', NULL, 'an edition before the system cannot end in the future');
SELECT lives_ok($$SELECT set_config('hof.ed', public.save_historical_edition(NULL, '{"competition_name":"FBF Antiga","edition_name":"1ª edição","edition_year":2019,"source":"ata da organização"}', 'confirmado pela organização')::text, true)$$,
  'admin registers an edition before the system');
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM pg_temp.as_user(''); END $$;
SELECT is((SELECT count(*)::integer FROM public.historical_editions WHERE competition_name = 'FBF Antiga'), 0, 'visitors do not see an edition without a published honour');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT lives_ok(format($$SELECT set_config('hof.hchamp', public.save_season_honour(NULL, '{"historical_edition_id":"%s","kind":"CHAMPION","team_name":"Equipe extinta"}', 'ata')::text, true)$$, current_setting('hof.ed')),
  'a champion before the system may be a team that is no longer registered');
SELECT throws_ok(format($$SELECT public.save_season_honour(NULL, '{"historical_edition_id":"%s","kind":"RUNNER_UP","season_team_id":"5f000000-0000-0000-0000-000000000001"}', 'ata')$$, current_setting('hof.ed')),
  '23514', NULL, 'editions before the system do not use season teams');
SELECT throws_ok(format($$SELECT public.save_season_honour(NULL, '{"historical_edition_id":"%s","kind":"CHAMPION","team_id":"4f000000-0000-0000-0000-000000000002"}', 'ata')$$, current_setting('hof.ed')),
  '23505', NULL, 'one champion per edition');
SELECT lives_ok(format($$SELECT public.save_season_honour(NULL, '{"historical_edition_id":"%s","kind":"RUNNER_UP","team_id":"4f000000-0000-0000-0000-000000000002"}', 'ata')$$, current_setting('hof.ed')),
  'a runner-up before the system may be a registered team');
SELECT lives_ok(format($$SELECT public.save_season_honour(NULL, '{"historical_edition_id":"%s","kind":"TOP_SCORER","player_name":"artilheiro antigo","goals":12}', 'ata')$$, current_setting('hof.ed')),
  'the top scorer before the system is a confirmed record (there are no match sheets)');
SELECT lives_ok(format($$SELECT public.save_season_honour(NULL, jsonb_build_object('historical_edition_id', %L, 'kind', 'AWARD', 'award_category_id', (SELECT id FROM public.award_categories WHERE name = 'Revelação'), 'player_id', '7f000000-0000-0000-0000-000000000003'), 'ata')$$, current_setting('hof.ed')),
  'an award before the system may go to a registered player');
SELECT is(public.publish_season_honour(current_setting('hof.hchamp')::uuid, true, 'confirmado pelo administrador'), 'PUBLISHED', 'the admin confirms and publishes a record before the system');
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM pg_temp.as_user(''); END $$;
SELECT is((SELECT count(*)::integer FROM public.historical_editions WHERE competition_name = 'FBF Antiga'), 1, 'the edition becomes public with its first published honour');
SELECT is((SELECT string_agg(kind, ',') FROM public.season_honours WHERE historical_edition_id = current_setting('hof.ed')::uuid), 'CHAMPION', 'visitors see only what was confirmed and published');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1f000000-0000-0000-0000-000000000001'); END $$;
SELECT throws_ok(format($$SELECT public.save_historical_edition(%L, '{"competition_name":"FBF Outra","source":"ata"}', 'trocar')$$, current_setting('hof.ed')),
  '55000', NULL, 'an edition with published records is not changed without unpublishing them');
SELECT throws_ok(format($$SELECT public.delete_historical_edition(%L, 'apagar')$$, current_setting('hof.ed')), '55000', NULL, 'an edition with records is not deleted');
SELECT is((SELECT string_agg(entity || ':' || action, ',' ORDER BY id) FROM public.hall_of_fame_changes WHERE historical_edition_id = current_setting('hof.ed')::uuid),
  'EDITION:CREATE,HONOUR:CREATE,HONOUR:CREATE,HONOUR:CREATE,HONOUR:CREATE,HONOUR:PUBLISH', 'edition and records are in the history');
RESET ROLE;
SELECT throws_ok($$DELETE FROM public.hall_of_fame_changes$$, '55000', NULL, 'the history is append-only, even for the owner');

SELECT * FROM finish();
ROLLBACK;
