import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  assertCliArgsTargetStaging,
  assertCliOutputTargetsStaging,
  assertEnvironmentIsNotProduction,
  assertStagingRef,
  assertStagingUrl,
  buildStagingCliArgs,
  redact,
} from '../scripts/lib/stagingGuard.mjs';
import { assertSupabaseUrlForMode, projectRefFromUrl } from '../src/lib/supabaseEnvironment.ts';

const stagingUrl = `https://${STAGING_PROJECT_REF}.supabase.co`;
const productionUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

test('staging and production refs are different', () => {
  assert.notEqual(STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF);
});

test('every staging command targets exactly the staging ref', () => {
  for (const [command, extra] of [['dry-run', []], ['migration-list', []], ['push', []], ['query-file', ['--file', 'x.sql']]]) {
    const args = buildStagingCliArgs(command, extra);
    assert.deepEqual(args.filter((arg) => arg.startsWith('--remote')), [`--remote=${STAGING_PROJECT_REF}`]);
    assert.ok(!args.join(' ').includes(PRODUCTION_PROJECT_REF));
  }
  assert.ok(buildStagingCliArgs('dry-run').includes('--dry-run'));
  assert.throws(() => buildStagingCliArgs('reset'), /Comando desconhecido/);
  assert.throws(() => buildStagingCliArgs('query-file'), /exige exatamente --file/);
  assert.throws(() => buildStagingCliArgs('query-file', ['--file', 'x.sql', '--linked']), /exige exatamente --file/);
  assert.throws(() => buildStagingCliArgs('dry-run', ['--linked']), /não aceita argumentos extras/);
  const readOnlyArgs = buildStagingCliArgs('query-readonly', ['SELECT 1']);
  assert.ok(readOnlyArgs.includes('--read-only'));
  assert.ok(!readOnlyArgs.includes('--yes'));
  assert.throws(() => buildStagingCliArgs('query-readonly', []), /uma consulta SELECT/);
  assert.throws(() => buildStagingCliArgs('query-readonly', ['DELETE FROM public.matches']), /uma consulta SELECT/);
  assert.throws(() => buildStagingCliArgs('query-readonly', ['SELECT 1', '--linked']), /uma consulta SELECT/);
});

test('refuses bare --remote, --linked, extra selectors and the production ref', () => {
  assert.throws(() => assertCliArgsTargetStaging(['db', 'push', '--remote']), /somente --remote=/);
  assert.throws(() => assertCliArgsTargetStaging(['db', 'push', '--linked']), /somente --remote=/);
  assert.throws(() => assertCliArgsTargetStaging(['db', 'push']), /somente --remote=/);
  assert.throws(() => assertCliArgsTargetStaging(['db', 'push', `--remote=${PRODUCTION_PROJECT_REF}`]), /somente --remote=/);
  assert.throws(
    () => assertCliArgsTargetStaging(['db', 'push', `--remote=${STAGING_PROJECT_REF}`, '--db-url=postgres://x']),
    /somente --remote=/,
  );
});

test('refs and URLs must be staging', () => {
  assert.doesNotThrow(() => assertStagingRef(STAGING_PROJECT_REF));
  assert.throws(() => assertStagingRef(PRODUCTION_PROJECT_REF), /produção/);
  assert.throws(() => assertStagingRef('abcdefghijklmnopqrst'), /exatamente/);
  assert.doesNotThrow(() => assertStagingUrl(stagingUrl));
  assert.throws(() => assertStagingUrl(productionUrl), /produção/);
  assert.throws(() => assertStagingUrl('http://127.0.0.1:54321'), /precisa ser do projeto/);
});

test('environment variables pointing to production are refused', () => {
  assert.doesNotThrow(() => assertEnvironmentIsNotProduction({ VITE_SUPABASE_URL: stagingUrl, PATH: PRODUCTION_PROJECT_REF }));
  assert.throws(() => assertEnvironmentIsNotProduction({ VITE_SUPABASE_URL: productionUrl }), /VITE_SUPABASE_URL/);
  assert.throws(() => assertEnvironmentIsNotProduction({ SUPABASE_DB_URL: `postgres://x@db.${PRODUCTION_PROJECT_REF}.supabase.co` }), /SUPABASE_DB_URL/);
});

test('the CLI report must name the staging project and only it', () => {
  assert.doesNotThrow(() => assertCliOutputTargetsStaging(`{"target":{"kind":"remote","project_ref":"${STAGING_PROJECT_REF}"}}`));
  assert.throws(() => assertCliOutputTargetsStaging(`{"target":{"project_ref":"${PRODUCTION_PROJECT_REF}"}}`), /produção/);
  assert.throws(() => assertCliOutputTargetsStaging('{"target":{"project_ref":"abcdefghijklmnopqrst"}}'), /diferente do staging/);
  assert.throws(() => assertCliOutputTargetsStaging('Finished supabase db push.'), /confirmar o projeto/);
  assert.doesNotThrow(() => assertCliOutputTargetsStaging(`Target: project ${STAGING_PROJECT_REF} (not the linked project)\n{"rows":[]}`));
  assert.throws(() => assertCliOutputTargetsStaging("Target: project Someone's Project (abcdefghijklmnopqrst) · production"), /diferente do staging/);
  assert.throws(() => assertCliOutputTargetsStaging(`Target: project ${STAGING_PROJECT_REF} (not the linked project)\n"project_ref":"abcdefghijklmnopqrst"`), /diferente do staging/);
});

test('redacts emails, database URLs and keys', () => {
  const text = redact('owner a.b@example.com postgres://user:pw@host/db sb_secret_abc eyJa.eyJb.sig');
  assert.ok(!/example\.com|pw@host|sb_secret_abc|eyJa/.test(text));
});

test('the site refuses a non-staging project in staging mode', () => {
  assert.equal(projectRefFromUrl(stagingUrl), STAGING_PROJECT_REF);
  assert.equal(projectRefFromUrl('not a url'), null);
  assert.doesNotThrow(() => assertSupabaseUrlForMode('staging', stagingUrl));
  assert.throws(() => assertSupabaseUrlForMode('staging', productionUrl), /modo staging/);
  assert.throws(() => assertSupabaseUrlForMode('staging', 'http://127.0.0.1:54321'), /modo staging/);
  assert.doesNotThrow(() => assertSupabaseUrlForMode('production', productionUrl));
});
