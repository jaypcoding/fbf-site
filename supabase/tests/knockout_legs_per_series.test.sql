BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Knockout ties with their own number of games (migration
-- 20261121150000_knockout_legs_per_series.sql): two-legged semifinals and a
-- single-match final, no third place; plans without "legs" keep p_legs.

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES ('1a000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'legs-admin@example.invalid', '', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET role = 'ADMIN' WHERE id = '1a000000-0000-0000-0000-000000000001';

INSERT INTO public.competitions (id, name, category, format, status) VALUES
  ('2a000000-0000-0000-0000-000000000001', 'Legs test mixed', 'Test', 'Mata-mata', 'DRAFT'),
  ('2a000000-0000-0000-0000-000000000002', 'Legs test default', 'Test', 'Mata-mata', 'DRAFT'),
  ('2a000000-0000-0000-0000-000000000003', 'Legs test invalid', 'Test', 'Mata-mata', 'DRAFT');
INSERT INTO public.seasons (id, competition_id, name) VALUES
  ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000001', 'Mixed'),
  ('3a000000-0000-0000-0000-000000000002', '2a000000-0000-0000-0000-000000000002', 'Default'),
  ('3a000000-0000-0000-0000-000000000003', '2a000000-0000-0000-0000-000000000003', 'Invalid');
INSERT INTO public.teams (id, name) VALUES
  ('4a000000-0000-0000-0000-000000000001', 'Legs KO 1'),
  ('4a000000-0000-0000-0000-000000000002', 'Legs KO 2'),
  ('4a000000-0000-0000-0000-000000000003', 'Legs KO 3'),
  ('4a000000-0000-0000-0000-000000000004', 'Legs KO 4');
INSERT INTO public.season_teams (season_id, team_id)
SELECT s.id, t.id FROM public.seasons s CROSS JOIN public.teams t
WHERE s.id::text LIKE '3a000000-%' AND t.id::text LIKE '4a000000-%';
INSERT INTO public.stages (id, season_id, name, format, settings) VALUES
  ('6a000000-0000-0000-0000-000000000001', '3a000000-0000-0000-0000-000000000001', 'Mixed', 'Mata-mata', '{"knockout_legs":2,"final_legs":1,"third_place":false}'::jsonb),
  ('6a000000-0000-0000-0000-000000000002', '3a000000-0000-0000-0000-000000000002', 'Default', 'Mata-mata', '{"knockout_legs":2}'::jsonb),
  ('6a000000-0000-0000-0000-000000000003', '3a000000-0000-0000-0000-000000000003', 'Invalid', 'Mata-mata', '{"knockout_legs":2}'::jsonb);
UPDATE public.competitions SET status = 'REGISTRATION' WHERE id::text LIKE '2a000000-%';

CREATE FUNCTION pg_temp.st(p_season text, p_team text) RETURNS uuid LANGUAGE sql AS $$
  SELECT st.id FROM public.season_teams st JOIN public.teams t ON t.id = st.team_id
  WHERE st.season_id = p_season::uuid AND t.name = p_team
$$;
CREATE FUNCTION pg_temp.plan(p_season text, p_semi_legs integer, p_final_legs integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object('key', 'R1M1', 'round', 1, 'matchNumber', 1, 'legs', p_semi_legs,
      'home', jsonb_build_object('kind', 'team', 'teamId', pg_temp.st(p_season, 'Legs KO 4')),
      'away', jsonb_build_object('kind', 'team', 'teamId', pg_temp.st(p_season, 'Legs KO 1')))),
    jsonb_strip_nulls(jsonb_build_object('key', 'R1M2', 'round', 1, 'matchNumber', 2, 'legs', p_semi_legs,
      'home', jsonb_build_object('kind', 'team', 'teamId', pg_temp.st(p_season, 'Legs KO 3')),
      'away', jsonb_build_object('kind', 'team', 'teamId', pg_temp.st(p_season, 'Legs KO 2')))),
    jsonb_strip_nulls(jsonb_build_object('key', 'R2M1', 'round', 2, 'matchNumber', 1, 'legs', p_final_legs,
      'home', jsonb_build_object('kind', 'winner', 'sourceKey', 'R1M1'),
      'away', jsonb_build_object('kind', 'winner', 'sourceKey', 'R1M2'))))
$$;
CREATE FUNCTION pg_temp.finish(p_season text, p_home text, p_away text, p_hs integer, p_as integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
  SELECT m.id, m.home_team_id, m.away_team_id INTO v FROM public.matches m
  WHERE m.home_team_id = pg_temp.st(p_season, p_home) AND m.away_team_id = pg_temp.st(p_season, p_away);
  PERFORM public.record_retroactive_match_result(v.id, NULL, NULL,
    (SELECT COALESCE(jsonb_agg(g), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('team_id', v.home_team_id) g FROM generate_series(1, p_hs)
      UNION ALL SELECT jsonb_build_object('team_id', v.away_team_id) FROM generate_series(1, p_as)) z),
    p_hs, p_as);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SELECT plan(12);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000001', true);

SELECT lives_ok(
  $$SELECT public.generate_knockout_stage('6a000000-0000-0000-0000-000000000001', pg_temp.plan('3a000000-0000-0000-0000-000000000001', 2, 1), 2)$$,
  'mixed plan: two-legged semifinals and a single-match final are accepted');
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id WHERE r.stage_id = '6a000000-0000-0000-0000-000000000001'),
  5, 'mixed plan: 2 + 2 semifinal games and 1 final game, no third place');
SELECT is(
  (SELECT string_agg(th.name || ' x ' || ta.name || ' (' || m.series_leg || ')', ', ' ORDER BY th.name, m.series_leg)
   FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   JOIN public.season_teams hs ON hs.id = m.home_team_id JOIN public.teams th ON th.id = hs.team_id
   JOIN public.season_teams aw ON aw.id = m.away_team_id JOIN public.teams ta ON ta.id = aw.team_id
   WHERE r.stage_id = '6a000000-0000-0000-0000-000000000001' AND r.bracket_round = 1),
  'Legs KO 1 x Legs KO 4 (2), Legs KO 2 x Legs KO 3 (2), Legs KO 3 x Legs KO 2 (1), Legs KO 4 x Legs KO 1 (1)',
  'semifinals: first leg at the series home, second leg with home and away inverted');
SELECT is(
  (SELECT count(*)::integer || ':' || min(m.series_leg) || ':' || bool_and(m.home_team_id IS NULL AND m.away_team_id IS NULL)
   FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   WHERE r.stage_id = '6a000000-0000-0000-0000-000000000001' AND r.bracket_round = 2),
  '1:1:true', 'final: one game, teams still to be defined');
SELECT is(
  (SELECT count(*)::integer FROM public.matches f JOIN public.rounds r ON r.id = f.round_id
   JOIN public.matches src ON src.id IN (f.home_source_match_id, f.away_source_match_id)
   WHERE r.stage_id = '6a000000-0000-0000-0000-000000000001' AND r.bracket_round = 2 AND src.series_leg = 2),
  2, 'final: fed by the second (deciding) leg of each semifinal');
SELECT is(
  (SELECT count(*)::integer FROM public.rounds WHERE stage_id = '6a000000-0000-0000-0000-000000000001' AND name = 'Disputa do terceiro lugar'),
  0, 'no third-place round');

-- semifinal 1: KO 4 x KO 1 2-1, KO 1 x KO 4 2-0 -> KO 1 (3-2 on aggregate); semifinal 2: KO 3 x KO 2 0-1, KO 2 x KO 3 0-0 -> KO 2
SELECT pg_temp.finish('3a000000-0000-0000-0000-000000000001', 'Legs KO 4', 'Legs KO 1', 2, 1);
SELECT pg_temp.finish('3a000000-0000-0000-0000-000000000001', 'Legs KO 1', 'Legs KO 4', 2, 0);
SELECT pg_temp.finish('3a000000-0000-0000-0000-000000000001', 'Legs KO 3', 'Legs KO 2', 0, 1);
SELECT pg_temp.finish('3a000000-0000-0000-0000-000000000001', 'Legs KO 2', 'Legs KO 3', 0, 0);
SELECT is(
  (SELECT th.name || ' x ' || ta.name FROM public.matches m JOIN public.rounds r ON r.id = m.round_id
   JOIN public.season_teams hs ON hs.id = m.home_team_id JOIN public.teams th ON th.id = hs.team_id
   JOIN public.season_teams aw ON aw.id = m.away_team_id JOIN public.teams ta ON ta.id = aw.team_id
   WHERE r.stage_id = '6a000000-0000-0000-0000-000000000001' AND r.bracket_round = 2),
  'Legs KO 1 x Legs KO 2', 'final: the aggregate winners of both semifinals meet in a single game');

SELECT lives_ok(
  $$SELECT public.generate_knockout_stage('6a000000-0000-0000-0000-000000000002', pg_temp.plan('3a000000-0000-0000-0000-000000000002', NULL, NULL), 2)$$,
  'plan without "legs" is still accepted');
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id WHERE r.stage_id = '6a000000-0000-0000-0000-000000000002'),
  6, 'plan without "legs" uses p_legs for every tie, as before (3 ties x 2 games)');

SELECT throws_ok(
  $$SELECT public.generate_knockout_stage('6a000000-0000-0000-0000-000000000003', pg_temp.plan('3a000000-0000-0000-0000-000000000003', 3, 1), 2)$$,
  '23514', 'Cada confronto da chave precisa ter 1 ou 2 jogos', 'a tie with 3 games is refused');
SELECT throws_ok(
  $$SELECT public.generate_knockout_stage('6a000000-0000-0000-0000-000000000003', pg_temp.plan('3a000000-0000-0000-0000-000000000003', 0, 1), 2)$$,
  '23514', 'Cada confronto da chave precisa ter 1 ou 2 jogos', 'a tie with 0 games is refused');
SELECT is(
  (SELECT count(*)::integer FROM public.matches m JOIN public.rounds r ON r.id = m.round_id WHERE r.stage_id = '6a000000-0000-0000-0000-000000000003'),
  0, 'refused plans create nothing');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
