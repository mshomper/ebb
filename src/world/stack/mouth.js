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
import { run } from '../../core/workers.js';
import { dispatch, onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { cleanCook } from '../camp/making.js';
import { kelvinRgb, flicker } from '../camp/light.js';
import { lathe, tube, lumpStone, join } from '../spring/cave-live.js';
import { mouthShape } from './mouth-field.js';
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

  // Where the hook is: on the wall beside the arch's opening, toward the way in.
  const hookAt = (() => {
    const A = S.arch, x = A.at[0] - A.halfWidthM - T.hook.fromArchM;
    for (let z = A.at[1] - 1.5; z < A.at[1] + 2; z += 0.02) if (shape.inside(x, z) < 0.1) return { x, z: z - 0.08 };
    return { x, z: A.at[1] };
  })();

  /** The floor (world height). @param {number} x @param {number} z */
  const floor = (x, z) => { const [a, b] = local(x, z); return O.y + shape.floorAt(a, b); };
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
  function build() {
    if (built || building) return;
    building = true;
    run({ module: './world/stack/mouth-field.js', fn: 'mouthMeshJob' }, { S, seed: R.seed, top: R.depthM }, { lane: 'interactive' }).then((m) => {
      const v = new Float32Array(m.count * 10);
      for (let i = 0; i < m.count; i++) {
        const a = m.pos[i * 3], y = m.pos[i * 3 + 1], b = m.pos[i * 3 + 2], na = m.nrm[i * 3], nb = m.nrm[i * 3 + 2];
        v.set([O.x + a * ux + b * vx, O.y + y, O.z + a * uz + b * vz, na * ux + nb * vx, m.nrm[i * 3 + 1], na * uz + nb * vz, 0, 0, 0, 0], i * 10);
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
    return lathe([[0, 0], [r, 0], [r, h * 0.08], [r * 0.92, h * 0.1], [r * 0.92, h * 0.7], [r, h * 0.72], [r * 1.05, h * 0.78], [r * 0.6, h * 0.92], [r * 0.25, h], [0, h]],
      12, K.lantern, [null, K.lanternRim, null, K.glass, K.glass, null, K.lanternRim, null, null, null]);
  }
  /** The made things: the lantern (lying, lit or hung), the note, the hook, the soot ring and the rubble. */
  function things() {
    const s = saved(), key = `${s.lantern}:${s.rubble}`;
    if (key === thingsKey) return;
    thingsKey = key;
    const K = R.look, parts = [];
    // The lantern: on its side on the floor, or hanging from the hook.
    const lan = lanternMesh();
    if (s.lantern === 'hung') {
      const y0 = T.hook.heightM - T.lantern.heightM - 0.06;
      for (let i = 0; i < lan.data.length; i += 10) { lan.data[i] += hookAt.x + 0.12; lan.data[i + 1] += y0; lan.data[i + 2] += hookAt.z; }
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
    parts.push(place(tube([[hookAt.x - 0.02, hy, hookAt.z + 0.06], [hookAt.x + 0.12, hy, hookAt.z], [hookAt.x + 0.14, hy + 0.05, hookAt.z]], 0.012, 5, K.iron)));
    // The note: a folded sheet with a small stone on it.
    const [nx0, nz0] = T.note.at, [nw, nd] = T.note.sizeM, ny0 = shape.floorAt(nx0, nz0) + 0.012;
    parts.push(place({ data: [nx0 - nw / 2, ny0, nz0 - nd / 2, 0, 1, 0, ...K.note, 1, nx0 + nw / 2, ny0, nz0 - nd / 2, 0, 1, 0, ...K.note, 1,
      nx0 + nw / 2, ny0 + 0.006, nz0 + nd / 2, 0, 1, 0, ...K.note, 1, nx0 - nw / 2, ny0 + 0.006, nz0 + nd / 2, 0, 1, 0, ...K.note, 1], idx: [0, 2, 1, 0, 3, 2] }));
    parts.push(place(lumpStone(nx0 + 0.02, ny0, nz0, 0.035, (k) => ((hash32(17, k) >>> 8) / 16777216), 0.2, K.stone)));
    // The soot ring round the arch's opening.
    const A = S.arch, ring = [];
    for (let k = 0; k <= 24; k++) {
      const t = Math.PI * (k / 24), sx = Math.cos(t) * (A.halfWidthM + 0.04), sy = Math.sin(t) * (A.heightM + 0.04);
      ring.push([A.at[0] - sx * A.dir[1], Math.max(0.02, sy), A.at[1] + sx * A.dir[0] - 0.02]);
    }
    parts.push(place(tube(ring, T.soot.radiusM, 6, K.soot)));
    parts.push(place(rubbleMesh(s.rubble)));
    o.pass.setMesh('things', join(parts));
  }
  /** The rubble's stones, heaped in its passage past what is dug. @param {number} dug */
  function rubbleMesh(dug) {
    const P = S.rubble, B = T.rubble, front = -0.6 + (P.lengthM + 0.6) * Math.min(1, dug / Math.max(1, o.stretches));
    const u = (/** @type {number} */ i, /** @type {number} */ k) => (hash32(B.seed, i, k) >>> 8) / 16777216;
    const parts = [];
    for (let i = 0; i < B.stones; i++) {
      const s = -0.4 + u(i, 1) * (P.lengthM + 0.4), t = (u(i, 2) - 0.5) * 2 * P.halfWidthM * 0.85;
      if (s < front) continue;
      // Heaped: most low, fewer higher, the heap rising to the roof a little way in.
      const lift = u(i, 3) ** 2 * Math.min(P.heightM - 0.35, 0.25 + (s - front) * 1.2);
      const x = P.at[0] + P.dir[0] * s - P.dir[1] * t, z = P.at[1] + P.dir[1] * s + P.dir[0] * t;
      const size = B.sizeM[0] + (B.sizeM[1] - B.sizeM[0]) * u(i, 4) ** 1.5;
      parts.push(lumpStone(x, lift, z, size / 2, (k) => u(i, k + 5), 0.25, R.look.stone, 0.75));
    }
    const all = join(parts);
    return { data: Array.from(all.data), idx: Array.from(all.idx) };
  }

  const enter = () => {
    build();
    things();
    const [ax, az] = world(R.view.arriveM, 0), yaw = Math.atan2(ux, uz);
    const xs = [S.boundsM[0], S.boundsM[3]], zs = [S.boundsM[2], S.boundsM[5]], pts = xs.flatMap((a) => zs.map((b) => world(a, b)));
    const bounds = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    const ok = o.walk.enterZone({ id: ID, ground, water, bounds, cellM: R.walk.cellM,
      at: { x: ax, z: az, yaw, viewYaw: yaw + Math.PI + (R.view.arriveTurnDeg * Math.PI) / 180 }, camera: R.view.camera });
    if (!ok) return false;
    flag('setpiece:stack:crossed');
    notice(W.below);
    return true;
  };
  const leave = () => { o.walk.leaveZone(null); notice(W.up); };

  // ---- the things you do ----

  /** @type {string | null} */ let acting = null;
  function light() {
    if (o.walk.zone !== ID || saved().lantern !== 'floor' || o.walk.busy()) return;
    update('identify', () => null);
    if (o.walk.act('strike')) acting = 'light'; else lit();
  }
  function lit() { save({ lantern: 'lit' }); notice(W.lit); }
  function hang() {
    if (o.walk.zone !== ID || saved().lantern !== 'lit') return;
    update('identify', () => null);
    const [hx, hz] = world(hookAt.x, hookAt.z);
    o.walk.kneelToward?.(hx, hz, 0.8, 'setDown');
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
    const s = saved(), p = s.lantern === 'hung' ? at(hookAt.x + 0.5, hookAt.z - 0.3) : at(T.lantern.at[0], T.lantern.at[1]);
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
    const lp = s.lantern === 'hung' ? [hookAt.x + 0.12, hookAt.z] : T.lantern.at;
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
  /**
   * This frame's light (cave-draw.wgsl CaveUniforms, as the spring cave's), the cleft's top as the
   * hole, plus the hung (or lit) lantern's warm fill. @param {{ sunDir: ArrayLike<number>, sunIlluminance: ArrayLike<number>, cloud: number, time: number }} d
   */
  function light(d) {
    const Lt = R.light, K = R.look, sy = Math.max(0, d.sunDir[1]);
    const sky = Lt.skyShare * Math.min(1, sy * 4) * (1 - Lt.cloudCut * d.cloud);
    const eOut = [0, 1, 2].map((c) => d.sunIlluminance[c] * sky), eLevel = [0, 1, 2].map((c) => d.sunIlluminance[c] * (sy + sky));
    const shaftY = O.y + shape.ceilAt(0, 0) - 0.15;
    const area = Math.PI * Lt.holeRadiusM ** 2, walls = 2 * Math.PI * S.radiusM[0] * S.radiusM[1] + 2 * Math.PI * Math.sqrt(S.radiusM[0] * S.radiusM[1]) * S.ceilingM;
    const alb = (K.rock[0] + K.rock[1] + K.rock[2]) / 3, carry = alb / (1 - alb), sunIn = sy > 0.85 ? 1 : 0;
    const lan = saved().lantern === 'floor' ? 0 : Lt.lantern.lux * flicker(d.time, Lt.lantern.flicker, Lt.lantern.flickerHz, 23);
    const bounce = [0, 1, 2].map((c) => ((eOut[c] * area + d.sunIlluminance[c] * area * sunIn) / walls) * carry * Lt.bounce / Math.PI + (eLevel[c] * Lt.fill) / Math.PI + (lan * lanternRgb[c]) / Math.PI);
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
    ];
    const wx = wk?.x ?? O.x, wz = wk?.z ?? O.z, wy = (wk?.y ?? O.y) + 0.9;
    const dx = O.x - wx, dy = O.top - wy, dz = O.z - wz, dl = Math.hypot(dx, dy, dz) || 1;
    const k = (area * (dy / dl)) / (Math.PI * Math.max(dl * dl, 0.16)) * Lt.figure.share;
    return { uniforms, sunDir: [dx / dl, dy / dl, dz / dl], sunIlluminance: eOut.map((e, c) => e * k + lan * lanternRgb[c] * 0.3) };
  }
  const sound = () => ({ under: R.sound.under, near: { waterNear: { still: 0, slow: R.sound.waterSlow, running: 0 }, surfaceNear: { water: 1, pads: 0, reeds: 0, grass: 0 }, falls: [] } });

  // ---- the arch, seen; and the acts' ends ----

  function tick() {
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
      else if (a.type === 'stack.light') light();
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
    debug: { shape, hookAt, world, local, rubbleFront, dug, lit, hang, get built() { return built; } },
    dispose() { for (const off of offs) off(); },
  };
}
