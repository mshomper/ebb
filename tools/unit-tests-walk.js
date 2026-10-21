// @ts-check
// Walker tests for tools/unit-tests.html (doc 23, the walker; W1 and W2): the walk grid marks
// steep ground, the way goes round deep water and refuses a cliff, the sandbar opens at low tide
// and closes at high tide (with the line saying when low tide comes), a tap in a pond walks to its
// edge, and the figure strolls, creeps near a creature, hurries on a double tap and wades back to
// dry ground when the tide comes in.

import { createWalkGrid } from '../src/world/walk/grid.js';
import { findPath, isOpen } from '../src/world/walk/path.js';
import { createWalker } from '../src/world/walk/walker.js';
import { crossingNote, hoursToLow, depthAtLow } from '../src/world/walk/crossing.js';

const WALK = 'walker';

/** @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/**
 * A test strip 40 m by 20 m: the main island (x under 8 m, 1 m up), a sandbar at -0.3 m from 11 m
 * to 19 m along z = 10, and an islet (x over 22 m, 1 m up). Off the bar the sea floor is 2 m down.
 * @param {number} x @param {number} z
 */
function sandbar(x, z) {
  const along = x <= 8 ? 1 : x <= 11 ? lerp(1, -0.3, (x - 8) / 3) : x <= 19 ? -0.3 : x <= 22 ? lerp(-0.3, 1, (x - 19) / 3) : 1;
  if (x > 8 && x < 22) {
    const off = Math.abs(z - 10);
    return off <= 3 ? along : lerp(along, -2, (off - 3) / 2);
  }
  return along;
}

/** @param {(x: number, z: number) => number} ground */
async function world(ground) {
  const R = await (await fetch('../recipes/world/walker.json')).json();
  const grid = createWalkGrid({ ground, minX: 0, minZ: 0, maxX: 40, maxZ: 20, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
  return { R, grid };
}

/** Water over each cell with the sea at `tide` (m). @param {import('../src/world/walk/grid.js').WalkGrid} grid @param {{ level: number }} tide */
const seaDepth = (grid, tide) => (/** @type {number} */ k) => Math.max(0, tide.level - grid.height[k]);

/** @param {any} R @param {(k: number) => number} depth */
const rulesOf = (R, depth) => ({ depth, wadeM: R.grid.wadeM, wadeCost: R.grid.wadeCost, maxStepM: R.grid.maxStepM, snapM: R.grid.snapM });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addWalkTests(test, assert, eq) {
  test(WALK, 'the walk grid marks ground past 35 degrees as too steep, and flat ground as open', async () => {
    const R = await (await fetch('../recipes/world/walker.json')).json();
    const mk = (/** @type {number} */ slope) => createWalkGrid({ ground: (x) => x * slope, minX: 0, minZ: 0, maxX: 10, maxZ: 10, cellM: 0.5, maxSlopeDeg: R.grid.maxSlopeDeg });
    const steep = mk(Math.tan((60 * Math.PI) / 180)), flat = mk(0.1);
    eq(steep.steep.reduce((a, b) => a + b, 0), steep.w * steep.h, 'a 60 degree slope has open cells');
    eq(flat.steep.reduce((a, b) => a + b, 0), 0, 'a gentle slope has steep cells');
    return `${steep.w} x ${steep.h} cells`;
  });

  test(WALK, 'the sandbar opens at low tide and closes at high tide, and the line says when low tide comes', async () => {
    const { R, grid } = await world(sandbar);
    const low = { level: -0.6 }, high = { level: 0.6 };
    const atLow = findPath(grid, rulesOf(R, seaDepth(grid, low)), [3, 10], [30, 10]);
    assert(atLow.ok, `no way across the bar at low tide: ${!atLow.ok && atLow.reason}`);
    const atHigh = findPath(grid, rulesOf(R, seaDepth(grid, high)), [3, 10], [30, 10]);
    assert(!atHigh.ok && atHigh.reason === 'cut-off', 'the bar can be crossed at high tide');
    const lowDepth = depthAtLow(seaDepth(grid, high), (k) => grid.height[k], high.level, low.level);
    const line = crossingNote(grid, rulesOf(R, seaDepth(grid, high)), [3, 10], [30, 10], { reason: 'cut-off', lowDepth, hoursToLow: 4.2, words: R.words });
    eq(line, `${R.words.barUnder} ${R.words.lowTideIn.replace('{h}', '4')}`);
    // An islet with no bar at all: low tide never helps, so the line says you can't get there.
    const far = await world((x) => (x < 10 || x > 30 ? 1 : -3));
    const none = crossingNote(far.grid, rulesOf(R, seaDepth(far.grid, high)), [3, 10], [35, 10],
      { reason: 'cut-off', lowDepth: seaDepth(far.grid, low), hoursToLow: 4, words: R.words });
    eq(none, R.words.cantReach);
    // At high water (cycle 0, recipe phase 0) low water is half a period away.
    eq(Math.round(hoursToLow(0) * 10) / 10, 6, 'hours to low from high water');
    return `${atLow.ok ? atLow.points.length : 0} legs across at low tide; "${line}"`;
  });

  test(WALK, 'the way goes round a deep pond, and a tap in the pond walks to its edge', async () => {
    const { R, grid } = await world(() => 1);
    const inPond = (/** @type {number} */ x, /** @type {number} */ z) => Math.hypot(x - 20, z - 10) < 4;
    const depth = (/** @type {number} */ k) => { const [x, z] = grid.center(k); return inPond(x, z) ? 1 : 0; };
    const r = findPath(grid, rulesOf(R, depth), [12, 10], [28, 10]);
    assert(r.ok, 'no way round the pond');
    if (!r.ok) return;
    // Every leg stays out of the pond: sample along each one.
    let prev = [12, 10];
    for (const p of r.points) {
      for (let s = 0; s <= 20; s++) {
        const x = prev[0] + ((p[0] - prev[0]) * s) / 20, z = prev[1] + ((p[1] - prev[1]) * s) / 20;
        assert(!inPond(x, z) || Math.hypot(x - 20, z - 10) > 3.6, `the way crosses the pond at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      }
      prev = p;
    }
    const edge = findPath(grid, rulesOf(R, depth), [12, 10], [22.5, 10]);
    assert(edge.ok, 'a tap in the pond found nowhere to stand');
    if (!edge.ok) return;
    const d = Math.hypot(edge.goal[0] - 20, edge.goal[1] - 10);
    assert(d >= 3.8 && d <= 4.6, `the walk ends ${d.toFixed(2)} m from the pond's middle, not at its edge`);
    return `${r.points.length} legs round; the edge is ${d.toFixed(2)} m from the middle`;
  });

  test(WALK, 'a cliff face is not a way up', async () => {
    const { R, grid } = await world((x) => (x < 20 ? 0.5 : 2.5));
    const r = findPath(grid, rulesOf(R, () => 0), [10, 10], [30, 10]);
    assert(!r.ok && r.reason === 'cut-off', 'the walker climbed a 2 m face');
  });

  test(WALK, 'the figure strolls, creeps near a creature, hurries on a double tap, and stops where it was sent', async () => {
    const { R, grid } = await world(() => 1);
    const run = (/** @type {number} */ near, /** @type {boolean} */ brisk) => {
      const w = createWalker(R, { grid, depth: () => 0, ground: () => 1, nearest: () => near });
      w.place(5, 10);
      const r = w.walkTo(15, 10, brisk);
      assert(r.ok, 'no way on flat ground');
      let top = 0;
      for (let i = 0; i < 60 * 60 && w.moving; i++) { w.update(1 / 60); top = Math.max(top, w.speed); }
      assert(!w.moving && Math.hypot(w.x - 15, w.z - 10) < R.pace.arriveM, `stopped at ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);
      return top;
    };
    const stroll = run(Infinity, false), creep = run(1, false), brisk = run(Infinity, true);
    assert(Math.abs(stroll - R.pace.strollMps) < 0.06, `stroll topped out at ${stroll.toFixed(2)} m/s`);
    assert(creep <= R.pace.creepMps + 0.06, `near a creature it went ${creep.toFixed(2)} m/s`);
    assert(brisk > R.pace.strollMps + 0.3, `a double tap only reached ${brisk.toFixed(2)} m/s`);
    return `stroll ${stroll.toFixed(2)}, creep ${creep.toFixed(2)}, brisk ${brisk.toFixed(2)} m/s`;
  });

  test(WALK, 'the figure wades back to dry ground when the tide comes in over the bar', async () => {
    const { R, grid } = await world(sandbar);
    const tide = { level: -0.6 };
    const depth = seaDepth(grid, tide);
    const w = createWalker(R, { grid, depth, ground: sandbar });
    assert(w.place(15, 10), 'nowhere to stand on the bar at low tide');
    assert(w.walkTo(30, 10).ok, 'no way across at low tide');
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    tide.level = 0.6;
    for (let i = 0; i < 60 * 60 && (w.moving || w.retreating); i++) w.update(1 / 60);
    const k = grid.cellAt(w.x, w.z);
    assert(isOpen(grid, w.rules, k), `the figure is left standing in ${depth(k).toFixed(2)} m of water at ${w.x.toFixed(1)}, ${w.z.toFixed(1)}`);
    return `waded back to ${w.x.toFixed(1)}, ${w.z.toFixed(1)}`;
  });
}
