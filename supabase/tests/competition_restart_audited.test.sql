BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Audited restart of a competition with protected history
-- (migration 20261124120000_competition_restart_audited.sql).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rst-admin@example.invalid', '', now()),
  ('1e000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rst-org@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1e000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'ORGANIZER' WHERE id = '1e000000-0000-0000-0000-000000000002';

INSERT INTO public.teams (id, name) VALUES ('4e000000-0000-0000-0000-000000000001', 'Rst Alpha'), ('4e000000-0000-0000-0000-000000000002', 'Rst Beta');
INSERT INTO public.players (id, nickname, position) VALUES
  ('7e000000-0000-0000-0000-000000000001', 'rst one', 'Pivô'),
  ('7e000000-0000-0000-0000-000000000002', 'rst two', 'Goleiro');
INSERT INTO public.competitions (id, name, category, format, status) VALUES ('2e000000-0000-0000-0000-000000000001', 'Rst Copa', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id) VALUES ('2e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000002');
INSERT INTO public.seasons (id, competition_id, name) VALUES ('3e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000001', 'Rst 1');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000001', '4e000000-0000-0000-0000-000000000001'),
  ('5e000000-0000-0000-0000-000000000002', '3e000000-0000-0000-0000-000000000001', '4e000000-0000-0000-0000-000000000002');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001'),
  ('5e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-000000000002');
INSERT INTO public.stages (id, season_id, name, format, stage_order) VALUES ('6e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000001', 'Fase', 'Pontos corridos', 1);
INSERT INTO public.rounds (id, stage_id, name, round_order, leg_number) VALUES ('8e000000-0000-0000-0000-000000000001', '6e000000-0000-0000-0000-000000000001', 'R1', 1, 1);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status, duration_seconds) VALUES
  ('9e000000-0000-0000-0000-000000000001', '8e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000002', 'SCHEDULED', 840);
UPDATE public.competitions SET status = 'UPCOMING' WHERE id = '2e000000-0000-0000-0000-000000000001';
UPDATE public.competitions SET status = 'ACTIVE' WHERE id = '2e000000-0000-0000-0000-000000000001';

CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', uid, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated;

-- a played match with protected history
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT public.record_retroactive_match_result('9e000000-0000-0000-0000-000000000001', now() - interval '1 day', 840,
  jsonb_build_array(jsonb_build_object('team_id', '5e000000-0000-0000-0000-000000000001', 'player_id', '7e000000-0000-0000-0000-000000000001', 'minute_seconds', 100)), 1, 0);
RESET ROLE;
INSERT INTO public.match_participations (match_id, player_id, season_team_id, seconds_played, source) VALUES
  ('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 840, 'SHEET'),
  ('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000002', 840, 'SHEET');
INSERT INTO public.match_edit_history (match_id, source, reason, before, after) VALUES ('9e000000-0000-0000-0000-000000000001', 'MANUAL', 'escalação conferida', '{}', '{}');
INSERT INTO public.match_mvp_reviews (match_id, decision, reason) VALUES ('9e000000-0000-0000-0000-000000000001', 'WALKOVER', 'W.O. confirmado');
INSERT INTO public.season_honours (id, season_id, kind, season_team_id, basis) VALUES
  ('0e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000001', 'CHAMPION', '5e000000-0000-0000-0000-000000000001', 'MANUAL');
INSERT INTO public.player_aliases (id, player_id, alias, alias_normalized, source_match_id) VALUES
  ('0e100000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001', 'rst_one_nick', 'rst_one_nick', '9e000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE before_counts AS SELECT
  (SELECT count(*) FROM public.teams) AS teams, (SELECT count(*) FROM public.players) AS players,
  (SELECT count(*) FROM public.match_events WHERE match_id = '9e000000-0000-0000-0000-000000000001') AS events;
GRANT SELECT ON before_counts TO authenticated;

SELECT plan(26);

-- the ordinary reset stays blocked, now with an explicit reason
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1e000000-0000-0000-0000-000000000001'); END $$;
SELECT is((SELECT b->>'code' FROM jsonb_array_elements(public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid])->'blockers') b WHERE b->>'code' = 'HAS_HISTORY'),
  'HAS_HISTORY', 'the ordinary reset preview shows the protected history as a blocker');
SELECT is((public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid])->>'can_reset')::boolean, false, 'the ordinary reset is not possible');
SELECT throws_ok($$SELECT public.reset_competitions(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid], 'RESETAR 1 COMPETIÇÕES',
    public.reset_competitions_preview(ARRAY['2e000000-0000-0000-0000-000000000001'::uuid])->>'fingerprint')$$,
  '55000', NULL, 'the ordinary reset refuses a competition with history (protection kept)');

-- the audited restart: permissions, preview and refusals
DO $$ BEGIN PERFORM pg_temp.as_user('1e000000-0000-0000-0000-000000000002'); END $$;
SELECT throws_ok($$SELECT public.competition_restart_preview('2e000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'an organizer cannot preview an audited restart');
SELECT throws_ok($$SELECT public.restart_competition_audited('2e000000-0000-0000-0000-000000000001', 'REINICIAR Rst Copa', 'x', 'motivo suficientemente longo para o teste')$$,
  '42501', NULL, 'an organizer cannot run an audited restart');
DO $$ BEGIN PERFORM pg_temp.as_user('1e000000-0000-0000-0000-000000000001'); END $$;
SELECT is(public.competition_restart_preview('2e000000-0000-0000-0000-000000000001')->>'confirmation', 'REINICIAR Rst Copa', 'the confirmation names the competition');
SELECT is(public.competition_restart_preview('2e000000-0000-0000-0000-000000000001')->'history',
  '{"match_replays":0,"match_replay_reviews":0,"match_replay_reports":0,"match_replay_audit":0,"match_edit_history":1,"match_participations":2,"match_mvp_reviews":1,"season_honours":1}'::jsonb,
  'the preview lists the history that will be archived');
SELECT is((public.competition_restart_preview('2e000000-0000-0000-0000-000000000001')->>'can_restart')::boolean, true, 'drafts only: the restart is possible');
SELECT set_config('rst.fp', public.competition_restart_preview('2e000000-0000-0000-0000-000000000001')->>'fingerprint', true);
SELECT throws_ok($$SELECT public.restart_competition_audited('2e000000-0000-0000-0000-000000000001', 'REINICIAR Rst Copa', current_setting('rst.fp'), 'curto')$$,
  '22023', NULL, 'a detailed reason is required');
SELECT throws_ok($$SELECT public.restart_competition_audited('2e000000-0000-0000-0000-000000000001', 'RESETAR', current_setting('rst.fp'), 'final registrada com a equipe errada')$$,
  '22023', NULL, 'the typed confirmation must match');
SELECT throws_ok($$SELECT public.restart_competition_audited('2e000000-0000-0000-0000-000000000001', 'REINICIAR Rst Copa', 'antiga', 'final registrada com a equipe errada')$$,
  '22023', NULL, 'a stale preview is refused');
RESET ROLE;
UPDATE public.season_honours SET status = 'PUBLISHED' WHERE id = '0e000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1e000000-0000-0000-0000-000000000001'); END $$;
SELECT is((SELECT b->>'code' FROM jsonb_array_elements(public.competition_restart_preview('2e000000-0000-0000-0000-000000000001')->'blockers') b),
  'PUBLISHED_HONOURS', 'a published Hall da Fama record blocks the restart');
SELECT throws_ok(format($$SELECT public.restart_competition_audited('2e000000-0000-0000-0000-000000000001', 'REINICIAR Rst Copa', %L, 'final registrada com a equipe errada')$$,
    public.competition_restart_preview('2e000000-0000-0000-0000-000000000001')->>'fingerprint'),
  '55000', NULL, 'it must be unpublished first');
RESET ROLE;
UPDATE public.season_honours SET status = 'DRAFT' WHERE id = '0e000000-0000-0000-0000-000000000001';

-- the restart itself
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.as_user('1e000000-0000-0000-0000-000000000001'); END $$;
SELECT lives_ok($$SELECT set_config('rst.archive', (public.restart_competition_audited('2e000000-0000-0000-0000-000000000001', 'REINICIAR Rst Copa', current_setting('rst.fp'), 'final registrada com a equipe errada; reiniciar a competição')->>'archive_id'), true)$$,
  'the admin runs the audited restart');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.competitions WHERE id = '2e000000-0000-0000-0000-000000000001'), 0, 'the competition was reset');
SELECT is((SELECT count(*)::integer FROM public.match_participations WHERE match_id = '9e000000-0000-0000-0000-000000000001')
  + (SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9e000000-0000-0000-0000-000000000001')
  + (SELECT count(*)::integer FROM public.match_mvp_reviews WHERE match_id = '9e000000-0000-0000-0000-000000000001'), 0, 'its history left the live tables');
SELECT is((SELECT (history_counts->>'match_participations')::integer + (history_counts->>'match_edit_history')::integer + (history_counts->>'season_honours')::integer
  FROM public.competition_restart_archive WHERE id = current_setting('rst.archive')::uuid), 4, '... and is in the archive, with the reason');
SELECT is((SELECT count(*)::integer FROM public.deletion_log WHERE competition_id = '2e000000-0000-0000-0000-000000000001' AND reset_batch_id IS NOT NULL), 1,
  'the competition rows are in the deletion log, like any safe reset');
SELECT ok((SELECT teams = (SELECT count(*) FROM public.teams) AND players = (SELECT count(*) FROM public.players) FROM before_counts), 'teams and players untouched');

-- the archive is append-only and private
SELECT throws_ok($$DELETE FROM public.competition_restart_archive$$, '55000', NULL, 'the archive cannot be deleted');
SELECT throws_ok(format($$UPDATE public.competition_restart_archive SET reason = 'outro motivo qualquer bem longo' WHERE id = %L$$, current_setting('rst.archive')), '55000', NULL, 'the archive cannot be changed');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.competition_restart_archive$$, '42501', NULL, 'visitors cannot read the archive');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok(format($$SELECT public.restore_competition_restart(%L)$$, current_setting('rst.archive')), '42501', NULL, 'the restore is not exposed to the API');
RESET ROLE;

-- nothing is lost: the owner restores everything
SELECT is(public.restore_competition_restart(current_setting('rst.archive')::uuid),
  '{"match_replays":0,"match_replay_reviews":0,"match_replay_reports":0,"match_replay_audit":0,"match_edit_history":1,"match_participations":2,"match_mvp_reviews":1,"season_honours":1}'::jsonb,
  'the restore brings back every history row');
SELECT ok((SELECT count(*) FROM public.competitions WHERE id = '2e000000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.match_events WHERE match_id = '9e000000-0000-0000-0000-000000000001') = (SELECT events FROM before_counts)
  AND (SELECT source_match_id FROM public.player_aliases WHERE id = '0e100000-0000-0000-0000-000000000001') = '9e000000-0000-0000-0000-000000000001',
  'competition, events and alias links are back');
SELECT throws_ok(format($$SELECT public.restore_competition_restart(%L)$$, current_setting('rst.archive')), '55000', NULL, 'a restart is restored only once');

SELECT * FROM finish();
ROLLBACK;
