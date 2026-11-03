import { assertLocalSupabase, resetLocalSupabase, runLocalSupabase } from './supabase-local.mjs';

assertLocalSupabase();
resetLocalSupabase(['--version', '20261102133000']);
runLocalSupabase(['db', 'query', '--file', 'supabase/fixtures/legacy_pre_integrity_seed.sql'], 'Insert pre-migration legacy match fixture');
runLocalSupabase(['migration', 'up'], 'Apply remaining local migrations');
runLocalSupabase(['db', 'query', '--file', 'supabase/fixtures/legacy_post_integrity_assertions.sql'], 'Verify legacy score preservation');

console.log('Legacy migration integration passed: existing 2-1 result remained FINISHED/LEGACY without invented events.');
