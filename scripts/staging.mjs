// Runs Supabase CLI commands against the STAGING project only.
//
//   npm run staging:dry-run          lista as migrations que seriam aplicadas
//   npm run staging:migrations       histórico de migrations do staging
//   npm run staging:push             aplica migrations (exige confirmação)
//   npm run staging:test-db          executa os testes pgTAP no staging
//
// Every command carries --remote=<staging ref>, is refused if anything points
// to production, and checks the CLI's own report of the project it targeted.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGING_PROJECT_REF,
  assertCliOutputTargetsStaging,
  assertEnvironmentIsNotProduction,
  buildStagingCliArgs,
  redact,
} from './lib/stagingGuard.mjs';
import {
  STAGING_SNAPSHOT_SQL,
  buildRemotePgtapScript,
  diffSnapshots,
  snapshotFromRows,
  summarizeTap,
} from './lib/pgtapRemote.mjs';

const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const testsDir = fileURLToPath(new URL('../supabase/tests/', import.meta.url));
const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const COMMANDS = ['dry-run', 'migration-list', 'push', 'test-db'];
const cleanCliNoise = (text) => text.replace(/^.*(?:new version of Supabase CLI|recommend updating).*$/gim, '').trim();

function runCli(command, extraArgs = [], { quiet = false } = {}) {
  const args = buildStagingCliArgs(command, extraArgs);
  if (!quiet) console.log(`> supabase ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  try {
    assertCliOutputTargetsStaging(output);
  } finally {
    if (!quiet) console.log(redact(cleanCliNoise(output)));
  }
  if (result.status !== 0) throw new Error(`O comando terminou com código ${result.status}.\n${redact(cleanCliNoise(output))}`);
  return result.stdout ?? '';
}

function parseRows(stdout) {
  const json = JSON.parse(stdout.slice(stdout.indexOf('{')));
  if (!Array.isArray(json.rows)) throw new Error('Resposta do CLI sem linhas de resultado.');
  return json.rows;
}

// Read-only; runCli confirms from the CLI's own report that the staging
// project answered before any test SQL is sent.
function readOnly(sql) {
  return parseRows(runCli('query-readonly', [sql], { quiet: true }));
}

// The staging history must end at the newest local migration, or — when a
// pending migration is being validated — at the one right before it.
function preflight(pendingVersion) {
  const versions = readdirSync(migrationsDir).filter((name) => /^\d{14}_.*\.sql$/.test(name)).sort().map((name) => name.slice(0, 14));
  const expected = pendingVersion ? versions.filter((version) => version < pendingVersion).at(-1) : versions.at(-1);
  const [row] = readOnly('SELECT max(version) AS latest, count(*)::int AS total FROM supabase_migrations.schema_migrations');
  if (!row || String(row.latest) !== expected) {
    throw new Error(`Destino inesperado: a última migration do staging (${row?.latest ?? 'nenhuma'}) difere da esperada (${expected}).`);
  }
  console.log(`✔ Destino confirmado (somente leitura): staging com ${row.total} migrations, última ${row.latest}.`);
  return snapshotFromRows(readOnly(STAGING_SNAPSHOT_SQL));
}

function pendingMigration(args) {
  const index = args.indexOf('--with-pending');
  if (index === -1) return null;
  const file = args[index + 1] ?? '';
  const name = file.replace(/\\/g, '/').split('/').at(-1);
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || !readdirSync(migrationsDir).includes(name)) {
    throw new Error('--with-pending exige um arquivo de supabase/migrations/.');
  }
  return { name, version: name.slice(0, 14), sql: readFileSync(join(migrationsDir, name), 'utf8') };
}

function runPgtapFiles(args) {
  const pending = pendingMigration(args);
  const files = readdirSync(testsDir).filter((name) => name.endsWith('.test.sql')).sort();
  // Every file is converted (and refused if unsafe) before anything remote runs.
  const scripts = files.map((name) => [name, buildRemotePgtapScript(readFileSync(join(testsDir, name), 'utf8'), { prelude: pending?.sql ?? '' })]);
  if (pending) console.log(`Migration pendente validada dentro da transação, sem aplicar: ${pending.name}`);
  const before = preflight(pending?.version);
  const workDir = mkdtempSync(join(tmpdir(), 'fbf-pgtap-'));
  let failures = 0;
  try {
    for (const [name, script] of scripts) {
      const scriptPath = join(workDir, name);
      writeFileSync(scriptPath, script);
      let lines;
      try {
        lines = parseRows(runCli('query-file', ['--file', scriptPath], { quiet: true })).map((row) => String(row.line ?? ''));
      } catch (error) {
        failures += 1;
        console.log(`✖ ${name}: erro ao executar\n${redact(error instanceof Error ? error.message : String(error))}`);
        continue;
      }
      const summary = summarizeTap(lines);
      if (summary.ok) {
        console.log(`✔ ${name}: ${summary.passed}/${summary.planned} testes passaram`);
      } else {
        failures += 1;
        console.log(`✖ ${name}: ${summary.passed}/${summary.planned ?? '?'} passaram`);
        for (const line of lines.filter((item) => /^(not ok|#)/.test(item))) console.log(`   ${line}`);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    const differences = diffSnapshots(before, snapshotFromRows(readOnly(STAGING_SNAPSHOT_SQL)));
    if (differences.length) {
      console.log('✖ O staging mudou durante os testes:');
      for (const line of differences) console.log(`   ${line}`);
      failures += 1;
    } else {
      console.log(`✔ Staging limpo (somente leitura): ${before.size} contagens de tabelas e extensões idênticas antes e depois.`);
    }
  }
  if (failures) throw new Error(`${failures} verificação(ões) com falha.`);
}

function main() {
  const command = process.argv[2];
  if (!COMMANDS.includes(command)) {
    throw new Error(`Uso: node scripts/staging.mjs <${COMMANDS.join('|')}>`);
  }
  assertEnvironmentIsNotProduction(process.env);
  console.log(`Projeto de destino: ${STAGING_PROJECT_REF} (staging)`);

  if (command === 'test-db') {
    runPgtapFiles(process.argv.slice(3));
    return;
  }
  if (command === 'push') {
    if (process.env.FBF_CONFIRM_STAGING_PUSH !== STAGING_PROJECT_REF) {
      throw new Error(`Para aplicar migrations, defina FBF_CONFIRM_STAGING_PUSH=${STAGING_PROJECT_REF}.`);
    }
    runCli('dry-run');
  }
  runCli(command);
}

try {
  main();
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
