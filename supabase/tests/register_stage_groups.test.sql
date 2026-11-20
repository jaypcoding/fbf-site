BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- A published group stage (2 groups x 4, home and away) with six rounds
-- created by hand and no groups, like the FBF 20 in production.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES
  ('18000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'groups-organizer@example.invalid', '', now()),
  ('18000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'groups-outsider@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = CASE id WHEN '18000000-0000-0000-0000-000000000002'::uuid THEN 'ORGANIZER' ELSE 'USER' END
WHERE id IN ('18000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000003');

INSERT INTO public.competitions (id, name, category, format, status)
VALUES
  ('28000000-0000-0000-0000-000000000001', 'Groups only', 'Test', 'Grupos + Mata-mata', 'DRAFT'),
  ('28000000-0000-0000-0000-000000000002', 'Groups crossing', 'Test', 'Grupos + Mata-mata', 'DRAFT'),
  ('28000000-0000-0000-0000-000000000003', 'League', 'Test', 'Pontos corridos', 'DRAFT');
UPDATE public.competitions SET status = 'REGISTRATION'
WHERE id IN ('28000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000003');
INSERT INTO public.seasons (id, competition_id, name)
VALUES
  ('38000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', 'S1'),
  ('38000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000002', 'S2'),
  ('38000000-0000-0000-0000-000000000003', '28000000-0000-0000-0000-000000000003', 'S3');
INSERT INTO public.competition_organizers (competition_id, user_id)
SELECT id, '18000000-0000-0000-0000-000000000002' FROM public.competitions
WHERE id IN ('28000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000002', '28000000-0000-0000-0000-000000000003');

INSERT INTO public.teams (id, name)
SELECT ('48000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'Groups team ' || lpad(n::text, 2, '0')
FROM generate_series(1, 8) AS n;
INSERT INTO public.season_teams (id, season_id, team_id)
SELECT ('58' || s || '00000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       ('38000000-0000-0000-0000-00000000000' || s)::uuid,
       ('48000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid
FROM generate_series(1, 8) AS n, generate_series(1, 3) AS s;

INSERT INTO public.players (id, nickname, position) VALUES ('98000000-0000-0000-0000-000000000001', 'Groups scorer', 'Pivô');
INSERT INTO public.rosters (season_team_id, player_id) VALUES ('58100000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001');

INSERT INTO public.stages (id, season_id, name, format, settings, tie_breakers)
VALUES
  ('68000000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000001', 'Grupos', 'Grupos + Mata-mata', '{"group_count":2,"group_legs":2,"qualifiers_per_group":2}'::jsonb, ARRAY['POINTS','GOAL_DIFF','TEAM_NAME']),
  ('68000000-0000-0000-0000-000000000002', '38000000-0000-0000-0000-000000000002', 'Grupos', 'Grupos + Mata-mata', '{"group_count":2,"group_legs":2,"qualifiers_per_group":2}'::jsonb, ARRAY['POINTS','GOAL_DIFF','TEAM_NAME']),
  ('68000000-0000-0000-0000-000000000003', '38000000-0000-0000-0000-000000000003', 'Liga', 'Pontos corridos', '{"legs":1}'::jsonb, ARRAY['POINTS','GOAL_DIFF','TEAM_NAME']);
INSERT INTO public.rounds (id, stage_id, name, round_order)
SELECT ('78' || s || '00000-0000-0000-0000-00000000000' || n)::uuid, ('68000000-0000-0000-0000-00000000000' || s)::uuid, 'Rodada ' || n, n
FROM generate_series(1, 6) AS n, generate_series(1, 2) AS s;

-- Stage 1: team 01 beat team 02 (same planned group). Stage 2: team 01 played team 05 (different groups).
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id)
VALUES
  ('88000000-0000-0000-0000-000000000001', '78100000-0000-0000-0000-000000000001', '58100000-0000-0000-0000-000000000001', '58100000-0000-0000-0000-000000000002'),
  ('88000000-0000-0000-0000-000000000002', '78200000-0000-0000-0000-000000000001', '58200000-0000-0000-0000-000000000001', '58200000-0000-0000-0000-000000000005');
UPDATE public.matches SET status = 'LIVE' WHERE id = '88000000-0000-0000-0000-000000000001';
INSERT INTO public.match_events (match_id, event_type, minute_seconds, team_id, player_id)
VALUES
  ('88000000-0000-0000-0000-000000000001', 'GOAL', 30, '58100000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001'),
  ('88000000-0000-0000-0000-000000000001', 'GOAL', 90, '58100000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001');
UPDATE public.matches SET status = 'FINISHED' WHERE id = '88000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE groups_plan AS
SELECT s AS stage,
  jsonb_build_array(
    jsonb_build_object('name', 'Grupo A', 'team_ids', (SELECT jsonb_agg(('58' || s || '00000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0')) ORDER BY n) FROM generate_series(1, 4) n)),
    jsonb_build_object('name', 'Grupo B', 'team_ids', (SELECT jsonb_agg(('58' || s || '00000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0')) ORDER BY n) FROM generate_series(5, 8) n))
  ) AS groups
FROM generate_series(1, 3) AS s;
CREATE TEMP TABLE before_state AS
SELECT (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.matches m) AS matches,
       (SELECT jsonb_agg(to_jsonb(e) - 'created_at' ORDER BY e.id) FROM public.match_events e) AS events,
       (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.rounds r) AS rounds;
GRANT SELECT ON groups_plan, before_state TO authenticated;

SELECT plan(18);

SELECT ok(
  NOT has_function_privilege('anon', 'public.register_stage_groups(uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.register_stage_groups(uuid,jsonb)', 'EXECUTE'),
  'only signed-in users can call register_stage_groups'
);
SELECT is(
  (SELECT count(*)::integer FROM public.stage_standings WHERE stage_id = '68000000-0000-0000-0000-000000000001' AND stage_group_id IS NULL),
  8,
  'before registering, every team of the stage is outside any group (single table)'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000003', true);
SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000001', (SELECT groups FROM groups_plan WHERE stage = 1))$$,
  '%Sem permissão%', 'a user without a role on the competition cannot register groups');

SELECT set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000002', true);
SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000003', (SELECT groups FROM groups_plan WHERE stage = 3))$$,
  '%grupos + mata-mata%', 'a league stage cannot receive groups');
SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000002', (SELECT groups FROM groups_plan WHERE stage = 2))$$,
  '%grupos diferentes%', 'groups that contradict an existing match are refused');
SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000001',
      jsonb_set((SELECT groups FROM groups_plan WHERE stage = 1), '{1,team_ids,0}', '"58100000-0000-0000-0000-000000000001"'))$$,
  '%mais de um grupo%', 'a team placed in two groups is refused');
SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000001',
      jsonb_set((SELECT groups FROM groups_plan WHERE stage = 1), '{1,team_ids}', '["58100000-0000-0000-0000-000000000005","58100000-0000-0000-0000-000000000006","58100000-0000-0000-0000-000000000007"]'))$$,
  '%mesmo número%', 'unequal groups are refused');
SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000001',
      '[{"name":"Grupo A","team_ids":["58100000-0000-0000-0000-000000000001","58100000-0000-0000-0000-000000000002"]},
        {"name":"Grupo B","team_ids":["58100000-0000-0000-0000-000000000003","58100000-0000-0000-0000-000000000004"]},
        {"name":"Grupo C","team_ids":["58100000-0000-0000-0000-000000000005","58100000-0000-0000-0000-000000000006"]},
        {"name":"Grupo D","team_ids":["58100000-0000-0000-0000-000000000007","58100000-0000-0000-0000-000000000008"]}]'::jsonb)$$,
  '%configurada para 2 grupos%', 'a group count different from the stage settings is refused');

SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000001',
      (SELECT groups FROM groups_plan WHERE stage = 1) || '[{"name":"Grupo C","team_ids":[]}]'::jsonb)$$,
  '%lista de equipes%', 'an empty group is refused');
SELECT is(
  public.register_stage_groups('68000000-0000-0000-0000-000000000001', (SELECT groups FROM groups_plan WHERE stage = 1)),
  '{"groups": 2, "groups_created": true, "already_registered": false}'::jsonb,
  'the organizer registers the two groups'
);
SELECT ok(
  (SELECT matches FROM before_state) = (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.matches m)
  AND (SELECT events FROM before_state) = (SELECT jsonb_agg(to_jsonb(e) - 'created_at' ORDER BY e.id) FROM public.match_events e)
  AND (SELECT rounds FROM before_state) = (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.rounds r),
  'registering groups creates no match and changes no match, event or round'
);
SELECT is(
  (SELECT string_agg(group_name || ':' || n, ',' ORDER BY group_name) FROM (
     SELECT group_name, count(*) AS n FROM public.stage_standings
     WHERE stage_id = '68000000-0000-0000-0000-000000000001' GROUP BY group_name) g),
  'Grupo A:4,Grupo B:4',
  'standings now split the eight teams into two groups of four, with no team outside a group'
);
SELECT is(
  (SELECT count(DISTINCT season_team_id)::integer FROM public.stage_standings WHERE stage_id = '68000000-0000-0000-0000-000000000001'),
  8,
  'each team appears exactly once in the standings'
);
SELECT is(
  (SELECT jsonb_object_agg(team_name, points || '/' || played || '/' || goals_for || '-' || goals_against ORDER BY team_name)
   FROM public.stage_standings WHERE stage_id = '68000000-0000-0000-0000-000000000001'
     AND season_team_id IN ('58100000-0000-0000-0000-000000000001', '58100000-0000-0000-0000-000000000002', '58100000-0000-0000-0000-000000000005')),
  '{"Groups team 01": "3/1/2-0", "Groups team 02": "0/1/0-2", "Groups team 05": "0/0/0-0"}'::jsonb,
  'points and goals stay with each team; the other group is not affected'
);
SELECT is(
  public.register_stage_groups('68000000-0000-0000-0000-000000000001', (SELECT groups FROM groups_plan WHERE stage = 1))->>'already_registered',
  'true',
  'registering the same groups again changes nothing'
);
SELECT throws_like(
  $$SELECT public.register_stage_groups('68000000-0000-0000-0000-000000000001',
      jsonb_set(jsonb_set((SELECT groups FROM groups_plan WHERE stage = 1), '{0,team_ids,3}', '"58100000-0000-0000-0000-000000000005"'),
                '{1,team_ids,0}', '"58100000-0000-0000-0000-000000000004"'))$$,
  '%grupos diferentes destes%', 'different groups after registration are refused');
SELECT throws_like(
  $$INSERT INTO public.matches (round_id, home_team_id, away_team_id)
    VALUES ('78100000-0000-0000-0000-000000000002', '58100000-0000-0000-0000-000000000001', '58100000-0000-0000-0000-000000000005')$$,
  '%mesmo grupo%', 'once groups exist, a manual match between groups is refused');

-- The full table generator accepts the groups registered beforehand.
SELECT is(
  public.apply_group_schedule('68000000-0000-0000-0000-000000000001', (SELECT groups FROM groups_plan WHERE stage = 1),
    (WITH grouped(g, ids) AS (
       SELECT g, ARRAY(SELECT ('581' || '00000-0000-0000-0000-0000000000' || lpad(((g - 1) * 4 + k)::text, 2, '0'))::uuid FROM generate_series(1, 4) k ORDER BY k)
       FROM generate_series(1, 2) g),
     pattern(r, h, a) AS (VALUES (1,1,2),(1,3,4),(2,3,2),(2,1,4),(3,1,3),(3,4,2),(4,2,1),(4,4,3),(5,2,3),(5,4,1),(6,3,1),(6,2,4))
     SELECT jsonb_agg(jsonb_build_object('round_order', p.r, 'home_team_id', gr.ids[p.h], 'away_team_id', gr.ids[p.a], 'scheduled_at', NULL))
     FROM grouped gr CROSS JOIN pattern p),
    (SELECT COALESCE(string_agg(m.id::text || ':' || m.status, ',' ORDER BY m.id), '') FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
     WHERE r.stage_id = '68000000-0000-0000-0000-000000000001'))->>'matches_created',
  '23',
  'the full table can still be generated later with the same groups'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
