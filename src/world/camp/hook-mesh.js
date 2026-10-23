// @ts-check
// The lantern's hook (docs/future/13 C-15; Phase 1 fix F2): a loop of cord round the tent's front
// pole crossing, and the cord down from it to the lantern's handle, so the lantern hangs from the
// pole and reads as attached from every side. Built in the tent model's frame (meters, +z the flap)
// in the props pass's layout (position, normal, uv: 8 floats a vertex). Pure.

/** @typedef {{ data: Float32Array, indices: Uint32Array }} PropMesh */

/**
 * @param {{ at: number[], to: number[], loopM?: number, cordM?: number, sides?: number, loopSteps?: number }} o
 *   at: where the loop sits round the pole (the crossing); to: the lantern's handle top, under it
 *   loopM: the loop's radius; cordM: the cord's thickness
 * @returns {PropMesh}
 */
export function hookMesh(o) {
  const r = o.loopM ?? 0.03, t = (o.cordM ?? 0.007) / 2, sides = o.sides ?? 6, steps = o.loopSteps ?? 16;
  /** @type {number[]} */ const V = [];
  /** @type {number[]} */ const I = [];
  /**
   * A tube along a path of points: rings of `sides` round each point, faces between them.
   * @param {number[][]} path @param {boolean} closed
   */
  const tube = (path, closed) => {
    const base = V.length / 8, n = path.length;
    for (let i = 0; i < n; i++) {
      const p = path[i], q = path[(i + 1) % n], pr = path[(i - 1 + n) % n];
      const a = closed || (i > 0 && i < n - 1) ? [q[0] - pr[0], q[1] - pr[1], q[2] - pr[2]] : i === 0 ? [q[0] - p[0], q[1] - p[1], q[2] - p[2]] : [p[0] - pr[0], p[1] - pr[1], p[2] - pr[2]];
      const al = Math.hypot(a[0], a[1], a[2]) || 1;
      const d = [a[0] / al, a[1] / al, a[2] / al];
      // Two axes across the path: from any vector not along it.
      const ref = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
      const ul = Math.hypot(u[0], u[1], u[2]) || 1;
      u = [u[0] / ul, u[1] / ul, u[2] / ul];
      const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * 2 * Math.PI, c = Math.cos(ang), s = Math.sin(ang);
        const nx = u[0] * c + w[0] * s, ny = u[1] * c + w[1] * s, nz = u[2] * c + w[2] * s;
        V.push(p[0] + nx * t, p[1] + ny * t, p[2] + nz * t, nx, ny, nz, i / n, k / sides);
      }
    }
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) for (let k = 0; k < sides; k++) {
      const a = base + i * sides + k, b = base + i * sides + ((k + 1) % sides);
      const c = base + ((i + 1) % n) * sides + k, e = base + ((i + 1) % n) * sides + ((k + 1) % sides);
      I.push(a, c, b, b, c, e);
    }
  };
  // The loop round the pole: in the plane across it (y and z), the pole running along x.
  /** @type {number[][]} */ const loop = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    loop.push([o.at[0], o.at[1] + Math.cos(a) * r, o.at[2] + Math.sin(a) * r]);
  }
  tube(loop, true);
  // The cord: from the loop's foot, out and down to the lantern's handle, with a slight sag.
  const from = [o.at[0], o.at[1] - r, o.at[2]];
  /** @type {number[][]} */ const cord = [];
  for (let i = 0; i <= 6; i++) {
    const s = i / 6;
    cord.push([from[0] + (o.to[0] - from[0]) * s, from[1] + (o.to[1] - from[1]) * s, from[2] + (o.to[2] - from[2]) * s + 0.01 * Math.sin(Math.PI * s)]);
  }
  tube(cord, false);
  return { data: new Float32Array(V), indices: new Uint32Array(I) };
}
