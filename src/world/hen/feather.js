// @ts-check
// The hen's tail feather (docs/future/15, slice 2b): once she is Fond, one morning she leaves a tail
// feather by the fire ring (trust.js lays it in the hourly tick; this file draws it and gives its
// card). Taking it up gives the hen-feather hat band: a paint round the walker's hat crown
// (figure-draw.wgsl, recipes/world/figure.json hatBand) and a small always-on boon, every creature a
// little calmer near you (fond.calmK on their wary rings, through presence's ringK).
//
// Where it lies: fond.feather.ringM from the ring, turned turnDeg round from the side toward her
// scrub; with no ring laid, by her scrub. The gift stone (B1 C1, built beside this) can take it over:
// `useGiftPlace(fn)` names a spot (its top) and the feather lies there instead. Numbers:
// recipes/species/hen.json fond.feather.

/** @typedef {{ data: Float32Array, indices: Uint32Array }} PropMesh */

/**
 * A tail feather lying on its side, in the props pass's layout (position, normal, uv: 8 floats a
 * vertex), quill along +z from the origin, the vane narrower on one side and arched a little off the
 * ground. Drawn both ways up (two layers), so it shows from any side. Pure.
 * @param {{ lengthM: number, widthM: number, bendM: number, archM: number }} F recipes/species/hen.json fond.feather
 * @param {number} [steps] @returns {PropMesh}
 */
export function featherMesh(F, steps = 14) {
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  for (const up of [1, -1]) {
    const base = V.length / 8;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const z = F.lengthM * t, cx = F.bendM * t * t, y = F.archM * Math.sin(Math.PI * t) + (up > 0 ? 0.002 : 0.0015);
      // The bare quill at the base, the vane widest past the middle, rounded to the tip.
      const vane = t < 0.12 ? 0 : Math.sin(Math.PI * Math.min(1, (t - 0.12) / 0.88) ** 0.7);
      const wl = F.widthM * 0.38 * vane, wr = F.widthM * 0.62 * vane;
      for (const [x, u] of [[cx - wl, 0], [cx, 0.5], [cx + wr, 1]]) V.push(x, y, z, 0, up, 0, u, t);
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 3;
      for (const [p, q, r] of [[a, a + 3, a + 1], [a + 1, a + 3, a + 4], [a + 1, a + 4, a + 2], [a + 2, a + 4, a + 5]]) {
        if (up > 0) I.push(p, q, r); else I.push(p, r, q);
      }
    }
  }
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * Where the feather lies: by the ring (or the gift stone's spot, or her scrub). Pure.
 * @param {any} F recipes/species/hen.json fond.feather @param {{ x: number, z: number } | null} ring
 * @param {{ x: number, z: number }} home her scrub's middle @param {{ x: number, z: number } | null} [gift] the gift stone's spot
 * @returns {{ x: number, z: number, yaw: number }}
 */
export function featherSpot(F, ring, home, gift = null) {
  if (gift) return { x: gift.x, z: gift.z, yaw: F.yawDeg * Math.PI / 180 };
  if (!ring) return { x: home.x + F.ringM, z: home.z, yaw: F.yawDeg * Math.PI / 180 };
  const a = Math.atan2(home.x - ring.x, home.z - ring.z) + (F.turnDeg * Math.PI) / 180;
  return { x: ring.x + Math.sin(a) * F.ringM, z: ring.z + Math.cos(a) * F.ringM, yaw: a + (F.yawDeg * Math.PI) / 180 };
}

/**
 * The feather's card (a tap on it): its words, and Take it up (registered by the app with the card
 * actions). @param {{ x: number, z: number }} at @param {any} W recipes/species/hen.json fond.feather.words
 */
export const featherCard = (at, W) => ({ sp: 'hen-feather', feather: true, name: W.card, sub: null, icon: 'feather', text: W.line,
  wx: at.x, wz: at.z, r: 0.3, stage: -1, noPage: true });
