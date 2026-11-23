BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Official participation (lineups), stable player slugs and the shared public
-- views (migrations 20261123120000, 20261123120100, 20261123120200).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1d000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lineup-admin@example.invalid', '', now()),
  ('1d000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lineup-user@example.invalid', '', now()),
  ('1d000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lineup-org@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1d000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET role = 'USER' WHERE id = '1d000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET role = 'ORGANIZER' WHERE id = '1d000000-0000-0000-0000-000000000003';

INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('2d000000-0000-0000-0000-000000000001', 'Lineup test', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.competition_organizers (competition_id, user_id) VALUES ('2d000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000003');
INSERT INTO public.seasons (id, competition_id, name) VALUES ('3d000000-0000-0000-0000-000000000001', '2d000000-0000-0000-0000-000000000001', 'Lineup');
INSERT INTO public.teams (id, name) VALUES ('4d000000-0000-0000-0000-000000000001', 'Lineup Home'), ('4d000000-0000-0000-0000-000000000002', 'Lineup Away');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000001'),
  ('5d000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000002');
INSERT INTO public.players (id, nickname, position) VALUES
  ('7d000000-0000-0000-0000-000000000001', 'Lineup GK Casa', 'Goleiro'),
  ('7d000000-0000-0000-0000-000000000002', 'Ação Rápida', 'Pivô'),
  ('7d000000-0000-0000-0000-000000000003', 'lineup b', 'Volante'),
  ('7d000000-0000-0000-0000-000000000004', 'lineup sem gol', 'Volante'),
  ('7d000000-0000-0000-0000-000000000005', 'Lineup GK Fora', 'Goleiro'),
  ('7d000000-0000-0000-0000-000000000006', 'lineup fora a', 'Pivô'),
  ('7d000000-0000-0000-0000-000000000007', 'lineup b', 'Pivô');
INSERT INTO public.rosters (season_team_id, player_id) VALUES
  ('5d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000001'),
  ('5d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000002'),
  ('5d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000003'),
  ('5d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000004'),
  ('5d000000-0000-0000-0000-000000000002', '7d000000-0000-0000-0000-000000000005'),
  ('5d000000-0000-0000-0000-000000000002', '7d000000-0000-0000-0000-000000000006'),
  ('5d000000-0000-0000-0000-000000000002', '7d000000-0000-0000-0000-000000000007');
INSERT INTO public.stages (id, season_id, name, format) VALUES ('6d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001', 'Lineup stage', 'Pontos corridos');
INSERT INTO public.rounds (id, stage_id, name, round_order, leg_number) VALUES
  ('8d000000-0000-0000-0000-000000000001', '6d000000-0000-0000-0000-000000000001', 'R1', 1, 1),
  ('8d000000-0000-0000-0000-000000000002', '6d000000-0000-0000-0000-000000000001', 'R2', 2, 2);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status) VALUES
  ('9d000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-000000000002', 'SCHEDULED'),
  ('9d000000-0000-0000-0000-000000000002', '8d000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-000000000001', 'SCHEDULED');
UPDATE public.competitions SET status = 'REGISTRATION' WHERE id = '2d000000-0000-0000-0000-000000000001';

CREATE FUNCTION pg_temp.lfp(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT public.match_lineup_fingerprint(p) $$;
CREATE FUNCTION pg_temp.l(player text, side text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('player_id', player, 'side', side) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SELECT plan(44);

-- ---------------------------------------------------------------- slugs
SELECT is((SELECT slug FROM public.players WHERE id = '7d000000-0000-0000-0000-000000000002'), 'acao-rapida', 'slug from the nickname, accents and spaces normalised');
SELECT is((SELECT string_agg(slug, ',' ORDER BY created_at, id) FROM public.players WHERE nickname = 'lineup b'), 'lineup-b,lineup-b-2', 'a repeated nickname gets a suffix; players are never merged');
UPDATE public.players SET nickname = 'Novo Apelido', slug = 'tentativa' WHERE id = '7d000000-0000-0000-0000-000000000002';
SELECT is((SELECT slug FROM public.players WHERE id = '7d000000-0000-0000-0000-000000000002'), 'acao-rapida', 'the address never changes, also after a nickname change');
UPDATE public.players SET nickname = 'Ação Rápida' WHERE id = '7d000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- finished match without lineup
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
SELECT lives_ok($$SELECT public.record_retroactive_match_result('9d000000-0000-0000-0000-000000000001', NULL, 840,
  jsonb_build_array(jsonb_build_object('team_id', '5d000000-0000-0000-0000-000000000001'), jsonb_build_object('team_id', '5d000000-0000-0000-0000-000000000001'), jsonb_build_object('team_id', '5d000000-0000-0000-0000-000000000002')), 2, 1)$$,
  'match 1 finished 2 x 1');
SELECT lives_ok(format($$SELECT public.edit_match_sheet('9d000000-0000-0000-0000-000000000001', %L, %L, 'autores')$$,
  public.match_sheet_fingerprint('9d000000-0000-0000-0000-000000000001'),
  jsonb_build_object('score', jsonb_build_object('home', 2, 'away', 1), 'duration_seconds', 840,
    'goals', jsonb_build_array(
      jsonb_build_object('team_id', '5d000000-0000-0000-0000-000000000001', 'player_id', '7d000000-0000-0000-0000-000000000002', 'is_own_goal', false, 'minute_seconds', 100, 'assist_player_id', '7d000000-0000-0000-0000-000000000003'),
      jsonb_build_object('team_id', '5d000000-0000-0000-0000-000000000001', 'player_id', '7d000000-0000-0000-0000-000000000002', 'is_own_goal', false, 'minute_seconds', 200, 'assist_player_id', NULL),
      jsonb_build_object('team_id', '5d000000-0000-0000-0000-000000000002', 'player_id', '7d000000-0000-0000-0000-000000000006', 'is_own_goal', false, 'minute_seconds', 300, 'assist_player_id', NULL)),
    'goalkeepers', jsonb_build_array(
      jsonb_build_object('team_id', '5d000000-0000-0000-0000-000000000001', 'player_id', '7d000000-0000-0000-0000-000000000001', 'started_at_seconds', 0)))),
  'authors, an assist and the home goalkeeper');

SELECT is((SELECT string_agg(p.nickname, ',' ORDER BY p.nickname COLLATE "C") FROM public.player_match_participation v JOIN public.players p ON p.id = v.player_id WHERE v.match_id = '9d000000-0000-0000-0000-000000000001'),
  'Ação Rápida,Lineup GK Casa,lineup b,lineup fora a', 'without lineup: scorers, assistants and goalkeepers are proven participants');
SELECT is((SELECT result || ' ' || goals || '/' || assists FROM public.player_match_stats WHERE match_id = '9d000000-0000-0000-0000-000000000001' AND player_id = '7d000000-0000-0000-0000-000000000002'), 'W 2/0', 'result and goals of a proven participant');
SELECT is((SELECT count(*)::integer FROM public.player_match_participation WHERE player_id = '7d000000-0000-0000-0000-000000000004'), 0, 'a player with no evidence is not counted (no invented lineup)');
SELECT is((SELECT string_agg(lineup_registered::text, ',') FROM public.team_match_lineups WHERE match_id = '9d000000-0000-0000-0000-000000000001'), 'false,false', 'both teams marked without lineup');

-- ---------------------------------------------------------------- save_match_lineup: guards
SELECT set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$SELECT pg_temp.lfp('9d000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'a common user cannot read the lineup version');
SELECT throws_ok($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', 'x', '[]', 'teste')$$, '42501', NULL, 'a common user cannot save a lineup');
SELECT set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000003', true);
SELECT throws_ok($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', 'stale', '[]', 'teste')$$, '55000', NULL, 'a stale lineup version is refused');
SELECT throws_ok(format($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', %L, '[]', '')$$, pg_temp.lfp('9d000000-0000-0000-0000-000000000001')), '22023', NULL, 'the reason is mandatory');
SELECT throws_ok(format($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000002', %L, '[]', 'teste')$$, md5('[]')), '23514', NULL, 'only finished matches get a lineup');
SELECT throws_ok(format($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', %L, %L, 'duplicado')$$, pg_temp.lfp('9d000000-0000-0000-0000-000000000001'),
  jsonb_build_array(pg_temp.l('7d000000-0000-0000-0000-000000000002', 'home'), pg_temp.l('7d000000-0000-0000-0000-000000000002', 'home'))), '23505', NULL, 'a player cannot appear twice');
SELECT throws_ok(format($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', %L, %L, 'fora do elenco')$$, pg_temp.lfp('9d000000-0000-0000-0000-000000000001'),
  jsonb_build_array(pg_temp.l('7d000000-0000-0000-0000-000000000006', 'home'))), '23514', NULL, 'a player outside the roster of that team is refused');
SELECT throws_ok(format($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', %L, %L, 'sem lado')$$, pg_temp.lfp('9d000000-0000-0000-0000-000000000001'),
  jsonb_build_array(jsonb_build_object('player_id', '7d000000-0000-0000-0000-000000000002'))), '22023', NULL, 'each player needs a side');
SELECT is((SELECT count(*)::integer FROM public.match_participations), 0, 'refused lineups changed nothing');

-- ---------------------------------------------------------------- save_match_lineup: lineup and correction
SELECT lives_ok(format($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', %L, %L, 'escalação conferida')$$, pg_temp.lfp('9d000000-0000-0000-0000-000000000001'),
  jsonb_build_array(pg_temp.l('7d000000-0000-0000-0000-000000000001', 'home'), pg_temp.l('7d000000-0000-0000-0000-000000000002', 'home'),
    pg_temp.l('7d000000-0000-0000-0000-000000000003', 'home'), pg_temp.l('7d000000-0000-0000-0000-000000000004', 'home'),
    pg_temp.l('7d000000-0000-0000-0000-000000000005', 'away'), pg_temp.l('7d000000-0000-0000-0000-000000000006', 'away'))),
  'the organizer registers the lineup');
SELECT is((SELECT result || ' ' || goals FROM public.player_match_stats WHERE match_id = '9d000000-0000-0000-0000-000000000001' AND player_id = '7d000000-0000-0000-0000-000000000004'), 'W 0', 'a player without goals or assists now counts, with the win');
SELECT is((SELECT count(*)::integer FROM public.player_match_participation WHERE match_id = '9d000000-0000-0000-0000-000000000001'), 6, 'six participants');
SELECT is((SELECT count(*) - count(DISTINCT player_id) FROM public.player_match_participation WHERE match_id = '9d000000-0000-0000-0000-000000000001')::integer, 0, 'lineup and events of the same player are one participation');
SELECT is((SELECT home_score || 'x' || away_score || ' ' || (SELECT count(*) FROM public.match_events WHERE match_id = m.id) FROM public.matches m WHERE id = '9d000000-0000-0000-0000-000000000001'), '2x1 5', 'score and events untouched by the lineup');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9d000000-0000-0000-0000-000000000001' AND changes->>'kind' = 'lineup' AND actor = '1d000000-0000-0000-0000-000000000003'), 1, 'the lineup is in the edit history with its author');
SELECT is((SELECT string_agg(lineup_registered::text, ',') FROM public.team_match_lineups WHERE match_id = '9d000000-0000-0000-0000-000000000001'), 'true,true', 'both teams marked with lineup');
SELECT lives_ok(format($$SELECT public.save_match_lineup('9d000000-0000-0000-0000-000000000001', %L, %L, 'não jogou')$$, pg_temp.lfp('9d000000-0000-0000-0000-000000000001'),
  jsonb_build_array(pg_temp.l('7d000000-0000-0000-0000-000000000001', 'home'), pg_temp.l('7d000000-0000-0000-0000-000000000002', 'home'),
    pg_temp.l('7d000000-0000-0000-0000-000000000003', 'home'), pg_temp.l('7d000000-0000-0000-0000-000000000005', 'away'), pg_temp.l('7d000000-0000-0000-0000-000000000006', 'away'))),
  'a later correction of the lineup');
SELECT is((SELECT count(*)::integer FROM public.player_match_participation WHERE player_id = '7d000000-0000-0000-0000-000000000004'), 0, 'the removed player no longer counts');
SELECT is((SELECT count(*)::integer FROM public.match_participations WHERE match_id = '9d000000-0000-0000-0000-000000000001'), 5, 'the lineup was replaced, not duplicated');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9d000000-0000-0000-0000-000000000001' AND changes->>'kind' = 'lineup'), 2, 'each correction is a new history entry');

-- ---------------------------------------------------------------- confirmation from recordings writes the lineup
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('match-replays', '9d000000-0000-0000-0000-000000000002/' || repeat('e', 64) || '.hbr2');
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
SELECT lives_ok($$SELECT public.register_match_replay('9d000000-0000-0000-0000-000000000002', '9d000000-0000-0000-0000-000000000002/' || repeat('e', 64) || '.hbr2', 'jogo.hbr2', 100, repeat('e', 64), NULL)$$, 'a recording for match 2');
RESET ROLE;
UPDATE public.match_replays SET status = 'ANALYZED', analysis = '{}'::jsonb WHERE match_id = '9d000000-0000-0000-0000-000000000002';
-- match 2: away team of the round is "Lineup Away" at home; 1 x 0 for the home side
UPDATE public.match_replay_reviews SET sheet = '{"canConfirm":true,"analyzer":"fbf-replay-1.1.0"}', report = '{"version":1}', sheet_hash = 'h-lineup',
  official = jsonb_build_object('matchId', '9d000000-0000-0000-0000-000000000002', 'durationSeconds', 840, 'score', jsonb_build_object('home', 1, 'away', 0),
    'goals', jsonb_build_array(jsonb_build_object('minute_seconds', 60, 'team_id', '5d000000-0000-0000-0000-000000000002', 'player_id', '7d000000-0000-0000-0000-000000000006', 'is_own_goal', false, 'side', 'home', 'source', 'replay')),
    'goalkeepers', '[]'::jsonb, 'aliases', '[]'::jsonb,
    'files', (SELECT jsonb_agg(id) FROM public.match_replays WHERE match_id = '9d000000-0000-0000-0000-000000000002'),
    'participants', jsonb_build_array(
      jsonb_build_object('player_id', '7d000000-0000-0000-0000-000000000006', 'side', 'home', 'seconds_played', 840),
      jsonb_build_object('player_id', '7d000000-0000-0000-0000-000000000007', 'side', 'home', 'seconds_played', 400),
      jsonb_build_object('player_id', '7d000000-0000-0000-0000-000000000004', 'side', 'away', 'seconds_played', 840)))
WHERE match_id = '9d000000-0000-0000-0000-000000000002' AND status = 'DRAFT';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
SELECT lives_ok($$SELECT public.confirm_match_replay_review('9d000000-0000-0000-0000-000000000002', 'h-lineup')$$, 'sheet from recordings confirmed');
SELECT is((SELECT string_agg(player_id::text || ':' || source || ':' || seconds_played, ',' ORDER BY player_id) FROM public.match_participations WHERE match_id = '9d000000-0000-0000-0000-000000000002'),
  '7d000000-0000-0000-0000-000000000004:REPLAY:840,7d000000-0000-0000-0000-000000000006:REPLAY:840,7d000000-0000-0000-0000-000000000007:REPLAY:400',
  'the identified players of the sheet became the official lineup, with their time');
SELECT is((SELECT result FROM public.player_match_stats WHERE match_id = '9d000000-0000-0000-0000-000000000002' AND player_id = '7d000000-0000-0000-0000-000000000004'), 'L', 'a participant without goals is counted with the defeat');

-- re-confirmation (reprocessed recordings): the lineup is replaced and the old one kept in the history
SELECT lives_ok($$SELECT public.reopen_match_replay_review('9d000000-0000-0000-0000-000000000002', 'reprocessar')$$, 'sheet reopened');
RESET ROLE;
UPDATE public.match_replay_reviews SET sheet = '{"canConfirm":true,"analyzer":"fbf-replay-1.1.0"}', report = '{"version":1}', sheet_hash = 'h-lineup-2',
  official = (SELECT official FROM public.match_replay_reviews WHERE match_id = '9d000000-0000-0000-0000-000000000002' AND status = 'SUPERSEDED')
    || jsonb_build_object('participants', jsonb_build_array(
      jsonb_build_object('player_id', '7d000000-0000-0000-0000-000000000006', 'side', 'home', 'seconds_played', 840),
      jsonb_build_object('player_id', '7d000000-0000-0000-0000-000000000004', 'side', 'away', 'seconds_played', 840)))
WHERE match_id = '9d000000-0000-0000-0000-000000000002' AND status = 'DRAFT';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
SELECT lives_ok($$SELECT public.confirm_match_replay_review('9d000000-0000-0000-0000-000000000002', 'h-lineup-2', true)$$, 're-confirmation with replacement');
SELECT is((SELECT count(*)::integer FROM public.match_participations WHERE match_id = '9d000000-0000-0000-0000-000000000002'), 2, 'the lineup was replaced by the new sheet, nothing duplicated');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9d000000-0000-0000-0000-000000000002' AND source = 'REPLAY' AND changes->>'kind' = 'lineup' AND jsonb_array_length(before->'lineup') = 3), 1, 'the replaced lineup is in the history');

-- ---------------------------------------------------------------- equivalence with the official statistics
SELECT is(
  (SELECT string_agg(player_id || ':' || g || '/' || a || '/' || o, ',' ORDER BY player_id) FROM (
    SELECT player_id, sum(goals) g, sum(assists) a, sum(own_goals) o FROM public.player_match_stats WHERE competition_id = '2d000000-0000-0000-0000-000000000001' AND (goals + assists + own_goals) > 0 GROUP BY player_id) x),
  (SELECT string_agg(player_id || ':' || goals || '/' || assists || '/' || own_goals, ',' ORDER BY player_id) FROM public.player_competition_statistics WHERE competition_id = '2d000000-0000-0000-0000-000000000001' AND (goals + assists + own_goals) > 0),
  'goals, assists and own goals per player are exactly the official statistics');
SELECT is((SELECT matches || ' ' || wins || '-' || draws || '-' || losses FROM public.player_season_summary WHERE player_id = '7d000000-0000-0000-0000-000000000006'), '2 1-0-1', 'season summary: 2 matches, 1 win (match 2), 1 defeat (match 1)');

-- ---------------------------------------------------------------- security
SELECT throws_ok($$INSERT INTO public.match_participations (match_id, player_id, season_team_id, source) VALUES ('9d000000-0000-0000-0000-000000000001', '7d000000-0000-0000-0000-000000000004', '5d000000-0000-0000-0000-000000000001', 'SHEET')$$,
  '42501', NULL, 'nobody writes the lineup table directly (not even an admin)');
SET LOCAL ROLE anon;
SELECT ok((SELECT count(*) FROM public.player_match_stats WHERE competition_id = '2d000000-0000-0000-0000-000000000001') > 0, 'visitors read the public views');
SELECT throws_ok($$DELETE FROM public.match_participations$$, '42501', NULL, 'visitors cannot change lineups');
RESET ROLE;

-- a player with a registered participation keeps his history
DELETE FROM public.rosters WHERE player_id = '7d000000-0000-0000-0000-000000000004';
SELECT throws_ok($$DELETE FROM public.players WHERE id = '7d000000-0000-0000-0000-000000000004'$$, '23503', NULL, 'a player who played cannot be deleted, even after leaving the roster');
SELECT is((SELECT count(*)::integer FROM public.player_match_participation WHERE player_id = '7d000000-0000-0000-0000-000000000004'), 1, 'his past participation stays after leaving the roster');

SELECT * FROM finish();
ROLLBACK;
