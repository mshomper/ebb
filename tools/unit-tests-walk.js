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
import { mainland, nearestJoined } from '../src/world/walk/reach.js';
import { createPresence, ringScale } from '../src/world/creatures/presence.js';
import { createWatching } from '../src/world/creatures/watching.js';
import { createWalk } from '../src/world/walk/index.js';
import { on, flushDeferred } from '../src/core/events.js';
import { makeStepping, strideAfter, jitterOf, links, footingAt } from '../src/world/pieces/stepping.js';
import { hash32 } from '../src/core/rng.js';

/**
 * The game's walk (walk/index.js) on flat ground 1 m up, 40 m by 20 m, with a stand-in camera and
 * dry water, so its hooks can be tried: returns the walk, the events it sent (flushed each frame)
 * and a way to run it. @param {any} R recipes/world/walker.json
 */
async function gameWalk(R) {
  const figure = await (await fetch('../recipes/world/figure.json')).json();
  const water = await (await fetch('../recipes/world/water.json')).json();
  const camera = { eye: [10, 5, 0], target: [10, 1, 10], viewProj: new Float32Array(16), setGround() {}, follow() {} };
  const walk = createWalk({
    recipe: R, figure, tide: water.tide, hours: () => 0, creatures: () => [], camera: /** @type {any} */ (camera),
    terrain: /** @type {any} */ ({ sampleHeight: () => 1, openBounds: () => ({ openMin: [0, 0], openMax: [40, 20] }), sampleMaterial: () => ({ grass: 1, sand: 0, rock: 0, soil: 0 }) }),
    water: { sim: { live: false }, tide: -5, sampleLive: () => ({ depth: 0 }) },
  });
  /** @type {{ name: string, p: any }[]} */ const heard = [];
  const offs = ['walk:arrived', 'walk:act-done', 'walk:went-down'].map((n) => on(n, (p) => heard.push({ name: n, p })));
  flushDeferred();
  const run = (/** @type {number} */ seconds) => { for (let i = 0; i < seconds * 60; i++) { walk.update(1 / 60); flushDeferred(); } };
  return { walk, heard, run, done: () => { offs.forEach((off) => off()); walk.dispose(); } };
}

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

  test(WALK, 'pond stones over 0.8 m of water: walked out to the last stone and back again (F10)', async () => {
    const R = await (await fetch('../recipes/world/walker.json')).json();
    const S = (await (await fetch('../recipes/world/pieces.json')).json()).stepping;
    // A bank 1.05 m up, sloping into a pond whose bed is 0.2 m, under still water 1.0 m up: 0.8 m deep.
    const land = (/** @type {number} */ x) => lerp(1.05, 0.2, (x - 8) / 2);
    const surface = 1.0;
    // A line laid as the Pond stones mode lays one: a seeded stride and nudge, on a diagonal so the
    // way back crosses the grid's cells at a slant (where the walker used to turn back on itself).
    /** @type {any[]} */ const stones = [];
    let at = [7.4, 4], n = 1;
    const ux = Math.cos(0.55), uz = Math.sin(0.55);
    for (;;) {
      const prev = stones[stones.length - 1];
      const stride = prev ? strideAfter(prev.seed, S) : 0, jit = jitterOf(hash32(9, n, 0x1a7), S);
      const x = at[0] + ux * stride - uz * jit, z = at[1] + uz * stride + ux * jit;
      if (x > 22) break;
      stones.push(makeStepping(9, n, x, z, Math.max(0, surface - land(x)), 0, stones[0]?.id ?? null, S));
      at = [at[0] + ux * stride, at[1] + uz * stride];
      n++;
    }
    const linked = links(stones, S, (x) => land(x));
    const footing = (/** @type {number} */ x, /** @type {number} */ z) => footingAt(stones, linked, (xx) => land(xx), S, x, z);
    const grid = createWalkGrid({ ground: (x) => land(x), footing, minX: 0, minZ: 0, maxX: 40, maxZ: 20, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
    const depth = (/** @type {number} */ k) => Math.max(0, surface - grid.height[k]);
    const w = createWalker(R, { grid, depth, ground: (x, z) => Math.max(land(x), footing(x, z)) });
    assert(stones.every((p, i) => i === 0 || linked.some(([a, b]) => (a === p || b === p) && (a === stones[i - 1] || b === stones[i - 1]))), 'a stone is not linked to the one before it');
    // Out on the stones, the water is deeper than the walker can wade.
    assert(Math.max(0, surface - land(stones[stones.length - 1].x)) >= 0.8 - 1e-9, 'the last stone is not over 0.8 m of water');
    /** Walk to a point and run until the walk ends; where it ended, and the deepest water stood in. @param {number} x @param {number} z */
    const go = (x, z) => {
      const r = w.walkTo(x, z);
      assert(r.ok, `no way to ${x.toFixed(1)}, ${z.toFixed(1)}: ${!r.ok && r.reason}`);
      let wet = 0;
      for (let i = 0; i < 60 * 120 && w.moving; i++) { w.update(1 / 60); wet = Math.max(wet, depth(grid.cellAt(w.x, w.z))); }
      return { d: Math.hypot(w.x - x, w.z - z), wet };
    };
    w.place(4, 4);
    const last = stones[stones.length - 1], mid = stones[Math.floor(stones.length / 2)];
    const out = go(last.x, last.z);
    assert(out.d < 0.3, `walking out stopped ${out.d.toFixed(2)} m short of the last stone`);
    const back = go(4, 4);
    assert(back.d < 0.3, `walking back from the last stone stopped ${back.d.toFixed(2)} m short of the bank`);
    // Out to the middle, then turn round there.
    go(mid.x, mid.z);
    const turn = go(4.5, 3.5);
    assert(turn.d < 0.3, `turning back from the middle stopped ${turn.d.toFixed(2)} m short`);
    assert(Math.max(out.wet, back.wet, turn.wet) < R.grid.wadeM, 'the walk stood in water deeper than wading');
    return `${stones.length} stones, ${linked.length} links; out and back to within ${Math.max(out.d, back.d, turn.d).toFixed(2)} m`;
  });

  test(WALK, 'wading past the ankle slows the walk, even hurrying', async () => {
    const { R, grid } = await world(() => 1);
    const w = createWalker(R, { grid, depth: () => 0.25, ground: () => 1 });
    w.place(5, 10);
    assert(w.walkTo(15, 10, true).ok, 'no way through shallow water');
    let top = 0;
    for (let i = 0; i < 60 * 60 && w.moving; i++) { w.update(1 / 60); top = Math.max(top, w.speed); }
    assert(top <= R.pace.wadeMps + 0.06, `wading it went ${top.toFixed(2)} m/s`);
    return `wading at ${top.toFixed(2)} m/s`;
  });

  test(WALK, 'a ring of terraces round the figure cuts it off, and the nearest way out is past the ring', async () => {
    const { R, grid } = await world((x, z) => { const d = Math.hypot(x - 20, z - 10); return d > 4 && d < 5 ? 2.5 : 0.5; });
    const land = mainland(grid, rulesOf(R, () => 0));
    assert(!land.joined(grid.cellAt(20, 10)), 'the middle of the ring still joins the island');
    assert(land.joined(grid.cellAt(2, 2)), 'the open ground is not the mainland');
    const k = nearestJoined(grid, land, 20, 10);
    const [x, z] = grid.center(k);
    const d = Math.hypot(x - 20, z - 10);
    assert(d >= 4.5 && d <= 6, `the way out lands ${d.toFixed(2)} m from the middle`);
    return `out at ${d.toFixed(2)} m from the middle`;
  });

  test(WALK, 'the islet joins the island at low water but not at high, so I\'m stuck brings you back to the main island', async () => {
    // The strip mirrored, so the bigger ground is the main island (x under 18 m) and the islet is small.
    const mirrored = (/** @type {number} */ x, /** @type {number} */ z) => sandbar(40 - x, z);
    const { R, grid } = await world(mirrored);
    const low = mainland(grid, rulesOf(R, seaDepth(grid, { level: -0.6 })));
    const high = mainland(grid, rulesOf(R, seaDepth(grid, { level: 0.6 })));
    const islet = grid.cellAt(36, 10);
    assert(low.joined(islet), 'the islet is cut off even at low water');
    assert(!high.joined(islet), 'the islet joins the island at high water');
    const k = nearestJoined(grid, high, 36, 10);
    const [x] = grid.center(k);
    // The main island's shore reaches x 20 at high water; the bar runs from 21 to 29.
    assert(x < 20.5, `I'm stuck at high water lands at x ${x.toFixed(1)}, not on the main island`);
    return `back on the main island at x ${x.toFixed(1)}`;
  });

  test(WALK, 'presence below: the camera above is felt only for its edits, and you on foot are felt low and slow', async () => {
    const R = await (await fetch('../recipes/world/walker.json')).json();
    const eye = new Float32Array([0, 10, 0]);
    /** @type {import('../src/world/creatures/presence.js').WalkerNow | null} */
    let me = null;
    const presence = createPresence({ camera: { eye, driven: () => false }, cameraBody: false, walker: () => me, heightM: R.presence.heightM });
    presence.update(1 / 60);
    eq(presence.sources().length, 1, 'above, only the camera');
    assert(!presence.sources()[0].body, 'the camera above has a body');
    me = { x: 2, y: 1, z: 3, speed: 0.3, posture: 'sit', gaze: [0, 1] };
    presence.update(1 / 60);
    const you = presence.sources().find((s) => s.kind === 'walker');
    assert(you && you.body && you.posture === 'sit', 'on foot, no walker source');
    if (!you) return;
    assert(Math.abs(you.pos[1] - (1 + R.presence.heightM.sit)) < 1e-6, `sitting, you are felt at ${you.pos[1]} m`);
    const M = (await (await fetch('../recipes/species/frog.json')).json()).presence.multipliers;
    // Sitting and looking straight at it, or looking away.
    const ahead = ringScale(you, 2, 6, M), aside = ringScale(you, 5, 3, M);
    assert(Math.abs(ahead - M.posture.sit * M.gaze.watch) < 1e-6, `sitting and watching scales the ring by ${ahead}`);
    assert(Math.abs(aside - M.posture.sit * M.gaze.away) < 1e-6, `sitting and looking away scales the ring by ${aside}`);
    return `ring x ${ahead.toFixed(2)} watching, x ${aside.toFixed(2)} looking away, sitting`;
  });

  test(WALK, 'sitting quietly by a frog earns trust faster than standing', async () => {
    const W = (await (await fetch('../recipes/species/frog.json')).json()).presence.watch;
    const frog = { id: 1, x: 0, y: 0, z: 0, mode: 'rest' };
    const src = (/** @type {'stand'|'sit'} */ posture) => [{ id: 'walker', kind: /** @type {const} */ ('walker'), pos: /** @type {[number, number, number]} */ ([1, 0.4, 0]),
      speed: 0, editing: false, edits: [], stillS: 0, body: true, posture }];
    const minutes = (/** @type {'stand'|'sit'} */ p) => {
      const w = createWatching(W);
      let got = 0;
      for (let t = 0; t < 60; t += 0.1) for (const d of w.step([frog], src(p), 0.1)) got += d.minutes;
      for (const d of w.step([frog], [], 0.1)) got += d.minutes;
      return got;
    };
    const stand = minutes('stand'), sit = minutes('sit');
    assert(Math.abs(sit - stand * W.sitBoost) < 0.05, `a minute sitting counts ${sit}, standing ${stand}`);
    return `a minute standing counts ${stand}, sitting ${sit}`;
  });

  test(WALK, 'kneeling or sitting stops a walk, and walking stands you up', async () => {
    const { R, grid } = await world(() => 1);
    const w = createWalker(R, { grid, depth: () => 0, ground: () => 1 });
    w.place(5, 10);
    w.walkTo(15, 10);
    w.update(0.5);
    w.setPosture('sit');
    eq(w.posture, 'sit');
    assert(!w.moving && w.speed === 0, 'sitting down did not stop the walk');
    w.walkTo(8, 10);
    eq(w.posture, 'stand', 'walking on');
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

  test(WALK, 'walk:arrived comes at the end of a walk, never after a stop', async () => {
    const R = await (await fetch('../recipes/world/walker.json')).json();
    const g = await gameWalk(R);
    try {
      assert(g.walk.placeAt(5, 10, 0), 'placeAt found nowhere to stand');
      assert(g.walk.downHere(), 'downHere did not go down');
      g.run(0.1);
      eq(g.heard.filter((e) => e.name === 'walk:went-down').length, 1, 'went down once');
      g.walk.tap(100, 100, [12, 1, 10]);
      assert(g.walk.walker.moving, 'the tap did not start a walk');
      g.run(20);
      const arrived = g.heard.filter((e) => e.name === 'walk:arrived');
      eq(arrived.length, 1, 'arrivals at the end of the walk');
      assert(Math.hypot(arrived[0].p.x - 12, arrived[0].p.z - 10) < 0.3, `arrived at ${arrived[0].p.x.toFixed(2)}, ${arrived[0].p.z.toFixed(2)}`);
      // A walk cut short by I'm stuck (a stop) does not arrive.
      g.walk.tap(400, 100, [20, 1, 10]);
      g.run(1);
      assert(g.walk.walker.moving, 'the second walk is under way');
      g.walk.stuck();
      g.run(3);
      eq(g.heard.filter((e) => e.name === 'walk:arrived').length, 1, 'arrivals after a stop');
      return `arrived at ${arrived[0].p.x.toFixed(2)}, ${arrived[0].p.z.toFixed(2)}`;
    } finally { g.done(); }
  });

  test(WALK, 'act() reports walk:act-done after its length, holds you still meanwhile, and placeAt never reads as a fast move', async () => {
    const R = await (await fetch('../recipes/world/walker.json')).json();
    const g = await gameWalk(R);
    try {
      assert(g.walk.placeAt(5, 10, 0, 'kneel'), 'placeAt found nowhere to stand');
      g.walk.downHere();
      g.run(0.1);
      // A jump of 20 m: the walker's speed (what presence reads) stays 0.
      assert(g.walk.placeAt(25, 10, 1, 'stand'), 'placeAt again');
      eq(g.walk.presenceNow()?.speed, 0, 'presence speed after a placeAt');
      g.run(0.05);
      eq(g.walk.presenceNow()?.speed, 0, 'presence speed a few frames on');
      eq(g.walk.act('cartwheel'), false, 'an unknown act');
      const figure = await (await fetch('../recipes/world/figure.json')).json();
      assert(g.walk.act('drink'), 'drink did not play');
      eq(g.walk.walker.posture, 'kneel', 'kneeling while it drinks');
      eq(g.walk.act('lay'), false, 'a second act while one plays');
      g.walk.tap(100, 100, [30, 1, 10]);
      assert(!g.walk.walker.moving, 'a tap walked off mid-act');
      const len = figure.poses.drink.keys.at(-1).t;
      g.run(len - 0.1);
      eq(g.heard.filter((e) => e.name === 'walk:act-done').length, 0, 'done too soon');
      g.run(0.2);
      const done = g.heard.filter((e) => e.name === 'walk:act-done');
      eq(done.length, 1, 'act-done once');
      eq(done[0].p.name, 'drink', 'the act named');
      eq(g.walk.walker.posture, 'stand', 'standing after drinking');
      eq(g.heard.filter((e) => e.name === 'walk:arrived').length, 0, 'no arrival from a placeAt or an act');
      return `drink ${len} s`;
    } finally { g.done(); }
  });
}
