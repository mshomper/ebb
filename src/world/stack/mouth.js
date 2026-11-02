// @ts-check
// The mouth room, live (docs/future/19 'The mouth room'; F16's mouth): a zone (src/world/zones) in
// the stack's foot, entered from the cave mouth's card at the back of the cleft once the causeway
// stands; the way out (or Go up) brings you back to the cleft. Drawn by a second cave pass with the
// spring cave's light (the cleft's open top as its hole). In it: the old lantern lying cold on its
// side (Light it with the fire steel, then Hang it on the hook by the arch: from then on its warm
// light fills the room), the lamplighter's first note (a keeper page), the arch ringed with soot
// (seeing it adds the driftwood staff to the workbench's makes; it stays closed until the Hollow),
// and the rubble choking the bear's passage (a stretch a game day with the shovel). Kept in the
// stack's save section (lantern, rubble). Numbers and words: recipes/world/stack-mouth.json.

import { get, update } from '../../core/store.js';
import { emitDeferred, on } from '../../core/events.js';
import { hash32 } from '../../core/rng.js';
import { run, poolSize } from '../../core/workers.js';
import { dispatch, onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { cleanCook } from '../camp/making.js';
import { kelvinRgb, flicker } from '../camp/light.js';
import { lathe, tube, lumpStone, join } from '../spring/cave-live.js';
import { mouthShape, mouthGrid, lampSight } from './mouth-field.js';
import { cleanStack } from './model.js';

const ID = 'stack-mouth';
const PAGE = 'lamplighter-1';

/**
 * @param {{ R: any, stack: import('./index.js').Stack, walk: any, zones: any, pass: ReturnType<typeof import('../../render/passes/cave.js').createCavePass>,
 *   day: () => number, stretches: number }} o
 *   R: recipes/world/stack-mouth.json; day: the game day; stretches: the rubble's length (setpieces/stack.json rubble)
 */
export function createStackMouth(o) {
  const R = o.R, S = R.shape, T = R.things, W = R.words, L = o.stack.layout;
  const shape = mouthShape(S, R.seed);
  // The rock pool's water stands just under the lowest point of its basin's rim, so it lies in the
  // rock and never over the floor round it (the floor's bumps dip below a fixed level).
  {
    const P = S.pool;
    let rim = Infinity;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      for (const f of [0.95, 1.05, 1.15, 1.3, 1.5]) rim = Math.min(rim, shape.floorAt(P.at[0] + Math.cos(a) * P.radiusM * f, P.at[1] + Math.sin(a) * P.radiusM * f));
    }
    S.pool = { ...P, levelM: Math.min(P.levelM, rim - R.poolBelowRimM) };
    Object.assign(shape, mouthShape(S, R.seed));
  }
  // The frame: x into the stack from the cleft's back, z across; y up from the apron.
  const O = { x: L.mouth[0], y: L.apronM, z: L.mouth[1], top: L.apronM + R.depthM };
  const ux = L.ux, uz = L.uz, vx = L.vx, vz = L.vz;
  /** @param {number} a @param {number} b @returns {[number, number]} */
  const world = (a, b) => [O.x + a * ux + b * vx, O.z + a * uz + b * vz];
  /** @param {number} x @param {number} z */
  const local = (x, z) => { const dx = x - O.x, dz = z - O.z; return [dx * ux + dz * uz, dx * vx + dz * vz]; };
  const saved = () => cleanStack(get('stack'));
  /** @param {Partial<import('./model.js').StackSave>} p */
  const save = (p) => update('stack', (s) => ({ ...(s ?? {}), ...cleanStack(s), ...p }));
  const flags = () => get('journal')?.flags ?? [];
  /** @param {string} f */
  const flag = (f) => { if (get('journal') && !flags().includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };
  const notice = (/** @type {string} */ text) => emitDeferred('island:notice', { text, showS: 6 });

  // Where the hook is: on the wall beside the arch's opening, toward the way in, at the hook's height.
  // Found in the rock itself (the field, in 3D), so its arm goes into stone: wall, where it meets the
  // rock; tip, armM back out into the room, where the lantern hangs (x, z in the mouth frame).
  const hookAt = (() => {
    const A = S.arch, x = A.at[0] - A.halfWidthM - T.hook.fromArchM, y = T.hook.heightM;
    let wall = A.at[1];
    for (let z = A.at[1] - 3; z < A.at[1] + 3; z += 0.01) if (shape.air(x, y, z) < 0) { wall = z; break; }
    return { x, z: wall - T.hook.armM, wall: wall + 0.04 };
  })();

  /** Where the lantern's flame is, lying on the floor or hanging on its hook (mouth frame [x, y, z]). */
  const flameAt = {
    floor: [T.lantern.at[0], shape.floorAt(T.lantern.at[0], T.lantern.at[1]) + T.lantern.radiusM, T.lantern.at[1]],
    hook: [hookAt.x, T.hook.heightM - 0.06 - T.lantern.heightM * 0.55, hookAt.z],
  };

  /**
   * The floor (world height), for the view to keep above: the room's own, never the climb it makes
   * into the walls and beyond them (a view behind you near a wall was pushed straight up).
   * @param {number} x @param {number} z
   */
  const floor = (x, z) => { const [a, b] = local(x, z); return O.y + Math.min(shape.floorAt(a, b), R.view.floorCapM); };
  /** Where you may walk: the floor, raised where the walls close in. @param {number} x @param {number} z */
  function ground(x, z) {
    const [a, b] = local(x, z), f = O.y + shape.floorAt(a, b);
    if (shape.inside(a, b) <= R.walk.wallM) return f + 3;
    // The rubble blocks its passage past what is dug.
    const P = S.rubble, s = (a - P.at[0]) * P.dir[0] + (b - P.at[1]) * P.dir[1];
    if (shape.passage(P, a, 0.3, b) > 0 && s > rubbleFront() - 0.4) return f + 3;
    return f;
  }
  /** @param {number} x @param {number} z */
  const water = (x, z) => { const [a, b] = local(x, z); return shape.inside(a, b) > 0 ? shape.poolDepth(a, b) : 0; };
  /** How far along its passage the rubble starts (m from its root). */
  const rubbleFront = () => -0.6 + (S.rubble.lengthM + 0.6) * Math.min(1, saved().rubble / Math.max(1, o.stretches));

  let built = false, building = false;
  /**
   * The rock's mesh and its baked lantern light, on every worker at once: the field sampled in
   * shares of its rows, meshed, then the bake in shares of the vertices (mouth-field.js).
   * @returns {Promise<{ pos: Float32Array, nrm: Float32Array, idx: Uint32Array, count: number, light: Float32Array }>}
   */
  async function buildRock() {
    const job = (/** @type {string} */ fn) => ({ module: './world/stack/mouth-field.js', fn });
    const lane = /** @type {const} */ ('interactive'), parts = Math.max(1, poolSize());
    const nz = mouthGrid(S, R.depthM)[2], rows = Math.ceil(nz / parts);
    const shares = await Promise.all(Array.from({ length: Math.ceil(nz / rows) }, (_, p) =>
      run(job('mouthFieldJob'), { S, seed: R.seed, top: R.depthM, k0: p * rows, k1: Math.min(nz, (p + 1) * rows) }, { lane })));
    const field = new Float32Array(shares.reduce((t, s) => t + s.field.length, 0));
    let at = 0;
    for (const s of shares) { field.set(s.field, at); at += s.field.length; }
    const m = await run(job('mouthNetsJob'), { S, top: R.depthM, field }, { lane });
    const lamps = [flameAt.floor, flameAt.hook], per = Math.ceil(m.count / parts);
    const light = new Float32Array(m.count * 3);
    await Promise.all(Array.from({ length: Math.ceil(m.count / per) }, (_, p) => {
      const i0 = p * per, i1 = Math.min(m.count, i0 + per);
      return run(job('mouthBakeJob'), { S, seed: R.seed, pos: m.pos, nrm: m.nrm, i0, i1, lamps, bake: R.bake }, { lane })
        .then((/** @type {{ light: Float32Array }} */ r) => light.set(r.light, i0 * 3));
    }));
    return { ...m, light };
  }
  function build() {
    if (built || building) return;
    building = true;
    // The rock and its light baked for the lantern's two spots (its sight of each, and the occlusion),
    // carried in the vertex colour (cave-draw.wgsl: r the floor spot, g the hook, b occlusion).
    buildRock().then((m) => {
      const v = new Float32Array(m.count * 10), lit = m.light.length === m.count * 3;
      for (let i = 0; i < m.count; i++) {
        const a = m.pos[i * 3], y = m.pos[i * 3 + 1], b = m.pos[i * 3 + 2], na = m.nrm[i * 3], nb = m.nrm[i * 3 + 2];
        const c = lit ? [m.light[i * 3], m.light[i * 3 + 1], m.light[i * 3 + 2]] : [1, 1, 1];
        v.set([O.x + a * ux + b * vx, O.y + y, O.z + a * uz + b * vz, na * ux + nb * vx, m.nrm[i * 3 + 1], na * uz + nb * vz, c[0], c[1], c[2], 0], i * 10);
      }
      o.pass.setMesh('rock', { data: v, idx: m.idx });
      built = true; building = false;
    }).catch((err) => { building = false; console.error('ebb: the stack mouth did not build', err); });
    const p = S.pool, [px, pz] = world(p.at[0], p.at[1]), wl = O.y + p.levelM, n = 32, wd = [px, wl, pz, 0, 1, 0, 0, 0, 0, 0], wi = [];
    for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2; wd.push(px + Math.cos(t) * p.radiusM * 1.1, wl, pz + Math.sin(t) * p.radiusM * 1.1, 0, 1, 0, 0, 0, 0, 0); }
    for (let i = 1; i <= n; i++) wi.push(0, i, i + 1);
    o.pass.setMesh('water', { data: new Float32Array(wd), idx: new Uint32Array(wi) });
    const r0 = R.light.holeRadiusM, r1 = r0 * R.light.beam.spread, foot = O.y + 0.05;
    const beam = tube([[O.x, O.top, O.z], [O.x, (O.top + foot) / 2, O.z], [O.x, foot, O.z]], /** @type {any} */ ([r0, (r0 + r1) / 2, r1]), 28, [0, 0, 0], 0);
    o.pass.setMesh('beam', { data: new Float32Array(beam.data), idx: new Uint32Array(beam.idx) });
  }

  let thingsKey = '';
  /** @type {{ dug: number, m: { data: number[], idx: number[] } } | null} */ let rubbleKept = null;
  /** @type {{ data: number[], idx: number[] } | null} */ let poolKept = null;
  /** Carrying the lit lantern to its hook (Hang it): live only, never saved. @type {{ t: number } | null} */ let carry = null;
  /** Where your right hand holds it, in the mouth frame [x, y, z], or null when not carrying. @returns {number[] | null} */
  function carryAt() {
    const h = carry ? o.walk.hand?.('r') : null;
    if (!h) return null;
    const [a, b] = local(h.x, h.z);
    return [a, h.y - O.y, b];
  }
  /** Move a mesh made in the mouth frame (x in, y up, z across) into the world. @param {{ data: number[], idx: number[] }} m */
  function place(m) {
    for (let i = 0; i < m.data.length; i += 10) {
      const a = m.data[i], b = m.data[i + 2], na = m.data[i + 3], nb = m.data[i + 5];
      m.data[i] = O.x + a * ux + b * vx; m.data[i + 1] += O.y; m.data[i + 2] = O.z + a * uz + b * vz;
      m.data[i + 3] = na * ux + nb * vx; m.data[i + 5] = na * uz + nb * vz;
    }
    return m;
  }
  /** The old lantern: an iron cylinder with a cap and a ring, horn panes between, its foot at the origin. */
  function lanternMesh() {
    const K = R.look, r = T.lantern.radiusM, h = T.lantern.heightM;
    const m = lathe([[0, 0], [r, 0], [r, h * 0.08], [r * 0.92, h * 0.1], [r * 0.92, h * 0.7], [r, h * 0.72], [r * 1.05, h * 0.78], [r * 0.6, h * 0.92], [r * 0.25, h], [0, h]],
      12, K.lantern, [null, K.lanternRim, null, K.glass, K.glass, null, K.lanternRim, null, null, null]);
    // Its horn panes glow while it burns (alpha 2: cave-draw.wgsl draws them by the flame's light, the warm tint at lamp nits).
    if (saved().lantern !== 'floor') {
      const g = K.glowTint;
      for (let i = 0; i < m.data.length; i += 10) {
        if (m.data[i + 6] === K.glass[0] && m.data[i + 7] === K.glass[1] && m.data[i + 8] === K.glass[2]) { m.data[i + 6] = g[0]; m.data[i + 7] = g[1]; m.data[i + 8] = g[2]; m.data[i + 9] = 2; }
      }
    }
    return m;
  }
  /** The made things: the lantern (lying, lit or hung), the note, the hook, the soot ring and the rubble. */
  function things() {
    const s = saved(), held = carryAt();
    const key = `${s.lantern}:${s.rubble}:${held ? held.map((v) => v.toFixed(2)).join(',') : ''}`;
    if (key === thingsKey) return;
    thingsKey = key;
    const K = R.look, parts = [];
    // The lantern: on its side on the floor, in your hand by its bail as you carry it, or on the hook.
    const lan = lanternMesh();
    if (held) {
      const y0 = held[1] - T.lantern.heightM - 0.03;
      for (let i = 0; i < lan.data.length; i += 10) { lan.data[i] += held[0]; lan.data[i + 1] += y0; lan.data[i + 2] += held[2]; }
      parts.push(place(tube([[held[0], held[1] + 0.01, held[2]], [held[0], held[1] - 0.035, held[2]]], 0.006, 4, K.iron)));
    } else if (s.lantern === 'hung') {
      const y0 = T.hook.heightM - T.lantern.heightM - 0.06;
      for (let i = 0; i < lan.data.length; i += 10) { lan.data[i] += hookAt.x; lan.data[i + 1] += y0; lan.data[i + 2] += hookAt.z; }
    } else {
      // On its side: its axis turned to lie along x, resting on the floor.
      const [ax, az] = T.lantern.at, y0 = shape.floorAt(ax, az) + T.lantern.radiusM, h = T.lantern.heightM;
      for (let i = 0; i < lan.data.length; i += 10) {
        const x = lan.data[i], y = lan.data[i + 1], nx = lan.data[i + 3], ny = lan.data[i + 4];
        lan.data[i] = ax + y - h / 2; lan.data[i + 1] = y0 - x; lan.data[i + 2] += az;
        lan.data[i + 3] = ny; lan.data[i + 4] = -nx;
      }
    }
    parts.push(place(lan));
    // The hook: an iron arm out of the wall, bent up at its end.
    const hy = T.hook.heightM;
    // From inside the rock out to its tip, bent up there; and a short iron plate where it is driven in.
    parts.push(place(tube([[hookAt.x, hy - 0.02, hookAt.wall], [hookAt.x, hy, hookAt.z + 0.02], [hookAt.x, hy + 0.05, hookAt.z]], 0.014, 6, K.iron)));
    parts.push(place(tube([[hookAt.x, hy - 0.09, hookAt.wall - 0.05], [hookAt.x, hy + 0.07, hookAt.wall - 0.05]], 0.03, 6, K.iron)));
    // The ring of the lantern's bail over the hook's tip, when it hangs.
    if (s.lantern === 'hung') parts.push(place(tube([[hookAt.x, hy + 0.04, hookAt.z], [hookAt.x, hy - 0.065, hookAt.z]], 0.006, 4, K.iron)));
    // The note: a folded sheet with a small stone on it.
    const [nx0, nz0] = T.note.at, [nw, nd] = T.note.sizeM, ny0 = shape.floorAt(nx0, nz0) + 0.012;
    parts.push(place({ data: [nx0 - nw / 2, ny0, nz0 - nd / 2, 0, 1, 0, ...K.note, 1, nx0 + nw / 2, ny0, nz0 - nd / 2, 0, 1, 0, ...K.note, 1,
      nx0 + nw / 2, ny0 + 0.006, nz0 + nd / 2, 0, 1, 0, ...K.note, 1, nx0 - nw / 2, ny0 + 0.006, nz0 + nd / 2, 0, 1, 0, ...K.note, 1], idx: [0, 2, 1, 0, 3, 2] }));
    parts.push(place(lumpStone(nx0 + 0.02, ny0, nz0, 0.035, (k) => ((hash32(17, k) >>> 8) / 16777216), 0.2, K.stone)));
    // The rubble and the pool's stones change only when a stretch is dug: kept, not stacked again each frame.
    if (!rubbleKept || rubbleKept.dug !== s.rubble) rubbleKept = { dug: s.rubble, m: place(rubbleMesh(s.rubble)) };
    if (!poolKept) poolKept = place(poolStones());
    parts.push(rubbleKept.m, poolKept);
    o.pass.setMesh('things', join(parts));
  }
  /** Pebbles and a few cobbles on the rock pool's bed and round its lip (seeded). */
  function poolStones() {
    const P = S.pool, u = (/** @type {number} */ i, /** @type {number} */ k) => (hash32(R.seed, 4411, i, k) >>> 8) / 16777216, parts = [];
    for (let i = 0; i < 26; i++) {
      const a = u(i, 1) * Math.PI * 2, r = Math.sqrt(u(i, 2)) * P.radiusM * 1.15, x = P.at[0] + Math.cos(a) * r, z = P.at[1] + Math.sin(a) * r;
      const size = 0.05 + 0.14 * u(i, 3) ** 2, r0 = size / 2;
      // Bedded in the floor (Matt, November 2, 2026: they floated): set on the lowest ground under
      // it, not its middle's (the flagstones tilt and the basin slopes), and sunk part way in; drawn
      // as the room's rock, lit and shadowed by the lantern like the rubble.
      let low = shape.floorAt(x, z);
      for (let k = 0; k < 6; k++) low = Math.min(low, shape.floorAt(x + Math.cos(k * 1.047) * r0, z + Math.sin(k * 1.047) * r0));
      const cy = low + r0 * 0.6;
      const sf = lampSight(shape, x, cy, z, flameAt.floor, R.bake), sh = lampSight(shape, x, cy, z, flameAt.hook, R.bake);
      parts.push(brokenStone(x, low - r0 * 0.5, z, r0, (k) => u(i, k + 4), sf, sh, 0.7));
    }
    const all = join(parts);
    return { data: Array.from(all.data), idx: Array.from(all.idx) };
  }
  /**
   * One fallen stone (decision 0001): broken rather than rounded, a low many-sided lump with each
   * corner pushed in or out on its own, flat-faced, sitting on its base; drawn as the room's rock
   * (vertex colour: its sight of the lantern's two spots and its occlusion, alpha 0), so it takes the
   * lantern's shadow and the rock scan and never the made things' outline.
   * @param {number} x @param {number} y0 @param {number} z @param {number} r @param {(k: number) => number} u seeded 0..1
   * @param {number} sightFloor @param {number} sightHook @param {number} occ
   */
  function brokenStone(x, y0, z, r, u, sightFloor, sightHook, occ) {
    const B = T.rubble, LAT = 3, LON = 6, pts = [];
    for (let a = 0; a <= LAT; a++) for (let b = 0; b < LON; b++) {
      const th = (a / LAT) * Math.PI, ph = (b / LON) * Math.PI * 2 + u(1) * 6;
      const k = 1 + B.lump * (u(10 + a * LON + b) - 0.5) * 2;
      // The bottom flattened where it rests; the long axis turned by the seed.
      const sx = Math.sin(th) * Math.cos(ph) * k, sy = Math.max(-0.35, Math.cos(th)) * B.flat * k, sz = Math.sin(th) * Math.sin(ph) * k * (0.75 + u(2) * 0.5);
      const ca = Math.cos(u(3) * 6.28), sa = Math.sin(u(3) * 6.28);
      pts.push([x + (sx * ca - sz * sa) * r, y0 + r * 0.4 + sy * r, z + (sx * sa + sz * ca) * r]);
    }
    /** @type {number[]} */ const data = [], idx = [];
    const tri = (/** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number[]} */ s) => {
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      // Facing out from the stone's middle.
      const mx = (p[0] + q[0] + s[0]) / 3 - x, my = (p[1] + q[1] + s[1]) / 3 - (y0 + r * 0.4), mz = (p[2] + q[2] + s[2]) / 3 - z;
      if (nx * mx + ny * my + nz * mz < 0) { nx = -nx; ny = -ny; nz = -nz; [q, s] = [s, q]; }
      const o = (B.occFloor + (1 - B.occFloor) * occ) * (0.7 + 0.3 * Math.max(0, ny));
      const base = data.length / 10;
      for (const v of [p, q, s]) data.push(v[0], v[1], v[2], nx, ny, nz, sightFloor, sightHook, o, 0);
      idx.push(base, base + 1, base + 2);
    };
    const at = (/** @type {number} */ a, /** @type {number} */ b) => pts[a * LON + (b % LON)];
    for (let a = 0; a < LAT; a++) for (let b = 0; b < LON; b++) {
      if (a > 0) tri(at(a, b), at(a + 1, b), at(a, b + 1));
      if (a < LAT - 1) tri(at(a, b + 1), at(a + 1, b), at(a + 1, b + 1));
    }
    return { data, idx };
  }

  /** The rubble's stones, heaped in its passage past what is dug. @param {number} dug */
  function rubbleMesh(dug) {
    const P = S.rubble, B = T.rubble, front = -0.6 + (P.lengthM + 0.6) * Math.min(1, dug / Math.max(1, o.stretches));
    const u = (/** @type {number} */ i, /** @type {number} */ k) => (hash32(B.seed, i, k) >>> 8) / 16777216;
    const parts = [];
    // Stacked from the floor up, deepest first: each stone rests on the floor or on the stones under
    // it, never in the air; the heap slopes down toward the dug face and stays under the roof.
    const cand = Array.from({ length: B.stones }, (_, i) => ({ i, s: -0.4 + u(i, 1) * (P.lengthM + 0.4), r: (B.sizeM[0] + (B.sizeM[1] - B.sizeM[0]) * u(i, 4) ** 1.5) / 2 }))
      .filter((c) => c.s >= front).sort((a, b) => b.s - a.s || a.i - b.i);
    /** @type {{ x: number, z: number, r: number, top: number }[]} */ const laid = [];
    for (const c of cand) {
      const t = (u(c.i, 2) - 0.5) * 2 * Math.max(0, P.halfWidthM - c.r * 0.7);
      const x = P.at[0] + P.dir[0] * c.s - P.dir[1] * t, z = P.at[1] + P.dir[1] * c.s + P.dir[0] * t;
      let base = shape.floorAt(x, z) - c.r * 0.15;
      for (const q of laid) if (Math.hypot(q.x - x, q.z - z) < (q.r + c.r) * 0.8) base = Math.max(base, q.top - c.r * 0.45);
      const roof = P.heightM * Math.sqrt(Math.max(0, 1 - (t / P.halfWidthM) ** 2)) - 0.08;
      const top = base + c.r * 1.3;
      if (top > Math.min(roof, 0.4 + (c.s - front) * 1.15)) continue;
      laid.push({ x, z, r: c.r, top });
      // Its light from where it lies: its sight of the lantern's spots from just above it, and how
      // deep in the heap it sits (deeper is darker).
      const cy = base + c.r * 0.9, fl = shape.floorAt(x, z);
      const sf = lampSight(shape, x, cy, z, flameAt.floor, R.bake), sh = lampSight(shape, x, cy, z, flameAt.hook, R.bake);
      const occ = Math.min(1, Math.max(0, (base - fl) / Math.max(0.3, T.rubble.heapM)));
      parts.push(brokenStone(x, base, z, c.r, (k) => u(c.i, k + 5), sf, sh, occ));
    }
    const all = join(parts);
    return { data: Array.from(all.data), idx: Array.from(all.idx) };
  }

  const enter = () => {
    build();
    things();
    // You come in facing the arch and the lantern's hook (the room's story), the view low behind you.
    const [ax, az] = world(R.view.arriveM, 0), [lx, lz] = world(R.view.lookAt[0], R.view.lookAt[1]), yaw = Math.atan2(lx - ax, lz - az);
    const xs = [S.boundsM[0], S.boundsM[3]], zs = [S.boundsM[2], S.boundsM[5]], pts = xs.flatMap((a) => zs.map((b) => world(a, b)));
    const bounds = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const ok = o.walk.enterZone({ id: ID, ground, water, bounds, cellM: R.walk.cellM,
      at: { x: ax, z: az, yaw, viewYaw: yaw + Math.PI + (R.view.arriveTurnDeg * Math.PI) / 180 }, camera: R.view.camera });
    if (!ok) return false;
    flag('setpiece:stack:crossed');
    notice(W.below);
    return true;
  };
  const leave = () => { carry = null; thingsKey = ''; o.walk.leaveZone(null); notice(W.up); };

  // ---- the things you do ----

  /** @type {string | null} */ let acting = null;
  function lightLantern() {
    if (o.walk.zone !== ID || saved().lantern !== 'floor' || o.walk.busy()) return;
    update('identify', () => null);
    if (o.walk.act('strike')) acting = 'light'; else lit();
  }
  function lit() { save({ lantern: 'lit' }); notice(W.lit); }
  /** Hang it: you take the lantern up and carry it, lit, to the hook by the arch, and hang it there. */
  function hang() {
    if (o.walk.zone !== ID || saved().lantern !== 'lit' || carry) return;
    update('identify', () => null);
    const [sx, sz] = world(hookAt.x, hookAt.z - T.hook.standM);
    carry = { t: 0 };
    thingsKey = '';
    if (!o.walk.tap(0, 0, [sx, floor(sx, sz), sz], 0.1)) hangNow();
  }
  /** The lantern goes up on its hook (you face it, reach up). */
  function hangNow() {
    const [hx, hz] = world(hookAt.x, hookAt.z);
    o.walk.kneelToward?.(hx, hz, 0.6, 'setDown');
    carry = null;
    thingsKey = '';
    save({ lantern: 'hung' });
    flag('setpiece:stack:lamp');
    notice(W.hung);
  }
  function read() {
    update('identify', () => null);
    flag(`keeper:${PAGE}`);
    dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: true, tab: 'threads', page: `keeper:${PAGE}` }));
  }
  const hasShovel = () => cleanCook(get('cook')).tools.includes('shovel');
  function dig() {
    if (o.walk.zone !== ID || o.walk.busy()) return;
    const s = saved();
    update('identify', () => null);
    if (s.rubble >= o.stretches) { notice(W.rubbleEnd); return; }
    if (!hasShovel()) { notice(W.needShovel); return; }
    if (s.dugDay === o.day()) { notice(W.dugToday); return; }
    if (o.walk.act('dig')) acting = 'dig'; else dug();
  }
  function dug() {
    const s = saved();
    save({ rubble: s.rubble + 1, dugDay: o.day() });
    flag('setpiece:stack:rubble');
    notice(s.rubble + 1 >= o.stretches ? W.rubbleEnd : W.dug);
  }

  // ---- cards ----

  const base = { noPage: true, stage: -1, sub: null, canCarry: false };
  const at = (/** @type {number} */ a, /** @type {number} */ b) => { const [x, z] = world(a, b); return { wx: x, wz: z }; };
  function lanternCard() {
    const s = saved(), p = s.lantern === 'hung' ? at(hookAt.x, hookAt.z - 0.6) : at(T.lantern.at[0], T.lantern.at[1]);
    return { ...base, sp: 'stack:lantern', stackLantern: s.lantern, name: W.lanternName, icon: 'lamp', text: s.lantern === 'hung' ? W.lanternHung : s.lantern === 'lit' ? W.lanternLit : W.lanternCold, ...p, r: 0.3, reachR: 0.7 };
  }
  const noteCard = () => ({ ...base, sp: 'stack:note', stackNote: true, name: W.noteName, icon: 'note', text: W.note, ...at(T.note.at[0], T.note.at[1]), r: 0.25, reachR: 0.7 });
  const archCard = () => ({ ...base, sp: 'stack:arch', name: W.archName, icon: 'stack', text: flags().includes('setpiece:stack:arch') ? `${W.arch} ${W.archShut}` : W.arch,
    ...at(S.arch.at[0] - 0.9, S.arch.at[1] - 0.4), r: 0.5, reachR: 1.0 });
  function rubbleCard() {
    const s = saved(), f = rubbleFront();
    return { ...base, sp: 'stack:rubble', stackRubble: true, name: W.rubbleName, icon: 'dig', text: s.rubble >= o.stretches ? W.rubbleEnd : s.rubble > 0 ? W.rubbleDug : W.rubble,
      ...at(S.rubble.at[0] + S.rubble.dir[0] * (f - 0.6), S.rubble.at[1] + S.rubble.dir[1] * (f - 0.6)), r: 0.5, reachR: 0.9 };
  }
  const doorCard = () => ({ ...base, sp: 'stack:door', stackDoor: true, name: W.doorName, icon: 'cavemouth', text: W.door, ...at(0.3, 0), r: 0.4, reachR: 0.9 });

  /** The card at a point down here. @param {number} x @param {number} z */
  function cardAt(x, z) {
    if (o.walk.zone !== ID) return null;
    const [a, b] = local(x, z), s = saved();
    const lp = s.lantern === 'hung' ? [hookAt.x, hookAt.z] : T.lantern.at;
    if (Math.hypot(a - lp[0], b - lp[1]) < T.lantern.tapM + (s.lantern === 'hung' ? 0.3 : 0)) return lanternCard();
    if (Math.hypot(a - T.note.at[0], b - T.note.at[1]) < T.note.tapM) return noteCard();
    if (Math.hypot(a, b) < T.door.tapM) return doorCard();
    const A = S.arch, P = S.rubble;
    if (shape.passage(A, a, 0.3, b) > -0.3 && (a - A.at[0]) * A.dir[0] + (b - A.at[1]) * A.dir[1] > -0.4) return archCard();
    if (shape.passage(P, a, 0.3, b) > -0.3 && (a - P.at[0]) * P.dir[0] + (b - P.at[1]) * P.dir[1] > -0.4) return rubbleCard();
    return null;
  }
  /** Where a ray meets the floor (a click), or null. @param {number[]} ro @param {number[]} rd */
  function groundAt(ro, rd) {
    for (let t = 0.05; t < 14; t += 0.04) {
      const x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t, z = ro[2] + rd[2] * t, [a, b] = local(x, z);
      if (shape.inside(a, b) < -0.2) continue;
      const f = O.y + shape.floorAt(a, b);
      if (y <= f) return [x, f, z];
    }
    return null;
  }
  /** How far the view may sit back before the rock. @param {ArrayLike<number>} target @param {ArrayLike<number>} eye */
  function viewRoom(target, eye) {
    const dx = eye[0] - target[0], dy = eye[1] - target[1], dz = eye[2] - target[2], d = Math.hypot(dx, dy, dz) || 1;
    let room = 0.4;
    for (let t = 0.2; t <= 8; t += 0.1) {
      const x = target[0] + (dx / d) * t, y = target[1] + (dy / d) * t, z = target[2] + (dz / d) * t, [a, b] = local(x, z);
      if (shape.air(a, y - O.y, b) < -R.view.throughM) break;
      room = t;
    }
    return room;
  }

  // ---- light ----

  const lanternRgb = kelvinRgb(R.light.lantern.lightK);
  /** The middle of the arch's opening (world), where its soot gathers. */
  const sootAt = (() => { const A = S.arch, [x, z] = world(A.at[0], A.at[1]); return [x, O.y + A.heightM * 0.55, z]; })();
  /**
   * This frame's light (cave-draw.wgsl CaveUniforms, as the spring cave's), the cleft's top as the
   * hole; then the lantern once lit (Matt, November 1, 2026: the cave must look its best with it): a
   * flickering point light of cd candela at its flame, its sight of each spot baked into the rock,
   * its bounce off the walls (the light it puts out, 4 pi I, carried round by the rock's albedo over
   * the walls' area), the air round it glowing, its glints in wet stone, and its glass alight. The
   * walker is lit by whichever is brighter on it, the cleft or the lantern. @param {{ sunDir: ArrayLike<number>, sunIlluminance: ArrayLike<number>, cloud: number, time: number }} d
   */
  function light(d) {
    const Lt = R.light, K = R.look, sy = Math.max(0, d.sunDir[1]);
    const sky = Lt.skyShare * Math.min(1, sy * 4) * (1 - Lt.cloudCut * d.cloud);
    const eOut = [0, 1, 2].map((c) => d.sunIlluminance[c] * sky), eLevel = [0, 1, 2].map((c) => d.sunIlluminance[c] * (sy + sky));
    const shaftY = O.y + shape.ceilAt(0, 0) - 0.15;
    const area = Math.PI * Lt.holeRadiusM ** 2, walls = 2 * Math.PI * S.radiusM[0] * S.radiusM[1] + 2 * Math.PI * Math.sqrt(S.radiusM[0] * S.radiusM[1]) * S.ceilingM;
    const alb = (K.rock[0] + K.rock[1] + K.rock[2]) / 3, carryShare = alb / (1 - alb), sunIn = sy > 0.85 ? 1 : 0;
    const st = saved().lantern, on = st !== 'floor', LL = Lt.lantern;
    const fl = on ? flicker(d.time, LL.flicker, LL.flickerHz, 23) : 0, cd = lanternRgb.map((c) => c * LL.cd * fl);
    // The flame: on the floor, on its hook, or swinging under your hand as you carry it (then unbaked: no shadows of its own).
    const held = carryAt(), fp = held ? [held[0], held[1] - T.lantern.heightM * 0.5, held[2]] : st === 'hung' ? flameAt.hook : flameAt.floor;
    const [fx, fz] = world(fp[0], fp[2]), fy = O.y + fp[1];
    const bounce = [0, 1, 2].map((c) => ((eOut[c] * area + d.sunIlluminance[c] * area * sunIn) / walls) * carryShare * Lt.bounce / Math.PI + (eLevel[c] * Lt.fill) / Math.PI);
    const W2 = K.water, p = S.pool, [px, pz] = world(p.at[0], p.at[1]), wk = o.walk.walker;
    const uniforms = [
      O.x, O.top, O.z, Lt.holeRadiusM,
      O.x, shaftY, O.z, S.shaft.radiusM,
      ...eOut, Lt.bounce,
      d.sunDir[0], d.sunDir[1], d.sunDir[2], sunIn,
      d.sunIlluminance[0], d.sunIlluminance[1], d.sunIlluminance[2], Lt.minNits,
      ...bounce, d.time,
      ...K.rock, K.wetNearM,
      ...K.rockWet, K.roughness[1],
      ...K.floor, K.roughness[0],
      px, O.y + p.levelM, pz, p.radiusM,
      ...W2.absorption, W2.f0,
      ...W2.tint, W2.ripple,
      W2.drips, W2.dripS, Lt.beam.nits, Lt.beam.scatter,
      wk?.x ?? O.x, (wk?.y ?? O.y) + 0.9, wk?.z ?? O.z, R.view.fadeM,
      ...W2.glow, W2.glowNits,
      fx, fy, fz, on ? LL.glassNits * fl : 0,
      ...cd, built ? 1 : 0,
      held ? 2 : st === 'hung' ? 1 : 0, (4 * Math.PI * carryShare * LL.bounce) / walls / Math.PI, LL.scatter, LL.glint,
      ...sootAt, T.soot.radiusM,
      T.soot.darken, 0, 0, 0,
    ];
    const wx = wk?.x ?? O.x, wz = wk?.z ?? O.z, wy = (wk?.y ?? O.y) + 0.9;
    const dx = O.x - wx, dy = O.top - wy, dz = O.z - wz, dl = Math.hypot(dx, dy, dz) || 1;
    const k = (area * (dy / dl)) / (Math.PI * Math.max(dl * dl, 0.16)) * Lt.figure.share;
    const eHole = eOut.map((e) => e * k);
    // The lantern on the walker: I / d^2 from its flame.
    const lx = fx - wx, ly = fy - wy, lz = fz - wz, ll = Math.hypot(lx, ly, lz) || 1, eLamp = cd.map((c) => c / Math.max(ll * ll, 0.09));
    const wH = eHole[1], wL = eLamp[1], t = wH + wL > 0 ? wL / (wH + wL) : 0;
    const dir = [dx / dl * (1 - t) + (lx / ll) * t, dy / dl * (1 - t) + (ly / ll) * t, dz / dl * (1 - t) + (lz / ll) * t], dn = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    // The walker's fill: the room's bounce, and the lantern's light coming back off the walls close
    // round you (figure.lampFill of what falls on you), so you are never a black cut-out against it.
    return { uniforms, sunDir: dir.map((v) => v / dn), sunIlluminance: eHole.map((e, c) => e + eLamp[c]), ambient: bounce.map((b, c) => b + (eLamp[c] * Lt.figure.lampFill) / Math.PI) };
  }
  const sound = () => ({ under: R.sound.under, near: { waterNear: { still: 0, slow: R.sound.waterSlow, running: 0 }, surfaceNear: { water: 1, pads: 0, reeds: 0, grass: 0 }, falls: [] } });

  // ---- the arch, seen; and the acts' ends ----

  function tick(/** @type {number} */ dt) {
    if (carry) {
      carry.t += dt;
      // There, or the walk ended short (something in the way): up it goes from where you stand.
      if (carry.t > 0.3 && !o.walk.busy()) hangNow();
    }
    things();
    const w = o.walk.walker;
    if (!w || flags().includes('setpiece:stack:arch')) return;
    const [a, b] = local(w.x, w.z), A = S.arch;
    if (Math.hypot(a - A.at[0], b - A.at[1]) < 2.4) { flag('setpiece:stack:arch'); notice(W.archSeen); }
  }

  const offs = [
    on('walk:act-done', () => { const a = acting; acting = null; if (a === 'light') lit(); else if (a === 'dig') dug(); }),
    registerCardAction({ id: 'stackgoin', icon: 'cavemouth', order: 9, main: true, label: W.goIn,
      when: (c) => !!c?.stackMouth && !!o.walk.below && !o.walk.zone, action: () => ({ type: 'stack.goIn' }) }),
    registerCardAction({ id: 'stackgoout', icon: 'cavemouth', order: 11, main: true, label: W.goOut,
      when: (c) => !!c?.stackDoor && o.walk.zone === ID, action: () => ({ type: 'stack.goOut' }) }),
    registerCardAction({ id: 'stacklight', icon: 'fire', order: 9, main: true, label: W.light,
      when: (c) => c?.stackLantern === 'floor' && o.walk.zone === ID, action: () => ({ type: 'stack.light' }) }),
    registerCardAction({ id: 'stackhang', icon: 'hook', order: 9, main: true, label: W.hang,
      when: (c) => c?.stackLantern === 'lit' && o.walk.zone === ID, action: () => ({ type: 'stack.hang' }) }),
    registerCardAction({ id: 'stackread', icon: 'note', order: 9, main: true, label: W.read,
      when: (c) => !!c?.stackNote && o.walk.zone === ID, action: () => ({ type: 'stack.read' }) }),
    registerCardAction({ id: 'stackdig', icon: 'dig', order: 9, main: true, label: W.dig,
      when: (c) => !!c?.stackRubble && o.walk.zone === ID && saved().rubble < o.stretches, action: () => ({ type: 'stack.dig' }) }),
    onAction((/** @type {any} */ a) => {
      if (a.type === 'stack.goIn') { if (o.stack.risen && o.walk.below) { update('identify', () => null); o.zones.go(ID); } }
      else if (a.type === 'stack.goOut') { update('identify', () => null); o.zones.back(); }
      else if (a.type === 'stack.light') lightLantern();
      else if (a.type === 'stack.hang') hang();
      else if (a.type === 'stack.read') read();
      else if (a.type === 'stack.dig') dig();
    }),
  ];

  o.zones.register({ id: ID, enter, leave, tick, cardAt, light, sound, groundAt, viewRoom, ready: () => o.stack.risen,
    pass: o.pass, floor, exposureBiasEV: R.light.exposureBiasEV });

  return {
    id: ID,
    floor, ground, cardAt,
    /** Start building the room once the road stands, so going in is quick. */
    prepare() { if (o.stack.risen && !built) build(); },
    debug: { shape, hookAt, world, local, rubbleFront, dug, lit, hang, pass: o.pass, get built() { return built; } },
    dispose() { for (const off of offs) off(); },
  };
}
