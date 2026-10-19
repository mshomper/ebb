// @ts-check
// Where every lily pad is, on the main thread (S6b-3, docs 10, 11): the same placement, swing, bob
// and turn as src/shaders/flora-lilies.wgsl, so a frog can sit on a pad and ride it, a hop can aim
// at where a pad will be, and a swimming frog knows where the pads are. Live look only; plain Math.
// Keep this and the shader in step (a unit test pins it against values worked out by hand from the
// WGSL); the pass's numbers come from flora-kinds.js (lilies pack and the common frame header).

import { hash32 } from '../../core/rng.js';

const TWO_PI = 6.2831853;
/** Pads stack in 16 layers this far apart (LAYER_M in the shader). */
export const LAYER_M = 0.0008;
const STAGE_SEED = 0, STAGE_DORMANT = 5;

/** The shader's hashToFloat: the top 24 bits. @param {number} h */
const u01 = (h) => (h >>> 8) / 16777216;

/**
 * The frame's wind as the lily shader sees it (flora-kinds.js common()): direction the wind blows
 * toward, the clock (seconds, wrapped as the pass wraps it) and strength 0..1.
 * @param {{ time: number, wind: number, windDir: number }} u the flora pass's update()
 */
export function lilyWind(u) {
  return { x: Math.cos(u.windDir), z: -Math.sin(u.windDir), t: u.time % 3600, s: Math.min(1, Math.max(0, u.wind)) };
}

/**
 * The pad numbers from the lily recipe, as the pass packs them (flora-kinds.js lilies.pack).
 * @param {any} r recipes/flora/lilies.json
 */
export function lilyShape(r) {
  return {
    padsMin: r.shape.padsPerPlant[0], padsMax: r.shape.padsPerPlant[1], spread: r.shape.spreadRadius, padR: r.shape.padRadius,
    padVar: r.shape.padVar, notch: (r.shape.notchDeg * Math.PI) / 180, lift: r.look.lift, radiusMin: r.look.radiusMin,
    sproutPads: r.look.sproutPads, dormantPads: r.look.dormantPads, dormantSize: r.look.dormantSize,
    bob: r.wind.bob, turn: (r.wind.turnDeg * Math.PI) / 180, swingM: r.wind.swingM,
    salt: (r.seed >>> 0) % 100000,
  };
}

/**
 * The plant's hash as the shader reads it: hash32(id, 0x51ed) / 2^32 stored as a 32-bit float,
 * times 2^24, as a whole number (growth/index.js packs it; flora-lilies.wgsl unpacks it).
 * @param {number} id
 */
export const plantU = (id) => Math.floor(Math.fround(hash32(id, 0x51ed) / 4294967296) * 16777216) >>> 0;

/** The shader's swing: downwind on the stem, easing with slow gusts, plus a small calm wander. */
function swing(/** @type {number} */ px, /** @type {number} */ pz, /** @type {number} */ reach, /** @type {number} */ h, /** @type {any} */ w, /** @type {any} */ L) {
  const gust = 0.75 + 0.25 * Math.sin(w.t * 0.35 + (px * w.x + pz * w.z) * 0.4);
  const wx = Math.sin(w.t * 0.21 + h * TWO_PI) * 0.25, wz = Math.cos(w.t * 0.17 + h * 4.1) * 0.25;
  return [(w.x * w.s * gust * reach + wx) * L.swingM, (w.z * w.s * gust * reach + wz) * L.swingM];
}

/**
 * The shared swell at a point (the shader's bobAt), metres.
 * @param {number} x @param {number} z @param {any} w lilyWind() @param {any} L lilyShape()
 */
export function bobAt(x, z, w, L) {
  const a = L.bob * (0.3 + w.s);
  return a * (0.6 * Math.sin((x * w.x + z * w.z) * 4 - w.t * 1.3) + 0.4 * Math.sin((-x * w.z + z * w.x) * 3.1 + w.t * 0.9));
}

/**
 * @typedef {Object} Pad
 * @property {string} key       plant id and pad number
 * @property {number} plant @property {number} pad @property {number} u  plantU (for the shader's pressed pads)
 * @property {number} x @property {number} z   centre (world m)
 * @property {number} radius
 * @property {number} yaw       the notch points this way (radians, x = cos, z = sin, as the shader's fan)
 * @property {number} layer     0..15
 */

/**
 * A lily plant's pads now.
 * @param {{ id: number, x: number, z: number, size: number, stage: number }} p a plant (state.growth.plants)
 * @param {any} L lilyShape() @param {any} w lilyWind()
 * @returns {Pad[]}
 */
export function padsOf(p, L, w) {
  const size = Math.min(1, Math.max(0, p.size));
  const seed = p.stage === STAGE_SEED, dormant = p.stage === STAGE_DORMANT;
  const u = plantU(p.id);
  const padsMax = Math.min(L.padsMax, 12);
  const spread = L.spread * (seed ? 0.2 : L.radiusMin + (1 - L.radiusMin) * size);
  let pads = Math.round(L.padsMin + (L.padsMax - L.padsMin) * size);
  let scale = 0.45 + 0.55 * size;
  if (seed) { pads = L.sproutPads; scale = 0.35; }
  if (dormant) { pads = Math.min(pads, L.dormantPads); scale *= L.dormantSize; }
  /** @type {Pad[]} */ const out = [];
  for (let pad = 0; pad < Math.min(pads, padsMax); pad++) {
    const h0 = hash32(u, pad, L.salt), h1 = hash32(h0), h2 = hash32(h1), h3 = hash32(h2);
    const v = [u01(h0), u01(h1), u01(h2), u01(h3)];
    const ang = v[0] * TWO_PI;
    const r = spread * Math.sqrt(v[1]) * (pad === 0 ? 0.3 : 1);
    const sw = swing(p.x, p.z, 0.7 + 0.3 * v[2], v[3], w, L);
    const sway = w.s * Math.sin(w.t * 0.7 + v[3] * TWO_PI);
    out.push({
      key: `${p.id}:${pad}`, plant: p.id, pad, u,
      x: p.x + Math.cos(ang) * r + sw[0], z: p.z + Math.sin(ang) * r + sw[1],
      radius: L.padR * scale * (1 - L.padVar * 0.5 + L.padVar * v[2]),
      yaw: v[3] * TWO_PI + L.turn * sway,
      layer: (pad * 5 + u) % 16,
    });
  }
  return out;
}

/**
 * Is a point over a pad's leaf (inside its rim, outside its notch)?
 * @param {Pad} pad @param {number} x @param {number} z @param {number} [margin] keep this far inside the rim
 * @param {number} [notch] the notch's full angle
 */
export function onPad(pad, x, z, margin = 0, notch = 0.52) {
  const dx = x - pad.x, dz = z - pad.z, d = Math.hypot(dx, dz);
  if (d > pad.radius - margin) return false;
  if (d < 1e-6) return true;
  // The notch is the wedge either side of the pad's yaw.
  let a = Math.atan2(dz, dx) - pad.yaw;
  a -= Math.round(a / TWO_PI) * TWO_PI;
  return Math.abs(a) > notch / 2 + Math.asin(Math.min(1, margin / Math.max(d, margin)));
}
