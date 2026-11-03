import assert from 'node:assert/strict';
import test from 'node:test';
import { getSafeResponseMessage } from '../scripts/supabase-health-diagnostics.mjs';

test('extracts safe JSON message and redacts keys, tokens and URLs', async () => {
  const url = 'https://private-project.supabase.co';
  const key = 'sb_publishable_private-value';
  const response = new Response(JSON.stringify({
    message: `Invalid key ${key}; token eyJhbGci.eyJyb2xlIjoiYW5vbiJ9.signature ${url}/auth/v1/health`,
  }), { status: 401 });

  const message = await getSafeResponseMessage(response, [url, key]);
  assert.match(message, /Invalid key/);
  assert.doesNotMatch(message, /private-project|sb_publishable_private-value|eyJhbGci|https:\/\//);
});

test('does not echo non-JSON response bodies', async () => {
  const response = new Response('<html>private-project.supabase.co</html>', { status: 502 });
  const message = await getSafeResponseMessage(response);
  assert.equal(message, 'A resposta não contém uma mensagem JSON segura para exibir.');
  assert.doesNotMatch(message, /private-project/);
});

test('uses a bounded fallback when the JSON response has no message field', async () => {
  const response = new Response(JSON.stringify({ code: 'bad_gateway' }), { status: 502 });
  assert.equal(
    await getSafeResponseMessage(response),
    'A resposta não informou uma mensagem de diagnóstico.',
  );
});
