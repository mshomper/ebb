// @ts-check
// The general net in the water (docs/future/12, K6): two driftwood stakes, a top cord sagging
// between them, a woven mesh of rush cord hanging from it, and a cork float at the middle. A full
// net has weed caught in its mesh and its float tipped, so you can tell from a distance that it is
// ready. Built in meters in the creature pass's layout (position, normal, linear albedo), net along
// local x, standing up y, thin along z, its stakes' feet on y = 0. Pure.

const STAKE = [0.3, 0.26, 0.2], CORD = [0.33, 0.3, 0.19], CORK = [0.5, 0.3, 0.13], WEED = [0.1, 0.13, 0.05], WRACK = [0.2, 0.15, 0.05];

/**
 * @param {{ netWidthM: number, netHeightM: number, staveM: number }} L recipes/world/nets.json look
 * @param {boolean} full @returns {{ vertices: Float32Array, indices: Uint32Array, count: number }}
 */
export function netMesh(L, full) {
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  const vert = (/** @type {number[]} */ p, /** @type {number[]} */ n, /** @type {number[]} */ c) => { V.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2]); return V.length / 9 - 1; };

  /** A round rod from a to b. */
  const tube = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ r, /** @type {number[]} */ c, sides = 6) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const t = d.map((x) => x / l);
    // Two directions across the rod.
    const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = u.map((x) => x / ul);
    const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const base = V.length / 9;
    for (const p of [a, b]) for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
      const n = [u[0] * cs + w[0] * sn, u[1] * cs + w[1] * sn, u[2] * cs + w[2] * sn];
      vert([p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n, c);
    }
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      I.push(base + s, base + sides + s, base + s1, base + s1, base + sides + s, base + sides + s1);
    }
  };

  /** A rod through several points. */
  const line = (/** @type {number[][]} */ pts, /** @type {number} */ r, /** @type {number[]} */ c) => { for (let i = 0; i + 1 < pts.length; i++) tube(pts[i], pts[i + 1], r, c, 5); };

  /** A low ball, scaled to an ellipsoid. */
  const blob = (/** @type {number[]} */ c0, /** @type {number[]} */ r, /** @type {number[]} */ c, rows = 5, cols = 8) => {
    const base = V.length / 9;
    for (let i = 0; i <= rows; i++) {
      const th = (i / rows) * Math.PI;
      for (let j = 0; j < cols; j++) {
        const ph = (j / cols) * Math.PI * 2;
        const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        vert([c0[0] + n[0] * r[0], c0[1] + n[1] * r[1], c0[2] + n[2] * r[2]], n, c);
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = base + i * cols + j, b = base + i * cols + ((j + 1) % cols), d = base + (i + 1) * cols + j, e = base + (i + 1) * cols + ((j + 1) % cols);
      I.push(a, d, b, b, d, e);
    }
  };

  const W = L.netWidthM, H = L.netHeightM, half = W / 2, sag = 0.06, cord = 0.0045;
  // The top cord sags in the middle; each row below sags a little less.
  const sagAt = (/** @type {number} */ x, /** @type {number} */ k) => sag * k * (1 - (x / half) ** 2);
  for (const sx of [-half, half]) tube([sx, -0.12, 0], [sx, H + 0.1, 0], L.staveM / 2, STAKE, 7);
  const cols = 9, rows = 5;
  /** Points along a row at height y. */
  const row = (/** @type {number} */ y, /** @type {number} */ k) => Array.from({ length: cols + 1 }, (_, i) => { const x = -half + (i / cols) * W; return [x, y - sagAt(x, k), 0]; });
  line(row(H, 1), cord * 1.5, CORD);
  for (let r = 1; r < rows; r++) line(row(H - (r / rows) * (H - 0.04), 1 - r / rows), cord, CORD);
  for (let i = 1; i < cols; i++) {
    const x = -half + (i / cols) * W;
    tube([x, H - sagAt(x, 1), 0], [x, 0.04, 0], cord, CORD, 5);
  }
  if (!full) {
    blob([0, H - sag + 0.02, 0.01], [0.045, 0.03, 0.03], CORK);
  } else {
    // Full: the float tipped down the cord, and weed caught through the mesh.
    blob([0.12, H - sag + 0.01, 0.02], [0.03, 0.045, 0.03], CORK);
    blob([-0.28, H * 0.55, 0.012], [0.16, 0.05, 0.03], WEED);
    blob([0.2, H * 0.32, -0.01], [0.13, 0.06, 0.025], WRACK);
    blob([-0.05, H * 0.18, 0.015], [0.22, 0.045, 0.03], WEED);
    blob([0.38, H * 0.66, 0.01], [0.07, 0.08, 0.025], WEED);
  }
  return { vertices: new Float32Array(V), indices: new Uint32Array(I), count: V.length / 9 };
}
