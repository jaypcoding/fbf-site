import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));

export function runLocalSupabase(args, label) {
  if (args.some((arg) => /^--(?:remote|linked|db-url|project-ref)(?:=|$)/.test(arg))) {
    throw new Error(`${label} refused: remote database selectors are not allowed`);
  }

  try {
    return execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
    });
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`${label} failed${output ? `:\n${output}` : ''}`);
  }
}

export function assertLocalSupabase() {
  const status = runLocalSupabase(['status', '--output', 'env'], 'Read local Supabase status');
  const apiUrl = status.match(/^API_URL="?([^"\r\n]+)"?$/m)?.[1];
  if (!apiUrl) throw new Error('Local Supabase API_URL is unavailable; start the local stack first');
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(apiUrl).hostname)) {
    throw new Error(`Refusing database reset or integration work against non-local URL: ${apiUrl}`);
  }
}

export function resetLocalSupabase(options = []) {
  const validOptions = options.length === 0
    || (options.length === 2 && options[0] === '--version' && /^\d{14}$/.test(options[1]));
  if (!validOptions) {
    throw new Error('Local reset accepts no options or only --version followed by a 14-digit migration timestamp');
  }

  assertLocalSupabase();
  runLocalSupabase(['db', 'reset', '--no-seed', ...options], 'Reset local Supabase database');
}

if (process.argv[2] === 'reset') {
  resetLocalSupabase(process.argv.slice(3));
} else if (process.argv[2] === 'test-db') {
  if (process.argv.length !== 3) throw new Error('Local database tests do not accept target options');
  assertLocalSupabase();
  runLocalSupabase(['test', 'db'], 'Run local Supabase database tests');
} else if (process.argv.length > 2) {
  throw new Error('Usage: node scripts/supabase-local.mjs [reset [local db reset options...] | test-db]');
}
