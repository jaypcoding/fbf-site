import assert from 'node:assert/strict';
import test from 'node:test';
import { getSupabaseBrowserConfig } from '../src/lib/supabaseConfig.ts';

function jwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ role })}.signature`;
}

test('accepts a legacy anon JWT and a publishable key', () => {
  assert.equal(
    getSupabaseBrowserConfig('https://project.supabase.co', jwt('anon')).url,
    'https://project.supabase.co',
  );
  assert.equal(
    getSupabaseBrowserConfig('https://project.supabase.co/', 'sb_publishable_test').anonKey,
    'sb_publishable_test',
  );
});

test('rejects missing configuration, insecure remote URLs and privileged keys', () => {
  assert.throws(() => getSupabaseBrowserConfig('', ''), /Configure VITE_SUPABASE_URL/);
  assert.throws(() => getSupabaseBrowserConfig('http://project.supabase.co', jwt('anon')), /HTTPS/);
  assert.throws(() => getSupabaseBrowserConfig('https://project.supabase.co', jwt('service_role')), /secret\/service_role/);
  assert.throws(() => getSupabaseBrowserConfig('https://project.supabase.co', 'sb_secret_test'), /secret\/service_role/);
  assert.throws(() => getSupabaseBrowserConfig('https://project.supabase.co', jwt('authenticated')), /chave pública/);
});

test('allows HTTP only for local Supabase', () => {
  assert.equal(
    getSupabaseBrowserConfig('http://127.0.0.1:54321', jwt('anon')).url,
    'http://127.0.0.1:54321',
  );
});

test('keeps only the project base URL when a service path was pasted', () => {
  for (const url of [
    'https://project.supabase.co/rest/v1/',
    'https://project.supabase.co/rest/v1',
    'https://project.supabase.co/auth/v1',
    'https://project.supabase.co///',
  ]) {
    assert.equal(getSupabaseBrowserConfig(url, 'sb_publishable_test').url, 'https://project.supabase.co');
  }
  assert.equal(getSupabaseBrowserConfig('https://project.supabase.co/rest/v1/', jwt('anon')).url, 'https://project.supabase.co');
  assert.equal(getSupabaseBrowserConfig('http://127.0.0.1:54321/rest/v1/', jwt('anon')).url, 'http://127.0.0.1:54321');
});
