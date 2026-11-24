BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- Integration of publication 2 (Hall da Fama + audited restart) and the
-- tactical map: the three new migrations come right after the 23 that are in
-- production, in this order, and every object they create exists.

SELECT plan(8);

SELECT ok((SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version <= '20261123130000') >= 23,
  'the 23 migrations of production are applied first');
SELECT is((SELECT string_agg(version, ',' ORDER BY version) FROM supabase_migrations.schema_migrations
  WHERE version IN ('20261124100000', '20261124120000', '20261125100000')),
  '20261124100000,20261124120000,20261125100000', 'the three new migrations are applied, in order');
SELECT ok(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version > '20261123130000' AND version < '20261124100000'),
  'nothing between production and publication 2');
SELECT has_table('public', 'season_honours', 'Hall da Fama: honours');
SELECT has_table('public', 'competition_restart_archive', 'audited restart: archive');
SELECT has_table('public', 'team_formations', 'tactical map: formations');
SELECT has_function('public', '_reset_plan', ARRAY['uuid[]', 'boolean', 'boolean'], 'the reset plan has the history blocker');
SELECT hasnt_function('public', '_reset_plan', ARRAY['uuid[]', 'boolean'], 'the old two-argument reset plan is gone (no ambiguous calls)');

SELECT * FROM finish();
ROLLBACK;
