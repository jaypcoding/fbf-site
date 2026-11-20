BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Scenario mirroring the recovery: a published group stage (4 groups x 4,
-- home and away) whose six shared rounds were created by hand, all marked as
-- first leg, with one match already finished with events.

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('17000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recovery-admin@example.invalid', '', now()),
  ('17000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recovery-organizer@example.invalid', '', now()),
  ('17000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recovery-outsider@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles
SET role = CASE id
  WHEN '17000000-0000-0000-0000-000000000001'::uuid THEN 'ADMIN'
  WHEN '17000000-0000-0000-0000-000000000002'::uuid THEN 'ORGANIZER'
  ELSE 'USER'
END
WHERE id IN ('17000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000003');

INSERT INTO public.competitions (id, name, category, format, status)
VALUES
  ('27000000-0000-0000-0000-000000000001', 'Recovery published', 'Test', 'Grupos + Mata-mata', 'DRAFT'),
  ('27000000-0000-0000-0000-000000000002', 'Recovery draft', 'Test', 'Grupos + Mata-mata', 'DRAFT');
UPDATE public.competitions SET status = 'REGISTRATION' WHERE id = '27000000-0000-0000-0000-000000000001';
INSERT INTO public.seasons (id, competition_id, name)
VALUES
  ('37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'Recovery season'),
  ('37000000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-000000000002', 'Draft season');
INSERT INTO public.competition_organizers (competition_id, user_id)
VALUES
  ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002'),
  ('27000000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000002');

INSERT INTO public.teams (id, name)
SELECT ('47000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Recovery team ' || lpad(n::text, 2, '0')
FROM generate_series(1, 16) AS n;
INSERT INTO public.season_teams (id, season_id, team_id)
SELECT ('57000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '37000000-0000-0000-0000-000000000001',
  ('47000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid
FROM generate_series(1, 16) AS n;

INSERT INTO public.players (id, nickname, position)
VALUES
  ('97000000-0000-0000-0000-000000000001', 'Recovery scorer', 'Pivô'),
  ('97000000-0000-0000-0000-000000000002', 'Recovery assistant', 'Volante'),
  ('97000000-0000-0000-0000-000000000003', 'Recovery defender', 'Volante');
INSERT INTO public.rosters (season_team_id, player_id)
VALUES
  ('57000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001'),
  ('57000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002'),
  ('57000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000003');

INSERT INTO public.stages (id, season_id, name, format, settings)
VALUES
  ('67000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 'Fase de grupos', 'Grupos + Mata-mata',
   '{"group_count":4,"group_legs":2,"qualifiers_per_group":2,"knockout_legs":2,"third_place":false,"group_crossing":"RANKED"}'::jsonb),
  ('67000000-0000-0000-0000-000000000002', '37000000-0000-0000-0000-000000000002', 'Fase de grupos', 'Grupos + Mata-mata',
   '{"group_count":4,"group_legs":2,"qualifiers_per_group":2}'::jsonb);
-- Six shared rounds created by hand: default type and first leg, like production.
INSERT INTO public.rounds (id, stage_id, name, round_order)
SELECT ('77000000-0000-0000-0000-00000000000' || n)::uuid, '67000000-0000-0000-0000-000000000001', 'Rodada ' || n, n
FROM generate_series(1, 6) AS n;

-- Match already played and finished in round 1: team 03 x team 04, 2 x 1,
-- one goal with assist, one own goal and one goal by the visitors, all with
-- named players (live events always name the player).
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, scheduled_at)
VALUES ('87000000-0000-0000-0000-000000000001', '77000000-0000-0000-0000-000000000001',
        '57000000-0000-0000-0000-000000000003', '57000000-0000-0000-0000-000000000004', '2026-11-16T03:00:00Z');
UPDATE public.matches SET status = 'LIVE' WHERE id = '87000000-0000-0000-0000-000000000001';
INSERT INTO public.match_events (id, match_id, event_type, minute_seconds, team_id, player_id)
VALUES ('88000000-0000-0000-0000-000000000001', '87000000-0000-0000-0000-000000000001', 'GOAL', 17,
        '57000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001');
INSERT INTO public.match_events (match_id, event_type, minute_seconds, team_id, player_id, goal_event_id)
VALUES ('87000000-0000-0000-0000-000000000001', 'ASSIST', 17, '57000000-0000-0000-0000-000000000003',
        '97000000-0000-0000-0000-000000000002', '88000000-0000-0000-0000-000000000001');
INSERT INTO public.match_events (match_id, event_type, minute_seconds, team_id, player_id, is_own_goal)
VALUES ('87000000-0000-0000-0000-000000000001', 'GOAL', 49, '57000000-0000-0000-0000-000000000004',
        '97000000-0000-0000-0000-000000000003', true);
INSERT INTO public.match_events (match_id, event_type, minute_seconds, team_id, player_id)
VALUES ('87000000-0000-0000-0000-000000000001', 'GOAL', 154, '57000000-0000-0000-0000-000000000004',
        '97000000-0000-0000-0000-000000000003');
UPDATE public.matches SET status = 'FINISHED' WHERE id = '87000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE recovery_before AS
SELECT m.id, m.round_id, m.home_team_id, m.away_team_id, m.scheduled_at, m.status, m.home_score, m.away_score,
  m.duration_seconds, m.score_source, m.updated_at,
  (SELECT jsonb_agg(to_jsonb(e) - 'created_at' ORDER BY e.id) FROM public.match_events e WHERE e.match_id = m.id) AS events
FROM public.matches m WHERE m.id = '87000000-0000-0000-0000-000000000001';

-- The official table. Group order: A = 01-04, B = 05-08, C = 09-12, D = 13-16.
-- Round 4-6 repeat rounds 1-3 with home and away inverted.
CREATE TEMP TABLE recovery_plan AS
WITH grouped(group_order, name, ids) AS (
  SELECT g, 'Grupo ' || chr(64 + g),
    ARRAY(SELECT ('57000000-0000-0000-0000-0000000000' || lpad(((g - 1) * 4 + k)::text, 2, '0'))::uuid
          FROM generate_series(1, 4) AS k ORDER BY k)
  FROM generate_series(1, 4) AS g
),
pattern(round_order, h, a) AS (
  VALUES (1, 1, 2), (1, 3, 4), (2, 3, 2), (2, 1, 4), (3, 1, 3), (3, 4, 2),
         (4, 2, 1), (4, 4, 3), (5, 2, 3), (5, 4, 1), (6, 3, 1), (6, 2, 4)
)
SELECT
  (SELECT jsonb_agg(jsonb_build_object('name', name, 'team_ids', to_jsonb(ids)) ORDER BY group_order) FROM grouped) AS groups,
  (SELECT jsonb_agg(jsonb_build_object(
      'round_order', p.round_order,
      'home_team_id', g.ids[p.h],
      'away_team_id', g.ids[p.a],
      'scheduled_at', CASE WHEN p.round_order = 1 AND g.group_order = 2 AND p.h = 1 THEN '2026-11-21T23:00:00Z' END
    ) ORDER BY p.round_order, g.group_order, p.h)
   FROM grouped g CROSS JOIN pattern p) AS matches;
GRANT SELECT ON recovery_plan, recovery_before TO authenticated;

CREATE TEMP VIEW recovery_existing AS
SELECT COALESCE(string_agg(m.id::text || ':' || m.status, ',' ORDER BY m.id), '') AS fingerprint
FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
WHERE r.stage_id = '67000000-0000-0000-0000-000000000001';
GRANT SELECT ON recovery_existing TO authenticated;

SELECT plan(32);

SELECT ok(
  NOT has_function_privilege('anon', 'public.apply_group_schedule(uuid,jsonb,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_retroactive_match_result(uuid,timestamptz,integer,jsonb,integer,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.apply_group_schedule(uuid,jsonb,jsonb,text)', 'EXECUTE'),
  'only signed-in users can call the recovery RPCs'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000003', true);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan), (SELECT matches FROM recovery_plan), (SELECT fingerprint FROM recovery_existing))$$,
  '%Sem permissão%',
  'a user without a role on the competition cannot generate the table'
);

SELECT set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000002', (SELECT groups FROM recovery_plan), (SELECT matches FROM recovery_plan), '')$$,
  '%publicadas%',
  'a draft competition cannot receive the table'
);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan),
      jsonb_set((SELECT matches FROM recovery_plan), '{0,away_team_id}', '"57000000-0000-0000-0000-000000000005"'),
      (SELECT fingerprint FROM recovery_existing))$$,
  '%grupos diferentes%',
  'a match between teams of different groups is refused'
);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan),
      (SELECT matches FROM recovery_plan) - 47, (SELECT fingerprint FROM recovery_existing))$$,
  '%rodadas completas%',
  'an incomplete table is refused'
);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan),
      jsonb_set(jsonb_set((SELECT matches FROM recovery_plan), '{24,home_team_id}', '"57000000-0000-0000-0000-000000000001"'),
                '{24,away_team_id}', '"57000000-0000-0000-0000-000000000002"'),
      (SELECT fingerprint FROM recovery_existing))$$,
  '%inverter o mando%',
  'a second leg that repeats the home team is refused'
);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000001',
      jsonb_set((SELECT groups FROM recovery_plan), '{0,team_ids,0}', '"57000000-0000-0000-0000-000000000005"'),
      (SELECT matches FROM recovery_plan), (SELECT fingerprint FROM recovery_existing))$$,
  '%mais de um grupo%',
  'a team placed in two groups is refused'
);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan),
      jsonb_set(jsonb_set(jsonb_set(jsonb_set((SELECT matches FROM recovery_plan),
        '{1,home_team_id}', '"57000000-0000-0000-0000-000000000004"'), '{1,away_team_id}', '"57000000-0000-0000-0000-000000000003"'),
        '{25,home_team_id}', '"57000000-0000-0000-0000-000000000003"'), '{25,away_team_id}', '"57000000-0000-0000-0000-000000000004"'),
      (SELECT fingerprint FROM recovery_existing))$$,
  '%não corresponde à tabela%',
  'a table that contradicts an existing match (inverted home) is refused'
);
SELECT throws_like(
  $$SELECT public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan), (SELECT matches FROM recovery_plan), '')$$,
  '%mudaram desde a prévia%',
  'a preview that no longer matches the stored matches is refused'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '67000000-0000-0000-0000-000000000001'),
  1,
  'refused attempts write nothing'
);

SELECT is(
  public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan),
    (SELECT matches FROM recovery_plan), (SELECT fingerprint FROM recovery_existing))
    - 'matches_total',
  '{"groups_created": true, "rounds_created": 0, "rounds_updated": 3, "matches_created": 47, "matches_existing": 1, "already_complete": false}'::jsonb,
  'the organizer generates the 47 missing matches, registers the groups and marks rounds 4-6 as second leg'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '67000000-0000-0000-0000-000000000001'),
  48,
  'the stage has the complete table of 48 matches'
);
SELECT ok(
  (SELECT to_jsonb(b) FROM recovery_before b) = (
    SELECT to_jsonb(x) FROM (
      SELECT m.id, m.round_id, m.home_team_id, m.away_team_id, m.scheduled_at, m.status, m.home_score, m.away_score,
        m.duration_seconds, m.score_source, m.updated_at,
        (SELECT jsonb_agg(to_jsonb(e) - 'created_at' ORDER BY e.id) FROM public.match_events e WHERE e.match_id = m.id) AS events
      FROM public.matches m WHERE m.id = '87000000-0000-0000-0000-000000000001'
    ) x
  ),
  'the finished match, its score and all its events are untouched'
);
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '67000000-0000-0000-0000-000000000001' AND m.id <> '87000000-0000-0000-0000-000000000001'
     AND m.status = 'SCHEDULED' AND m.home_score IS NULL),
  47,
  'every new match starts scheduled and without a score'
);
SELECT is(
  (SELECT array_agg(leg_number ORDER BY round_order) FROM public.rounds WHERE stage_id = '67000000-0000-0000-0000-000000000001'),
  ARRAY[1, 1, 1, 2, 2, 2],
  'rounds 1-3 are the first leg and rounds 4-6 the second'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.matches a
    JOIN public.rounds ra ON ra.id = a.round_id AND ra.stage_id = '67000000-0000-0000-0000-000000000001'
    WHERE (SELECT count(*) FROM public.matches b JOIN public.rounds rb ON rb.id = b.round_id
           WHERE rb.stage_id = ra.stage_id AND b.home_team_id = a.away_team_id AND b.away_team_id = a.home_team_id
             AND rb.leg_number <> ra.leg_number) <> 1
  ),
  'each pair meets exactly twice, once at each home'
);
SELECT is(
  (SELECT count(*)::integer FROM public.stage_group_teams WHERE stage_id = '67000000-0000-0000-0000-000000000001'),
  16,
  'the four groups and their sixteen teams are registered'
);
SELECT is(
  (SELECT m.scheduled_at FROM public.matches m
   WHERE m.round_id = '77000000-0000-0000-0000-000000000001' AND m.home_team_id = '57000000-0000-0000-0000-000000000005'),
  '2026-11-21T23:00:00Z'::timestamptz,
  'a planned date is stored; matches without a date stay without one'
);
SELECT is(
  public.apply_group_schedule('67000000-0000-0000-0000-000000000001', (SELECT groups FROM recovery_plan),
    (SELECT matches FROM recovery_plan), (SELECT fingerprint FROM recovery_existing))->>'already_complete',
  'true',
  'generating again changes nothing'
);
SELECT throws_like(
  $$INSERT INTO public.matches (round_id, home_team_id, away_team_id)
    VALUES ('77000000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000003')$$,
  '%mesma rodada%',
  'a team cannot get a second match in the same round'
);
SELECT lives_ok(
  $$INSERT INTO public.rounds (id, stage_id, name, round_order) VALUES ('77000000-0000-0000-0000-000000000007', '67000000-0000-0000-0000-000000000001', 'Extra', 7)$$,
  'an extra empty round can still be created'
);
SELECT throws_like(
  $$INSERT INTO public.matches (round_id, home_team_id, away_team_id)
    VALUES ('77000000-0000-0000-0000-000000000007', '57000000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000005')$$,
  '%mesmo grupo%',
  'a manual match between groups is refused once groups exist'
);

-- Retroactive results ------------------------------------------------------
SELECT throws_like(
  $$SELECT public.record_retroactive_match_result(
      (SELECT id FROM public.matches WHERE round_id = '77000000-0000-0000-0000-000000000001' AND home_team_id = '57000000-0000-0000-0000-000000000005'),
      NULL, NULL,
      '[{"team_id":"57000000-0000-0000-0000-000000000005"}]'::jsonb, 2, 0)$$,
  '%resultam em 1 × 0%',
  'a result whose goals do not add up to the official score is refused'
);
SELECT is(
  (SELECT status || ':' || (SELECT count(*) FROM public.match_events e WHERE e.match_id = m.id)
   FROM public.matches m WHERE round_id = '77000000-0000-0000-0000-000000000001' AND home_team_id = '57000000-0000-0000-0000-000000000005'),
  'SCHEDULED:0',
  'the refused result left the match scheduled and without events'
);
SELECT is(
  public.record_retroactive_match_result(
    (SELECT id FROM public.matches WHERE round_id = '77000000-0000-0000-0000-000000000001' AND home_team_id = '57000000-0000-0000-0000-000000000005'),
    NULL, NULL,
    '[{"team_id":"57000000-0000-0000-0000-000000000005"},{"team_id":"57000000-0000-0000-0000-000000000005"}]'::jsonb, 2, 0),
  '{"home_score": 2, "away_score": 0, "goals": 2, "duration_seconds": 840, "duration_is_presumed": true}'::jsonb,
  'a result with team-only goals and unknown duration is recorded'
);
SELECT is(
  (SELECT jsonb_build_object('status', m.status, 'score', m.home_score || 'x' || m.away_score,
      'presumed', m.duration_is_presumed, 'retroactive', m.recorded_retroactively, 'date', m.scheduled_at,
      'unknown_minutes', (SELECT count(*) FROM public.match_events e
                          WHERE e.match_id = m.id AND e.player_id IS NULL AND e.metadata->>'minute_unknown' = 'true'))
   FROM public.matches m WHERE round_id = '77000000-0000-0000-0000-000000000001' AND home_team_id = '57000000-0000-0000-0000-000000000005'),
  '{"status": "FINISHED", "score": "2x0", "presumed": true, "retroactive": true, "date": "2026-11-21T23:00:00+00:00", "unknown_minutes": 2}'::jsonb,
  'the match is finished, flagged as retroactive with presumed duration, keeps its date and has no invented times'
);
SELECT is(
  (SELECT points FROM public.stage_standings WHERE season_team_id = '57000000-0000-0000-0000-000000000005'),
  3,
  'the recovered result feeds the group standings'
);
SELECT is(
  public.record_retroactive_match_result(
    (SELECT id FROM public.matches WHERE round_id = '77000000-0000-0000-0000-000000000001' AND home_team_id = '57000000-0000-0000-0000-000000000009'),
    '2026-11-17T22:30:00Z', 600,
    '[{"team_id":"57000000-0000-0000-0000-000000000010","is_own_goal":true,"minute_seconds":125}]'::jsonb, 1, 0)->>'duration_is_presumed',
  'false',
  'an own goal with known time, real date and real duration is recorded'
);
SELECT throws_like(
  $$SELECT public.record_retroactive_match_result('87000000-0000-0000-0000-000000000001', NULL, NULL, '[]'::jsonb, 0, 0)$$,
  '%agendadas ou adiadas%',
  'a finished match cannot receive a retroactive result'
);
SELECT throws_like(
  $$SELECT public.record_retroactive_match_result(
      (SELECT id FROM public.matches WHERE round_id = '77000000-0000-0000-0000-000000000001' AND home_team_id = '57000000-0000-0000-0000-000000000013'),
      NULL, NULL,
      '[{"team_id":"57000000-0000-0000-0000-000000000013","assist_player_id":"97000000-0000-0000-0000-000000000002"}]'::jsonb, 1, 0)$$,
  '%gol com autor%',
  'an assist cannot be credited to a goal without scorer'
);
SELECT throws_like(
  $$INSERT INTO public.match_events (match_id, event_type, minute_seconds, team_id)
    VALUES ('87000000-0000-0000-0000-000000000001', 'GOAL', 300, '57000000-0000-0000-0000-000000000003')$$,
  '%elenco%',
  'outside retroactive results, a goal still needs a player from the roster'
);
SELECT throws_like(
  $$UPDATE public.matches SET recorded_retroactively = false
    WHERE round_id = '77000000-0000-0000-0000-000000000001' AND home_team_id = '57000000-0000-0000-0000-000000000005'$$,
  '%definidos pelo banco%',
  'the retroactive markers cannot be edited by hand'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
