// @ts-check
// The moth for the move effects (tools/arena/fx-pass.js), made in code at a wingspan of 1 m (the draw
// scales it to each moth's size): a slim fuzzy body, two broad rounded forewings and two smaller
// rounded hindwings as flat fans from the wing root, and two short feathered antennae as thin quads.
// Local space: +z the heading, +y up, the right wings on +x. Triangles, unindexed, MOTH_VERTEX_FLOATS
// a vertex: position, normal, aux (wings: the wing's own x, z and how far out from the root, 0..1;
// antennae: across -1..1, along 0..1), part (0 body, 1 forewing, 2 hindwing, 3 antenna).

export const MOTH_VERTEX_FLOATS = 10;
/** Where the wings hinge, above the body's axis (m at a 1 m wingspan). */
export const MOTH_HINGE_Y = 0.02;

/** Chaikin's corner cutting on an open outline (keeps its two ends). @param {number[][]} pts @param {number} times */
function smooth(pts, times) {
  let p = pts;
  for (let t = 0; t < times; t++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [a, b] = [p[i], p[i + 1]];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// The right wings' outlines (x out from the body, z forward), root front round to root back.
const FORE = [[0.04, 0.12], [0.16, 0.135], [0.3, 0.11], [0.43, 0.06], [0.5, 0.0], [0.49, -0.07], [0.44, -0.14], [0.36, -0.19],
  [0.27, -0.2], [0.17, -0.15], [0.08, -0.06], [0.04, 0.0]];
const HIND = [[0.04, 0.02], [0.13, 0.0], [0.24, -0.04], [0.3, -0.1], [0.29, -0.18], [0.22, -0.25], [0.13, -0.24], [0.07, -0.16], [0.04, -0.08]];

/** @returns {{ data: Float32Array, vertices: number }} */
export function buildMothMesh() {
  /** @type {number[]} */ const v = [];
  /** @param {number[]} p @param {number[]} n @param {number[]} a @param {number} part */
  const put = (p, n, a, part) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], a[0], a[1], a[2], part);

  // The body: a six-sided tube along z, flattened a little, tapering to the abdomen's tip and the head.
  const rings = [[-0.25, 0], [-0.2, 0.024], [-0.12, 0.038], [-0.04, 0.044], [0.02, 0.054], [0.1, 0.056], [0.15, 0.046], [0.18, 0.04], [0.215, 0]];
  const SIDES = 6;
  /** @param {number} r @param {number} k */
  const ringPt = (r, k) => { const a = (k / SIDES) * Math.PI * 2; return [Math.cos(a), Math.sin(a) * 0.85]; };
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < SIDES; k++) {
    const [z0, r0] = rings[j], [z1, r1] = rings[j + 1];
    const c = [ringPt(0, k), ringPt(0, k + 1)];
    /** @param {number} z @param {number} r @param {number[]} d */
    const pt = (z, r, d) => [d[0] * r, d[1] * r, z];
    /** @param {number[]} d */
    const nn = (d) => { const l = Math.hypot(d[0], d[1] / 0.85); return [d[0] / l, d[1] / 0.85 / l, 0]; };
    const quad = [[z0, r0, c[0]], [z1, r1, c[0]], [z1, r1, c[1]], [z0, r0, c[0]], [z1, r1, c[1]], [z0, r0, c[1]]];
    for (const [z, r, d] of /** @type {[number, number, number[]][]} */ (quad)) put(pt(z, r, d), nn(d), [0, 0, 0], 0);
  }

  // The wings: fans from the root's middle, both sides, the hindwings a touch below the forewings.
  for (const [outline, part, dy] of /** @type {[number[][], number, number][]} */ ([[FORE, 1, 0], [HIND, 2, -0.006]])) {
    const o = smooth(outline, 2);
    const root = [(o[0][0] + o[o.length - 1][0]) * 0.5, (o[0][1] + o[o.length - 1][1]) * 0.5];
    for (const side of [1, -1]) for (let i = 0; i < o.length - 1; i++) {
      for (const [p, t] of /** @type {[number[], number][]} */ ([[root, 0], [o[i], 1], [o[i + 1], 1]])) {
        put([p[0] * side, MOTH_HINGE_Y + dy, p[1]], [0, 1, 0], [p[0], p[1], t], part);
      }
    }
  }

  // The antennae: thin quads out and up from the head, feathered by the shader.
  for (const side of [1, -1]) {
    const a = [0.015 * side, 0.03, 0.19], b = [0.11 * side, 0.09, 0.35];
    const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz), w = 0.016;
    const s = [(dz / l) * w, 0, (-dx / l) * w];
    const corner = (/** @type {number[]} */ p, /** @type {number} */ k) => [p[0] + s[0] * k, p[1], p[2] + s[2] * k];
    const q = /** @type {[number[], number, number][]} */ ([[a, -1, 0], [b, -1, 1], [b, 1, 1], [a, -1, 0], [b, 1, 1], [a, 1, 0]]);
    for (const [p, k, t] of q) put(corner(p, k), [0, 1, 0], [k, t, 1], 3);
  }
  return { data: new Float32Array(v), vertices: v.length / MOTH_VERTEX_FLOATS };
}
