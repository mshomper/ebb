// Moves rows a branch added to the closed archive table (docs/progress.md) into their own entry
// files under docs/progress/ (October 31, 2026). For the merge queue: a branch cut before the
// archive closed still appends a row, and the progress unit test fails until it moves. Node, no npm.
//
//   node tools/progress-move.mjs              move them, dated today
//   node tools/progress-move.mjs 2026-11-02   move them, dated that day

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = join(REPO, 'docs', 'progress.md');
const DIR = join(REPO, 'docs', 'progress');
/** Table lines when the archive closed (as tools/unit-tests-progress.js). */
const ARCHIVE_LINES = 114;

const date = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2] ?? '') ? process.argv[2] : new Date().toISOString().slice(0, 10);
const raw = readFileSync(ARCHIVE, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
let seen = 0;
/** @type {string[]} */ const moved = [];
const kept = lines.filter((l) => {
  if (!l.startsWith('|')) return true;
  seen++;
  if (seen <= ARCHIVE_LINES) return true;
  moved.push(l);
  return false;
});
mkdirSync(DIR, { recursive: true });
for (const row of moved) {
  const cells = row.slice(2, row.endsWith(' |') ? -2 : undefined).split(' | ');
  const [status, step] = cells;
  const body = cells.slice(2).join(' | ');
  const branch = /\(([a-z0-9-]+)\)\s*$/.exec(step ?? '')?.[1] ?? (step ?? 'entry').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  let file = join(DIR, `${date}-${branch}.md`);
  for (let i = 2; existsSync(file); i++) file = join(DIR, `${date}-${branch}-${i}.md`);
  writeFileSync(file, `# ${step}${/\([a-z0-9-]+\)\s*$/.test(step ?? '') ? '' : ` (${branch})`}\n\nStatus: ${status}\n\n${body}\n`);
  console.log(`Moved "${step}" to docs/progress/${file.split(/[\\/]/).pop()}`);
}
if (moved.length) writeFileSync(ARCHIVE, kept.join(nl));
else console.log('No rows to move: docs/progress.md has only its archive rows.');
