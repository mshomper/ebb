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
  let f = new Float32Array(NN);
  for (let k = 0; k < NN; k++) {
    const wet = Math.max(reach(dW[k], L.waterM), reach(dD[k], L.dampM));
    f[k] = wet * (1 - L.saltDry * (hab.salt[k] / 255));
  }
  // Feathered: a soft blur over featherM (three box passes, close to a Gaussian), so wet ground
  // melts into dry instead of ending at a line.
  const r = Math.round(L.featherM ?? 0);
  if (r > 0) for (let pass = 0; pass < 3; pass++) f = boxBlur(f, N, r);
  const out = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) out[k] = Math.round(255 * Math.min(1, Math.max(0, f[k])));
  return out;
}

/** One box blur of radius r squares, along rows then columns (running sums). @param {Float32Array} src @param {number} n @param {number} r */
function boxBlur(src, n, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[j * n + Math.min(n - 1, Math.max(0, i))];
    for (let i = 0; i < n; i++) {
      tmp[j * n + i] = s / w;
      s += src[j * n + Math.min(n - 1, i + r + 1)] - src[j * n + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += tmp[Math.min(n - 1, Math.max(0, j)) * n + i];
    for (let j = 0; j < n; j++) {
      out[j * n + i] = s / w;
      s += tmp[Math.min(n - 1, j + r + 1) * n + i] - tmp[Math.max(0, j - r) * n + i];
    }
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
