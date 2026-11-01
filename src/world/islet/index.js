// @ts-check
// The meadow islet in the game (docs/13, 'How new land joins'; B3a). It watches the journal for the
// Tier 1 milestone (the second happy pond species, src/world/expansion.js milestoneReached), notes
// the low water it will first show at (the big low tide near day 27, or the first after the
// milestone), and from then on keeps the ground matching the hour: a pale shoal growing out of the
// seabed before that low water, then rising over one tide cycle to sit just above high tide, written
// in steps (recipe rise.stepM) over only the islet's own cells. Its chunks are drawn from the moment
// it shows, and the water, the walk grid and the view above grow to hold it (terrain.raiseLand).
// The rise is a function of the clock, so an island left alone finds it risen on its return, and
// the reveal rings it. Once risen, a few meadow clumps are planted on its dry ground (flax's slot
// waits for its plant). The ground it raises inside the open land (the bar's shore end) is saved
// with those chunks; the rest is rebuilt from the seed on every load, as the open land's base is.
//
// Store slice `islet` (saved, src/world/islet/model.js, plus what others read):
//   { earnedH, lowH, applied, planted,       saved
//     phase: 'waiting'|'shoal'|'rising'|'risen', risen: boolean, riseDay: number | null (the game
//     day it first showed), x, z (its middle), sideDeg,
//     bar: { from: [x, z], to: [x, z], halfWidthM, topM } (the sandbar's line, width and top, m),
//     box: { x0, z0, x1, z1 } (everything it touches) }
// Events: `islet:rose` { x, z, text, away } when it first shows (the journal writes it as a note
// and sets `setpiece:islet:rose`), `islet:risen` when it stands at full height.

import { emitDeferred, on } from '../../core/events.js';
import { get, update, subscribe } from '../../core/store.js';
import { stream } from '../../core/rng.js';
import { dispatch } from '../../input/actions.js';
import { CELL, WORLD_ORIGIN, quantize, dequantize } from '../terrain/grid.js';
import { milestoneReached } from '../expansion.js';
import { isletLayout, makeShape, riseLowH, underBy, phaseOf, inBox } from './layout.js';
import { cleanIslet } from './model.js';

/**
 * @param {{ R: any, land: any, terrain: import('../terrain/index.js').Terrain, seed: number, terrainSeed: number,
 *   tide: { periodH: number, phaseH: number }, hours: () => number, base: (x: number, z: number) => number,
 *   test?: string | null }} o
 *   R: recipes/land/meadow-islet.json; seed: subSeed(world, 'islet'); hours: game hours now (world time);
 *   base: the island's ground as generated (the bar starts where it reaches the bar's top);
 *   test: `?islet` ('' risen now,
 *   'rising' the shoal starting now, a number 0..1 that far through the rise, 'earned' the milestone now)
 */
export function createIslet(o) {
  const { R, terrain } = o;
  const L = isletLayout(R, o.land, o.terrainSeed, o.seed, o.base);
  const seabed = o.land.seabedDepth ?? -3;
  if (!L) return null;
  const shape = makeShape(L, R, o.seed, seabed);
  // Its final ground over every cell it touches, worked out once (-Infinity where it does not reach).
  const i0 = Math.floor((L.box.x0 - WORLD_ORIGIN) / CELL), j0 = Math.floor((L.box.z0 - WORLD_ORIGIN) / CELL);
  const rect = { x: i0, y: j0, w: Math.ceil((L.box.x1 - WORLD_ORIGIN) / CELL) - i0, h: Math.ceil((L.box.z1 - WORLD_ORIGIN) / CELL) - j0 };
  const target = new Float32Array(rect.w * rect.h);
  let top = seabed;
  for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) {
    const h = shape.heightAt(WORLD_ORIGIN + (rect.x + i + 0.5) * CELL, WORLD_ORIGIN + (rect.y + j + 0.5) * CELL);
    target[j * rect.w + i] = h;
    if (h > top) top = h;
  }
  const span = top - seabed;
  /** How far under its final shape the ground was last written (m); Infinity: not yet. */
  let written = Infinity;
  /** @type {(() => [number, number] | null)} */ let walkerAt = () => null;
  /** @type {any} */ let growth = null;
  /** @type {(sp: string) => boolean} */ let hasPlant = () => false;
  /** @type {() => void} */ let record = () => {};
  /** @type {any} */ let camera = null;
  let reached = false;
  /** A test link's state, set once the island is up (`?day=N` grows it first). */
  let test = o.test ?? null;

  const saved = () => cleanIslet(get('islet'));
  /** @param {Partial<import('./model.js').IsletSave>} patch */
  function save(patch) {
    const s = { ...saved(), ...patch };
    const tH = o.hours(), phase = phaseOf(R, s.lowH, tH);
    update('islet', () => ({
      ...s, phase, risen: phase === 'risen', riseDay: s.lowH === null || phase === 'waiting' ? null : Math.floor(s.lowH / 24),
      x: L.x, z: L.z, sideDeg: L.sideDeg, bar: { ...L.bar, from: [...L.bar.from], to: [...L.bar.to] }, box: { ...L.box },
    }));
  }

  /**
   * Write the ground standing `under` meters below its final shape wherever that is higher than the
   * ground now. Cells inside the open land are written only when landToo (they are saved with their
   * chunks once written). @param {number} under @param {boolean} landToo
   */
  function write(under, landToo) {
    return terrain.raiseCells(rect, (m) => {
      const N = Math.round(Math.sqrt(m.heightF.length));
      for (let j = 0; j < rect.h; j++) {
        const z = WORLD_ORIGIN + (rect.y + j + 0.5) * CELL;
        for (let i = 0; i < rect.w; i++) {
          const t = target[j * rect.w + i];
          if (!(t > -Infinity)) continue;
          const x = WORLD_ORIGIN + (rect.x + i + 0.5) * CELL;
          if (!landToo && inBox(L.islandBox, x, z)) continue;
          const k = (rect.y + j) * N + rect.x + i, h = t - under;
          if (h <= m.heightF[k] + 1e-4) continue;
          const q = quantize(h);
          m.heightQ[k] = q;
          m.heightF[k] = dequantize(q);
          writeWeights(m.material, k * 4, shape.paintAt(x, z, m.heightF[k]));
        }
      }
    });
  }

  /** The view above may roam out over it. */
  function reach() {
    if (!camera || reached) return;
    reached = true;
    const c = o.land.center ?? { x: 0, z: 0 };
    camera.addReach({ ax: c.x, az: c.z, bx: L.x, bz: L.z, r: Math.max(L.A, L.B) + R.camera.marginM });
  }

  /** Bring the ground to the hour (and the milestone, and a test link). */
  function sync() {
    let s = saved();
    const tH = o.hours();
    if (test !== null && (test === '' || get('testGrow')?.done !== false)) {
      const f = Number.parseFloat(test);
      const lowH = test === '' ? tH - R.rise.durationH - 1 : test === 'rising' ? tH + R.rise.shoalH
        : Number.isFinite(f) ? tH - Math.max(0, Math.min(1, f)) * R.rise.durationH : null;
      s = { ...s, earnedH: Math.floor(tH), lowH: lowH ?? riseLowH(R, o.tide, Math.floor(tH)), applied: 0 };
      test = null;
      save(s);
    }
    if (s.earnedH === null && milestoneReached(get('journal')?.flags ?? [], R.milestone)) {
      s = { ...s, earnedH: Math.floor(tH), lowH: riseLowH(R, o.tide, Math.floor(tH)) };
      save(s);
      emitDeferred('progress:milestone-reached', { tier: R.tier, land: R.id, lowH: s.lowH });
    }
    if (s.lowH === null) return;
    const under = underBy(R, s.lowH, tH, span);
    if (under === Infinity) return;
    // Shown: its chunks drawn, and the water, the walk and the view reach it.
    if (written === Infinity) { terrain.raiseLand(L.box); reach(); }
    // On a load the ground it had written into the open land is in the saved chunks already.
    const wasApplied = s.applied, now = 1 - under / span;
    const due = written === Infinity || under <= written - R.rise.stepM || (under === 0 && written > 0);
    if (!due) return;
    if (!write(under, now > wasApplied + 1e-6)) return;
    const was = written;
    written = under;
    if (now > wasApplied) save({ applied: now }); else if (was === Infinity) save({});
    const phase = phaseOf(R, s.lowH, tH);
    if (!get('journal')?.flags?.includes('setpiece:islet:rose')) {
      emitDeferred('islet:rose', { x: L.x, z: L.z, text: R.words?.rose ?? '', away: false });
    }
    if (phase === 'risen' && under === 0 && !get('journal')?.flags?.includes('setpiece:islet:risen')) {
      flag('setpiece:islet:risen');
      emitDeferred('islet:risen', { x: L.x, z: L.z });
    }
  }

  /** @param {string} f */
  const flag = (f) => { if (get('journal') && !get('journal').flags?.includes(f)) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f })); };

  /** Once risen and its habitat known: the meadow clumps not planted yet (flax once it has a plant). */
  function plantClumps() {
    const s = saved();
    if (!growth || phaseOf(R, s.lowH, o.hours()) !== 'risen' || written !== 0) return;
    const S = R.starters, planted = [...s.planted];
    let any = false;
    S.clumps.forEach((/** @type {{ sp: string, count: number }} */ c, /** @type {number} */ n) => {
      const key = `${n}:${c.sp}`;
      if (planted.includes(key) || !hasPlant(c.sp)) return;
      const r = stream(o.seed, 77, n);
      // Spots across it, the one its habitat suits best (thyme and trefoil find the open sand,
      // clover and bedstraw the grassy patches), then the rest of the clump round it.
      /** @type {{ x: number, z: number, suit: number }[]} */ const spots = [];
      for (let t = 0; t < S.tries; t++) {
        const a = r.range(-1, 1) * L.A, b = r.range(-1, 1) * L.B;
        const x = L.x + a * L.tx + b * L.ux, z = L.z + a * L.tz + b * L.uz;
        if (shape.heightAt(x, z) < S.minHeightM || terrain.sampleHeight(x, z) < S.minHeightM) continue;
        spots.push({ x, z, suit: growth.suitabilityAt?.(c.sp, x, z).suit ?? 0 });
      }
      spots.sort((p, q) => q.suit - p.suit);
      for (const { x, z } of spots) {
        if (!growth.plant(c.sp, x, z, { size: S.sizeShare }).ok) continue;
        for (let k = 1; k < c.count; k++) {
          const ang = r.range(0, 2 * Math.PI), d = r.range(0.4, 1) * S.spreadM;
          growth.plant(c.sp, x + Math.cos(ang) * d, z + Math.sin(ang) * d, { size: S.sizeShare });
        }
        planted.push(key); any = true;
        break;
      }
    });
    if (any) { record(); save({ planted }); }
  }

  // Risen while you were away: the reveal shows it, its ring on the islet.
  const offCaught = on('world:caught-up', (/** @type {any} */ p) => {
    const s = saved();
    if (s.lowH === null || !Number.isFinite(p?.hours)) return;
    const tH = o.hours();
    if (s.lowH > tH || s.lowH < tH - p.hours) return;
    const text = R.words?.rose ?? '';
    p.notes?.push({ hour: Math.floor(s.lowH), date: '', text, sp: 'islet', kind: 'land' });
    p.events?.push({ name: 'islet:rose', hour: Math.floor(s.lowH), payload: { species: 'islet', x: L.x, z: L.z } });
    if (!get('journal')?.flags?.includes('setpiece:islet:rose')) emitDeferred('islet:rose', { x: L.x, z: L.z, text, away: true });
  });
  // A new summary: the plants' habitat is rebuilt from it in the same event (growth listens too), so
  // the clumps are tried on the next frame, once it holds the islet.
  let summaryNew = false;
  const offSummary = on('water:summary-updated', () => { summaryNew = true; });
  const offJournal = subscribe('journal', () => { if (saved().earnedH === null) sync(); });

  sync();
  if (get('islet')?.x === undefined) save({});

  return {
    id: 'islet',
    layout: L,
    shape,
    /**
     * The systems made after it (src/app/islet.js): the view above, the plants and the walker.
     * @param {{ camera: any, growth: any, hasPlant: (sp: string) => boolean, record: () => void, walkerAt: () => [number, number] | null }} a
     */
    attach(a) {
      camera = a.camera; growth = a.growth; hasPlant = a.hasPlant; record = a.record; walkerAt = a.walkerAt;
      if (written !== Infinity) reach();
    },
    /** Each frame: the ground follows the hour; standing on it is noted once. */
    tick() {
      sync();
      if (summaryNew) { summaryNew = false; plantClumps(); }
      if (written !== Infinity && written < 0.5) {
        const at = walkerAt();
        if (at && shape.heightAt(at[0], at[1]) > R.materials.sandHighM && terrain.sampleHeight(at[0], at[1]) > 0) flag('setpiece:islet:walked');
      }
    },
    dispose() { offCaught(); offSummary(); offJournal(); },
  };
}

/**
 * Four paint shares (grass, sand, rock, soil) to bytes that sum to exactly 255, as the landform
 * writes them. @param {Uint8Array} dst @param {number} at @param {number[]} w
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

/** @typedef {NonNullable<ReturnType<typeof createIslet>>} Islet */
