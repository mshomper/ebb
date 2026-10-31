// @ts-check
// Which small lights are drawn (doc 06, Lanterns and small lights). The shaders loop over at most
// MAX_POINT_LIGHTS (src/render/lighting.js, common.wgsl); the island can have more (the fire, the
// hand lantern, the furnace, placed lanterns, the passing boat, fireflies later). Each frame every
// light is scored by how much it matters to the view, its intensity over its squared distance to
// the eye, and any whose reach ends short of what you are looking at is left out. The best keep
// their places. A light coming in or going out fades over fadeS, so nothing pops; one fading out
// keeps its place until it is dark, so the drawn count never passes the limit. Lights are told
// apart by `key` (camp-fire, lantern:<id>, ...). Pure apart from the fade's memory. Numbers:
// recipes/world/small-lights.json.

/**
 * @typedef {{ x: number, y: number, z: number, rangeM: number, cd: number, rgb: ArrayLike<number>, key?: string }} Light
 * @typedef {{ max: number, fadeS: number, viewReachM: number }} PickRecipe
 */

/** A light's importance to an eye: its intensity (luminance-weighted) over its squared distance, 1 m held. @param {Light} l @param {ArrayLike<number>} eye */
export function lightScore(l, eye) {
  const lum = (l.rgb[0] * 0.2126 + l.rgb[1] * 0.7152 + l.rgb[2] * 0.0722) * l.cd;
  const d2 = (l.x - eye[0]) ** 2 + (l.y - eye[1]) ** 2 + (l.z - eye[2]) ** 2;
  return lum / Math.max(1, d2);
}

/** Can a light's reach touch what the view looks at (within viewReachM of it)? @param {Light} l @param {ArrayLike<number>} target @param {number} reachM */
export const reachesView = (l, target, reachM) => Math.hypot(l.x - target[0], l.z - target[2]) <= l.rangeM + reachM;

/**
 * A picker that remembers each light's fade. @param {PickRecipe} R @param {number} cap the most the
 * shaders take (MAX_POINT_LIGHTS)
 */
export function createLightPicker(R, cap) {
  const max = Math.max(0, Math.min(cap, R.max));
  /** How far in each light is, 0..1, by key. @type {Map<string, number>} */
  const fade = new Map();
  return {
    /**
     * The lights to draw this frame, their intensity scaled by their fade, at most max.
     * @param {Light[]} list @param {ArrayLike<number>} eye @param {ArrayLike<number>} target @param {number} dt real seconds
     * @returns {Light[]}
     */
    pick(list, eye, target, dt) {
      const step = R.fadeS > 0 ? dt / R.fadeS : 1;
      const lit = list.filter((l) => l.cd > 0 && l.rangeM > 0).map((l, i) => ({ l, key: l.key ?? `light:${i}` }));
      const byKey = new Map(lit.map((e) => [e.key, e]));
      const ranked = lit.filter((e) => reachesView(e.l, target, R.viewReachM)).sort((a, b) => lightScore(b.l, eye) - lightScore(a.l, eye) || (a.key < b.key ? -1 : 1));
      const want = new Set(ranked.slice(0, max).map((e) => e.key));
      // Those going out still hold their places until dark; the rest go to the best wanted.
      // A light that is gone (a lantern taken up, the fire out) goes at once: there is nothing left to fade.
      for (const k of [...fade.keys()]) if (!byKey.has(k)) fade.delete(k);
      const leaving = [...fade.keys()].filter((k) => !want.has(k));
      let room = max - fade.size;
      /** @type {Set<string>} */ const shown = new Set(leaving);
      for (const e of ranked) {
        if (!want.has(e.key)) continue;
        if (fade.has(e.key) || room > 0) { shown.add(e.key); if (!fade.has(e.key)) room--; }
      }
      for (const k of shown) {
        const w = fade.get(k) ?? 0, next = want.has(k) ? Math.min(1, w + step) : w - step;
        if (next <= 0 && !want.has(k)) fade.delete(k); else fade.set(k, Math.max(0, next));
      }
      for (const k of [...fade.keys()]) if (!shown.has(k)) fade.delete(k);
      /** @type {Light[]} */ const out = [];
      for (const [k, w] of fade) {
        const e = byKey.get(k);
        if (e && w > 0) out.push({ ...e.l, key: k, cd: e.l.cd * w });
      }
      return out.slice(0, max);
    },
    /** How far in each light is (tests). */
    fades: () => new Map(fade),
  };
}
