// @ts-check
// Walking with the keys (doc 23; WASD, October 26, 2026) for tools/unit-tests.html: W A S D read
// camera-relative with diagonals no faster, the walker steered to full pace in about 0.15 s and
// stopped in about 0.1 s, deep water and cliffs blocking the way, sliding along an edge, a creep near
// a creature, a key taking over from a click walk (and the card it would open), the dodge roll's
// length and its stop at an edge, and the roll on the figure's rig.

import { createWalkGrid } from '../src/world/walk/grid.js';
import { createWalker } from '../src/world/walk/walker.js';
import { createWalk } from '../src/world/walk/index.js';
import { keyAxes, worldWay } from '../src/input/move-keys.js';
import { rollPose } from '../src/world/figure/roll.js';
import { createSolids } from '../src/world/walk/solids.js';
import { campSolids, pieceSolids } from '../src/world/walk/solids-live.js';
import { on, flushDeferred } from '../src/core/events.js';

const G = 'steer';
const DT = 1 / 60;

/** @param {(x: number, z: number) => number} ground */
async function world(ground) {
  const R = await (await fetch('../recipes/world/walker.json')).json();
  const grid = createWalkGrid({ ground, minX: 0, minZ: 0, maxX: 40, maxZ: 20, cellM: R.grid.cellM, maxSlopeDeg: R.grid.maxSlopeDeg });
  return { R, grid };
}

/** Steer a walker for some seconds. @param {any} w @param {number} x @param {number} z @param {number} s @param {boolean} [run] */
function steerFor(w, x, z, s, run = false) {
  let top = 0;
  for (let i = 0; i < Math.round(s / DT); i++) { w.steer(x, z, run); w.update(DT); top = Math.max(top, w.speed); }
  return top;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSteerTests(test, assert, eq) {
  test(G, 'keys read camera-relative, and a diagonal is never faster than one key', () => {
    const w = keyAxes(['KeyW']), d = keyAxes(['KeyW', 'KeyD']), both = keyAxes(['KeyW', 'ArrowUp', 'KeyS']);
    eq(w.forward, 1, 'W forward');
    assert(Math.abs(Math.hypot(d.forward, d.right) - 1) < 1e-9, `W and D together have length ${Math.hypot(d.forward, d.right)}`);
    eq(both.forward, 0, 'W and S cancel');
    // The camera's yaw 0 has its eye at +z, so forward is -z and right is +x.
    const [fx, fz] = worldWay(1, 0, 0), [rx, rz] = worldWay(0, 1, 0);
    assert(Math.abs(fx) < 1e-9 && Math.abs(fz + 1) < 1e-9, `forward is ${fx}, ${fz}`);
    assert(Math.abs(rx - 1) < 1e-9 && Math.abs(rz) < 1e-9, `right is ${rx}, ${rz}`);
    // Turned a quarter, forward turns with it.
    const [qx, qz] = worldWay(1, 0, Math.PI / 2);
    assert(Math.abs(qx + 1) < 1e-9 && Math.abs(qz) < 1e-9, `forward a quarter round is ${qx}, ${qz}`);
  });

  test(G, 'steered on flat ground: full pace in about 0.15 s, the same along a diagonal, a stop in about 0.1 s, Shift runs', async () => {
    const { R, grid } = await world(() => 1);
    const w = createWalker(R, { grid, depth: () => 0, ground: () => 1, nearest: () => Infinity });
    w.place(10, 10, 0);
    let t = 0;
    while (w.speed < R.pace.strollMps * 0.95 && t < 2) { w.steer(0, 1); w.update(DT); t += DT; }
    assert(t <= R.steer.profiles.island.accelS + 0.05, `took ${t.toFixed(2)} s to reach the walk`);
    let s = 0;
    while (w.moving && s < 2) { w.steer(0, 0); w.update(DT); s += DT; }
    assert(s <= R.steer.profiles.island.stopS + 0.05, `took ${s.toFixed(2)} s to stop`);
    w.place(10, 10, Math.PI / 4);
    const diag = steerFor(w, Math.SQRT1_2, Math.SQRT1_2, 0.6);
    assert(Math.abs(diag - R.pace.strollMps) < 0.05, `a diagonal topped out at ${diag.toFixed(2)} m/s`);
    w.place(10, 10, 0);
    const run = steerFor(w, 0, 1, 1, true);
    assert(Math.abs(run - R.pace.briskMps) < 0.05, `Shift topped out at ${run.toFixed(2)} m/s`);
    return `walk in ${t.toFixed(2)} s, stop in ${s.toFixed(2)} s, diagonal ${diag.toFixed(2)}, run ${run.toFixed(2)} m/s`;
  });

  test(G, 'a cliff and deep water block the keys, and a slanting push slides along the edge', async () => {
    const cliff = (/** @type {number} */ x) => (x < 20 ? 0.5 : 2.5);
    const { R, grid } = await world(cliff);
    const w = createWalker(R, { grid, depth: () => 0, ground: (x) => cliff(x) });
    w.place(18, 10, Math.PI / 2);
    steerFor(w, 1, 0, 2);
    assert(w.x < 20, `walked up a 2 m face to x ${w.x.toFixed(2)}`);
    // Slanting into the face: you slide along it instead of stopping dead.
    w.place(18, 5, Math.PI / 4);
    steerFor(w, Math.SQRT1_2, Math.SQRT1_2, 2);
    assert(w.x < 20 && w.z > 7, `slid only to ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);
    // A deep pond: never walked into.
    const flat = await world(() => 1);
    const inPond = (/** @type {number} */ x, /** @type {number} */ z) => Math.hypot(x - 20, z - 10) < 3;
    const depth = (/** @type {number} */ k) => { const [x, z] = flat.grid.center(k); return inPond(x, z) ? 1 : 0; };
    const p = createWalker(R, { grid: flat.grid, depth, ground: () => 1 });
    p.place(12, 10, Math.PI / 2);
    steerFor(p, 1, 0, 4);
    assert(!inPond(p.x, p.z), `walked into the pond at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
    return `stopped at x ${w.x.toFixed(2)} by the face; at the pond's edge ${Math.hypot(p.x - 20, p.z - 10).toFixed(2)} m from its middle`;
  });

  test(G, 'keys creep near a creature, and Shift still hurries', async () => {
    const { R, grid } = await world(() => 1);
    const w = createWalker(R, { grid, depth: () => 0, ground: () => 1, nearest: () => 1 });
    w.place(10, 10, 0);
    const creep = steerFor(w, 0, 1, 1);
    assert(creep <= R.pace.creepMps + 0.02, `near a frog the keys went ${creep.toFixed(2)} m/s`);
    const hurry = steerFor(w, 0, 1, 1, true);
    assert(hurry > R.pace.strollMps, `Shift near a frog only went ${hurry.toFixed(2)} m/s`);
    return `creep ${creep.toFixed(2)}, Shift ${hurry.toFixed(2)} m/s`;
  });

  test(G, 'the dodge roll covers its distance, waits before the next, and stops short at a cliff edge', async () => {
    const { R, grid } = await world(() => 1);
    const RL = R.steer.roll;
    const w = createWalker(R, { grid, depth: () => 0, ground: () => 1 });
    w.place(10, 10, 0);
    assert(w.roll(0, 0), 'the roll did not start');
    let top = 0;
    for (let i = 0; i < Math.round(RL.durS / DT) + 2; i++) { w.update(DT); top = Math.max(top, w.speed); }
    assert(Math.abs(w.z - 10 - RL.distM) < 0.1, `rolled ${(w.z - 10).toFixed(2)} m`);
    assert(top > R.pace.briskMps, `the roll's speed ${top.toFixed(2)} m/s is not fast movement`);
    assert(!w.roll(0, 1), 'a second roll started with no wait');
    for (let i = 0; i < Math.round(RL.waitS / DT) + 1; i++) w.update(DT);
    assert(w.roll(0, 1), 'no roll after the wait');
    const cliff = (/** @type {number} */ x) => (x < 20 ? 0.5 : -1.5);
    const c = await world(cliff);
    const e = createWalker(R, { grid: c.grid, depth: () => 0, ground: (x) => cliff(x) });
    e.place(19, 10, Math.PI / 2);
    e.roll(1, 0);
    for (let i = 0; i < 40; i++) e.update(DT);
    assert(e.x < 20, `rolled off the edge to x ${e.x.toFixed(2)}`);
    return `rolled ${(w.z - 10).toFixed(2)} m at up to ${top.toFixed(2)} m/s; stopped at x ${e.x.toFixed(2)} by the edge`;
  });

  test(G, 'a movement key takes over from a click walk: no arrival, and walk:keys for the card it would open', async () => {
    const R = await (await fetch('../recipes/world/walker.json')).json();
    const figure = await (await fetch('../recipes/world/figure.json')).json();
    const water = await (await fetch('../recipes/world/water.json')).json();
    const camera = { eye: [10, 5, 0], target: [10, 1, 10], viewProj: new Float32Array(16), setGround() {}, follow() {} };
    const walk = createWalk({
      recipe: R, figure, tide: water.tide, hours: () => 0, creatures: () => [], camera: /** @type {any} */ (camera),
      terrain: /** @type {any} */ ({ sampleHeight: () => 1, openBounds: () => ({ openMin: [0, 0], openMax: [40, 20] }), sampleMaterial: () => ({ grass: 1, sand: 0, rock: 0, soil: 0 }) }),
      water: { sim: { live: false }, tide: -5, sampleLive: () => ({ depth: 0 }) },
    });
    /** @type {string[]} */ const heard = [];
    const offs = ['walk:arrived', 'walk:keys'].map((n) => on(n, () => heard.push(n)));
    const run = (/** @type {number} */ s) => { for (let i = 0; i < s / DT; i++) { walk.update(DT); flushDeferred(); } };
    try {
      walk.placeAt(5, 10, 0);
      walk.downHere();
      run(0.1);
      assert(walk.tap(100, 100, [30, 1, 10], 0.9), 'the click found no way');
      run(0.5);
      walk.keyTakeover();
      flushDeferred();
      assert(!walk.walker.pathing, 'the click walk carried on under the key');
      eq(heard.filter((n) => n === 'walk:keys').length, 1, 'walk:keys');
      eq(heard.filter((n) => n === 'walk:arrived').length, 0, 'arrivals when the key took over');
      // Steered, then let go: the stop is an arrival (the first evening reads it).
      for (let i = 0; i < 30; i++) { walk.steer(1, 0, false); walk.update(DT); flushDeferred(); }
      for (let i = 0; i < 30; i++) { walk.steer(0, 0, false); walk.update(DT); flushDeferred(); }
      eq(heard.filter((n) => n === 'walk:arrived').length, 1, 'arrivals after a steered walk stops');
      return `${heard.join(', ')}`;
    } finally { offs.forEach((off) => off()); walk.dispose(); }
  });

  test(G, 'solid things: steering stops at a workbench and slides along a wall, and a click walk goes round them', async () => {
    const { R, grid } = await world(() => 1);
    const solids = createSolids(R.solids.bodyM);
    // A workbench turned a little, and a long wall.
    solids.set([{ x: 10, z: 10, hw: 0.5, hd: 0.33, yaw: 0.3, id: 'bench' }, { x: 25, z: 10, hw: 0.15, hd: 5, yaw: 0, id: 'wall' }]);
    solids.mark(grid);
    const w = createWalker(R, { grid, depth: () => 0, ground: () => 1, solids });
    w.place(10, 13, Math.PI);
    steerFor(w, 0, -1, 3);
    assert(!solids.hit(w.x, w.z), `walked into the workbench, to ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);
    assert(w.z > 10.2, `stood at z ${w.z.toFixed(2)}, inside the bench`);
    const stoppedZ = w.z;
    // Slanting into the wall: you slide along it.
    w.place(22, 8, Math.PI / 4);
    steerFor(w, Math.SQRT1_2, Math.SQRT1_2, 2);
    assert(w.x < 24.85 && w.z > 9.5, `slid only to ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);
    // A click across the bench: a way round it, every leg clear of it, ending at its edge for a card.
    w.place(10, 13, Math.PI);
    w.steer(0, 0);
    const r = w.walkTo(10, 7);
    assert(r.ok, 'no way round the bench');
    const legs = r.ok ? r.points.length : 0;
    for (let i = 0; i < 600 && w.moving; i++) { w.update(DT); assert(!solids.hit(w.x, w.z) || i === 0, `walked through the bench at ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`); }
    assert(Math.hypot(w.x - 10, w.z - 7) < 0.3, `ended at ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);
    const edge = w.walkTo(10, 10);
    assert(edge.ok, 'a click on the bench found nowhere to stand');
    const g = edge.ok ? edge.goal : [0, 0];
    assert(!solids.hit(g[0], g[1]) && Math.hypot(g[0] - 10, g[1] - 10) < 1.5, `a click on the bench ends at ${g[0].toFixed(2)}, ${g[1].toFixed(2)}`);
    return `the bench stopped you at z ${stoppedZ.toFixed(2)}; ${legs} legs round it`;
  });

  test(G, 'the camp\'s slots become solids once something stands there; logs and stones are solids, the carried one is not', () => {
    const slots = [
      { id: 'tent', kinds: ['tent'], w: 2.2, d: 1.6, blocks: true }, { id: 'ring', kinds: ['ring'], r: 0.5, blocks: true },
      { id: 'workbench', kinds: ['workbench'], w: 1, d: 0.66, faces: 'ring', blocks: true }, { id: 'sticks', kinds: ['pile'], r: 0.6, blocks: true },
      { id: 'heap1', kinds: ['pile'], r: 0.35, blocks: true }, { id: 'hearth', kinds: ['hearth'], r: 0.3 },
    ];
    const at = (/** @type {string} */ id) => ({ x: slots.findIndex((s) => s.id === id) * 3, z: 0, yaw: 0 });
    const empty = campSolids({ kit: {}, slots: [] }, slots, at, at, new Set(), 90).map((s) => s.id);
    eq(empty.join(), 'sticks', 'a new camp: only the wood store\'s stakes');
    const built = campSolids({ kit: { tent: 'pitched' }, slots: [{ slot: 'tent', kind: 'tent' }, { slot: 'ring', kind: 'ring' }, { slot: 'workbench', kind: 'workbench' }, { slot: 'hearth', kind: 'hearth' }] },
      slots, at, at, new Set(['heap1']), 90);
    eq(built.map((s) => s.id).sort().join(), 'heap1,ring,sticks,tent,workbench', 'built, pitched, laid and piled; the hearth stays open');
    const tent = /** @type {any} */ (built.find((s) => s.id === 'tent'));
    assert(tent.hd === 1.1 && tent.hw === 0.8, 'the tent\'s length runs seaward');
    const ps = pieceSolids([{ id: 'a', kind: 'stone', x: 1, z: 1, size: 0.4 }, { id: 'b', kind: 'log', x: 2, z: 2, yaw: 0, size: 0.2, length: 1.4 },
      { id: 'c', kind: 'log', x: 3, z: 3, size: 0.2, length: 1 }, { id: 'd', kind: 'stepping', x: 4, z: 4 }, { id: 'e', kind: 'hole', x: 5, z: 5 }], 'c', []);
    eq(ps.map((s) => s.id).join(), 'a,b', 'a stone and a log; not the carried log, a pond stone or a hole');
  });

  test(G, 'creeping never startles: the creep is under every creature\'s calm pace', async () => {
    const R = await (await fetch('../recipes/world/walker.json')).json();
    /** @type {[string, number][]} */ const calm = [];
    for (const sp of ['frog', 'lizard', 'turtle', 'damselfly', 'dragonfly', 'minnow']) {
      const P = (await (await fetch(`../recipes/species/${sp}.json`)).json()).presence;
      if (P?.calmSpeed !== undefined) calm.push([sp, P.calmSpeed]);
    }
    for (const [sp, v] of calm) assert(R.pace.creepMps < v, `the creep ${R.pace.creepMps} m/s startles a ${sp} (calm under ${v})`);
    return calm.map(([sp, v]) => `${sp} ${v}`).join(', ');
  });

  test(G, 'the roll on the rig: tucked in the middle, one full turn, upright at both ends', async () => {
    const R = await (await fetch('../recipes/world/figure.json')).json();
    const a = rollPose(R.roll, 0), mid = rollPose(R.roll, 0.5), end = rollPose(R.roll, 1), none = rollPose(R.roll, -1);
    eq(a.angle, 0, 'turned at the start');
    eq(none.tuck, 0, 'tucked when not rolling');
    eq(mid.tuck, 1, 'tuck in the middle');
    assert(mid.angle > 0.5 && mid.angle < 2 * Math.PI - 0.5, `half way it has turned ${mid.angle.toFixed(2)}`);
    assert(Math.abs(end.angle - 2 * Math.PI) < 1e-9 && end.tuck === 0, `at the end: turned ${end.angle.toFixed(2)}, tuck ${end.tuck}`);
  });
}
