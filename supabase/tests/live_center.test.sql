BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Central ao Vivo (migration 20261124130000_live_center.sql).

INSERT INTO public.teams (id, name) VALUES ('4d000000-0000-0000-0000-000000000001', 'Live Alpha'), ('4d000000-0000-0000-0000-000000000002', 'Live Beta');
INSERT INTO public.competitions (id, name, category, format, status) VALUES ('2d000000-0000-0000-0000-000000000001', 'Live Copa', 'Test', 'Pontos corridos', 'DRAFT');
INSERT INTO public.seasons (id, competition_id, name) VALUES ('3d000000-0000-0000-0000-000000000001', '2d000000-0000-0000-0000-000000000001', 'Live 1');
INSERT INTO public.season_teams (id, season_id, team_id) VALUES
  ('5d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000001'),
  ('5d000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000001', '4d000000-0000-0000-0000-000000000002');
INSERT INTO public.stages (id, season_id, name, format, stage_order) VALUES ('6d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001', 'Fase', 'Pontos corridos', 1);
INSERT INTO public.rounds (id, stage_id, name, round_order, leg_number) VALUES
  ('8d000000-0000-0000-0000-000000000001', '6d000000-0000-0000-0000-000000000001', 'R1', 1, 1),
  ('8d000000-0000-0000-0000-000000000002', '6d000000-0000-0000-0000-000000000001', 'R2', 2, 2);
INSERT INTO public.matches (id, round_id, home_team_id, away_team_id, status) VALUES
  ('9d000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-000000000002', 'SCHEDULED'),
  ('9d000000-0000-0000-0000-000000000002', '8d000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-000000000001', 'SCHEDULED');
UPDATE public.competitions SET status = 'UPCOMING' WHERE id = '2d000000-0000-0000-0000-000000000001';
UPDATE public.competitions SET status = 'ACTIVE' WHERE id = '2d000000-0000-0000-0000-000000000001';

SELECT plan(6);

SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::integer FROM public.live_match_status() WHERE match_id IN ('9d000000-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-000000000002')), 0,
  'scheduled matches are not live');
RESET ROLE;

UPDATE public.matches SET status = 'LIVE' WHERE id = '9d000000-0000-0000-0000-000000000001';

SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::integer FROM public.live_match_status() WHERE match_id = '9d000000-0000-0000-0000-000000000001'), 1, 'a visitor sees the live match');
SELECT ok((SELECT live_since IS NOT NULL AND live_since <= now() FROM public.live_match_status() WHERE match_id = '9d000000-0000-0000-0000-000000000001'),
  '... with the moment it was put live in the system');
SELECT is((SELECT count(*)::integer FROM public.live_match_status() WHERE match_id = '9d000000-0000-0000-0000-000000000002'), 0, 'only matches live right now');
SELECT throws_ok($$SELECT count(*) FROM public.match_status_history$$, '42501', NULL, 'the status history itself stays private');
RESET ROLE;
SELECT is((SELECT array_to_string(proargnames, ',') FROM pg_proc WHERE proname = 'live_match_status'), 'match_id,live_since', 'it returns only the match and the start time');

SELECT * FROM finish();
ROLLBACK;
