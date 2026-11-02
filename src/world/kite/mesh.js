// @ts-check
// The kite's meshes, baked in code (docs/future/20, 'The kite'): a spine and a spar of stick, a
// diamond of cloth on both faces, a tail of small bows down from its foot. Torn, a quarter of the
// cloth is gone to a ragged flap and a loop of its line lies tangled beside it. The line itself is a
// thin rod 0..1 along +z, laid segment by segment by its bone. In meters, the kite's face in its own
// x-y plane facing +z, the spar's crossing at the origin. Vertex albedo is linear (docs/05). Pure.

/** @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array }} Mesh */

/** @param {number[]} a @param {number[]} b */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {number[]} a */
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function builder() {
  /** @type {number[]} */ const v = [];
  /** @type {number[]} */ const idx = [];
  return {
    /** A tapered-free rod from a to b, radius r, six sides. @param {number[]} a @param {number[]} b @param {number} r @param {number[]} col */
    rod(a, b, r, col) {
      const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const s1 = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), s2 = cross(s1, d);
      const first = v.length / 9, A = 6;
      for (const c of [a, b]) for (let j = 0; j < A; j++) {
        const t = (j / A) * Math.PI * 2, n = [s1[0] * Math.cos(t) + s2[0] * Math.sin(t), s1[1] * Math.cos(t) + s2[1] * Math.sin(t), s1[2] * Math.cos(t) + s2[2] * Math.sin(t)];
        v.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, n[0], n[1], n[2], col[0], col[1], col[2]);
      }
      for (let j = 0; j < A; j++) {
        const p = first + j, q = first + ((j + 1) % A);
        idx.push(p, q, p + A, q, q + A, p + A);
      }
    },
    /** A triangle on both faces (front toward +z of its own winding). @param {number[][]} t @param {number[]} col @param {number[]} back */
    tri(t, col, back) {
      const n = norm(cross([t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]]));
      const off = 0.0025;
      for (const [s, c] of /** @type {[number, number[]][]} */ ([[1, col], [-1, back]])) {
        const first = v.length / 9;
        for (const p of t) v.push(p[0] + n[0] * off * s, p[1] + n[1] * off * s, p[2] + n[2] * off * s, n[0] * s, n[1] * s, n[2] * s, c[0], c[1], c[2]);
        if (s > 0) idx.push(first, first + 1, first + 2); else idx.push(first, first + 2, first + 1);
      }
    },
    /** @returns {Mesh} */
    done() { return { vertices: new Float32Array(v), count: v.length / 9, indices: new Uint32Array(idx) }; },
  };
}

/**
 * The kite, whole or torn. @param {any} K kite.json look @param {boolean} torn
 * @returns {Mesh}
 */
export function kiteMesh(K, torn) {
  const b = builder();
  const S = K.spanM, top = [0, S * K.crossAt, 0], foot = [0, -S * (1 - K.crossAt), 0];
  const left = [-K.crossM / 2, 0, 0], right = [K.crossM / 2, 0, 0], mid = [0, 0, 0];
  // The sticks, just behind the cloth.
  b.rod([top[0], top[1] + 0.01, -0.006], [foot[0], foot[1] - 0.01, -0.006], K.stickR, K.stick);
  b.rod([left[0] - 0.01, 0, -0.012], [right[0] + 0.01, 0, -0.012], K.stickR * 0.85, K.stick);
  // The cloth: four panels round the crossing (wound to face +z).
  b.tri([mid, top, left], K.cloth, K.clothBack);
  b.tri([mid, right, top], K.cloth, K.clothBack);
  b.tri([mid, left, foot], K.cloth, K.clothBack);
  if (torn) {
    // A ragged flap left of the lower right panel, the rest of it gone.
    const lerp = (/** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number} */ s) => [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, 0];
    const a = lerp(mid, right, 0.55), c = lerp(mid, foot, 0.7), m = [K.crossM * 0.1, -S * 0.22, 0];
    b.tri([mid, a, m], K.cloth, K.clothBack);
    b.tri([mid, m, c], K.cloth, K.clothBack);
    // A loop of its line, tangled beside it.
    const n = 10, r = K.loopR, cx = right[0] + r * 0.6, cy = -S * 0.3;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
      const w0 = 1 + 0.25 * Math.sin(t0 * 3), w1 = 1 + 0.25 * Math.sin(t1 * 3);
      b.rod([cx + Math.cos(t0) * r * w0, cy + Math.sin(t0) * r * w0, -0.004], [cx + Math.cos(t1) * r * w1, cy + Math.sin(t1) * r * w1, -0.004], K.lineR, K.line);
    }
    b.rod(right, [cx + r, cy, -0.004], K.lineR, K.line);
  } else {
    b.tri([mid, foot, right], K.cloth, K.clothBack);
  }
  // The tail: a thin cord down from the foot, with small bows tied along it.
  const tailEnd = [foot[0], foot[1] - K.tailGapM * (K.tailBows + 0.5), -0.004];
  b.rod(foot, tailEnd, K.lineR, K.tail);
  for (let i = 1; i <= K.tailBows; i++) {
    const y = foot[1] - K.tailGapM * i, w = K.bowM, h = K.bowM * 0.45, c = [0, y, 0];
    b.tri([c, [-w, y + h, 0], [-w, y - h, 0]], K.tail, K.tail);
    b.tri([c, [w, y - h, 0], [w, y + h, 0]], K.tail, K.tail);
  }
  return b.done();
}

/** The line: a thin rod from 0 to 1 along +z (its bone stretches it to each segment). @param {any} K kite.json look */
export function lineMesh(K) {
  const b = builder();
  b.rod([0, 0, 0], [0, 0, 1], K.lineR, K.line);
  return b.done();
}
