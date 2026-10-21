// @ts-check
// One of the unit test page's helpers: it loads a test file from unit-tests-parallel.js
// and runs the single tests the page hands it, so the long island runs share all cores.

import { PARALLEL, assert, eq, runOne } from './unit-tests-parallel.js';
import { initWorkers } from '../src/core/workers.js';

// The game's own pool would start a worker per core inside every test worker; one is plenty.
initWorkers({ size: 1 });

/** @type {Map<string, Promise<{group: string, name: string, fn: () => any}[]>>} */
const files = new Map();

/** @param {string} key */
function testsOf(key) {
  let p = files.get(key);
  if (!p) {
    p = PARALLEL[key]().then((add) => {
      /** @type {{group: string, name: string, fn: () => any}[]} */
      const tests = [];
      add((group, name, fn) => tests.push({ group, name, fn }), assert, eq);
      return tests;
    });
    files.set(key, p);
  }
  return p;
}

/** @param {MessageEvent} ev */
async function onMessage(ev) {
  const { id, key, index } = ev.data;
  try {
    const tests = await testsOf(key);
    // src/core/workers.js sets its own worker handler when a test file imports it; take it back.
    self.onmessage = onMessage;
    if (index < 0) {
      self.postMessage({ id, names: tests.map((t) => [t.group, t.name]) });
      return;
    }
    self.postMessage({ id, ...(await runOne(tests[index].fn)) });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
}

self.onmessage = onMessage;
