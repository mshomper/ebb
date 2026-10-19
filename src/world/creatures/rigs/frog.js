// @ts-check
// The frog rig (S6b, docs 11, 14): which bones a frog has and where each one pivots, read from the
// body pieces (prims) in recipes/species/frog.json, never typed in; and how the named proportions
// (body.shape) reshape those pieces before the bake. At every proportion 1 the pieces come back
// exactly as the recipe holds them. Pure and worker-safe.

/**
 * @typedef {{ name: string, parent: number, pivot: (P: Record<string, any>) => number[] }} BoneDef
 *   P maps a bone name to its prim
 */

/** A piece's end point. @param {any} q @param {'a'|'b'} end */
const endOf = (q, end) => q[end].slice();

/** The bones, parents first. The throat pivots at the top of the sac, so it swells down. @type {BoneDef[]} */
export const FROG_BONES = [
  { name: 'torso', parent: -1, pivot: (P) => [0, 0, P.torso.c[2]] },
  { name: 'head', parent: 0, pivot: (P) => endOf(P.head, 'a') },
  { name: 'eye.l', parent: 1, pivot: (P) => P['eye.l'].c.slice() },
  { name: 'eye.r', parent: 1, pivot: (P) => P['eye.r'].c.slice() },
  { name: 'throat', parent: 1, pivot: (P) => [P.throat.c[0], P.throat.c[1] + P.throat.r[1], P.throat.c[2]] },
  { name: 'thigh.l', parent: 0, pivot: (P) => endOf(P['thigh.l'], 'a') },
  { name: 'shank.l', parent: 5, pivot: (P) => endOf(P['shank.l'], 'a') },
  { name: 'foot.l', parent: 6, pivot: (P) => endOf(P['foot.l'], 'a') },
  { name: 'arm.l', parent: 0, pivot: (P) => endOf(P['arm.l'], 'a') },
  { name: 'forearm.l', parent: 8, pivot: (P) => endOf(P['forearm.l'], 'a') },
  { name: 'thigh.r', parent: 0, pivot: (P) => endOf(P['thigh.r'], 'a') },
  { name: 'shank.r', parent: 10, pivot: (P) => endOf(P['shank.r'], 'a') },
  { name: 'foot.r', parent: 11, pivot: (P) => endOf(P['foot.r'], 'a') },
  { name: 'arm.r', parent: 0, pivot: (P) => endOf(P['arm.r'], 'a') },
  { name: 'forearm.r', parent: 13, pivot: (P) => endOf(P['forearm.r'], 'a') },
];

/** The proportions the rig knows, each 1 for the body as the recipe holds it. */
export const FROG_SHAPE_KEYS = Object.freeze(['torsoLen', 'torsoWid', 'torsoHgt', 'headSize', 'eyeSize', 'sacSize', 'hindThick']);

/** Every point a piece is placed by. @param {any} q */
const pointsOf = (q) => (q.c ? [q.c] : [q.a, q.b]);

/** Scale a radius (a number or a list) by s. @param {any} r @param {number} s */
const scaleR = (r, s) => (Array.isArray(r) ? r.map((x) => x * s) : r * s);

/**
 * The body pieces reshaped by the proportions. A proportion of exactly 1 leaves every number as it
 * was (nothing is multiplied), so the recipe's own body comes back unchanged.
 * @param {any[]} prims recipes/species/frog.json body.prims
 * @param {Record<string, number>} shape body.shape, varied per body variant
 * @returns {any[]} new prims (the input is not changed)
 */
export function shapeFrogPrims(prims, shape) {
  const out = prims.map((q) => structuredClone(q));
  /** @type {Record<string, any>} */ const P = {};
  for (const q of out) P[q.part ?? q.bone] = q;
  const s = (/** @type {string} */ k) => shape?.[k] ?? 1;

  // The torso stretches from the ground under its middle; the head and limbs ride with it.
  const W = s('torsoWid'), H = s('torsoHgt'), L = s('torsoLen');
  if (W !== 1 || H !== 1 || L !== 1) {
    const z0 = P.torso.c[2];
    for (const q of out) {
      for (const p of pointsOf(q)) {
        if (W !== 1) p[0] *= W;
        if (H !== 1) p[1] *= H;
        if (L !== 1) p[2] = z0 + (p[2] - z0) * L;
      }
    }
    P.torso.r = [P.torso.r[0] * W, P.torso.r[1] * H, P.torso.r[2] * L];
  }
  // The head grows about where it joins the body; the eyes and the throat sit on it and follow.
  const hs = s('headSize');
  if (hs !== 1) {
    const a = P.head.a;
    P.head.b = P.head.b.map((v, i) => a[i] + (v - a[i]) * hs);
    P.head.ra *= hs;
    P.head.rb *= hs;
    for (const name of ['eye.l', 'eye.r', 'lid.l', 'lid.r', 'throat']) {
      const q = P[name];
      if (!q) continue;
      q.c = q.c.map((/** @type {number} */ v, /** @type {number} */ i) => a[i] + (v - a[i]) * hs);
      q.r = scaleR(q.r, hs);
    }
  }
  // Each eye grows about its middle; its lid (if any) grows and moves with it.
  const es = s('eyeSize');
  if (es !== 1) {
    for (const side of ['l', 'r']) {
      const eye = P[`eye.${side}`], lid = P[`lid.${side}`];
      eye.r = scaleR(eye.r, es);
      if (lid) {
        lid.c = lid.c.map((/** @type {number} */ v, /** @type {number} */ i) => eye.c[i] + (v - eye.c[i]) * es);
        lid.r = scaleR(lid.r, es);
      }
    }
  }
  const ss = s('sacSize');
  if (ss !== 1) P.throat.r = scaleR(P.throat.r, ss);
  const ht = s('hindThick');
  if (ht !== 1) for (const side of ['l', 'r']) for (const part of ['thigh', 'shank', 'foot']) P[`${part}.${side}`].r = scaleR(P[`${part}.${side}`].r, ht);
  return out;
}
