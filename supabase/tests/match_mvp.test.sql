BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- MVP of the match (migration 20261123130000_match_mvp.sql).
-- Each match below is one scenario, registered like a live match.

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at) VALUES
  ('1e000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mvp-admin@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1e000000-0000-0000-0000-000000000001';

INSERT INTO public.competitions (id, name, category, format, status) VALUES ('2e000000-0000-0000-0000-000000000001', 'MVP test', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.seasons (id, competition_id, name) VALUES ('3e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000001', 'MVP');
INSERT INTO public.teams (id, name) VALUES ('4e000000-0000-0000-0000-000000000001', 'MVP Home'), ('4e000000-0000-0000-0000-000000000002', 'MVP Away');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000001', '4e000000-0000-0000-0000-000000000001'),
  ('5e000000-0000-0000-0000-000000000002', '3e000000-0000-0000-0000-000000000001', '4e000000-0000-0000-0000-000000000002');
-- home: A (striker), B (assists), C (plays, no events), G1/G2 keepers, H1 (own goal) · away: V1, V2, W (keeper)
INSERT INTO public.players (id, nickname, position) VALUES
  ('7e000000-0000-0000-0000-00000000000a', 'mvp A', 'Pivô'),
  ('7e000000-0000-0000-0000-00000000000b', 'mvp B', 'Volante'),
  ('7e000000-0000-0000-0000-00000000000c', 'mvp C', 'Volante'),
  ('7e000000-0000-0000-0000-000000000001', 'mvp G1', 'Goleiro'),
  ('7e000000-0000-0000-0000-000000000002', 'mvp G2', 'Goleiro'),
  ('7e000000-0000-0000-0000-0000000000a1', 'mvp H1', 'Volante'),
  ('7e000000-0000-0000-0000-0000000000f1', 'mvp V1', 'Pivô'),
  ('7e000000-0000-0000-0000-0000000000f2', 'mvp V2', 'Volante'),
  ('7e000000-0000-0000-0000-0000000000ff', 'mvp W', 'Goleiro');
INSERT INTO public.rosters (season_team_id, player_id)
SELECT '5e000000-0000-0000-0000-000000000001'::uuid, id FROM public.players WHERE id IN ('7e000000-0000-0000-0000-00000000000a', '7e000000-0000-0000-0000-00000000000b', '7e000000-0000-0000-0000-00000000000c', '7e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-0000000000a1')
UNION ALL
SELECT '5e000000-0000-0000-0000-000000000002'::uuid, id FROM public.players WHERE id IN ('7e000000-0000-0000-0000-0000000000f1', '7e000000-0000-0000-0000-0000000000f2', '7e000000-0000-0000-0000-0000000000ff');
-- one stage per scenario (a pair of teams meets once per leg in a round-robin stage)
INSERT INTO public.stages (id, season_id, name, format, stage_order)
SELECT ('6e000000-0000-0000-0000-00000000000' || n)::uuid, '3e000000-0000-0000-0000-000000000001', 'MVP stage ' || n, 'Pontos corridos', n FROM generate_series(1, 7) n;
INSERT INTO public.rounds (id, stage_id, name, round_order, leg_number)
SELECT ('8e000000-0000-0000-0000-00000000000' || n)::uuid, ('6e000000-0000-0000-0000-00000000000' || n)::uuid, 'R1', 1, 1 FROM generate_series(1, 7) n;
-- one match per stage
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status, duration_seconds)
SELECT ('9e000000-0000-0000-0000-00000000000' || n)::uuid, ('8e000000-0000-0000-0000-00000000000' || n)::uuid,
  '5e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000002', 'SCHEDULED', 840
FROM generate_series(1, 7) n;

-- starters in goal before kick-off (normal flow)
INSERT INTO public.goalkeeper_participations (match_id, team_id, player_id) VALUES
  ('9e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001'), -- M1 G1
  ('9e000000-0000-0000-0000-000000000006', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001'), -- M6 G1, replaced by G2
  ('9e000000-0000-0000-0000-000000000007', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001'); -- M7 G1
UPDATE public.matches SET status = 'LIVE' WHERE id::text LIKE '9e000000-%' AND id <> '9e000000-0000-0000-0000-000000000005';

CREATE FUNCTION pg_temp.goal(m text, team text, player text, sec integer, own boolean DEFAULT false, assist text DEFAULT NULL, meta jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$
DECLARE g uuid;
BEGIN
  INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, is_own_goal, metadata)
  VALUES (m::uuid, 'GOAL', 'REGULATION', sec, team::uuid, player::uuid, own, meta) RETURNING id INTO g;
  IF assist IS NOT NULL THEN
    INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id, goal_event_id)
    VALUES (m::uuid, 'ASSIST', 'REGULATION', sec, team::uuid, assist::uuid, g);
  END IF;
END $$;

-- M1: the example of the proposal. A 4 goals (2 assisted by B), V1 scores at 8:20 (500 s); G1 in goal all match. 4 x 1
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', 100, false, '7e000000-0000-0000-0000-00000000000b'); END $$;
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', 200, false, '7e000000-0000-0000-0000-00000000000b'); END $$;
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', 300); END $$;
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', 400); END $$;
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-0000000000f1', 500); END $$;
-- M2: own goal. H1 own goal (counts for away) + A scores: 1 x 1
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-0000000000a1', 100, true); END $$;
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', 200); END $$;
-- M3: tie at the top. A and V1 score: 1 x 1
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000003', '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a', 100); END $$;
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000003', '5e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-0000000000f1', 200); END $$;
-- M4: 0 x 0 (lineup registered later, nobody scores)
-- M5: W.O. registered as 1 x 0 without author ("Registrar resultado", below)
-- M6: goalkeeper change at 7:00 (G1 out, G2 in at 421 s); V1 scores at 500 s: 0 x 1
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id) VALUES
  ('9e000000-0000-0000-0000-000000000006', 'GOALKEEPER_OUT', 'REGULATION', 420, '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001');
INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id) VALUES
  ('9e000000-0000-0000-0000-000000000006', 'GOALKEEPER_IN', 'REGULATION', 421, '5e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000002');
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000006', '5e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-0000000000f1', 500); END $$;
-- M7: goal conceded with unknown minute (registered as second 0 + minute_unknown): 0 x 1
DO $$ BEGIN PERFORM pg_temp.goal('9e000000-0000-0000-0000-000000000007', '5e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-0000000000f2', 0, false, NULL, '{"minute_unknown": true}'); END $$;

UPDATE public.matches SET status = 'FINISHED' WHERE id::text LIKE '9e000000-%' AND id <> '9e000000-0000-0000-0000-000000000005';
-- M1: C played (lineup) without goals; M4: lineup of a goalless draw
INSERT INTO public.match_participations (match_id, player_id, season_team_id, source) VALUES
  ('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000c', '5e000000-0000-0000-0000-000000000001', 'SHEET'),
  ('9e000000-0000-0000-0000-000000000004', '7e000000-0000-0000-0000-00000000000a', '5e000000-0000-0000-0000-000000000001', 'SHEET'),
  ('9e000000-0000-0000-0000-000000000004', '7e000000-0000-0000-0000-0000000000f1', '5e000000-0000-0000-0000-000000000002', 'SHEET');
UPDATE public.competitions SET status = 'REGISTRATION' WHERE id = '2e000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true); END $$;
DO $$ BEGIN PERFORM public.record_retroactive_match_result('9e000000-0000-0000-0000-000000000005', NULL, 840, jsonb_build_array(jsonb_build_object('team_id', '5e000000-0000-0000-0000-000000000001')), 1, 0); END $$;
RESET ROLE;

CREATE FUNCTION pg_temp.line(m text, p text) RETURNS text LANGUAGE sql AS $$
  SELECT points_goals || '/' || points_assists || '/' || points_keeper || '/' || points_win || '/' || points_own_goals || '=' || total || CASE WHEN is_mvp THEN ' MVP' ELSE '' END
  FROM public.match_mvp_scores WHERE match_id = m::uuid AND player_id = p::uuid
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated;

SELECT plan(51);

-- M1
SELECT is((SELECT home_score || 'x' || away_score FROM public.matches WHERE id = '9e000000-0000-0000-0000-000000000001'), '4x1', 'M1 finished 4 x 1');
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000a'), '12/0/0/2/0=14 MVP', 'M1: 4 goals + win = 14, MVP');
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000b'), '0/4/0/2/0=6', 'M1: 2 assists + win = 6');
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-000000000001'), '0/0/6/2/0=8', 'M1: keeper conceded at 500 s -> blocks 4 (500 s) + 2 (340 s) + win = 8');
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-00000000000c'), '0/0/0/2/0=2', 'M1: a lineup player without events gets only the win bonus');
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000001', '7e000000-0000-0000-0000-0000000000f1'), '3/0/0/0/0=3', 'M1: scorer of the losing side, no bonus');
SELECT is((SELECT count(*)::integer FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000001' AND player_id = '7e000000-0000-0000-0000-0000000000f2'), 0, 'M1: a player without proven participation is not a candidate');
SELECT is((SELECT keeper_seconds || ' ' || keeper_goals_conceded FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000001' AND player_id = '7e000000-0000-0000-0000-000000000001'), '840 1', 'M1: keeper time and goals conceded are explained');
-- M2
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000002', '7e000000-0000-0000-0000-0000000000a1'), '0/0/0/0/-3=-3', 'M2: own goal is -3 and never a goal');
SELECT is((SELECT goals FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000002' AND player_id = '7e000000-0000-0000-0000-0000000000a1'), 0, 'M2: the own goal is not counted as a goal of its author');
SELECT is((SELECT string_agg(player_id::text, ',') FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000002' AND is_mvp), '7e000000-0000-0000-0000-00000000000a', 'M2: draw (no bonus), A is the MVP with 3');
-- M3
SELECT is((SELECT string_agg(player_id::text, ',' ORDER BY player_id) FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000003' AND is_mvp), '7e000000-0000-0000-0000-00000000000a,7e000000-0000-0000-0000-0000000000f1', 'M3: tie at the top -> shared MVP');
SELECT is((SELECT DISTINCT mvp_count FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000003'), 2, 'M3: two MVPs');
-- M4
SELECT is((SELECT count(*) FILTER (WHERE is_mvp) || '/' || count(*) FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000004'), '0/2', 'M4: nobody with a positive total -> no MVP');
-- M5
SELECT is((SELECT count(*)::integer FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000005'), 0, 'M5: W.O. without authors has no candidates and no MVP');
-- M5 with its lineup filled afterwards: the winners are candidates with the win bonus,
-- but a goal without author and no review yet keeps the MVP pending
INSERT INTO public.match_participations (match_id, player_id, season_team_id, source) VALUES
  ('9e000000-0000-0000-0000-000000000005', '7e000000-0000-0000-0000-00000000000a', '5e000000-0000-0000-0000-000000000001', 'SHEET'),
  ('9e000000-0000-0000-0000-000000000005', '7e000000-0000-0000-0000-00000000000c', '5e000000-0000-0000-0000-000000000001', 'SHEET');
SELECT is((SELECT mvp_status || ' ' || goals_without_author FROM public.match_mvp_state WHERE match_id = '9e000000-0000-0000-0000-000000000005'), 'PENDING_REVIEW 1',
  'M5: goal without author, not reviewed -> MVP pending review');
SELECT is((SELECT count(*) || ' ' || bool_and(won) || ' ' || count(*) FILTER (WHERE is_mvp) FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000005'), '2 true 0',
  'M5 + lineup, pending: candidates with the win, but no MVP yet');
SELECT is((SELECT string_agg(DISTINCT mvp_status, ',') FROM public.match_mvp_state WHERE match_id IN ('9e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000003', '9e000000-0000-0000-0000-000000000006')), 'NORMAL',
  'matches with complete events are NORMAL (calculated as usual)');
-- M6
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000006', '7e000000-0000-0000-0000-000000000001'), '0/0/3/0/0=3', 'M6: first keeper, 420 s clean -> 3 blocks');
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000006', '7e000000-0000-0000-0000-000000000002'), '0/0/2/0/0=2', 'M6: second keeper from 421 s, conceded at 500 s: 79 s (0) + 340 s (2)');
SELECT is((SELECT string_agg(player_id::text, ',') FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000006' AND is_mvp), '7e000000-0000-0000-0000-0000000000f1', 'M6: V1 goal + win = 5 is the MVP');
-- M7
SELECT is((SELECT keeper_blocks || ' ' || keeper_time_unknown FROM public.match_mvp_scores WHERE match_id = '9e000000-0000-0000-0000-000000000007' AND player_id = '7e000000-0000-0000-0000-000000000001'), '0 true',
  'M7: a goal conceded with unknown minute gives no keeper points (flagged)');

-- every candidate appears once per match
SELECT is((SELECT count(*) - count(DISTINCT (match_id, player_id)) FROM public.match_mvp_scores WHERE competition_id = '2e000000-0000-0000-0000-000000000001')::integer, 0, 'one line per player per match');

-- a corrected sheet changes the MVP immediately (M3: V1's goal becomes A's second goal -> 2 x 0)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(format($$SELECT public.edit_match_sheet('9e000000-0000-0000-0000-000000000003', %L, %L, 'gol corrigido')$$,
  public.match_sheet_fingerprint('9e000000-0000-0000-0000-000000000003'),
  jsonb_build_object('score', jsonb_build_object('home', 2, 'away', 0), 'goals', jsonb_build_array(
    jsonb_build_object('team_id', '5e000000-0000-0000-0000-000000000001', 'player_id', '7e000000-0000-0000-0000-00000000000a', 'is_own_goal', false, 'minute_seconds', 100),
    jsonb_build_object('team_id', '5e000000-0000-0000-0000-000000000001', 'player_id', '7e000000-0000-0000-0000-00000000000a', 'is_own_goal', false, 'minute_seconds', 200)))),
  'M3 corrected');
RESET ROLE;
SELECT is(pg_temp.line('9e000000-0000-0000-0000-000000000003', '7e000000-0000-0000-0000-00000000000a'), '6/0/0/2/0=8 MVP', 'M3 after the correction: A alone, 2 goals + win');


-- reviews of a goal without author (admin)
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true); END $$;
SELECT throws_ok($$SELECT public.review_match_mvp('9e000000-0000-0000-0000-000000000005', 'VALID', '')$$, '22023', NULL, 'a review needs a reason');
SELECT throws_ok($$SELECT public.review_match_mvp('9e000000-0000-0000-0000-000000000001', 'VALID', 'conferido')$$, '23514', NULL, 'VALID is refused where no goal lacks its author');
SELECT lives_ok($$SELECT public.review_match_mvp('9e000000-0000-0000-0000-000000000005', 'VALID', 'jogo aconteceu, autor do gol desconhecido')$$, 'M5 reviewed as a legitimate match');
SELECT is(public.match_mvp('9e000000-0000-0000-0000-000000000005')->>'status', 'NORMAL', 'M5 legitimate: status NORMAL');
SELECT is((SELECT string_agg(r->>'player_id', ',' ORDER BY r->>'player_id') FROM jsonb_array_elements(public.match_mvp('9e000000-0000-0000-0000-000000000005')->'rows') r WHERE (r->>'is_mvp')::boolean),
  '7e000000-0000-0000-0000-00000000000a,7e000000-0000-0000-0000-00000000000c', 'M5 legitimate: calculated normally (the goal without author gives nobody points; win bonus shared)');
SELECT lives_ok($$SELECT public.review_match_mvp('9e000000-0000-0000-0000-000000000005', 'WALKOVER', 'W.O. confirmado pela organização')$$, 'M5 identified as an official W.O.');
SELECT is((SELECT (j->>'status') || ' ' || (SELECT count(*) FROM jsonb_array_elements(j->'rows') r WHERE (r->>'is_mvp')::boolean)
  FROM (SELECT public.match_mvp('9e000000-0000-0000-0000-000000000005') j) x), 'WALKOVER 0', 'official W.O.: no MVP even with a lineup');
SELECT is((SELECT count(*)::integer FROM public.match_edit_history WHERE match_id = '9e000000-0000-0000-0000-000000000005' AND changes->>'kind' = 'mvp_review'), 2, 'every review is in the edit history');
RESET ROLE;
-- access: the MVP result is closed while the switch is off; goalkeeper statistics are not
SELECT is((SELECT enabled FROM public.feature_flags WHERE key = 'mvp_public'), false, 'the MVP switch starts off');
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '', true); END $$;
SELECT throws_ok($$SELECT count(*) FROM public.match_mvp_scores$$, '42501', NULL, 'visitors cannot read the MVP breakdown view');
SELECT throws_ok($$SELECT count(*) FROM public.match_mvp_state$$, '42501', NULL, 'visitors cannot read the MVP status view');
SELECT is(public.match_mvp('9e000000-0000-0000-0000-000000000001'), '{"enabled": false}'::jsonb, 'switch off: visitors get no MVP of a match');
SELECT is((SELECT count(*)::integer FROM public.mvp_results()), 0, 'switch off: visitors get no MVP awards');
SELECT ok((SELECT count(*) FROM public.player_match_keeping WHERE competition_id = '2e000000-0000-0000-0000-000000000001') > 0, 'goalkeeper statistics stay public with the switch off');
SELECT ok((SELECT count(*) FROM public.match_keeper_spells WHERE match_id = '9e000000-0000-0000-0000-000000000006') = 2, 'visitors read the goalkeeper spells');
SELECT throws_ok($$SELECT public.set_feature_flag('mvp_public', true, 'tentativa')$$, '42501', NULL, 'visitors cannot turn the MVP on');
RESET ROLE;
-- a manager previews while it is off
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true); END $$;
SELECT is((SELECT (j->>'preview') || ' ' || jsonb_array_length(j->'rows') FROM (SELECT public.match_mvp('9e000000-0000-0000-0000-000000000001') j) x), 'true 5', 'switch off: an admin previews the full breakdown');
SELECT is((SELECT count(*)::integer FROM public.mvp_results()), 0, 'profiles and rankings never preview');
SELECT throws_ok($$SELECT public.set_feature_flag('mvp_public', true, '')$$, '22023', NULL, 'turning the MVP on needs a reason');
SELECT lives_ok($$SELECT public.set_feature_flag('mvp_public', true, 'escalações revisadas')$$, 'an admin turns the MVP on');
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '', true); END $$;
SELECT is((SELECT (j->>'enabled') || ' ' || (j->>'status') || ' ' || jsonb_array_length(j->'rows') FROM (SELECT public.match_mvp('9e000000-0000-0000-0000-000000000001') j) x), 'true NORMAL 5', 'switch on: visitors read the breakdown');
SELECT is((SELECT (j->>'status') || ' ' || jsonb_array_length(j->'rows') FROM (SELECT public.match_mvp('9e000000-0000-0000-0000-000000000005') j) x), 'WALKOVER 0', 'switch on: a W.O. shows its status and no breakdown');
SELECT ok((SELECT count(*) FROM public.mvp_results() WHERE competition_id = '2e000000-0000-0000-0000-000000000001') > 0, 'switch on: visitors read the MVP awards');
SELECT throws_ok($$SELECT count(*) FROM public.match_mvp_scores$$, '42501', NULL, 'switch on: the views themselves stay closed');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.feature_flag_changes WHERE key = 'mvp_public'), 1, 'the activation is recorded with its reason');

SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000099', true); END $$;
SELECT throws_ok($$SELECT public.review_match_mvp('00000000-0000-0000-0000-000000000000', 'VALID', 'sonda')$$, '42501', NULL, 'without permission nobody learns whether a match exists');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
