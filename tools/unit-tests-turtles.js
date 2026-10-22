// @ts-check
// Turtle life (M2, TL1 to TL6), for tools/unit-tests.html: the turtle's rig and pose
// (src/world/creatures/rigs/turtle.js), its shell plates for the creature shader, and its live
// behaviour (src/world/creatures/bask.js) in a round test pond: swimming and diving, hauling out
// onto a raft, slipping off one by one when startled, hiding, peeking and coming back.

import { poseState, poseTurtle, haulPath, slidePath, LAYERS } from '../src/world/creatures/rigs/turtle.js';
import { createBask } from '../src/world/creatures/bask.js';
import { poseSkeleton, axisAngle } from '../src/world/creatures/pose.js';
import { skeletonOf, MAX_BONES } from '../src/world/creatures/bodies.js';
import { shellBlock } from '../src/render/passes/creatures.js';

const G = 'turtle life';

/** A round pond 5 m across the middle, 0.8 m deep, shelving to its rim; a raft at (2, 0). */
function pond(/** @type {any[]} */ seats) {
  const water = (/** @type {number} */ x, /** @type {number} */ z) => {
    const r = Math.hypot(x, z);
    return { surface: 1, depth: r < 5 ? 0.8 * Math.min(1, (5 - r) / 1.5) : 0 };
  };
  /** @type {{ x: number, z: number }[]} */ const rings = [];
  const env = { water, ground: (/** @type {number} */ x, /** @type {number} */ z) => 1 - water(x, z).depth, seats: () => seats,
    ring: (/** @type {number} */ x, /** @type {number} */ z) => rings.push({ x, z }), viewer: () => [0, 3, 6],
    food: () => [{ x: -1, z: 1, sp: 'lilies' }, { x: 1, z: -2, sp: 'pondweed' }] };
  return { env, rings };
}
const RAFT = { x: 2, y: 1.03, z: 0, r: 0.4, kind: 'raft', room: 3, yaw: 0.5, inWater: true };

/** @param {any} R @param {any[]} seats @param {number} seed */
const turtles = (R, seats, seed) => {
  const p = pond(seats);
  const b = createBask({ id: 1, seed, count: 4, home: { x: 0, z: 0 }, deep: { x: 0, z: 0 }, size: R.body.displayScale, M: R.motion, env: p.env, bones: R.body.bones });
  return { b, rings: p.rings };
};
/** Step a bask for s seconds at its 20 Hz. @param {any} b @param {number} s @param {(t: number) => void} [each] */
function run(b, s, each) { for (let i = 0; i < s * 20; i++) { b.step(1 / 20); each?.(i / 20); } }

/** @type {import('./unit-tests-parallel.js').AddTests} */
export function addTurtleTests(test, assert, eq) {
  const recipe = () => fetch('../recipes/species/turtle.json').then((x) => x.json());

  test(G, 'the turtle has 15 bones, its shell on the root and stiff', async () => {
    const R = await recipe();
    const bones = skeletonOf('turtle', R.body.prims, R.body.bones);
    eq(bones.length, 15, 'bones');
    assert(bones.length <= MAX_BONES, 'fits the draw pass');
    for (const n of ['body', 'neck', 'head', 'jaw', 'eye.l', 'eye.r', 'arm.l', 'hand.l', 'leg.r', 'foot.r', 'tail']) assert(bones.some((b) => b.name === n), n);
    const shell = R.body.prims.find((/** @type {any} */ q) => q.scutes);
    assert(shell && shell.bone === 'body' && shell.stiff, 'the shell rides the root, stiff');
  });

  test(G, 'every way of holding itself poses to finite bones; all still is the body as baked', async () => {
    const R = await recipe();
    const rig = skeletonOf('turtle', R.body.prims, R.body.bones);
    const out = new Float32Array(MAX_BONES * 16);
    for (const L of LAYERS) {
      const f = poseState(3, 'swim');
      for (const k of LAYERS) f.w[k] = k === L ? 1 : 0;
      f.t = 7.3; f.ph = 0.41; f.haulK = 0.55; f.slideK = 0.3; f.look = 0.4; f.lookUp = 0.2;
      poseSkeleton(rig, poseTurtle(rig, f, R.motion, [0, 0, 0, 1], axisAngle), out, 0);
      assert([...out.subarray(0, rig.length * 16)].every(Number.isFinite), `${L} finite`);
    }
    // No layer, no look, past any blink: every bone still.
    const f = poseState(3, 'swim');
    for (const k of LAYERS) f.w[k] = 0;
    f.t = 0.5; f.id = 0;
    const R2 = { ...R.motion, pose: { ...R.motion.pose, blink: { everyS: [1000, 1000], s: 0.1 }, yawn: { ...R.motion.pose.yawn, everyS: [1000, 1000] } } };
    poseSkeleton(rig, poseTurtle(rig, f, R2, [0, 0, 0, 1], axisAngle), out, 0);
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let b = 0; b < rig.length; b++) for (let k = 0; k < 16; k++) assert(Math.abs(out[b * 16 + k] - I[k]) < 1e-6, `bone ${rig[b].name} still`);
  });

  test(G, 'the haul-out goes from the water to the spot and ends level; the slide ends in the water', async () => {
    const R = await recipe();
    const P = R.motion.pose;
    const a = haulPath(0, P), z = haulPath(1, P);
    eq(a.h, 0, 'starts at the water'); eq(z.h, 1, 'ends on the spot'); eq(z.v, 1, 'up'); eq(z.pitch, 0, 'level');
    let last = -1, tipped = 0;
    for (let k = 0; k <= 1; k += 0.01) { const p = haulPath(k, P); assert(p.h >= last - 1e-9, 'never back'); last = p.h; tipped = Math.max(tipped, p.pitch); }
    assert(tipped > 0.3, 'the shell tips up');
    const s = slidePath(1, P);
    assert(s.h === 1 && s.v === 1, 'slid in');
  });

  test(G, 'the shell plates reach the creature shader for the turtle only', async () => {
    const R = await recipe();
    const frog = await fetch('../recipes/species/frog.json').then((x) => x.json());
    const t = shellBlock(R.body), f = shellBlock(frog.body);
    eq(t.length, 52, 'block size');
    eq(t[0], 1, 'turtle: plates on');
    assert(t[48] > 0 && t[50] > 0, 'turtle: dries');
    assert(f.every((x) => x === 0), 'frog: nothing');
  });

  test(G, 'swimming: strokes, glides, dives and the periscope, the same every time from a seed', async () => {
    const R = await recipe();
    const a = turtles(R, [], 42), b = turtles(R, [], 42);
    /** @type {Record<string, number>} */ const modes = {};
    let glides = 0;
    run(a.b, 400, () => { for (const f of a.b.fish) { modes[f.mode] = (modes[f.mode] ?? 0) + 1; if (f.gliding) glides++; } });
    run(b.b, 400);
    for (const m of ['swim', 'under', 'peri']) assert(modes[m] > 0, `${m} seen`);
    assert(glides > 0, 'glides');
    a.b.fish.forEach((f, i) => assert(f.x === b.b.fish[i].x && f.z === b.b.fish[i].z && f.y === b.b.fish[i].y, 'same path from the same seed'));
    for (const f of a.b.fish) assert(Math.hypot(f.x, f.z) < 5, 'stays in the pond');
  });

  test(G, 'on the raft: three haul out and bask side by side, drying; the fourth swims', async () => {
    const R = await recipe();
    const { b } = turtles(R, [RAFT], 11);
    run(b, 120);
    const on = b.fish.filter((f) => f.mode === 'bask');
    eq(on.length, 3, 'three basking');
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      assert(Math.hypot(on[i].x - on[j].x, on[i].z - on[j].z) >= R.motion.sideM * 0.9, 'side by side, not on top');
    }
    assert(on.every((f) => f.wet < 1), 'drying in the sun');
  });

  test(G, 'startled: they slip off one by one with a plop each, hide, peek, then come back', async () => {
    const R = await recipe();
    const { b, rings } = turtles(R, [RAFT], 11);
    run(b, 120);
    b.startle();
    /** @type {number[]} */ const slid = [];
    let peeked = 0, hid = 0;
    run(b, 60, (s) => {
      b.fish.forEach((f, i) => { if (f.mode === 'slide' && slid[i] === undefined) slid[i] = s; if (f.mode === 'peek') peeked |= 1 << i; if (f.mode === 'hide') hid |= 1 << i; });
    });
    const times = slid.filter((x) => x !== undefined).sort((x, y) => x - y);
    eq(times.length, 3, 'three slipped off');
    for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] >= R.motion.startle.gapS[0] - 1e-6, 'one by one');
    eq(rings.length, 3, 'a plop each');
    assert(hid !== 0 && peeked !== 0, 'hid, then peeked');
    run(b, 90);
    assert(b.fish.filter((f) => f.mode === 'bask' || f.mode === 'shuffle').length >= 2, 'back on the raft');
  });

  test(G, 'habits: grazing lily leaves and pondweed, and walking the bottom', async () => {
    const R = await recipe();
    const { b } = turtles(R, [], 3);
    /** @type {Record<string, number>} */ const modes = {};
    run(b, 400, () => { for (const f of b.fish) modes[f.mode] = (modes[f.mode] ?? 0) + 1; });
    assert(modes.graze > 0, 'grazes');
    assert(modes.bottom > 0, 'walks the bottom');
  });
}
