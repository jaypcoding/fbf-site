export type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function getJwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(decoded);
    if (typeof claims !== 'object' || claims === null || !('role' in claims)) return null;
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

export function getSupabaseBrowserConfig(
  url: string | undefined,
  anonKey: string | undefined,
): SupabaseBrowserConfig {
  if (!url?.trim() || !anonKey?.trim()) {
    throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL precisa ser uma URL válida.');
  }

  if (
    (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLoopback(parsedUrl.hostname)))
    || parsedUrl.username
    || parsedUrl.password
  ) {
    throw new Error('VITE_SUPABASE_URL precisa usar HTTPS (ou HTTP somente em loopback local).');
  }

  if (anonKey.startsWith('sb_secret_')) {
    throw new Error('Chaves secret/service_role não podem ser usadas no frontend.');
  }

  if (anonKey.startsWith('sb_publishable_')) {
    return { url: parsedUrl.toString().replace(/\/$/, ''), anonKey };
  }

  const role = getJwtRole(anonKey);
  if (role === 'service_role') {
    throw new Error('Chaves secret/service_role não podem ser usadas no frontend.');
  }
  if (role !== 'anon') {
    throw new Error('VITE_SUPABASE_ANON_KEY deve ser uma chave pública anon/publishable.');
  }

  return { url: parsedUrl.toString().replace(/\/$/, ''), anonKey };
}
