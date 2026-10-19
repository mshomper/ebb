// @ts-check
// Wet-to-dry grass (island areas step C, docs 10, 04): how lush the grass looks, square by square.
// Grass by the water stands taller and deeper green; on the dry rise it is shorter and paler, and it
// cures toward straw as summer goes on. The plants' own moisture (habitat.js) falls off within about
// a meter of the water and decides where reeds and iris grow; this is a separate, wider look field:
// lush ground reaches recipe `lush.waterM` from ponds, marshes and streams and `lush.dampM` from small
// damp hollows, and salt dries the shore ring. Only the look reads it (the grass blades and the
// ground's grass layer); no plant's growth changes, so the simulation and saves are untouched. Pure.

import { chamfer } from './habitat.js';

/** 1 near, 0 at `reachM` (distance in thirds of a cell), easing out from a third of the way. @param {number} d @param {number} reachM */
function reach(d, reachM) {
  const m = d / 3, a = reachM * 0.35;
  if (m <= a) return 1;
  if (m >= reachM) return 0;
  const t = (m - a) / (reachM - a);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The lush field, 0..255 per habitat square (1 m): 255 at the water's edge, falling to 0 by `waterM`
 * from fresh water and `dampM` from damp hollows, dried by salt (`saltDry` at full salt).
 * @param {import('./habitat.js').Habitat} hab @param {any} L recipes/flora/grass.json `lush`
 * @returns {Uint8Array}
 */
export function lushField(hab, L) {
  const N = hab.n, NN = N * N;
  const water = new Uint8Array(NN), damp = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    if (hab.sea[k]) continue;
    if (hab.depthCm[k] > 0) water[k] = 1;
    else if (hab.still[k]) damp[k] = 1;
  }
  const dW = chamfer(water, N, 3 * Math.ceil(L.waterM + 1));
  const dD = chamfer(damp, N, 3 * Math.ceil(L.dampM + 1));
  const out = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    const wet = Math.max(reach(dW[k], L.waterM), reach(dD[k], L.dampM));
    out[k] = Math.round(255 * wet * (1 - L.saltDry * (hab.salt[k] / 255)));
  }
  return out;
}

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/**
 * How lush and dry grass look at a time of year, for the blades and the ground: the season's grass
 * albedo (base), the dry end (paler, cured toward straw by the season's `cure`) and the wet end
 * (deeper, cooler); `mid` is the lushness that looks like today's meadow; heights at the two ends.
 * Season values hold at each season's middle and ease into the next, like the grass's own.
 * @param {any} grass recipes/flora/grass.json @param {number} season season index plus phase (0..4)
 */
export function lushLook(grass, season) {
  const L = grass.lush, S = grass.season;
  const t = season - 0.5;
  const i0 = ((Math.floor(t) % 4) + 4) % 4, i1 = (i0 + 1) % 4;
  let k = t - Math.floor(t);
  k = k * k * (3 - 2 * k);
  const a = SEASONS[i0], b = SEASONS[i1];
  const base = [0, 1, 2].map((i) => S.albedo[a][i] + (S.albedo[b][i] - S.albedo[a][i]) * k);
  const cure = L.cure[a] + (L.cure[b] - L.cure[a]) * k;
  const dry = base.map((c, i) => c * L.dryTint[i] + (L.straw[i] - c * L.dryTint[i]) * cure);
  const wet = base.map((c, i) => c * L.wetTint[i]);
  return { base, dry, wet, mid: L.mid, height: L.height };
}

/**
 * The albedo and height factor at a lushness (0..1), the way the shaders blend it (tests, tools).
 * @param {ReturnType<typeof lushLook>} look @param {number} lush
 */
export function lushAt(look, lush) {
  const m = look.mid;
  if (lush < m) {
    const s = lush / m;
    return { albedo: look.dry.map((c, i) => c + (look.base[i] - c) * s), height: look.height[0] + (1 - look.height[0]) * s };
  }
  const s = (lush - m) / (1 - m);
  return { albedo: look.base.map((c, i) => c + (look.wet[i] - c) * s), height: 1 + (look.height[1] - 1) * s };
}
