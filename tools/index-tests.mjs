// Writes the list of unit test files, tools/unit-tests-index.js (October 31, 2026). Node, no npm.
//
//   node tools/index-tests.mjs           write the list
//   node tools/index-tests.mjs --check   say whether it is out of date (exit 1 if so)
//
// A test file is any tools/unit-tests-<key>.js that exports one add...Tests(test, assert, eq)
// function. Its key (the group name ?groups= and tools/affected-tests.mjs use) is its file name.
// A file that cannot run in a worker says why in one line:
//   export const NEEDS = 'webgpu';     the page runs it on its main thread; Node cannot
//   export const NEEDS = 'web-audio';  the page runs it on its main thread; Node runs it too, and
//                                      the checks that need Web Audio skip themselves
// Adding a test file never means editing a list by hand: run this, and commit the list with the
// file. Both runners (tools/run-tests.mjs and the page on the local server) stop when the list is
// out of date. When two branches both add files, a clash in the list is settled by running this
// again on the merged tree.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const INDEX_FILE = join(HERE, 'unit-tests-index.js');
const ADD = /^export (?:async )?function add\w*Tests\(/m;
const NEEDS = /^export const NEEDS = '(webgpu|web-audio)';/m;

/** @typedef {'' | 'webgpu' | 'web-audio'} Needs */

/** Every test file in tools/, by key. @returns {Record<string, Needs>} */
export function scanTests() {
  /** @type {Record<string, Needs>} */ const out = {};
  for (const name of readdirSync(HERE).sort()) {
    const m = /^unit-tests-([a-z0-9-]+)\.js$/.exec(name);
    if (!m) continue;
    const src = readFileSync(join(HERE, name), 'utf8');
    if (!ADD.test(src)) continue;
    out[m[1]] = /** @type {Needs} */ (NEEDS.exec(src)?.[1] ?? '');
  }
  return out;
}

/** The list file's text. @param {Record<string, Needs>} files */
export function indexText(files) {
  const rows = Object.entries(files).map(([k, n]) => `  '${k}': '${n}',`);
  return `// @ts-check
// Every unit test file, by key, and what it needs beyond a worker ('' for nothing). Written by
// \`node tools/index-tests.mjs\`: never edit it by hand, run that instead (and again after a merge).

/** @type {Record<string, '' | 'webgpu' | 'web-audio'>} */
export const TEST_FILES = {
${rows.join('\n')}
};
`;
}

/**
 * Whether the list on disk matches the files.
 * @returns {{ ok: boolean, missing: string[], gone: string[], changed: string[] }}
 *   missing: files not in the list; gone: listed keys with no file; changed: a different NEEDS
 */
export function checkIndex() {
  const want = scanTests();
  /** @type {Record<string, string>} */ let have = {};
  if (existsSync(INDEX_FILE)) {
    const src = readFileSync(INDEX_FILE, 'utf8');
    for (const m of src.matchAll(/^\s+'([a-z0-9-]+)': '([a-z-]*)',/gm)) have[m[1]] = m[2];
  }
  const missing = Object.keys(want).filter((k) => !(k in have));
  const gone = Object.keys(have).filter((k) => !(k in want));
  const changed = Object.keys(want).filter((k) => k in have && have[k] !== want[k]);
  return { ok: !missing.length && !gone.length && !changed.length, missing, gone, changed };
}

/** One line on what is out of date. @param {ReturnType<typeof checkIndex>} c */
export function staleText(c) {
  const parts = [];
  if (c.missing.length) parts.push(`not listed: ${c.missing.join(', ')}`);
  if (c.gone.length) parts.push(`listed but gone: ${c.gone.join(', ')}`);
  if (c.changed.length) parts.push(`NEEDS changed: ${c.changed.join(', ')}`);
  return `tools/unit-tests-index.js is out of date (${parts.join('; ')}). Run: node tools/index-tests.mjs`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const c = checkIndex();
    console.log(c.ok ? 'tools/unit-tests-index.js is up to date.' : staleText(c));
    process.exitCode = c.ok ? 0 : 1;
  } else {
    const files = scanTests();
    writeFileSync(INDEX_FILE, indexText(files));
    console.log(`Wrote tools/unit-tests-index.js: ${Object.keys(files).length} test files.`);
  }
}
