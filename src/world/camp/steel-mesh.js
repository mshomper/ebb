// @ts-check
// The fire steel and its flint (docs/future/13 resolution 22, C-27): the walker's small striker, a
// C-shaped bar of forged steel held in the right hand, and a sharp shard of flint in the left. They
// show only while the walker strikes a light. Built in meters in the props pass's layout (position,
// normal, uv: 8 floats a vertex), origin at the grip, the steel's C opening toward +z. Pure.

/** @typedef {{ data: Float32Array, indices: Uint32Array }} PropMesh */

/**
 * The steel: a flat bar swept round a C (its two ends curl back a little, as old strikers do).
 * @param {{ radiusM?: number, barM?: number, thickM?: number, openDeg?: number, steps?: number }} [o]
 * @returns {PropMesh}
 */
export function steelMesh(o = {}) {
  const r = o.radiusM ?? 0.026, w = o.barM ?? 0.009, t = o.thickM ?? 0.004, open = ((o.openDeg ?? 70) * Math.PI) / 180, n = o.steps ?? 28;
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  // The bar's cross-section: four corners (radial, height) and the outward normal of each face.
  const corners = [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]];
  for (let face = 0; face < 4; face++) {
    const a = corners[face], b = corners[(face + 1) % 4];
    const base = V.length / 8;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const ang = open / 2 + s * (2 * Math.PI - open);
      // The ends curl inward: a little less radius near them.
      const rr = r * (1 - 0.18 * Math.pow(Math.abs(s * 2 - 1), 6));
      const cx = Math.sin(ang), cz = Math.cos(ang);
      for (const [q, k] of [[a, 0], [b, 1]]) {
        const rad = rr + /** @type {number[]} */ (q)[0], y = /** @type {number[]} */ (q)[1];
        // Face normal in the section: radial for the outer and inner faces, up or down for the flats.
        const nr = face === 1 ? 1 : face === 3 ? -1 : 0, ny = face === 2 ? 1 : face === 0 ? -1 : 0;
        V.push(cx * rad, y, cz * rad, cx * nr, ny, cz * nr, s, /** @type {number} */ (k));
      }
    }
    for (let i = 0; i < n; i++) {
      const v = base + i * 2;
      I.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}

/**
 * The flint: a small knapped shard, a squashed double pyramid with an uneven edge.
 * @param {number} [sizeM] its length @returns {PropMesh}
 */
export function flintMesh(sizeM = 0.032) {
  const ring = [[1, 0.1, 0.2], [0.45, -0.05, 0.85], [-0.5, 0.05, 0.7], [-1, -0.1, -0.05], [-0.4, 0.08, -0.8], [0.5, -0.06, -0.65]];
  const top = [0.05, 0.42, 0.05], bottom = [-0.08, -0.36, 0];
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  const s = sizeM / 2;
  /** A flat-shaded triangle. @param {number[]} a @param {number[]} b @param {number[]} c */
  const tri = (a, b, c) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const k = V.length / 8;
    for (const p of [a, b, c]) V.push(p[0] * s, p[1] * s, p[2] * s, nx, ny, nz, p[0] * 0.5 + 0.5, p[2] * 0.5 + 0.5);
    I.push(k, k + 1, k + 2);
  };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    tri(top, b, a);
    tri(bottom, a, b);
  }
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}
