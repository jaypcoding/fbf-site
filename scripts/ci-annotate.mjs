// CI helper: re-emits the relevant part of test logs as GitHub Actions
// error annotations, so failures are readable without downloading logs.
// Usage: node scripts/ci-annotate.mjs <log file>...
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const RELEVANT = /not ok|# Failed|# {2,}(got|expected|have|want|caught|wanted)|Looks like|Result:|Parse errors|ERROR|Error:|failed|FAIL|AssertionError|exception/i;
const MAX_CHARS = 60000;

function escapeData(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const picked = new Set();
  lines.forEach((line, index) => {
    if (RELEVANT.test(line)) {
      for (let offset = 0; offset <= 6; offset += 1) {
        if (index + offset < lines.length) picked.add(index + offset);
      }
    }
  });
  const tailStart = Math.max(0, lines.length - 40);
  for (let index = tailStart; index < lines.length; index += 1) picked.add(index);
  const excerpt = [...picked].sort((a, b) => a - b).map((index) => lines[index]).join('\n').slice(-MAX_CHARS);
  process.stdout.write(`::error title=${basename(file)}::${escapeData(excerpt)}\n`);
}
