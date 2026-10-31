// Runs the unit tests in Node, over all cores (October 31, 2026). Node, no npm packages.
//
//   node tools/run-tests.mjs                 the full suite (every test Node can run)
//   node tools/run-tests.mjs --affected      what this branch changed reaches, and the core
//                                            (tools/affected-tests.mjs picks the groups)
//   node tools/run-tests.mjs --groups=a,b    these groups and the core
//   node tools/run-tests.mjs --core          the core alone
//   --only=pond     just the tests whose group or name holds "pond"
//   --threads=4     how many threads share the run (default: as the page, every core but one, 2 to 8)
//
// It runs the same test files as tools/unit-tests.html, through the same worker
// (tools/unit-tests-worker.js) in a worker thread that looks like a browser worker
// (tools/run-tests-env.mjs), longest tests first. It prints the failures and a short summary and
// exits 0 when everything passed, 1 when anything failed or the test list is out of date.
// The tests that need a browser (the page's worker pool and palette groups, and the WebGPU files)
// are named, with the page link to run them; a test that skipped a Web Audio check in Node says so.

import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './run-tests-env.mjs';
import { checkIndex, staleText } from './index-tests.mjs';
import { TEST_FILES, CORE, loadTestFile, groupId, assert, eq } from './unit-tests-parallel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Each test's last time, so the longest start first (never committed). */
const TIMES_FILE = join(HERE, '.test-times.json');
/** More threads than this only slow the long island runs down (they share memory bandwidth), as on the page. */
const THREADS_MAX = 8;
/** A test that runs longer than this is failed and its thread replaced. */
const TEST_LIMIT_MS = 180000;
/** The test page's own groups (in tools/unit-tests.js): they need the page, so Node leaves them. */
const PAGE_GROUPS = { workers: /^test\('workers',/gm, palette: /^test\(PAL,/gm };

/** @param {string} name */
const flag = (name) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
/** @param {string} name */
const value = (name) => flag(name)?.split('=').slice(1).join('=') ?? '';
/** @param {number} ms */
const timeText = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

/** @typedef {{ group: string, name: string, ok: boolean, detail: string, ms: number, key: string }} Result */

/** Which groups to run, or null for all. @returns {Promise<{ asked: Set<string> | null, notes: string[] }>} */
async function pickGroups() {
  /** @type {string[]} */ const notes = [];
  if (flag('affected')) {
    const { buildMap, affected, changedFiles } = await import('./affected-tests.mjs');
    const changed = changedFiles();
    const r = affected(changed, buildMap());
    notes.push(`${changed.length} changed file${changed.length === 1 ? '' : 's'} on this branch.`);
    if (r.untested.length) notes.push(`No unit test reaches ${r.untested.join(', ')}: check those by hand (in the game, or on their own tools page).`);
    notes.push(r.determinism ? 'Determinism: yes, open tools/determinism.html too.' : 'Determinism: not needed.');
    if (r.full) { notes.unshift(`Full suite: ${r.why.join('; ')}.`); return { asked: null, notes }; }
    return { asked: new Set([...CORE, ...r.groups]), notes };
  }
  if (flag('groups') || flag('core')) return { asked: new Set([...CORE, ...value('groups').split(',').map((g) => g.trim()).filter(Boolean)]), notes };
  return { asked: null, notes };
}

/** @returns {Record<string, number>} */
function lastTimes() {
  try { return JSON.parse(readFileSync(TIMES_FILE, 'utf8')); } catch { return {}; }
}

/**
 * Runs the files over a pool of worker threads, each the page's own test worker.
 * @param {string[]} keys @param {number} n @param {(group: string, name: string) => boolean} picked
 * @param {Record<string, number>} last @param {(r: Result) => void} show
 */
async function runFiles(keys, n, picked, last, show) {
  const WORKER = new URL('./unit-tests-worker.js', import.meta.url);
  let nextId = 0;
  const spawn = () => {
    const w = new Worker(WORKER, { type: 'module' });
    /** @type {Map<number, (data: any) => void>} */ const waiting = new Map();
    /** @type {number | null} */ let current = null;
    w.onmessage = (ev) => { const done = waiting.get(ev.data.id); waiting.delete(ev.data.id); current = null; done?.(ev.data); };
    // An error no test caught (a stray timer, a module that will not load) fails the test in hand.
    w.onerror = (ev) => {
      if (current === null) return;
      const done = waiting.get(current); waiting.delete(current); current = null;
      done?.({ error: `worker error: ${ev.message}` });
    };
    /** @param {{key: string, index: number}} msg @returns {Promise<any>} */
    const ask = (msg) => new Promise((res) => {
      const id = nextId++;
      current = id;
      const timer = setTimeout(() => { waiting.delete(id); res({ error: `timed out after ${TEST_LIMIT_MS / 1000} s`, hung: true }); }, TEST_LIMIT_MS);
      waiting.set(id, (data) => { clearTimeout(timer); res(data); });
      w.postMessage({ id, ...msg });
    });
    return { w, ask };
  };
  const slots = Array.from({ length: n }, spawn);
  /** @type {{key: string, index: number, group: string, name: string}[]} */
  const jobs = [];
  let k = 0;
  await Promise.all(slots.map(async (slot) => {
    while (k < keys.length) {
      const key = keys[k++];
      const r = await slot.ask({ key, index: -1 });
      if (r.error) { show({ key, group: key, name: 'the test file loads in a worker', ok: false, detail: r.error, ms: 0 }); continue; }
      r.names.forEach((/** @type {[string, string]} */ [group, name], /** @type {number} */ index) => {
        if (picked(group, name)) jobs.push({ key, index, group, name });
      });
    }
  }));
  jobs.sort((a, b) => (last[`${b.group}: ${b.name}`] ?? 0) - (last[`${a.group}: ${a.name}`] ?? 0));
  let next = 0;
  await Promise.all(slots.map(async (_, i) => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const r = await slots[i].ask({ key: j.key, index: j.index });
      // A hung test takes its thread with it; start a fresh one for the rest.
      if (r.hung) { slots[i].w.terminate(); slots[i] = spawn(); }
      show({ key: j.key, group: j.group, name: j.name, ok: !r.error && r.ok === true, detail: String(r.error ?? r.detail ?? ''), ms: r.ms ?? 0 });
    }
  }));
  for (const { w } of slots) w.terminate();
}

/** How many tests the browser-only groups hold (for the page's total). @param {string[]} groups */
async function browserCount(groups) {
  const page = readFileSync(join(HERE, 'unit-tests.js'), 'utf8');
  let n = 0;
  for (const g of groups) {
    if (g in PAGE_GROUPS) { n += [...page.matchAll(PAGE_GROUPS[/** @type {keyof typeof PAGE_GROUPS} */ (g)])].length; continue; }
    try { (await loadTestFile(g))(() => { n++; }, assert, eq); } catch { /* counted as none */ }
  }
  return n;
}

async function main() {
  const t0 = performance.now();
  const index = checkIndex();
  if (!index.ok) { console.log(staleText(index)); process.exitCode = 1; return; }

  const { asked, notes } = await pickGroups();
  const askedIds = asked && new Set([...asked].map(groupId));
  /** @param {string} g */
  const runs = (g) => !askedIds || askedIds.has(groupId(g));
  const only = value('only').trim().toLowerCase();
  /** @param {string} group @param {string} name */
  const picked = (group, name) => !only || `${group}: ${name}`.toLowerCase().includes(only);

  const keys = Object.keys(TEST_FILES).filter((k) => TEST_FILES[k] !== 'webgpu' && runs(k));
  const browser = [...Object.keys(PAGE_GROUPS), ...Object.keys(TEST_FILES).filter((k) => TEST_FILES[k] === 'webgpu')].filter(runs);
  if (asked) {
    const known = new Set([...Object.keys(TEST_FILES), ...Object.keys(PAGE_GROUPS)].map(groupId));
    const unknown = [...asked].filter((g) => !known.has(groupId(g)));
    if (unknown.length) notes.push(`No such group: ${unknown.join(', ')}.`);
  }
  const asked2 = Number(value('threads'));
  const n = asked2 >= 1 ? Math.min(32, Math.floor(asked2)) : Math.max(2, Math.min(THREADS_MAX, availableParallelism() - 1));

  const last = lastTimes();
  /** @type {Result[]} */ const results = [];
  let lastLine = 0;
  /** @param {Result} r */
  const show = (r) => {
    results.push(r);
    if (!r.ok) console.log(`FAILED ${r.group}: ${r.name}\n       ${r.detail}`);
    else if (process.stdout.isTTY && performance.now() - lastLine > 500) { lastLine = performance.now(); process.stdout.write(`  ${results.length} done\r`); }
  };
  for (const line of notes) console.log(line);
  console.log(`Running ${asked ? `${keys.length} groups (the core: ${CORE.join(', ')}${asked.size > CORE.length ? `; and ${[...asked].filter((g) => !CORE.includes(g)).join(', ')}` : ''})` : `the full suite, ${keys.length} test files`} on ${n} threads${only ? `, only tests matching "${only}"` : ''}.`);
  await runFiles(keys, n, picked, last, show);

  for (const r of results) last[`${r.group}: ${r.name}`] = r.ms;
  try { writeFileSync(TIMES_FILE, JSON.stringify(last)); } catch { /* read-only checkout */ }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const skipped = results.filter((r) => r.ok && /^skipped\b/i.test(r.detail));
  const skippedKeys = [...new Set(skipped.map((r) => r.key))];
  console.log(`${failed ? 'FAILED' : 'Passed'}: ${passed} of ${results.length} in ${timeText(performance.now() - t0)} on ${n} threads${asked ? ', a partial run' : ''}${failed ? ` (${failed} failed, listed above)` : ''}.`);
  if (skipped.length) console.log(`${skipped.length} passed by skipping a check that needs a browser (${skippedKeys.join(', ')}): tools/unit-tests.html runs them in full${asked ? `?groups=${skippedKeys.join(',')}` : ''}.`);
  if (browser.length) {
    const extra = await browserCount(browser);
    console.log(`Needs the browser page: ${browser.join(', ')} (${extra} tests). `
      + (asked ? `Open tools/unit-tests.html?groups=${browser.join(',')} when they matter to the change.` : `The page runs ${results.length + extra} tests in all: these ${results.length} and those ${extra}.`));
  }
  process.exitCode = failed ? 1 : 0;
}

await main();
// The pool's own threads are unref'd; nothing else should keep Node alive.
process.exit(process.exitCode ?? 0);
