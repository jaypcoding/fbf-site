// Runs a pgTAP file on a hosted project through `supabase db query`, which
// needs no Docker but only returns the result of the LAST statement.
//
// The file is rewritten so that every top-level SELECT stores its TAP lines in
// a temporary table, and the final statement reads that table. The file's own
// ROLLBACK is removed and nothing commits: the query endpoint discards an open
// transaction at the end of the request (verified on staging before use), so
// the fixtures inserted by the tests never persist. Files that could commit are
// refused.

export function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      current += '\n';
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('Comentário /* sem fechamento.');
      i = end + 2;
      current += ' ';
      continue;
    }
    const dollar = rest.match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) throw new Error(`Bloco ${tag} sem fechamento.`);
      current += sql.slice(i, end + tag.length);
      i = end + tag.length;
      continue;
    }
    const char = sql[i];
    // E'...' strings allow backslash-escaped quotes, which this splitter does
    // not model; a misread string could hide a transaction command. Checked
    // here, outside strings, comments and dollar quotes.
    if (char === "'" && /(^|[^A-Za-z0-9_$])[Ee]$/.test(current)) {
      throw new Error("Strings no formato E'...' não são suportadas.");
    }
    if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === char && sql[j + 1] === char) { j += 2; continue; }
        if (sql[j] === char) break;
        j += 1;
      }
      if (j >= sql.length) throw new Error('Texto entre aspas sem fechamento.');
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += char;
    i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const firstWord = (statement) => statement.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? '';

const TRANSACTION_CONTROL = ['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'START', 'SAVEPOINT', 'RELEASE', 'PREPARE'];

function assertNoTransactionControl(statements, where) {
  for (const statement of statements) {
    if (TRANSACTION_CONTROL.includes(firstWord(statement))) {
      throw new Error(`Controle de transação não permitido ${where}: ${statement.slice(0, 40)}`);
    }
  }
}

// `prelude` (optional) is SQL run inside the same never-committed transaction
// before the test body — used to validate a migration that is not applied yet.
// It must not contain transaction control either.
export function buildRemotePgtapScript(sql, { prelude = '' } = {}) {
  if (/^\s*\\/m.test(sql) || /^\s*\\/m.test(prelude)) throw new Error('Comandos do psql (\\) não são suportados.');
  const statements = splitSqlStatements(sql);
  if (firstWord(statements[0] ?? '') !== 'BEGIN') throw new Error('O teste precisa começar com BEGIN.');
  if (!/^ROLLBACK$/i.test(statements.at(-1) ?? '')) throw new Error('O teste precisa terminar com ROLLBACK.');
  const body = statements.slice(1, -1);
  assertNoTransactionControl(body, 'no corpo do teste');
  const preludeStatements = prelude ? splitSqlStatements(prelude) : [];
  assertNoTransactionControl(preludeStatements, 'na migration pendente');

  const out = [
    'BEGIN',
    'CREATE TEMP TABLE fbf_tap_output (n integer NOT NULL, line text) ON COMMIT DROP',
    'GRANT ALL ON pg_temp.fbf_tap_output TO PUBLIC',
    ...preludeStatements,
  ];
  for (const statement of body) {
    if (firstWord(statement) === 'SELECT') {
      out.push(
        'INSERT INTO pg_temp.fbf_tap_output (n, line) '
        + 'SELECT (SELECT count(*) FROM pg_temp.fbf_tap_output) + row_number() OVER (), '
        + '(SELECT string_agg(value, \' \') FROM jsonb_each_text(to_jsonb(fbf_row))) '
        + `FROM (${statement}) AS fbf_row`,
      );
    } else {
      out.push(statement);
    }
  }
  out.push('RESET ROLE');
  out.push('SELECT n, line FROM pg_temp.fbf_tap_output ORDER BY n');
  return `${out.join(';\n')};\n`;
}

// Read-only snapshot used before and after the remote tests: the row count of
// every table in the application and auth schemas, plus installed extensions.
// Identical snapshots show that no test data persisted.
export const STAGING_SNAPSHOT_SQL = `
SELECT 'table:' || table_schema || '.' || table_name AS item,
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text AS value
FROM information_schema.tables
WHERE table_schema IN ('public', 'auth', 'supabase_migrations') AND table_type = 'BASE TABLE'
UNION ALL
SELECT 'extension:' || extname, extversion FROM pg_extension
UNION ALL
SELECT 'schema:public-columns', md5(string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, column_name))
FROM information_schema.columns WHERE table_schema = 'public'
UNION ALL
SELECT 'schema:public-functions', md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' ORDER BY p.oid::regprocedure::text))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
UNION ALL
SELECT 'schema:triggers', md5(string_agg(t.tgname || '@' || t.tgrelid::regclass::text, ',' ORDER BY t.tgname || '@' || t.tgrelid::regclass::text))
FROM pg_trigger t WHERE NOT t.tgisinternal
ORDER BY item`.trim();

export function snapshotFromRows(rows) {
  const snapshot = new Map();
  for (const row of rows) snapshot.set(String(row.item), String(row.value));
  if (snapshot.size === 0) throw new Error('A verificação do staging não retornou nenhuma tabela.');
  return snapshot;
}

export function diffSnapshots(before, after) {
  const differences = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) {
      differences.push(`${key}: antes=${before.get(key) ?? '—'} depois=${after.get(key) ?? '—'}`);
    }
  }
  return differences.sort();
}

export function summarizeTap(lines) {
  const plan = lines.map((line) => line.match(/^1\.\.(\d+)$/)).find(Boolean);
  const passed = lines.filter((line) => /^ok \d+/.test(line)).length;
  const failed = lines.filter((line) => /^not ok \d+/.test(line));
  const planned = plan ? Number(plan[1]) : null;
  return {
    planned,
    passed,
    failed,
    ok: planned !== null && failed.length === 0 && passed === planned,
  };
}
