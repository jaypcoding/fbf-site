import test from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, orderPosts, paragraphs } from '../src/lib/news.ts';

test('paragraphs: blank lines split, single breaks kept, no HTML interpretation', () => {
  assert.deepEqual(paragraphs('Primeiro\nlinha 2\n\n\n<b>Segundo</b>\r\n\r\nTerceiro  '), [['Primeiro', 'linha 2'], ['<b>Segundo</b>'], ['Terceiro']]);
  assert.deepEqual(paragraphs('   \n\n  '), []);
});

test('excerpt: summary first, otherwise the body cut at a word', () => {
  assert.equal(excerpt({ summary: ' Resumo ', body: 'x' }), 'Resumo');
  assert.equal(excerpt({ summary: null, body: 'curto' }), 'curto');
  const long = excerpt({ summary: null, body: 'palavra '.repeat(40) }, 30);
  assert.ok(long.endsWith('…') && long.length <= 31 && !long.includes('  '));
});

test('order: pinned first, then newest', () => {
  const p = (id, pinned, at) => ({ id, pinned, published_at: at });
  assert.deepEqual(orderPosts([p('a', false, '2026-11-01'), p('b', true, '2026-10-01'), p('c', false, '2026-11-20')]).map((x) => x.id), ['b', 'c', 'a']);
});
