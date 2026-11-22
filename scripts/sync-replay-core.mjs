// Copies the replay analyzer (src/lib/replay) into the Edge Function shared
// folder (supabase/functions/_shared/replay), so the site and the server run
// the same code. tests/replayCore.test.mjs fails if the copies diverge.
//   node scripts/sync-replay-core.mjs
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/lib/replay/', import.meta.url));
const dst = fileURLToPath(new URL('../supabase/functions/_shared/replay/', import.meta.url));
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.worker.ts'));
for (const f of files) copyFileSync(src + f, dst + f);
console.log(`replay core: ${files.length} arquivos copiados para supabase/functions/_shared/replay`);
