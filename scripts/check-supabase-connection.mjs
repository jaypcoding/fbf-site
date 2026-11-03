import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { getSupabaseBrowserConfig } from '../src/lib/supabaseConfig.ts';
import { getSafeResponseMessage } from './supabase-health-diagnostics.mjs';

async function main() {
  const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
  let envFileContents;
  try {
    envFileContents = await readFile(envFile, 'utf8');
  } catch {
    throw new Error('.env.local não foi encontrado ou não pôde ser lido na raiz do projeto.');
  }

  const env = parseEnv(envFileContents);

  const { url, anonKey } = getSupabaseBrowserConfig(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_ANON_KEY,
  );
  const endpoint = new URL('/auth/v1/health', url);

  let response;
  try {
    response = await fetch(endpoint, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('Não foi possível alcançar o endpoint Supabase configurado.');
  }

  if (!response.ok) {
    const message = await getSafeResponseMessage(response, [url, anonKey]);
    console.error(`Falha na verificação Supabase (HTTP ${response.status}): ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Conexão Supabase verificada (HTTP ${response.status}) para ${new URL(url).host}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha inesperada na verificação Supabase.');
  process.exitCode = 1;
});
