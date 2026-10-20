// @ts-check
// Legs for a find whose model has no skeleton (the young edible crab, docs/future/11). At load,
// each vertex out past the shell's edge is bound to a leg bone by its side and how far forward it
// sits (four legs a side, the claws the front pair), its weight rising from the shell's edge out;
// the shell keeps bone 0. Each frame a leg bone turns about its root, lifting and sweeping in turn
// with its neighbours, so the legs step while the crab runs. Matrices are column-major 4x4, for the
// creatures pass. Pure.

/**
 * @typedef {{ pivot: number[], side: number, band: number }} Leg
 * @typedef {{ joints: Uint8Array, weights: Uint8Array, legs: Leg[] }} LegRig
 */

/**
 * Bind a mesh (models.js joinParts layout: 9 floats a vertex, base on y = 0, facing +z, legs out
 * along x) to a shell bone and eight leg bones.
 * @param {{ vertices: Float32Array, count: number }} mesh
 * @param {{ shellShare?: number, bands?: number }} [o] shellShare: how much of the half width is
 *   shell (legs start past it); bands: legs a side
 * @returns {LegRig}
 */
export function legRig(mesh, o = {}) {
  const V = mesh.vertices, n = mesh.count;
  const shell = o.shellShare ?? 0.42, bands = o.bands ?? 4;
  let hw = 0, z0 = Infinity, z1 = -Infinity, ymax = 0;
  for (let i = 0; i < n; i++) { hw = Math.max(hw, Math.abs(V[i * 9])); z0 = Math.min(z0, V[i * 9 + 2]); z1 = Math.max(z1, V[i * 9 + 2]); ymax = Math.max(ymax, V[i * 9 + 1]); }
  const edge = hw * shell;
  /** @type {Leg[]} */ const legs = [];
  for (const side of [1, -1]) for (let b = 0; b < bands; b++) {
    legs.push({ pivot: [side * edge, ymax * 0.45, z1 - ((b + 0.5) / bands) * (z1 - z0)], side, band: b });
  }
  const joints = new Uint8Array(n * 4), weights = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = V[i * 9], z = V[i * 9 + 2];
    const out = Math.abs(x);
    // From the shell's edge out, the vertex follows its leg more and more.
    const t = Math.max(0, Math.min(1, (out - edge * 0.8) / (edge * 0.6)));
    const w = t * t * (3 - 2 * t);
    const band = Math.max(0, Math.min(bands - 1, Math.floor(((z1 - z) / Math.max(z1 - z0, 1e-6)) * bands)));
    const leg = (x >= 0 ? 0 : bands) + band;
    joints[i * 4] = 0; joints[i * 4 + 1] = 1 + leg;
    const wl = Math.round(w * 255);
    weights[i * 4] = 255 - wl; weights[i * 4 + 1] = wl;
  }
  return { joints, weights, legs };
}

/**
 * The bone matrices for a step phase (radians, about 2 pi a step): bone 0 still, each leg lifted
 * and swept about its root, neighbours and the leg across out of step.
 * @param {LegRig} rig @param {number} phase @param {{ liftDeg: number, sweepDeg: number, clawShare?: number }} g
 * @param {Float32Array} [out] @returns {Float32Array}
 */
export function legBones(rig, phase, g, out = new Float32Array((rig.legs.length + 1) * 16)) {
  out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  rig.legs.forEach((L, i) => {
    const ph = phase + (L.band % 2) * Math.PI + (L.side > 0 ? 0 : Math.PI);
    const share = L.band === 0 ? g.clawShare ?? 0.35 : 1;
    // Lift: about the forward axis (z), the tip rising on its own side; sweep: about up (y).
    const lift = (Math.max(0, Math.sin(ph)) * g.liftDeg * share * Math.PI) / 180 * L.side;
    const sweep = (Math.cos(ph) * g.sweepDeg * share * Math.PI) / 180;
    const cz = Math.cos(lift), sz = Math.sin(lift), cy = Math.cos(sweep), sy = Math.sin(sweep);
    // R = Ry(sweep) * Rz(lift), column-major.
    const R = [cy * cz, sz, -sy * cz, 0, -cy * sz, cz, sy * sz, 0, sy, 0, cy, 0];
    const [px, py, pz] = L.pivot;
    // M = T(p) R T(-p)
    const tx = px - (R[0] * px + R[4] * py + R[8] * pz);
    const ty = py - (R[1] * px + R[5] * py + R[9] * pz);
    const tz = pz - (R[2] * px + R[6] * py + R[10] * pz);
    out.set([R[0], R[1], R[2], 0, R[4], R[5], R[6], 0, R[8], R[9], R[10], 0, tx, ty, tz, 1], (i + 1) * 16);
  });
  return out;
}
