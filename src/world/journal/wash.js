// @ts-check
// The journal's show-where wash (J2b, docs 13, 05): for the open page, a map of the island at half
// a meter a square, R where its thing lives now and G where a known species would do well, plus, for a
// species not yet seen, a few pencil circles near (never on) the best places for it. Pure and
// deterministic; the tonemap pass paints it after the palette (src/shaders/tonemap.wgsl).

import { hash32 } from '../../core/rng.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';
import { suitability } from '../growth/coarse.js';
import { groundKind, onPage } from './ground.js';
import { coverShare, isAnimal, COVER_FULL } from './observe.js';

/**
 * @typedef {{ n: number, cell: number, origin: number, data: Uint8Array, circles: number[][] }} WashMap
 *   data: n × n × 2 bytes (R lives, G would do well), cell (i, j) at world x = origin + (i + 0.5) · cell;
 *   circles: [x, z, radius] in meters
 */

/**
 * The wash for a journal page, or null when the page washes nothing.
 * @param {string} page a species or Ground page id
 * @param {{ state: any, hab: any, material: Uint8Array | null, island: any, flora: Record<string, any>,
 *   words: any, journal: import('./observe.js').Journal, wash: any }} ctx  wash: recipes/world/journal-wash.json;
 *   flora: the plant recipes and the cover plants' (rushes) by id, for where each would do well
 * @returns {WashMap | null}
 */
export function washMap(page, ctx) {
  const { hab, words, island, journal } = ctx;
  if (!hab) return null;
  const n = hab.n;
  const live = new Float32Array(n * n), well = new Float32Array(n * n);
  /** @type {number[][]} */ let circles = [];
  const xOf = (/** @type {number} */ k) => HABITAT_ORIGIN + (k % n) + 0.5;
  const zOf = (/** @type {number} */ k) => HABITAT_ORIGIN + Math.floor(k / n) + 0.5;

  // The map is drawn at half a meter, twice the habitat's resolution, so washes come out round.
  const N = n * 2;
  /** @type {Float32Array | null} */ let stamped = null;
  if (island.ground[page]) {
    for (let k = 0; k < n * n; k++) {
      if (!hab.open[k]) continue;
      const x = xOf(k), z = zOf(k);
      if (onPage(page, groundKind(hab, ctx.material, x, z, island), ctx.material, x, z)) live[k] = 1;
    }
  } else if (isAnimal(words.species[page])) {
    // Frogs: their homes, and where the habitat score says they would do well; before you have
    // found one, pencil circles near the best edge. Midges: where their cloud is now.
    const kind = words.species[page].kind;
    const eco = ctx.state?.ecology;
    const field = kind === 'creature' ? eco?.frogs?.score : eco?.midges;
    const at = (/** @type {number} */ k) => (field ? field[k] / 255 : 0);
    if (!journal.species[page]?.ever) {
      // Frogs' circles go near the best stretch of the pond's edge, where one would come.
      const bank = kind === 'creature' ? new Set(eco?.frogs?.edge?.cells ?? []) : null;
      circles = hintCircles(page, hab, (k) => (!bank || bank.has(k) ? at(k) : 0), ctx.wash);
    }
    else if (kind === 'creature') {
      stamped = new Float32Array(N * N);
      for (const f of ctx.state?.creatures?.frogs?.frogs ?? []) stamp(stamped, N, f.x, f.z, ctx.wash.plantM * 0.6);
      for (let k = 0; k < n * n; k++) if (at(k) >= island.suitAt) well[k] = 1;
    } else {
      const share = words.species[page].seenAt.share;
      for (let k = 0; k < n * n; k++) if (at(k) >= share) live[k] = 1;
    }
  } else if (words.species[page]) {
    const rec = ctx.flora[page];
    const seen = !!journal.species[page]?.ever;
    const suitAt = (/** @type {number} */ k) => (rec?.habitat ? suitability(rec, hab, xOf(k), zOf(k)).suit : 0);
    if (!seen) {
      circles = hintCircles(page, hab, suitAt, ctx.wash);
    } else {
      if (words.species[page].kind === 'cover') {
        for (let k = 0; k < n * n; k++) if (coverShare(page, ctx.state, hab, k) > COVER_FULL) live[k] = 1;
      } else {
        stamped = new Float32Array(N * N);
        for (const p of ctx.state?.growth?.plants ?? []) if (p.sp === page) stamp(stamped, N, p.x, p.z, ctx.wash.plantM * (0.6 + 0.4 * Math.min(1, p.size)));
      }
      if (rec?.habitat) for (let k = 0; k < n * n; k++) if (hab.open[k] && !hab.sea[k] && suitAt(k) >= island.suitAt) well[k] = 1;
    }
  } else return null;

  // Plant stamps are soft already; squares of ground, grass and suitability get rounded off.
  const L = stamped ?? soften(soften(double(live, n), N), N), G = soften(soften(double(well, n), N), N);
  const data = new Uint8Array(N * N * 2);
  for (let k = 0; k < N * N; k++) {
    data[k * 2] = Math.round(255 * L[k]);
    data[k * 2 + 1] = Math.round(255 * G[k]);
  }
  return { n: N, cell: 0.5, origin: HABITAT_ORIGIN, data, circles };
}

/** Each 1 m square as four half-meter squares. @param {Float32Array} a @param {number} n */
function double(a, n) {
  const out = new Float32Array(4 * n * n);
  for (let j = 0; j < 2 * n; j++) for (let i = 0; i < 2 * n; i++) out[j * 2 * n + i] = a[(j >> 1) * n + (i >> 1)];
  return out;
}

/** Max-add a soft disc of radius r (m) at (x, z) on the half-meter map. @param {Float32Array} a @param {number} n @param {number} x @param {number} z @param {number} r */
function stamp(a, n, x, z, r) {
  // In half-meter cells.
  const ci = (x - HABITAT_ORIGIN) * 2, cj = (z - HABITAT_ORIGIN) * 2;
  r *= 2;
  const reach = Math.ceil(r) + 1;
  for (let j = Math.floor(cj) - reach; j <= Math.floor(cj) + reach; j++) {
    for (let i = Math.floor(ci) - reach; i <= Math.floor(ci) + reach; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj);
      const v = d >= r ? 0 : d <= 0.5 * r ? 1 : 1 - (d - 0.5 * r) / (0.5 * r);
      if (v > a[j * n + i]) a[j * n + i] = v;
    }
  }
}

/** A 3 × 3 tent blur, so 1 m squares read as soft shapes. @param {Float32Array} a @param {number} n */
function soften(a, n) {
  const out = new Float32Array(n * n);
  const W = [1, 2, 1];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0, w = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= n) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= n) continue;
          const ww = W[di + 1] * W[dj + 1];
          s += a[jj * n + ii] * ww; w += ww;
        }
      }
      out[j * n + i] = s / w;
    }
  }
  return out;
}

/**
 * Pencil circles for a species not yet seen: the best places for it, each at least apartM from
 * the others, nudged a fixed, page-seeded distance off the spot.
 * @param {string} page @param {any} hab @param {(k: number) => number} suitAt @param {any} W
 */
function hintCircles(page, hab, suitAt, W) {
  const n = hab.n;
  /** @type {{ k: number, s: number }[]} */ const best = [];
  for (let k = 0; k < n * n; k++) {
    if (!hab.open[k] || hab.sea[k]) continue;
    const s = suitAt(k);
    if (s > 0.5) best.push({ k, s });
  }
  best.sort((a, b) => b.s - a.s || a.k - b.k);
  /** @type {number[][]} */ const out = [];
  let seed = 0;
  for (let c = 0; c < page.length; c++) seed = hash32(seed, page.charCodeAt(c));
  for (const { k } of best) {
    if (out.length >= W.circles) break;
    const x = HABITAT_ORIGIN + (k % n) + 0.5, z = HABITAT_ORIGIN + Math.floor(k / n) + 0.5;
    if (out.some((c) => Math.hypot(c[3] - x, c[4] - z) < W.apartM)) continue;
    const a = (hash32(seed, out.length) / 4294967296) * Math.PI * 2;
    out.push([x + Math.cos(a) * W.nudgeM, z + Math.sin(a) * W.nudgeM, W.circleM / 2, x, z]);
  }
  return out.map((c) => c.slice(0, 3));
}
