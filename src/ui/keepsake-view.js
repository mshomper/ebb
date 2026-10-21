// @ts-check
// A keepsake turned in the hand (docs/future/12): its mesh painted onto a 2D canvas, fitted to it,
// with one soft light from the upper left that turns with the view. A painter's sort is plenty for
// one small object; the shelf's card and tools/keepsake-lab.html use it.

const toSrgb = (/** @type {number} */ c) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));

/**
 * Paint a mesh into a canvas, fitted to it. @param {HTMLCanvasElement} cv
 * @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} m @param {number} yaw @param {number} pitch
 * @param {number} [bright] how much the lit colour is lifted
 */
export function drawMesh(cv, m, yaw, pitch, bright = 1.15) {
  const W = (cv.width = Math.round(cv.clientWidth * devicePixelRatio)), H = (cv.height = W);
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.clearRect(0, 0, W, H);
  const V = m.vertices;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.count; i++) for (let r = 0; r < 3; r++) { lo[r] = Math.min(lo[r], V[i * 9 + r]); hi[r] = Math.max(hi[r], V[i * 9 + r]); }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const sc = (W * 0.62) / ext;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const P = new Float32Array(m.count * 3);
  for (let i = 0; i < m.count; i++) {
    const x = V[i * 9] - c[0], y = V[i * 9 + 1] - c[1], z = V[i * 9 + 2] - c[2];
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    P[i * 3] = W / 2 + x1 * sc; P[i * 3 + 1] = H / 2 - y2 * sc; P[i * 3 + 2] = z2;
  }
  const I = m.indices, nt = I.length / 3;
  const order = new Uint32Array(nt), depth = new Float32Array(nt);
  for (let t = 0; t < nt; t++) { order[t] = t; depth[t] = P[I[t * 3] * 3 + 2] + P[I[t * 3 + 1] * 3 + 2] + P[I[t * 3 + 2] * 3 + 2]; }
  order.sort((a, b) => depth[a] - depth[b]);
  // The light turns with the view so the keepsake is always lit from the upper left.
  const Lv = [-0.45, 0.75, 0.5];
  const L = [cy * Lv[0] - sy * (sp * Lv[1] + cp * Lv[2]), cp * Lv[1] - sp * Lv[2], sy * Lv[0] + cy * (sp * Lv[1] + cp * Lv[2])];
  g.lineJoin = 'round';
  g.lineWidth = 0.6;
  for (const t of order) {
    const a = I[t * 3], b = I[t * 3 + 1], d = I[t * 3 + 2];
    const n = [0, 1, 2].map((k) => V[a * 9 + 3 + k] + V[b * 9 + 3 + k] + V[d * 9 + 3 + k]);
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    // Both sides are drawn (an aperture shows its inside), so light the side that faces the light.
    const lit = 0.38 + 0.62 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
    const col = [0, 1, 2].map((k) => toSrgb(((V[a * 9 + 6 + k] + V[b * 9 + 6 + k] + V[d * 9 + 6 + k]) / 3) * lit * bright));
    g.fillStyle = g.strokeStyle = `rgb(${col.join(',')})`;
    g.beginPath(); g.moveTo(P[a * 3], P[a * 3 + 1]); g.lineTo(P[b * 3], P[b * 3 + 1]); g.lineTo(P[d * 3], P[d * 3 + 1]); g.closePath(); g.fill(); g.stroke();
  }
}

/**
 * The paper ground of a shelf slot for a rarity, as CSS (keepsakes.json shelf.grounds).
 * @param {any} K keepsakes.json @param {string} rarity
 */
export function groundCss(K, rarity) {
  const G = K.shelf.grounds[rarity] ?? K.shelf.grounds.common;
  let css = `background: linear-gradient(170deg, ${G.top}, ${G.bottom}); border: ${G.borderPx}px solid ${G.border};`;
  if (G.gilt) css += ` box-shadow: inset 0 0 0 2px ${G.gilt}, inset 0 0 0 3px ${G.border};`;
  return css;
}
