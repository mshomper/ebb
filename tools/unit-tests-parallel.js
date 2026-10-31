// @ts-check
// What the test page, its workers and the Node runner (tools/run-tests.mjs) share: the list of test
// files, loading one, the core groups, assert, eq and runOne. The list itself is
// tools/unit-tests-index.js, written by `node tools/index-tests.mjs`; a new test file needs no
// line here (October 31, 2026).

import { TEST_FILES } from './unit-tests-index.js';

export { TEST_FILES };

/** @typedef {(test: (group: string, name: string, fn: () => any) => void, assert: (cond: any, msg?: string) => void, eq: (a: any, b: any, msg?: string) => void) => void} AddTests */

/** Groups that run on every partial run: quick, and they guard what every island depends on (tools/affected-tests.mjs). */
export const CORE = ['rng', 'save', 'format9', 'smoke'];

/**
 * A group name to compare by, so an older camelCase link (?groups=campLock) still finds camp-lock.
 * @param {string} g
 */
export const groupId = (g) => g.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A test file's add...Tests function, by its key (tools/unit-tests-<key>.js).
 * @param {string} key @returns {Promise<AddTests>}
 */
export async function loadTestFile(key) {
  const mod = await import(`./unit-tests-${key}.js`);
  const add = Object.entries(mod).find(([k, v]) => /^add\w*Tests$/.test(k) && typeof v === 'function')?.[1];
  if (!add) throw new Error(`tools/unit-tests-${key}.js exports no add...Tests function`);
  return add;
}

/** @param {any} cond @param {string} [msg] */
export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
/** @param {any} a @param {any} b @param {string} [msg] */
export function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${String(b)}, got ${String(a)}`.trim());
}

/** Runs one test and times it. @param {() => any} fn */
export async function runOne(fn) {
  const t0 = performance.now();
  let ok = true, detail = '';
  try {
    const r = await fn();
    if (typeof r === 'string') detail = r;
  } catch (e) {
    ok = false;
    detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return { ok, detail, ms: performance.now() - t0 };
}
