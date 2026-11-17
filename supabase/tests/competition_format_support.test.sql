BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'format-admin@example.invalid', '', now()),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'format-organizer@example.invalid', '', now()),
  ('11000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'format-outsider@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles
SET role = CASE id
  WHEN '11000000-0000-0000-0000-000000000001'::uuid THEN 'ADMIN'
  WHEN '11000000-0000-0000-0000-000000000002'::uuid THEN 'ORGANIZER'
  ELSE 'USER'
END
WHERE id IN (
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000003'
);

INSERT INTO public.competitions (id, name, category, format, status)
VALUES
  ('21000000-0000-0000-0000-000000000001', 'Format test round robin', 'Test', 'Pontos corridos', 'DRAFT'),
  ('21000000-0000-0000-0000-000000000002', 'Format test groups', 'Test', 'Grupos + Mata-mata', 'DRAFT'),
  ('21000000-0000-0000-0000-000000000003', 'Format test knockout', 'Test', 'Mata-mata', 'DRAFT');

INSERT INTO public.seasons (id, competition_id, name)
VALUES
  ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Round robin test'),
  ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'Groups test'),
  ('31000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000003', 'Knockout test');

INSERT INTO public.competition_organizers (competition_id, user_id)
VALUES
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002'),
  ('21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002'),
  ('21000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000002');

INSERT INTO public.teams (id, name)
VALUES
  ('41000000-0000-0000-0000-000000000001', 'Format RR 1'),
  ('41000000-0000-0000-0000-000000000002', 'Format RR 2'),
  ('41000000-0000-0000-0000-000000000003', 'Format RR 3'),
  ('41000000-0000-0000-0000-000000000004', 'Format RR 4'),
  ('41000000-0000-0000-0000-000000000005', 'Format RR 5'),
  ('42000000-0000-0000-0000-000000000001', 'Format Group A1'),
  ('42000000-0000-0000-0000-000000000002', 'Format Group A2'),
  ('42000000-0000-0000-0000-000000000003', 'Format Group B1'),
  ('42000000-0000-0000-0000-000000000004', 'Format Group B2'),
  ('43000000-0000-0000-0000-000000000001', 'Format KO 1'),
  ('43000000-0000-0000-0000-000000000002', 'Format KO 2'),
  ('43000000-0000-0000-0000-000000000003', 'Format KO 3'),
  ('43000000-0000-0000-0000-000000000004', 'Format KO 4');

INSERT INTO public.season_teams (season_id, team_id)
SELECT '31000000-0000-0000-0000-000000000001', id FROM public.teams
WHERE id BETWEEN '41000000-0000-0000-0000-000000000001'::uuid
             AND '41000000-0000-0000-0000-000000000005'::uuid;
INSERT INTO public.season_teams (season_id, team_id)
SELECT '31000000-0000-0000-0000-000000000002', id FROM public.teams
WHERE id BETWEEN '42000000-0000-0000-0000-000000000001'::uuid
             AND '42000000-0000-0000-0000-000000000004'::uuid;
INSERT INTO public.season_teams (season_id, team_id)
SELECT '31000000-0000-0000-0000-000000000003', id FROM public.teams
WHERE id BETWEEN '43000000-0000-0000-0000-000000000001'::uuid
             AND '43000000-0000-0000-0000-000000000004'::uuid;

INSERT INTO public.players (id, nickname, position)
VALUES
  ('91000000-0000-0000-0000-000000000001', 'Format KO player 1', 'Pivô'),
  ('91000000-0000-0000-0000-000000000002', 'Format KO player 2', 'Pivô'),
  ('91000000-0000-0000-0000-000000000003', 'Format KO player 3', 'Pivô'),
  ('91000000-0000-0000-0000-000000000004', 'Format KO player 4', 'Pivô');
INSERT INTO public.rosters (season_team_id, player_id)
SELECT st.id, p.id
FROM public.season_teams st
JOIN public.teams t ON t.id = st.team_id
JOIN public.players p ON p.nickname = 'Format KO player ' || right(t.name, 1)
WHERE st.season_id = '31000000-0000-0000-0000-000000000003';

INSERT INTO public.stages (id, season_id, name, format, settings)
VALUES
  ('61000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Round robin', 'Pontos corridos', '{"legs":2}'::jsonb),
  ('61000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002', 'Group stage', 'Grupos + Mata-mata', '{"group_count":2,"group_legs":1,"qualifiers_per_group":1}'::jsonb),
  ('61000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000003', 'Knockout', 'Mata-mata', '{"knockout_legs":1,"third_place":true}'::jsonb);

SELECT plan(28);

SELECT is(
  (SELECT count(*)::integer FROM public.profiles
   WHERE id IN (
     '11000000-0000-0000-0000-000000000001',
     '11000000-0000-0000-0000-000000000002',
     '11000000-0000-0000-0000-000000000003'
   ) AND role IN ('ADMIN', 'ORGANIZER', 'USER')),
  3,
  'synthetic auth users have synchronized profiles and isolated roles'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_round_robin' AND p.pronargs = 1),
  1,
  'round-robin RPC exists with one argument'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_group_stage' AND p.pronargs = 4),
  1,
  'group-stage RPC exists with four arguments'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_knockout_stage' AND p.pronargs = 3),
  1,
  'knockout RPC exists with three arguments'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.generate_round_robin(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.generate_group_stage(uuid,jsonb,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.generate_knockout_stage(uuid,jsonb,integer)', 'EXECUTE'),
  'anonymous users cannot execute fixture-generation RPCs'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);

SELECT lives_ok(
  $$SELECT public.generate_round_robin('61000000-0000-0000-0000-000000000001')$$,
  'assigned organizer can generate a two-leg round robin'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000001'),
  20,
  'five-team return round robin creates twenty matches'
);
SELECT is(
  (SELECT count(*)::integer FROM public.rounds
   WHERE stage_id = '61000000-0000-0000-0000-000000000001'),
  10,
  'five-team return round robin creates ten rounds with automatic byes'
);
SELECT is(
  (SELECT count(DISTINCT (
      LEAST(m.home_team_id, m.away_team_id),
      GREATEST(m.home_team_id, m.away_team_id),
      r.leg_number
    ))::integer
   FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000001'),
  20,
  'each team pairing occurs exactly once in each leg'
);
SELECT is(
  (SELECT (public.generate_round_robin('61000000-0000-0000-0000-000000000001')->>'already_generated')::boolean),
  true,
  'round-robin RPC is idempotent after generation'
);

SELECT lives_ok(
  $$SELECT public.generate_group_stage(
    '61000000-0000-0000-0000-000000000002',
    jsonb_build_array(
      jsonb_build_object('name', 'Grupo A', 'team_ids', (
        SELECT jsonb_agg(st.id ORDER BY t.name)
        FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
        WHERE st.season_id = '31000000-0000-0000-0000-000000000002'
          AND t.name IN ('Format Group A1', 'Format Group A2')
      )),
      jsonb_build_object('name', 'Grupo B', 'team_ids', (
        SELECT jsonb_agg(st.id ORDER BY t.name)
        FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
        WHERE st.season_id = '31000000-0000-0000-0000-000000000002'
          AND t.name IN ('Format Group B1', 'Format Group B2')
      ))
    ),
    1,
    1
  )$$,
  'assigned organizer can create groups and group fixtures'
);
SELECT is(
  (SELECT count(*)::integer FROM public.stage_groups
   WHERE stage_id = '61000000-0000-0000-0000-000000000002'),
  2,
  'group-stage RPC persists two groups'
);
SELECT is(
  (SELECT count(*)::integer FROM public.stage_group_teams
   WHERE stage_id = '61000000-0000-0000-0000-000000000002'),
  4,
  'group-stage RPC assigns every season team exactly once'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000002'
     AND r.phase_type = 'GROUP'),
  2,
  'two two-team groups create one match each'
);
SELECT is(
  (SELECT count(*)::integer FROM public.stage_standings
   WHERE stage_id = '61000000-0000-0000-0000-000000000002'
     AND stage_group_id IS NOT NULL AND group_name IS NOT NULL),
  4,
  'standings view returns separate group membership rows'
);

SELECT lives_ok(
  $$SELECT public.generate_knockout_stage(
    '61000000-0000-0000-0000-000000000003',
    jsonb_build_array(
      jsonb_build_object(
        'key', 'R1M1', 'round', 1, 'matchNumber', 1, 'legs', 1,
        'home', jsonb_build_object('kind', 'team', 'teamId', (
          SELECT st.id FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
          WHERE st.season_id = '31000000-0000-0000-0000-000000000003' AND t.name = 'Format KO 1'
        )),
        'away', jsonb_build_object('kind', 'team', 'teamId', (
          SELECT st.id FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
          WHERE st.season_id = '31000000-0000-0000-0000-000000000003' AND t.name = 'Format KO 4'
        ))
      ),
      jsonb_build_object(
        'key', 'R1M2', 'round', 1, 'matchNumber', 2, 'legs', 1,
        'home', jsonb_build_object('kind', 'team', 'teamId', (
          SELECT st.id FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
          WHERE st.season_id = '31000000-0000-0000-0000-000000000003' AND t.name = 'Format KO 2'
        )),
        'away', jsonb_build_object('kind', 'team', 'teamId', (
          SELECT st.id FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
          WHERE st.season_id = '31000000-0000-0000-0000-000000000003' AND t.name = 'Format KO 3'
        ))
      ),
      jsonb_build_object(
        'key', 'R2M1', 'round', 2, 'matchNumber', 1, 'legs', 1,
        'home', jsonb_build_object('kind', 'winner', 'sourceKey', 'R1M1'),
        'away', jsonb_build_object('kind', 'winner', 'sourceKey', 'R1M2')
      ),
      jsonb_build_object(
        'key', 'THIRD_PLACE', 'round', 2, 'matchNumber', 1, 'legs', 1, 'thirdPlace', true,
        'home', jsonb_build_object('kind', 'loser', 'sourceKey', 'R1M1'),
        'away', jsonb_build_object('kind', 'loser', 'sourceKey', 'R1M2')
      )
    ),
    1
  )$$,
  'assigned organizer can generate a knockout bracket with a third-place match'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000003'),
  4,
  'two semifinals, final and third-place match are persisted'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000003'
     AND r.name = 'Disputa do terceiro lugar'),
  1,
  'third-place fixture is stored as its own round'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000003'
     AND r.bracket_round = 2 AND m.home_source_outcome = 'WINNER'
     AND m.away_source_outcome = 'WINNER'),
  1,
  'final is linked to both semifinal winners'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000003'
     AND r.name = 'Disputa do terceiro lugar'
     AND m.home_source_outcome = 'LOSER' AND m.away_source_outcome = 'LOSER'),
  1,
  'third-place match is linked to both semifinal losers'
);
SELECT throws_ok(
  $$SELECT public.generate_knockout_stage('61000000-0000-0000-0000-000000000003', '[]'::jsonb, 1)$$,
  '23514',
  NULL,
  'knockout generation cannot create duplicate fixtures'
);
SELECT throws_ok(
  $$SELECT public.generate_group_stage(
    '61000000-0000-0000-0000-000000000002', '[]'::jsonb, 1, 1
  )$$,
  '42501',
  NULL,
  'unassigned user cannot generate group fixtures'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::integer FROM public.stage_groups
   WHERE stage_id = '61000000-0000-0000-0000-000000000002'),
  2,
  'public visitors can read group labels'
);
SELECT throws_ok(
  $$INSERT INTO public.stage_groups (stage_id, name, group_order)
    VALUES ('61000000-0000-0000-0000-000000000002', 'Anonymous group', 99)$$,
  '42501',
  NULL,
  'public visitors cannot create competition groups'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
SELECT lives_ok(
  $test$DO $body$
  BEGIN
    UPDATE public.matches m SET status = 'LIVE'
    FROM public.rounds r
    WHERE r.id = m.round_id
      AND r.stage_id = '61000000-0000-0000-0000-000000000003'
      AND r.bracket_round = 1;

    INSERT INTO public.match_events (match_id, event_type, period, minute_seconds, team_id, player_id)
    SELECT m.id, 'GOAL', 'REGULATION', 60, m.home_team_id, roster.player_id
    FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id
    JOIN public.rosters roster ON roster.season_team_id = m.home_team_id
    WHERE r.stage_id = '61000000-0000-0000-0000-000000000003'
      AND r.bracket_round = 1;

    UPDATE public.matches m SET status = 'FINISHED'
    FROM public.rounds r
    WHERE r.id = m.round_id
      AND r.stage_id = '61000000-0000-0000-0000-000000000003'
      AND r.bracket_round = 1;
  END
  $body$$test$,
  'finishing semifinals calculates scores and advances the bracket'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000003'
     AND r.bracket_round = 1 AND m.status = 'FINISHED'),
  2,
  'both synthetic semifinals finish through event-derived scores'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '61000000-0000-0000-0000-000000000003'
     AND r.bracket_round = 2 AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL),
  2,
  'semifinal winners and losers automatically populate final and third-place match'
);
SELECT throws_ok(
  $$UPDATE public.matches m
    SET home_team_id = '53000000-0000-0000-0000-000000000001'
    FROM public.rounds r
    WHERE r.id = m.round_id
      AND r.stage_id = '61000000-0000-0000-0000-000000000003'
      AND r.bracket_round = 1
      AND m.id = (
        SELECT candidate.id
        FROM public.matches candidate
        JOIN public.rounds candidate_round ON candidate_round.id = candidate.round_id
        WHERE candidate_round.stage_id = '61000000-0000-0000-0000-000000000003'
          AND candidate_round.bracket_round = 1
        LIMIT 1
      )$$,
  '23514',
  NULL,
  'a played match cannot have its participants changed'
);

SELECT * FROM finish();
ROLLBACK;
