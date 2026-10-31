// Type-checks the // @ts-check files with the TypeScript checker and jsconfig.json (October 31,
// 2026). Node; the checker is a one-time install (Matt approved it) into tools/.tsc/, which git
// ignores.
//
//   node tools/typecheck.mjs            check, and compare with the baseline
//   node tools/typecheck.mjs --update   check, and write the counts as the new baseline
//   node tools/typecheck.mjs --list     also print every error, not only the new ones
//
// The code had errors before this check existed, so it reports what is new since the baseline
// (tools/typecheck-baseline.json): errors are counted by file and error code, and a file whose
// count of a code goes up has new errors, printed in full. It exits 1 when there are new errors,
// so it can gate a branch later. Fixing errors lowers the counts; run --update to keep them low.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TSC_DIR = join(HERE, '.tsc');
const TSC = join(TSC_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
const BASELINE = join(HERE, 'typecheck-baseline.json');
/** Pinned, so the counts do not move when a new checker comes out. */
const PACKAGES = ['typescript@5.9.3', '@webgpu/types@0.1.74'];

/** Installs the checker once. */
function install() {
  if (existsSync(TSC)) return;
  console.log(`Installing ${PACKAGES.join(' and ')} into tools/.tsc/ (once; git ignores it).`);
  mkdirSync(TSC_DIR, { recursive: true });
  if (!existsSync(join(TSC_DIR, 'package.json'))) writeFileSync(join(TSC_DIR, 'package.json'), '{ "private": true }\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(`${npm} install --no-audit --no-fund --prefix "${TSC_DIR}" ${PACKAGES.join(' ')}`, { stdio: 'inherit', shell: true });
  if (r.status !== 0 || !existsSync(TSC)) throw new Error('could not install the TypeScript checker (is npm on PATH?)');
}

/**
 * The checker's errors. jsconfig.json is used as it is, through a small tsconfig beside the
 * installed packages so that @webgpu/types is found there, with checkJs off: only files that
 * opt in with // @ts-check are checked.
 * @returns {{ file: string, line: number, code: string, text: string }[]}
 */
function check() {
  const cfg = join(TSC_DIR, 'tsconfig.json');
  writeFileSync(cfg, JSON.stringify({ extends: '../../jsconfig.json', compilerOptions: { checkJs: false, noEmit: true, typeRoots: ['./node_modules'] } }, null, 2));
  let out = '';
  try {
    out = execFileSync(process.execPath, [TSC, '-p', cfg, '--pretty', 'false'], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    out = /** @type {any} */ (e).stdout ?? '';
  }
  /** @type {{ file: string, line: number, code: string, text: string }[]} */ const errors = [];
  for (const raw of out.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(raw);
    if (m) errors.push({ file: m[1].split('\\').join('/'), line: Number(m[2]), code: m[3], text: m[4] });
    else if (raw.startsWith(' ') && errors.length) errors[errors.length - 1].text += `\n${raw}`;
    else if (/error TS\d+/.test(raw)) errors.push({ file: '(config)', line: 0, code: /TS\d+/.exec(raw)?.[0] ?? '', text: raw });
  }
  return errors;
}

/** Counts by file, then by code. @param {ReturnType<typeof check>} errors */
function counts(errors) {
  /** @type {Record<string, Record<string, number>>} */ const out = {};
  for (const e of errors) (out[e.file] ??= {})[e.code] = (out[e.file][e.code] ?? 0) + 1;
  // Sorted, so the file diffs cleanly.
  return Object.fromEntries(Object.keys(out).sort().map((f) => [f, Object.fromEntries(Object.keys(out[f]).sort().map((c) => [c, out[f][c]]))]));
}

const t0 = Date.now();
install();
const errors = check();
const now = counts(errors);
const total = errors.length;
const files = Object.keys(now).length;

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ checker: PACKAGES[0], total, byFile: now }, null, 1)}\n`);
  console.log(`Baseline written: ${total} errors in ${files} files (tools/typecheck-baseline.json).`);
} else {
  /** @type {{ total: number, byFile: Record<string, Record<string, number>> }} */
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { total: 0, byFile: {} };
  /** @type {string[]} */ const grew = [];
  for (const [f, codes] of Object.entries(now)) {
    for (const [c, n] of Object.entries(codes)) if (n > (base.byFile[f]?.[c] ?? 0)) grew.push(`${f} ${c}`);
  }
  const fresh = errors.filter((e) => grew.includes(`${e.file} ${e.code}`));
  const show = process.argv.includes('--list') ? errors : fresh;
  for (const e of show) console.log(`${e.file}:${e.line} ${e.code} ${e.text}`);
  console.log(`${total} type errors in ${files} files (baseline ${base.total}), in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  if (grew.length) console.log(`New since the baseline: ${grew.length} file and code pair${grew.length === 1 ? '' : 's'} went up (${fresh.length} errors listed above, old ones among them).`);
  else console.log(total < base.total ? 'No new errors, and fewer than the baseline: run with --update to keep it there.' : 'No new errors.');
  process.exitCode = grew.length ? 1 : 0;
}
