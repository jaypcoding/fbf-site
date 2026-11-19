BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

INSERT INTO public.competitions (id, name, category, format, status)
VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Public read published', 'Test', 'Pontos corridos', 'DRAFT'),
  ('c0000000-0000-0000-0000-000000000002', 'Public read draft', 'Test', 'Pontos corridos', 'DRAFT');

-- Competitions must start as DRAFT; the first one is then made public.
UPDATE public.competitions SET status = 'UPCOMING'
WHERE id = 'c0000000-0000-0000-0000-000000000001';

INSERT INTO public.seasons (id, competition_id, name)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Published season'),
  ('c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Draft season');

SELECT plan(11);

SET LOCAL ROLE anon;

SELECT lives_ok(
  $$SELECT id FROM public.competitions$$,
  'anonymous visitors can query competitions without a permission error'
);
SELECT is(
  (SELECT count(*)::integer FROM public.competitions
   WHERE id = 'c0000000-0000-0000-0000-000000000001'),
  1,
  'anonymous visitors see a non-draft competition'
);
SELECT is(
  (SELECT count(*)::integer FROM public.competitions
   WHERE id = 'c0000000-0000-0000-0000-000000000002'),
  0,
  'anonymous visitors do not see a draft competition'
);
SELECT is(
  (SELECT count(*)::integer FROM public.seasons
   WHERE id = 'c1000000-0000-0000-0000-000000000001'),
  1,
  'anonymous visitors see seasons of a non-draft competition'
);
SELECT is(
  (SELECT count(*)::integer FROM public.seasons
   WHERE id = 'c1000000-0000-0000-0000-000000000002'),
  0,
  'anonymous visitors do not see seasons of a draft competition'
);
SELECT lives_ok(
  $$SELECT player_id FROM public.player_competition_statistics$$,
  'anonymous visitors can read the official player statistics view'
);
SELECT lives_ok(
  $$SELECT player_id FROM public.player_career_statistics$$,
  'anonymous visitors can read career statistics'
);
SELECT lives_ok(
  $$SELECT team_id FROM public.team_competition_statistics$$,
  'anonymous visitors can read team statistics'
);
SELECT lives_ok(
  $$SELECT player_id FROM public.goalkeeper_clean_sheet_statistics$$,
  'anonymous visitors can read goalkeeper statistics'
);
SELECT lives_ok(
  $$SELECT r.id FROM public.rosters r
    JOIN public.season_teams st ON st.id = r.season_team_id
    JOIN public.seasons s ON s.id = st.season_id$$,
  'anonymous visitors can read rosters together with their seasons'
);
SELECT is(
  public.is_fbf_manager(),
  false,
  'the role check reports false for anonymous visitors'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
