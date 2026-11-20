import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  buildRemotePgtapScript,
  diffSnapshots,
  snapshotFromRows,
  splitSqlStatements,
  summarizeTap,
} from '../scripts/lib/pgtapRemote.mjs';

test('splits statements without breaking strings, dollar quotes or comments', () => {
  const sql = "BEGIN; -- a; comment\nSELECT 'x;y'; SELECT $$a;b$$; /* c; */ DO $body$ BEGIN PERFORM 1; END $body$; ROLLBACK;";
  assert.deepEqual(splitSqlStatements(sql), ['BEGIN', "SELECT 'x;y'", 'SELECT $$a;b$$', 'DO $body$ BEGIN PERFORM 1; END $body$', 'ROLLBACK']);
});

test('wraps SELECTs, drops the final ROLLBACK and never commits', () => {
  const script = buildRemotePgtapScript('BEGIN;\nSELECT plan(1);\nSET LOCAL ROLE anon;\nSELECT ok(true);\nSELECT * FROM finish();\nROLLBACK;\n');
  assert.match(script, /^BEGIN;/);
  assert.equal((script.match(/INSERT INTO pg_temp\.fbf_tap_output/g) ?? []).length, 3);
  assert.match(script, /SET LOCAL ROLE anon;/);
  assert.match(script, /SELECT n, line FROM pg_temp\.fbf_tap_output ORDER BY n;\n$/);
  assert.doesNotMatch(script, /^(COMMIT|ROLLBACK|END)\b/im);
});

test('refuses files that could commit or are not wrapped in a transaction', () => {
  assert.throws(() => buildRemotePgtapScript('SELECT 1; ROLLBACK;'), /começar com BEGIN/);
  assert.throws(() => buildRemotePgtapScript('BEGIN; SELECT 1;'), /terminar com ROLLBACK/);
  assert.throws(() => buildRemotePgtapScript('BEGIN; COMMIT; SELECT 1; ROLLBACK;'), /Controle de transação/);
  assert.throws(() => buildRemotePgtapScript('BEGIN; SAVEPOINT a; ROLLBACK;'), /Controle de transação/);
  assert.throws(() => buildRemotePgtapScript('BEGIN; SELECT 1; ABORT; INSERT INTO t VALUES (1); ROLLBACK;'), /Controle de transação/);
  assert.throws(() => buildRemotePgtapScript('BEGIN; abort; ROLLBACK;'), /Controle de transação/);
  assert.throws(() => buildRemotePgtapScript('BEGIN;\n\\set x 1\nROLLBACK;'), /psql/);
});

test("refuses E'...' strings, which could hide statements from the splitter", () => {
  assert.throws(() => buildRemotePgtapScript("BEGIN; SELECT E'a\\'; COMMIT; --'; ROLLBACK;"), /E'\.\.\.'/);
  assert.throws(() => buildRemotePgtapScript("BEGIN; SELECT e'x'; ROLLBACK;"), /E'\.\.\.'/);
  assert.throws(() => buildRemotePgtapScript("BEGIN;\nSELECT(E'x');\nROLLBACK;"), /E'\.\.\.'/);
  // Ordinary strings and identifiers ending in "e" are not E-strings.
  assert.doesNotThrow(() => buildRemotePgtapScript("BEGIN; SELECT 'e' AS name, 'nome' AS type; ROLLBACK;"));
  assert.doesNotThrow(() => buildRemotePgtapScript("BEGIN; SELECT 'type''s'; ROLLBACK;"));
});

test('snapshot diff reports every changed, added or removed item', () => {
  const before = snapshotFromRows([{ item: 'table:public.matches', value: '0' }, { item: 'extension:pgcrypto', value: '1.3' }]);
  assert.deepEqual(diffSnapshots(before, new Map(before)), []);
  const after = snapshotFromRows([{ item: 'table:public.matches', value: '2' }, { item: 'extension:pgtap', value: '1.3.3' }]);
  assert.deepEqual(diffSnapshots(before, after), [
    'extension:pgcrypto: antes=1.3 depois=—',
    'extension:pgtap: antes=— depois=1.3.3',
    'table:public.matches: antes=0 depois=2',
  ]);
  assert.throws(() => snapshotFromRows([]), /nenhuma tabela/);
});

test('every pgTAP file in the repository can be converted', () => {
  const dir = new URL('../supabase/tests/', import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.test.sql'))) {
    assert.doesNotThrow(() => buildRemotePgtapScript(readFileSync(new URL(name, dir), 'utf8')), name);
  }
});

test('summarizes TAP output', () => {
  assert.deepEqual(summarizeTap(['1..2', 'ok 1 - a', 'ok 2 - b']), { planned: 2, passed: 2, failed: [], ok: true });
  assert.equal(summarizeTap(['1..2', 'ok 1 - a', 'not ok 2 - b']).ok, false);
  assert.equal(summarizeTap(['1..3', 'ok 1 - a']).ok, false);
  assert.equal(summarizeTap(['ok 1 - a']).ok, false);
});
