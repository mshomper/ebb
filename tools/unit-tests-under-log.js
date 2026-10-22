// @ts-check
// Life under a log for tools/unit-tests.html (docs/future/11 L3a): the shelter field kept logs and
// loose stones write into the habitat grid (src/world/ecology/shelter.js) and the toad's walk that
// reads it.

import { coveredCells, shelterFields, dampUnderAt } from '../src/world/ecology/shelter.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';

const G = 'under-log';

/** A small habitat grid: dry ground, damp (moisture 230) on the east half. @param {number} n */
function grid(n) {
  const moisture = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = n / 2; i < n; i++) moisture[j * n + i] = 230;
  return { n, moisture };
}
/** World x or z at the middle of square i. @param {number} i */
const mid = (i) => HABITAT_ORIGIN + i + 0.5;

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addUnderLogTests(test, assert, eq) {
  test(G, 'a stone shelters its own square; a log every square along its length', () => {
    const n = 64;
    eq(coveredCells({ x: mid(10), z: mid(12), kind: 'stone' }, n).join(), String(12 * n + 10), 'a stone');
    // A 2.4 m log lying along x (yaw pi/2) covers three squares, maybe a fourth at its ends.
    const log = coveredCells({ x: mid(20), z: mid(5), kind: 'log', len: 2.4, yaw: Math.PI / 2 }, n);
    assert(log.length >= 3 && log.length <= 4, `a log along x covers 3 or 4 squares (${log.length})`);
    assert(log.every((k) => Math.floor(k / n) === 5), 'all on its own row');
    eq(coveredCells({ x: -1e4, z: 0, kind: 'stone' }, n).length, 0, 'off the grid: none');
  });

  test(G, 'shelter under and damp underneath: logs and stones only, damp where the ground is', () => {
    const n = 64, hab = grid(n);
    eq(shelterFields([], hab), null, 'nothing set: no field');
    eq(shelterFields([{ x: mid(4), z: mid(4), kind: 'raft' }], hab), null, 'a raft is no shelter');
    const f = shelterFields([{ x: mid(4), z: mid(4), kind: 'stone' }, { x: mid(40), z: mid(9), kind: 'log', len: 1.2, yaw: 0 }], hab);
    assert(f, 'a field');
    if (!f) return;
    eq(f.shelterUnder[4 * n + 4], 255, 'under the stone');
    eq(f.dampUnder[4 * n + 4], 0, 'the stone lies on dry ground');
    eq(f.shelterUnder[9 * n + 40], 255, 'under the log');
    eq(f.dampUnder[9 * n + 40], 230, 'the log lies in the damp');
    eq(f.shelterUnder[0], 0, 'open ground is not sheltered');
    // The same pieces in any order give the same fields (catch-up and live agree).
    const g = shelterFields([{ x: mid(40), z: mid(9), kind: 'log', len: 1.2, yaw: 0 }, { x: mid(4), z: mid(4), kind: 'stone' }], hab);
    eq(Array.from(g?.dampUnder ?? []).join(), Array.from(f.dampUnder).join(), 'order does not matter');
    assert(Math.abs(dampUnderAt({ x: mid(40), z: mid(9), kind: 'log', len: 1.2, yaw: 0 }, f, n) - 230 / 255) < 1e-9, 'damp under the log, 0..1');
    eq(dampUnderAt({ x: mid(4), z: mid(4), kind: 'stone' }, f, n), 0, 'dry under the stone');
  });
}
