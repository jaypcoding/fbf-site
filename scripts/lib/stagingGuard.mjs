// Guards for every remote command aimed at the staging project.
// The CLI in this repository is linked to PRODUCTION (supabase/.temp), and a
// bare `--remote` targets the linked project, so staging commands must always
// carry the explicit staging ref and must prove afterwards that the CLI really
// targeted it.
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  projectRefFromUrl,
} from '../../src/lib/supabaseEnvironment.ts';

export { PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF };

const SAFE_COMMANDS = {
  'dry-run': ['db', 'push', '--dry-run'],
  'migration-list': ['migration', 'list'],
  push: ['db', 'push', '--yes'],
  // Runs one SQL file (the rewritten pgTAP tests, see pgtapRemote.mjs). The CLI
  // asks for consent on hosted projects, given here for staging only.
  'query-file': ['db', 'query', '--yes'],
  // A single statement in a read-only transaction (preflight and cleanliness
  // checks around the remote tests).
  'query-readonly': ['db', 'query', '--read-only'],
};

export function stagingCommands() {
  return Object.keys(SAFE_COMMANDS);
}

export function assertNotProduction(value, label = 'valor') {
  if (typeof value === 'string' && value.toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(`Bloqueado: ${label} aponta para o projeto de produção (${PRODUCTION_PROJECT_REF}).`);
  }
}

export function assertStagingRef(ref) {
  assertNotProduction(ref, 'a referência');
  if (ref !== STAGING_PROJECT_REF) {
    throw new Error(`Bloqueado: a referência precisa ser exatamente ${STAGING_PROJECT_REF}.`);
  }
}

export function assertStagingUrl(url) {
  assertNotProduction(url, 'a URL');
  if (projectRefFromUrl(url) !== STAGING_PROJECT_REF) {
    throw new Error(`Bloqueado: a URL precisa ser do projeto ${STAGING_PROJECT_REF}.`);
  }
}

// Environment variables the Supabase CLI or our scripts could pick up.
export function assertEnvironmentIsNotProduction(env) {
  for (const [name, value] of Object.entries(env)) {
    if (/^(SUPABASE_|FBF_STAGING_|FBF_CONFIRM_|VITE_SUPABASE_)/.test(name)) assertNotProduction(value, `a variável ${name}`);
  }
}

export function buildStagingCliArgs(command, extraArgs = []) {
  const base = SAFE_COMMANDS[command];
  if (!base) throw new Error(`Comando desconhecido: ${command}. Use: ${stagingCommands().join(', ')}.`);
  if (command === 'query-file' && (extraArgs.length !== 2 || extraArgs[0] !== '--file')) {
    throw new Error('query-file exige exatamente --file <arquivo>.');
  }
  if (command === 'query-readonly'
    && (extraArgs.length !== 1 || typeof extraArgs[0] !== 'string' || !/^\s*SELECT\b/i.test(extraArgs[0]))) {
    throw new Error('query-readonly exige exatamente uma consulta SELECT.');
  }
  if (!['query-file', 'query-readonly'].includes(command) && extraArgs.length) {
    throw new Error(`${command} não aceita argumentos extras.`);
  }
  const args = [...base, ...extraArgs, `--remote=${STAGING_PROJECT_REF}`, '--output-format', 'json'];
  assertCliArgsTargetStaging(args);
  return args;
}

export function assertCliArgsTargetStaging(args) {
  const selectors = args.filter((arg) => /^--(?:remote|linked|db-url|project-ref)(?:=|$)/.test(arg));
  if (selectors.length !== 1 || selectors[0] !== `--remote=${STAGING_PROJECT_REF}`) {
    throw new Error(`Bloqueado: o comando precisa conter somente --remote=${STAGING_PROJECT_REF}.`);
  }
  for (const arg of args) assertNotProduction(arg, 'um argumento');
}

// The CLI prints a JSON document whose `target` names the project it used.
export function assertCliOutputTargetsStaging(output) {
  assertNotProduction(output, 'a saída do CLI');
  const refs = [
    ...[...output.matchAll(/"project_ref"\s*:\s*"([a-z0-9]+)"/g)].map((match) => match[1]),
    // Text header, e.g. "Target: project <ref> (not the linked project)" or
    // "Target: project <name> (<ref>) · production".
    ...[...output.matchAll(/^Target: project (?:([a-z0-9]{20})\b|.*?\(([a-z0-9]{20})\))/gm)]
      .map((match) => match[1] ?? match[2]),
  ];
  if (refs.length === 0) throw new Error('Não foi possível confirmar o projeto atingido pelo CLI.');
  if (refs.some((ref) => ref !== STAGING_PROJECT_REF)) {
    throw new Error('Bloqueado: o CLI informou um projeto diferente do staging.');
  }
}

export function redact(text) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '<database-url>')
    .replace(/\b(?:sb_secret|sb_publishable)_[A-Za-z0-9_-]+/g, '<key>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>');
}
