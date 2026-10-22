// @ts-check
// Life under a log for tools/unit-tests.html (docs/future/11 L3a): the shelter field kept logs and
// loose stones write into the habitat grid (src/world/ecology/shelter.js) and the toad's walk that
// reads it.

import { coveredCells, shelterFields, dampUnderAt } from '../src/world/ecology/shelter.js';
import { HABITAT_ORIGIN } from '../src/world/growth/habitat.js';
import { rollUnder, chanceOf, inTime, onGround, groundUnder, underToWorld, keptAge } from '../src/world/finds/under-log.js';

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

  const recipe = () => fetch('../recipes/species/under-log.json').then((r) => r.json());
  /** A ground: damp grass by water, unless changed. @param {any} [o] */
  const ground = (o = {}) => ({ damp: 0.8, shade: 0.5, nearWater: 1, grass: 0.9, soil: 0.1, wet: false, ...o });
  const log = { id: 'p3', kind: 'log', seed: 123456, length: 1.4, size: 0.22 };
  /** A summer's day at noon, a log kept for days. @param {any} [o] */
  const when = (o = {}) => ({ day: 40, days: 10, ground: ground(), season: 1, phase: 0.5, hourOfDay: 12, ...o });

  test(G, 'woodlice: kept logs on soil or grass after two days, never in the water or under a stone', async () => {
    const R = await recipe();
    const W = R.woodlice;
    assert(chanceOf(W, { kind: 'log', ...when() }, R.ground) > 0.5, 'a damp, shaded log by water is likely');
    eq(chanceOf(W, { kind: 'log', ...when({ days: 1 }) }, R.ground), 0, 'not before two days');
    eq(chanceOf(W, { kind: 'stone', ...when() }, R.ground), 0, 'not under a stone (L3a)');
    eq(chanceOf(W, { kind: 'log', ...when({ ground: ground({ grass: 0, soil: 0 }) }) }, R.ground), 0, 'not on sand or rock');
    eq(chanceOf(W, { kind: 'log', ...when({ ground: ground({ wet: true }) }) }, R.ground), 0, 'not in the water');
    const dry = chanceOf(W, { kind: 'log', ...when({ ground: ground({ damp: 0, shade: 0, nearWater: 0 }), days: 2 }) }, R.ground);
    assert(dry > 0 && dry < chanceOf(W, { kind: 'log', ...when() }, R.ground), 'a dry, sunny, new log: less likely, not never');
    assert(onGround(W.ground, ground({ grass: 0, soil: 0.6 }), R.ground), 'bare soil counts');
    // The age share follows L2's ageing of the log itself (log-age.js).
    const A = (await fetch('../recipes/world/pieces.json').then((r) => r.json())).driftwood.age;
    const young = keptAge(0, 3 * 24, A), old = keptAge(0, 60 * 24, A);
    assert(young.age !== undefined && old.age !== undefined && old.age > young.age, 'a log ages by L2\'s clock');
    assert(chanceOf(W, { kind: 'log', ...when(old) }, R.ground) > chanceOf(W, { kind: 'log', ...when(young) }, R.ground), 'an old log is likelier');
    eq(keptAge(0, 48, null).age, undefined, 'a stone has no age');
  });

  test(G, 'the violet ground beetle: logs on grass, late spring to autumn, by day', async () => {
    const R = await recipe();
    const B = R.beetle;
    assert(chanceOf(B, { kind: 'log', ...when() }, R.ground) > 0, 'summer noon on grass');
    eq(inTime(B, { season: 0, phase: 0.2, hourOfDay: 12 }), false, 'not early spring');
    eq(inTime(B, { season: 0, phase: 0.7, hourOfDay: 12 }), true, 'late spring');
    eq(inTime(B, { season: 2, phase: 0.5, hourOfDay: 12 }), true, 'autumn');
    eq(inTime(B, { season: 3, phase: 0.5, hourOfDay: 12 }), false, 'not winter');
    eq(inTime(B, { season: 1, phase: 0.5, hourOfDay: 23 }), false, 'not at night');
    eq(chanceOf(B, { kind: 'log', ...when({ ground: ground({ grass: 0.1, soil: 0.9 }) }) }, R.ground), 0, 'not on bare soil');
  });

  test(G, 'a lift\'s roll is seeded: the same log and day find the same, another day may not', async () => {
    const R = await recipe();
    const a = rollUnder(77, log, when(), R), b = rollUnder(77, log, when(), R);
    eq(JSON.stringify(a), JSON.stringify(b), 'the same roll');
    let woodlice = 0, beetles = 0, days = 0;
    for (let d = 0; d < 400; d++) {
      const r = rollUnder(77, log, when({ day: d }), R);
      days++;
      if (r.counts.woodlice) {
        woodlice++;
        assert(r.counts.woodlice >= R.woodlice.count[0] && r.counts.woodlice <= R.woodlice.count[1], 'three to eight');
      }
      if (r.counts.beetle) beetles++;
      for (const f of r.found) assert(Math.abs(f.u) <= 0.45 && Math.abs(f.v) <= log.size, 'under the log');
    }
    const wShare = woodlice / days, bShare = beetles / days;
    assert(wShare > 0.6 && wShare < 0.98, `woodlice most days under a damp log (${wShare.toFixed(2)})`);
    assert(bShare > 0.1 && bShare < 0.35, `the beetle about one lift in five (${bShare.toFixed(2)})`);
    return `woodlice ${Math.round(wShare * 100)}% of days, beetle ${Math.round(bShare * 100)}%`;
  });

  test(G, 'the ground under a piece: damp, shade, water near, from the grid and the plants', () => {
    const n = 64, hab = { n, moisture: new Uint8Array(n * n), depthCm: new Uint8Array(n * n), sea: new Uint8Array(n * n), grass: new Uint8Array(n * n).fill(230), soil: new Uint8Array(n * n) };
    hab.moisture[10 * n + 10] = 200;
    hab.depthCm[10 * n + 12] = 20;
    const G0 = { nearWaterM: 4, nearWaterFullM: 1, shade: { radiusM: 2.5, plants: { willow: 1 }, full: 0.8 } };
    const g = groundUnder({ hab, plants: [{ sp: 'willow', x: mid(10), z: mid(11), size: 1 }], x: mid(10), z: mid(10), G: G0 });
    assert(Math.abs(g.damp - 200 / 255) < 1e-9, 'damp from the moisture');
    assert(g.nearWater > 0.3 && g.nearWater < 1, `water two squares off (${g.nearWater.toFixed(2)})`);
    assert(g.shade > 0.5, 'a willow beside it shades it');
    eq(g.wet, false, 'not in the water');
    const far = groundUnder({ hab, plants: [], x: mid(40), z: mid(40), G: G0 });
    eq(far.nearWater, 0, 'no water near');
    eq(far.shade, 0, 'no shade');
    const [x, z] = underToWorld({ x: 1, z: 2, yaw: 0, length: 2, kind: 'log' }, 0.25, 0);
    assert(Math.abs(x - 1) < 1e-9 && Math.abs(z - 2.5) < 1e-9, 'along a log lying along z');
  });
}
