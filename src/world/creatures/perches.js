// @ts-check
// Lily pads as perches (S6b-3, docs 10, 11): every lily pad where it is this frame (lily-pads.js,
// the same formula the pad drawing uses), so a frog can sit on one and ride it as it swings, bobs
// and turns; which pads are big enough and clear enough to hold a frog; where a seat on a pad is;
// whether a point of water is open or under a pad (a swimming frog ducks under, and floats only in
// open water); and which pads are pressed down by a frog (the pad drawing dips them). Also the
// reed and iris clumps a frog keeps to the edge of. Live look only.

import { padsOf, lilyShape, lilyWind, bobAt, onPad, LAYER_M } from '../growth/lily-pads.js';

/**
 * @typedef {{ key: string, rho: number, phi: number, yawRel: number }} Perch
 *   a seat on a pad: rho (m) out from its centre at angle phi from its notch, the frog turned yawRel
 */

/**
 * @param {{ lily: any, P: any, water: (x: number, z: number) => { surface: number } }} opts
 *   lily: recipes/flora/lilies.json; P: recipes/species/frog.json motion.pads
 */
export function createPerches(opts) {
  const L = lilyShape(opts.lily), P = opts.P;
  /** @type {import('../growth/lily-pads.js').Pad[]} */ let pads = [];
  /** @type {Map<string, import('../growth/lily-pads.js').Pad>} */ let byKey = new Map();
  /** @type {{ x: number, z: number, r: number }[]} */ let clumps = [];
  /** @type {any} */ let wind = lilyWind({ time: 0, wind: 0, windDir: 0 });

  /** The height of a pad's top at a point on it. @param {import('../growth/lily-pads.js').Pad} pad @param {number} x @param {number} z */
  const topAt = (pad, x, z) => opts.water(x, z).surface + L.lift + bobAt(x, z, wind, L) + pad.layer * LAYER_M;

  return {
    /**
     * Where every pad is now, and the clumps to keep to the edge of.
     * @param {{ time: number, wind: number, windDir: number }} u the flora pass's frame
     * @param {any[]} plants state.growth.plants @param {Record<string, any>} flora the flora recipes by id
     */
    update(u, plants, flora) {
      wind = lilyWind(u);
      pads = [];
      clumps = [];
      for (const p of plants ?? []) {
        if (p.sp === 'lilies') { for (const pad of padsOf(p, L, wind)) pads.push(pad); continue; }
        const share = P.clumps?.[p.sp];
        const R = flora?.[p.sp]?.shape?.clumpRadius;
        if (share && R) clumps.push({ x: p.x, z: p.z, r: R * Math.min(1, Math.max(0.3, p.size)) * share });
      }
      byKey = new Map(pads.map((p) => [p.key, p]));
    },

    /** The pads now. */
    all: () => pads,

    /** One pad now by its key, or null if it is gone. @param {string} key */
    padOf: (key) => byKey.get(key) ?? null,

    /** The height of a pad's top at a point on it (the frog lab's outlines). */
    topAt,

    /** Is a land point inside a reed or iris clump (a frog sits at the edge, never in the stems)? @param {number} x @param {number} z */
    inClump: (x, z) => clumps.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < c.r * c.r),

    /** Is a point of water under a pad, or within `margin` of one? @param {number} x @param {number} z @param {number} [margin] */
    underPad: (x, z, margin = 0) => pads.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.radius + margin) ** 2),

    /**
     * A free seat on a pad near (x, z), within reach: a grown pad (minRadiusM), clear of other pads
     * that could cover the seat as they swing, not taken; the nearest such first.
     * @param {number} x @param {number} z @param {number} reach @param {Set<string>} taken pad keys with a frog on or on its way
     * @returns {Perch | null}
     */
    freeSeat(x, z, reach, taken) {
      let best = null, bestD = Infinity;
      for (const pad of pads) {
        if (pad.radius < P.minRadiusM || taken.has(pad.key)) continue;
        const d = Math.hypot(pad.x - x, pad.z - z);
        if (d > reach || d >= bestD) continue;
        // The seat: out from the middle, opposite the notch, the frog facing outward a little askew.
        const rho = Math.min(pad.radius - P.footM, pad.radius * P.seatShare);
        if (rho < 0) continue;
        const sx = pad.x + Math.cos(pad.yaw + Math.PI) * rho, sz = pad.z + Math.sin(pad.yaw + Math.PI) * rho;
        const clear = pads.every((o) => o === pad || o.layer < pad.layer || Math.hypot(o.x - sx, o.z - sz) > o.radius + P.footM + P.clearM);
        if (!clear) continue;
        best = { key: pad.key, rho, phi: Math.PI, yawRel: Math.PI * 0.5 }; bestD = d;
      }
      return best;
    },

    /**
     * Where a frog on a seat is now: on the pad's top, riding its swing, bob and turn; null if the
     * pad is gone (the plant died back, or it shrank too small).
     * @param {Perch} s
     * @returns {{ x: number, y: number, z: number, yaw: number } | null}
     */
    seatOf(s) {
      const pad = byKey.get(s.key);
      if (!pad || pad.radius < P.minRadiusM * 0.8) return null;
      const a = pad.yaw + s.phi;
      const x = pad.x + Math.cos(a) * s.rho, z = pad.z + Math.sin(a) * s.rho;
      // A frog faces along body +z; its yaw turns from +z toward +x, the pad's angle the other way.
      // On the pad as it dips under the frog (about 0.7 of the dip at a seat a quarter way out).
      return { x, y: topAt(pad, x, z) - 0.7 * P.dipM, z, yaw: s.yawRel - pad.yaw };
    },

    /** Is a seat's point still on its pad's leaf? @param {Perch} s */
    onLeaf(s) {
      const pad = byKey.get(s.key);
      if (!pad) return false;
      const a = pad.yaw + s.phi;
      return onPad(pad, pad.x + Math.cos(a) * s.rho, pad.z + Math.sin(a) * s.rho, 0, L.notch);
    },

    /**
     * The pads frogs sit on, for the pad drawing to dip (at most four).
     * @param {{ perch: Perch | null, x: number, z: number }[]} sitters
     */
    pressed(sitters) {
      /** @type {{ u: number, pad: number, dipM: number, bearing: number }[]} */ const out = [];
      for (const s of sitters) {
        if (!s.perch || out.length >= 4) continue;
        const pad = byKey.get(s.perch.key);
        if (!pad) continue;
        out.push({ u: pad.u, pad: pad.pad, dipM: P.dipM, bearing: Math.atan2(s.z - pad.z, s.x - pad.x) });
      }
      return out;
    },
  };
}

/** @typedef {ReturnType<typeof createPerches>} Perches */
