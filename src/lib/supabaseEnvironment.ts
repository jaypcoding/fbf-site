// Supabase project references are public identifiers (they appear in every API
// URL). Keeping them in one place lets the site and the maintenance scripts
// refuse to mix environments.
export const PRODUCTION_PROJECT_REF = 'wybcbavgixfhvvmegkwc';
export const STAGING_PROJECT_REF = 'stzftmetlrsaatfuhhqs';

export function projectRefFromUrl(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = hostname.match(/^(?:db\.)?([a-z0-9]{20})\.supabase\.(?:co|in)$/);
  return match ? match[1] : null;
}

// A Vite build in `staging` mode must talk to the staging project and nothing
// else, so a misplaced production URL fails at startup instead of writing
// test data to production.
export function assertSupabaseUrlForMode(mode: string, url: string): void {
  if (mode !== 'staging') return;
  const ref = projectRefFromUrl(url);
  if (ref !== STAGING_PROJECT_REF) {
    throw new Error(`O modo staging só pode usar o projeto ${STAGING_PROJECT_REF}.`);
  }
}
