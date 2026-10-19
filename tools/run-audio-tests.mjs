// Runs the pure audio tests in Node, for the cloud session's own checks:
//   node tools/run-audio-tests.mjs
// Matt runs the same tests in the browser on tools/unit-tests-audio.html.
import { addMusicTests } from './unit-tests-music.js';

const tests = [];
const test = (group, name, fn) => tests.push({ group, name, fn });
const assert = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${String(b)}, got ${String(a)}`.trim()); };
addMusicTests(test, assert, eq);

let passed = 0;
for (const t of tests) {
  try { await t.fn(); passed++; } catch (e) { console.log(`FAIL ${t.group}: ${t.name}\n     ${e.message}`); }
}
console.log(`${passed} of ${tests.length} passed`);
process.exitCode = passed === tests.length ? 0 : 1;
