// @ts-check
// Shell keepsakes (docs/future/12): one-of-a-kind shells from Raup's coiling model. An aperture, an
// ellipse S times as tall as it is wide, is swept along a logarithmic spiral: each turn it grows W
// times, its centre stands (1 + D) / (1 - D) apertures from the axis, and it climbs T times its
// centre's distance. Ribs (across the whorl), cords (along it), spines (on the shoulder) and bands
// (spiral stripes, or flames across) dress it. Rarity is picked first (rarity.js) and the tier
// shapes everything after.
//
// shellNumbers turns a seed into the numbers a kept shell saves (with gen, the generator version),
// so retuning the recipe never changes a shell someone kept. shellMesh turns numbers into a mesh in
// the creature pass's layout (position, normal, linear albedo), meters, base on y = 0.

import { hash32 } from '../../../core/rng.js';
import { builder } from '../../finds/procedural.js';
import { pickIndex, pickRarity } from '../rarity.js';

/** @typedef {import('../rarity.js').Rarity} Rarity */
/** @typedef {import('../rarity.js').Conditions} Conditions */
/**
 * @typedef {{ family: 'shell', gen: number, rarity: Rarity, form: string,
 *   W: number, D: number, T: number, S: number, whorls: number, sizeM: number,
 *   ribCount: number, ribAmp: number, cordCount: number, cordAmp: number,
 *   spinePerWhorl: number, spineLen: number,
 *   bandCount: number, bandWidth: number, pattern: string, patFreq: number, bandPhase: number,
 *   base: number[], band: number[], apex: number[] | null, apexMix: number, canal: number,
 *   left: number, mark: string | null }} ShellNumbers
 */

/** Salts the shell family's rolls apart from other families'. */
export const SHELL_SALT = 0x5e11;

/** @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;
/** @param {number[]} r @param {number} u */
const lerp = (r, u) => r[0] + (r[1] - r[0]) * u;
/** Four decimals keep a saved shell small. @param {number} x */
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/**
 * The shell the sea leaves for seed and slot n under these conditions, or of a given rarity
 * (the lab's tier chips). Pure. @param {number} seed @param {number} n @param {any} K keepsakes.json
 * @param {Conditions} cond @param {Rarity} [force] @returns {ShellNumbers}
 */
export function rollShell(seed, n, K, cond, force) {
  const h0 = hash32(seed, n, SHELL_SALT);
  const rarity = force ?? pickRarity(u01(hash32(h0, 1)), K.rarity, cond);
  return shellNumbers(h0, rarity, K);
}

/**
 * A shell's numbers from its hash and rarity. Each number has its own fixed draw, so a new number
 * added later (with a new gen) leaves the others where they were.
 * @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json @returns {ShellNumbers}
 */
export function shellNumbers(h0, rarity, K) {
  const S = K.shells, tier = K.rarity.order.indexOf(rarity), Tr = S.tiers[rarity];
  const u = (/** @type {number} */ i) => u01(hash32(h0, i));
  const pick = (/** @type {number[]} */ list, /** @type {number} */ i) => list[Math.min(list.length - 1, Math.floor(u(i) * list.length))];
  const int = (/** @type {number[]} */ r, /** @type {number} */ i) => Math.round(lerp(r, u(i)));
  const form = S.forms[pickIndex(u(2), S.forms.map((/** @type {any} */ f) => f.weights[tier]))];
  const ribs = u(9) < Tr.ribs.chance, cords = u(12) < Tr.cords.chance;
  const spines = !form.smooth && u(15) < Tr.spines.chance, bands = u(18) < Tr.bands.chance;
  const tone = (/** @type {number[]} */ c, /** @type {number} */ i) => {
    const k = 1 + S.colors.jitter * (u(i) * 2 - 1);
    return c.map((x) => r4(Math.min(1, x * k)));
  };
  const left = u(26) < S.marks.leftCoiled.chance ? 1 : 0;
  const base = tone(S.colors.base[pick(Tr.base, 23)], 25);
  // A pattern must show: if the band is too close to the base in lightness, take the tier's band
  // colour that stands out most.
  const lum = (/** @type {number[]} */ c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let band = S.colors.band[pick(Tr.band, 24)];
  if (Math.abs(lum(band) - lum(base)) < S.colors.minContrast) {
    for (const i of Tr.band) if (Math.abs(lum(S.colors.band[i]) - lum(base)) > Math.abs(lum(band) - lum(base))) band = S.colors.band[i];
  }
  return {
    family: 'shell', gen: S.gen, rarity, form: form.id,
    W: r4(lerp(form.W, u(3))), D: r4(lerp(form.D, u(4))), T: r4(lerp(form.T, u(5))), S: r4(lerp(form.S, u(6))),
    whorls: r4(lerp(form.whorls, u(7))), sizeM: r4(lerp(Tr.sizeM, u(8))),
    ribCount: int(Tr.ribs.count, 10), ribAmp: ribs ? r4(lerp(Tr.ribs.amp, u(11))) : 0,
    cordCount: int(Tr.cords.count, 13), cordAmp: cords ? r4(lerp(Tr.cords.amp, u(14))) : 0,
    spinePerWhorl: int(Tr.spines.perWhorl, 16), spineLen: spines ? r4(lerp(Tr.spines.length, u(17))) : 0,
    bandCount: bands ? int(Tr.bands.count, 19) : 0, bandWidth: r4(lerp(Tr.bands.width, u(20))),
    pattern: S.patternOrder[pickIndex(u(21), Tr.bands.patterns)], patFreq: int(Tr.bands.freq, 27),
    bandPhase: r4(u(22) * Math.PI * 2),
    base, band: band.slice(),
    apex: u(28) < Tr.apexChance ? tone(S.colors.base[pick(Tr.base, 29)], 30) : null, apexMix: r4(lerp([0.35, 0.9], u(31))),
    canal: r4(lerp(form.canal ?? [0, 0], u(32))),
    left, mark: left ? 'leftCoiled' : null,
  };
}

/**
 * A plain line for a shell's card: no species name, only what it looks like (Matt, October 21,
 * 2026: keepsakes are pretty things, not things to identify). @param {ShellNumbers} n
 * @param {any} K keepsakes.json @returns {string}
 */
export function shellWords(n, K) {
  const S = K.shells, w = S.words;
  const form = S.forms.find((/** @type {any} */ f) => f.id === n.form);
  /** @type {string[]} */ const feats = [];
  if (n.spineLen > 0) feats.push(n.spineLen >= 0.5 ? w.longSpined : w.spined);
  else if (n.ribAmp > 0) feats.push(w.ribbed);
  else if (n.cordAmp > 0) feats.push(w.corded);
  if (n.bandCount > 0) feats.push(w.patterns[n.pattern] ?? w.patterns.spiral);
  let line = form?.word ?? 'a shell';
  if (feats.length) line += ', ' + feats.join(' and ');
  if (n.left) line += ', ' + S.marks.leftCoiled.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/**
 * How much of the band colour shows at a point (0 to 1), for the shell's pattern. th runs along the
 * growth (around the coil), ph around the aperture. Spiral bands follow the whorl; flames run
 * across it, wavering; zigzags are spiral bands bent back and forth; spots sit where two waves
 * meet; tents are the crossed diamonds of cone shells. @param {ShellNumbers} n @param {number} th
 * @param {number} ph @returns {number}
 */
function patternAt(n, th, ph) {
  const b = n.bandCount, f = n.patFreq, p = n.bandPhase, turn = th / (Math.PI * 2);
  let c;
  switch (n.pattern) {
    case 'flames': c = 0.5 + 0.5 * Math.cos(b * 2 * th + 2 * Math.sin(ph) + p); break;
    case 'zigzag': {
      const tri = 2 * Math.abs(((turn * f * 2) % 1) - 0.5);
      c = 0.5 + 0.5 * Math.cos(b * ph + (tri - 0.5) * 2.6 + p);
      break;
    }
    case 'spots': c = (0.5 + 0.5 * Math.cos(b * ph + p)) * (0.5 + 0.5 * Math.cos(f * 2 * th + b * ph * 0.5)); break;
    case 'tents': c = 0.5 + 0.5 * Math.cos(f * 2 * th + b * ph + p) * Math.cos(f * 2 * th - b * ph); break;
    default: c = 0.5 + 0.5 * Math.cos(b * ph + p);
  }
  const e0 = 1 - n.bandWidth - 0.05, e1 = 1 - n.bandWidth + 0.05;
  const t = Math.max(0, Math.min(1, (c - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The shell's mesh: its axis up, spire on top, largest extent n.sizeM, base on y = 0, centred on x
 * and z. @param {ShellNumbers} n @param {any} M keepsakes.json shells.mesh
 * @returns {import('../../finds/procedural.js').Mesh}
 */
export function shellMesh(n, M) {
  // Enough steps around each whorl that every rib and spine lands on samples, not between them.
  const steps = Math.max(M.stepsPerWhorl, n.spineLen > 0 ? n.spinePerWhorl * M.samplesPerSpine : 0, n.ribAmp > 0 ? n.ribCount * 4 : 0);
  const rows = Math.max(2, Math.min(M.maxRows, Math.ceil(n.whorls * steps))), cols = M.ringSides;
  const tMax = Math.PI * 2 * n.whorls, kD = (1 + n.D) / (1 - Math.min(0.9, n.D));
  const P = new Float32Array((rows + 1) * cols * 3), C = new Float32Array((rows + 1) * cols * 3);
  const centres = new Float32Array((rows + 1) * 3);
  const side = n.left ? -1 : 1;
  for (let i = 0; i <= rows; i++) {
    const th = (tMax * i) / rows;
    const a = Math.pow(n.W, (th - tMax) / (Math.PI * 2)), Rc = a * kD, yc = -n.T * Rc;
    const ct = Math.cos(th), st = Math.sin(th);
    centres.set([side * Rc * ct, yc, Rc * st], i * 3);
    const rib = n.ribAmp * Math.pow(0.5 + 0.5 * Math.cos(n.ribCount * th), 4);
    // Spines sit at evenly spaced turns; d is how many samples this ring is from the nearest one.
    const q = ((th * n.spinePerWhorl) / (Math.PI * 2)) % 1;
    const d = Math.min(q, 1 - q) * M.samplesPerSpine;
    const spineAt = n.spineLen * Math.exp(-(d / M.spineWidth) * (d / M.spineWidth));
    for (let j = 0; j < cols; j++) {
      const ph = (Math.PI * 2 * j) / cols, cp = Math.cos(ph), sp = Math.sin(ph);
      const cord = n.cordAmp * (0.5 + 0.5 * Math.cos(n.cordCount * ph));
      // Spines stand on the outer shoulder of the whorl, a little above its widest point.
      const shoulder = Math.pow(Math.max(0, Math.cos(ph - 0.6)), M.spineSharpness);
      const m = 1 + rib + cord + spineAt * shoulder;
      // The canal draws the lower half of the aperture down along the axis.
      const stretch = sp < 0 ? 1 + 2 * n.canal * sp * sp : 1;
      const rho = Rc + a * m * cp, y = yc + a * n.S * m * sp * stretch;
      const k = (i * cols + j) * 3;
      P[k] = side * rho * ct; P[k + 1] = y; P[k + 2] = rho * st;
      const w = n.bandCount > 0 ? patternAt(n, th, ph) : 0;
      // The body colour, shifting from the apex colour near the tip to the base colour at the lip.
      const g = n.apex ? Math.min(1, i / (rows * n.apexMix)) : 1;
      const gs = g * g * (3 - 2 * g);
      for (let r = 0; r < 3; r++) {
        const body = n.apex ? n.apex[r] + (n.base[r] - n.apex[r]) * gs : n.base[r];
        C[k + r] = body + (n.band[r] - body) * w;
      }
    }
  }
  // Scale to size and centre on x and z.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < P.length; k += 3) for (let r = 0; r < 3; r++) { lo[r] = Math.min(lo[r], P[k + r]); hi[r] = Math.max(hi[r], P[k + r]); }
  const sc = n.sizeM / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9);
  const mid = [(lo[0] + hi[0]) / 2, 0, (lo[2] + hi[2]) / 2];
  for (let k = 0; k < P.length; k += 3) for (let r = 0; r < 3; r++) P[k + r] = (P[k + r] - mid[r]) * sc;
  for (let k = 0; k < centres.length; k += 3) for (let r = 0; r < 3; r++) centres[k + r] = (centres[k + r] - mid[r]) * sc;

  const b = builder();
  const at = (/** @type {number} */ i, /** @type {number} */ j) => ((i * cols + ((j + cols) % cols)) * 3);
  for (let i = 0; i <= rows; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(rows, i + 1);
    for (let j = 0; j < cols; j++) {
      const k = at(i, j), a0 = at(i0, j), a1 = at(i1, j), p0 = at(i, j - 1), p1 = at(i, j + 1);
      const dt = [P[a1] - P[a0], P[a1 + 1] - P[a0 + 1], P[a1 + 2] - P[a0 + 2]];
      const dp = [P[p1] - P[p0], P[p1 + 1] - P[p0 + 1], P[p1 + 2] - P[p0 + 2]];
      let nx = dt[1] * dp[2] - dt[2] * dp[1], ny = dt[2] * dp[0] - dt[0] * dp[2], nz = dt[0] * dp[1] - dt[1] * dp[0];
      // Outward: away from the aperture's centre on this ring.
      const ox = P[k] - centres[i * 3], oy = P[k + 1] - centres[i * 3 + 1], oz = P[k + 2] - centres[i * 3 + 2];
      if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      b.vert([P[k], P[k + 1], P[k + 2]], [nx, ny, nz], [C[k], C[k + 1], C[k + 2]]);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * cols + j, bb = i * cols + ((j + 1) % cols), c = (i + 1) * cols + j, d = (i + 1) * cols + ((j + 1) % cols);
      // A mirrored (left-coiled) shell keeps its triangles facing out by turning their order.
      if (n.left) { b.tri(a, bb, c); b.tri(bb, d, c); } else { b.tri(a, c, bb); b.tri(bb, c, d); }
    }
  }
  // The apex: close the first, tiny ring to a point.
  const tip = b.vert([centres[0], centres[1], centres[2]], [0, 1, 0], [C[0], C[1], C[2]]);
  for (let j = 0; j < cols; j++) {
    if (n.left) b.tri(tip, (j + 1) % cols, j); else b.tri(tip, j, (j + 1) % cols);
  }
  return b.done();
}
