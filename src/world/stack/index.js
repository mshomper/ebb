// @ts-check
// The stack in the game (docs/future/19, 'The light on the stack'): a tall terraced rock offshore,
// raised from the recipe on every load into the open sea beside the island (its chunks drawn, the
// water, the walk grid and the view above grown to hold it, as the meadow islet's are). Round it the
// no-build ring: the brushes leave its cells alone (terrain setFixedGuard), anything an edit spills
// in is put back, and on an older island the land raised inside it sinks back once. Go down never
// sets you on it (landing). On two or three seeded evenings of its first week a light shows at its
// foot; at the first low water of its day 7 the causeway rises (reveal.js) and stands for good,
// written again from the recipe on every load. Its cave mouth is a zone (mouth.js).
//
// Store slice `stack` (saved, src/world/stack/model.js). Flags (journal): setpiece:stack:seen,
// :lights, :crossed (and :road, by the journal on `stack:road`). Events: `stack:road` { away, text } when the
// causeway has risen.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { dispatch } from '../../input/actions.js';
import { CELL, WORLD_ORIGIN, WORLD_CELLS, quantize, dequantize } from '../terrain/grid.js';
import { islandCenter } from '../terrain/landform.js';
import { kelvinRgb, flicker } from '../camp/light.js';
import { stackLayout, makeStackShape, makeCauseway, causewayFrom, inBox } from './layout.js';
import { startDayOf, lightDays, lightAt, roadH, duskOf } from './schedule.js';
import { cleanStack } from './model.js';

const N = WORLD_CELLS;

/**
 * @param {{ S: any, R: any, land: any, terrain: import('../terrain/index.js').Terrain, seed: number, terrainSeed: number,
 *   isletDeg: number | null, tide: { periodH: number, phaseH: number }, hours: () => number, base: (x: number, z: number) => number[],
 *   test?: string | null }} o
 *   S: the land recipe's stack block; R: recipes/setpieces/stack.json; seed: subSeed(world, 'stack');
 *   hours: game hours now (world time); base: the island as generated (landform baseSampler: height and paint shares);
 *   test: `?stack` ('' the road up now, 'road' its reveal now, 'lights' an evening with the light, 'mouth' you in the mouth)
 */
export function createStack(o) {
  const { S, R, terrain } = o;
  const seabed = o.land.seabedDepth ?? -3;
  const L = stackLayout(S, o.land, o.terrainSeed, o.seed, (x, z) => o.base(x, z)[0], o.isletDeg);
  if (!L) return null;
  const shape = makeStackShape(L, S, o.seed, seabed);
  const center = islandCenter(o.land);
  const open = terrain.openBounds();
  const inOpen = (/** @type {number} */ x, /** @type {number} */ z) => x >= open.openMin[0] && x <= open.openMax[0] && z >= open.openMin[1] && z <= open.openMax[1];
  /** @param {{ x0: number, z0: number, x1: number, z1: number }} b */
  const rectOf = (b) => {
    const i0 = Math.max(0, Math.floor((b.x0 - WORLD_ORIGIN) / CELL)), j0 = Math.max(0, Math.floor((b.z0 - WORLD_ORIGIN) / CELL));
    return { x: i0, y: j0, w: Math.min(N, Math.ceil((b.x1 - WORLD_ORIGIN) / CELL)) - i0, h: Math.min(N, Math.ceil((b.z1 - WORLD_ORIGIN) / CELL)) - j0 };
  };
  const cx = (/** @type {number} */ i) => WORLD_ORIGIN + (i + 0.5) * CELL;

  const saved = () => cleanStack(get('stack'));
  /** @param {Partial<import('./model.js').StackSave>} patch */
  const save = (patch) => update('stack', () => ({ ...saved(), ...patch, x: L.x, z: L.z }));
  const flags = () => get('journal')?.flags ?? [];
  /** @param {string} f */
  const flag = (f) => { if (get('journal') && !flags().includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };

  /**
   * Write ground into a rect: heightAt's height wherever it is higher than the ground now (or, with
   * `exact`, wherever it differs), painted by paintAt. @param {{ x: number, y: number, w: number, h: number }} rect
   * @param {(x: number, z: number) => number} heightAt -Infinity: leave it @param {(x: number, z: number, h: number) => number[]} paintAt
   * @param {boolean} [exact]
   */
  function writeRect(rect, heightAt, paintAt, exact = false) {
    return terrain.raiseCells(rect, (m) => {
      for (let j = 0; j < rect.h; j++) {
        const z = cx(rect.y + j);
        for (let i = 0; i < rect.w; i++) {
          const x = cx(rect.x + i), t = heightAt(x, z);
          if (!(t > -Infinity)) continue;
          const k = (rect.y + j) * N + rect.x + i;
          if (exact ? Math.abs(t - m.heightF[k]) < 1e-4 : t <= m.heightF[k] + 1e-4) continue;
          const q = quantize(t);
          m.heightQ[k] = q;
          m.heightF[k] = dequantize(q);
          writeWeights(m.material, k * 4, paintAt(x, z, m.heightF[k]));
        }
      }
    });
  }

  const ringR2 = L.noBuildM * L.noBuildM;
  const inRing = (/** @type {number} */ x, /** @type {number} */ z) => (x - L.x) ** 2 + (z - L.z) ** 2 <= ringR2;
  const ringBox = { x0: L.x - L.noBuildM, z0: L.z - L.noBuildM, x1: L.x + L.noBuildM, z1: L.z + L.noBuildM };

  // ---- the ground, on every load (in the land phase, before the water and the walk grid) ----

  // An older island: land raised inside the ring sinks back to the ground as generated, once.
  if (!saved().cleared) {
    writeRect(rectOf(ringBox), (x, z) => {
      if (!inRing(x, z) || !inOpen(x, z)) return -Infinity;
      const b = o.base(x, z)[0];
      return terrain.sampleHeight(x, z) > b + 0.02 ? b : -Infinity;
    }, (x, z) => o.base(x, z).slice(1), true);
    save({ cleared: true });
  }
  terrain.raiseLand(L.box);
  // Out in the open sea only: the open land's own ground (its skirt's edge, at most) is the brushes'.
  writeRect(rectOf(L.box), (x, z) => (inOpen(x, z) ? -Infinity : shape.heightAt(x, z)), (x, z, h) => shape.paintAt(x, z, h));
  /** The causeway's shape once it has a land end (as it rises, or from the save). @type {ReturnType<typeof makeCauseway> | null} */
  let road = null;
  /** @param {[number, number]} from */
  const roadFrom = (from) => makeCauseway(from, L.foot, R.road, o.seed, seabed);
  if (saved().risen && saved().from) {
    road = roadFrom(/** @type {[number, number]} */ (saved().from));
    terrain.raiseLand(road.box);
    writeRect(rectOf(road.box), (x, z) => road.heightAt(x, z), (x, z, h) => road.paintAt(x, z, h));
  }

  // The days this island counts from: its first load with the stack.
  if (saved().startDay === null) save({ startDay: startDayOf(Math.floor(o.hours() / 24), R) });
  const startDay = /** @type {number} */ (saved().startDay);
  const lights = lightDays(o.seed, startDay, R);
  const riseH = roadH(startDay, o.tide, R);

  // ---- the guard: the ring (and the causeway once risen) as it stands now ----

  const mask = new Uint8Array(N * N);
  /** @type {{ idx: Int32Array, q: Uint16Array, mat: Uint8Array } | null} */ let snap = null;
  /** Mark the guarded cells and take their ground as it stands (what an edit is put back to). @param {any} m the terrain mirror */
  function guardNow(m) {
    const cells = [];
    const boxes = [ringBox, ...(road ? [road.box] : [])];
    for (const b of boxes) {
      const r = rectOf(b);
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
        const x = cx(r.x + i), z = cx(r.y + j), k = (r.y + j) * N + r.x + i;
        if (mask[k] || !inOpen(x, z)) continue;
        if (inRing(x, z) || (road && road.heightAt(x, z) > -Infinity)) { mask[k] = 1; cells.push(k); }
      }
    }
    const prev = snap ? Array.from(snap.idx) : [];
    const idx = Int32Array.from([...prev, ...cells]);
    const q = new Uint16Array(idx.length), mat = new Uint8Array(idx.length * 4);
    idx.forEach((k, n) => { q[n] = m.heightQ[k]; for (let c = 0; c < 4; c++) mat[n * 4 + c] = m.material[k * 4 + c]; });
    snap = { idx, q, mat };
    const all = rectOf({ x0: Math.min(ringBox.x0, road?.box.x0 ?? Infinity), z0: Math.min(ringBox.z0, road?.box.z0 ?? Infinity),
      x1: Math.max(ringBox.x1, road?.box.x1 ?? -Infinity), z1: Math.max(ringBox.z1, road?.box.z1 ?? -Infinity) });
    terrain.setFixedGuard?.(mask, all, putBack);
  }
  /** After an edit: guarded cells it changed go back as they were. @param {any} m @param {{ x: number, y: number, w: number, h: number }} r */
  function putBack(m, r) {
    if (!snap) return false;
    let changed = false;
    const { idx, q, mat } = snap;
    for (let n = 0; n < idx.length; n++) {
      const k = idx[n], i = k % N, j = (k - i) / N;
      if (i < r.x || j < r.y || i >= r.x + r.w || j >= r.y + r.h) continue;
      let same = m.heightQ[k] === q[n];
      for (let c = 0; c < 4 && same; c++) same = m.material[k * 4 + c] === mat[n * 4 + c];
      if (same) continue;
      m.heightQ[k] = q[n];
      m.heightF[k] = dequantize(q[n]);
      for (let c = 0; c < 4; c++) m.material[k * 4 + c] = mat[n * 4 + c];
      changed = true;
    }
    return changed;
  }

  // ---- the causeway's rise ----

  /**
   * Write the causeway risen `p` of the way (0..1 swept from the land end out to the stack). Each
   * stretch climbs from the seabed to its top as the sweep passes it. @param {number} p
   */
  function writeRoad(p) {
    if (!road) return false;
    const R2 = road, win = 0.18;
    return writeRect(rectOf(R2.box), (x, z) => {
      const t = R2.heightAt(x, z);
      if (!(t > -Infinity)) return -Infinity;
      const e = Math.max(0, Math.min(1, (p * (1 + win) - R2.along(x, z)) / win));
      const s = e * e * e * (e * (e * 6 - 15) + 10);
      return seabed + (t - seabed) * s;
    }, (x, z, h) => R2.paintAt(x, z, h));
  }
  /** Lay the causeway's line from the land nearest it now, and grow the drawn world to hold it. */
  function startRoad() {
    const from = causewayFrom(L, center, (x, z) => (inRing(x, z) && shape.onRock(x, z) ? -Infinity : terrain.sampleHeight(x, z)), R.road.topM - 0.15);
    road = roadFrom(from);
    terrain.raiseLand(road.box);
    return from;
  }
  /** The causeway stands: saved, flagged, guarded. @param {[number, number]} from @param {boolean} away */
  function roadDone(from, away) {
    save({ risen: true, from, shown: true });
    const live = get('terrainLive');
    if (live?.mirror) guardNow(live.mirror);
    // The journal writes its line as a note (journal italic) and sets setpiece:stack:road.
    emitDeferred('stack:road', { away, text: R.words.road });
  }

  // ---- the lights at dusk ----

  const lightRgb = kelvinRgb(R.lights.light.lightK);
  const lightPos = () => [L.foot[0] * 0.6 + L.mouth[0] * 0.4, L.apronM + R.lights.heightM, L.foot[1] * 0.6 + L.mouth[1] * 0.4];
  /** @type {() => number} */ let dayLengthH = () => 12;
  /** How bright the light at the foot is now (0 off). */
  const lightNow = () => (test === 'lights-on' ? 1 : lightAt(o.hours(), lights, duskOf(dayLengthH()), R));

  // ---- Go down, and the walker's first look ----

  /** @type {(() => { x: number, z: number, yaw: number } | null)} */ let walker = () => null;
  /** A test link's state. */
  let test = o.test ?? null;

  /**
   * Where Go down may set you (docs/23; Matt, November 1, 2026: never on the stack, its ledges or in
   * the cave): a point inside the ring is moved to the nearest island ground back toward the island's
   * middle, except on the risen causeway's top. @param {number} x @param {number} z @returns {[number, number] | null} null: as it is
   */
  function landing(x, z) {
    if (!inRing(x, z)) return null;
    if (road && saved().risen && road.onTop(x, z, 0.3) && !shape.onRock(x, z)) return null;
    const dx = center.x - x, dz = center.z - z, d = Math.hypot(dx, dz) || 1;
    for (let s = 0.5; s < d; s += 0.5) {
      const px = x + (dx / d) * s, pz = z + (dz / d) * s;
      if (inRing(px, pz) && !(road && saved().risen && road.onTop(px, pz) && !shape.onRock(px, pz))) continue;
      if (terrain.sampleHeight(px, pz) > 0.75) return [px, pz];
    }
    return [L.shore[0], L.shore[1]];
  }

  return {
    id: 'stack',
    layout: L,
    shape,
    /** The game hour the causeway rises, and the evenings the light shows (tests and the test links). */
    riseH,
    lightDays: lights,
    get road() { return road; },
    landing,
    inRing,
    /** Is a point the stack's own (its ring, or on the causeway)? The shaper's trail leaves its falls alone. @param {number} x @param {number} z */
    owns: (x, z) => inRing(x, z) || (!!road && road.heightAt(x, z) > -Infinity),
    /** The ring's dashed edge for the brush marks (the camp pad's style). */
    ring: { x: L.x, z: L.z, r: L.noBuildM },
    /**
     * The systems made after it (src/app/stack.js). @param {{ camera: any, dayLengthH: () => number, walker: () => { x: number, z: number, yaw: number } | null }} a
     */
    attach(a) {
      dayLengthH = a.dayLengthH; walker = a.walker;
      a.camera?.addReach({ ax: center.x, az: center.z, bx: L.x, bz: L.z, r: L.reachM + S.cameraMarginM });
      const live = get('terrainLive');
      if (live?.mirror) guardNow(live.mirror);
    },
    /** Is the causeway due and not yet standing? */
    roadDue: () => !saved().risen && o.hours() >= riseH,
    /** Is the causeway standing? */
    get risen() { return saved().risen; },
    startRoad,
    writeRoad,
    roadDone,
    /** The test link's ask, taken once (`?stack=lights` keeps the light on for the visit). */
    takeTest() { const t = test; test = t === 'lights' ? 'lights-on' : null; return t; },
    /** Each frame: the light at the foot noted while you are there; your first look; your first steps on it. */
    tick() {
      if (lightNow() > 0.3) flag('setpiece:stack:lights');
      const w = walker();
      if (!w) return;
      const dx = L.x - w.x, dz = L.z - w.z, d = Math.hypot(dx, dz);
      if (!flags().includes('setpiece:stack:seen') && d <= R.seenM && !inRing(w.x, w.z)) {
        const face = Math.cos(Math.atan2(dx, dz) - w.yaw);
        if (face > 0.5) { flag('setpiece:stack:seen'); emitDeferred('island:notice', { text: R.words.seen, showS: 6 }); }
      }
      if (saved().risen && shape.onRock(w.x, w.z)) flag('setpiece:stack:crossed');
    },
    /** The light at its foot (doc 06 small lights), while it shows. */
    lights() {
      const g = lightNow();
      if (g <= 0) return [];
      const p = lightPos(), F = R.lights.light, t = performance.now() / 1000;
      return [{ key: 'stack-light', x: p[0], y: p[1], z: p[2], rangeM: F.rangeM, cd: F.cd * g * flicker(t, F.flicker, F.flickerHz, 19), rgb: lightRgb }];
    },
    /** Its glow and the moths round it, for the camp's effects pass (the placed lanterns' list). */
    glass() {
      const g = lightNow();
      if (g <= 0) return [];
      const p = lightPos();
      return [{ glass: [p[0], p[1], p[2], g], look: [R.lights.glass.nits, R.lights.glass.m] }];
    },
    /** The card a tap on the stack or at its mouth opens, or null. @param {number} x @param {number} z */
    cardAt(x, z) {
      const W = R.words;
      if (saved().risen && Math.hypot(x - L.mouth[0], z - L.mouth[1]) <= 1.4) {
        return { sp: 'setpiece:stack-mouth', stackMouth: true, name: W.mouthName, sub: null, icon: 'stack', text: W.mouth,
          wx: L.stand[0], wz: L.stand[1], r: 0.4, reachR: 0.9, stage: -1, noPage: true, canCarry: false };
      }
      if (!inRing(x, z) || !shape.onRock(x, z)) return null;
      return { sp: 'setpiece:stack', name: W.stackName, sub: null, icon: 'stack', text: saved().risen ? W.stackRoad : W.stack,
        wx: x, wz: z, r: 0.6, reachR: 3, stage: -1, noPage: true, canCarry: false };
    },
    /** Tests. */
    debug: { saved, guardNow, putBack, mask: () => mask, snap: () => snap, lightNow, inBox: (/** @type {number} */ x, /** @type {number} */ z) => inBox(L.box, x, z) },
  };
}

/**
 * Four paint shares (grass, sand, rock, soil) to bytes that sum to exactly 255, as the landform
 * writes them (the islet's own, src/world/islet/index.js). @param {Uint8Array} dst @param {number} at @param {number[]} w
 */
function writeWeights(dst, at, w) {
  const total = w[0] + w[1] + w[2] + w[3];
  if (!(total > 0)) { dst[at] = 0; dst[at + 1] = 255; dst[at + 2] = 0; dst[at + 3] = 0; return; }
  const k = 255 / total;
  const c1 = Math.min(255, Math.floor(w[0] * k + 0.5));
  const c2 = Math.max(c1, Math.min(255, Math.floor((w[0] + w[1]) * k + 0.5)));
  const c3 = Math.max(c2, Math.min(255, Math.floor((w[0] + w[1] + w[2]) * k + 0.5)));
  dst[at] = c1; dst[at + 1] = c2 - c1; dst[at + 2] = c3 - c2; dst[at + 3] = 255 - c3;
}

/** @typedef {NonNullable<ReturnType<typeof createStack>>} Stack */
