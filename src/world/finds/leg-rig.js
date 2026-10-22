// @ts-check
// Legs for a find whose model has no skeleton (the young edible crab, docs/future/11). At load,
// each vertex out past the shell's edge is bound to a leg bone by its side and how far forward it
// sits (four legs a side, the claws the front pair), its weight rising from the shell's edge out;
// the shell keeps bone 0. Each frame a leg bone turns about its root, lifting and sweeping in turn
// with its neighbours, so the legs step while the crab runs. Matrices are column-major 4x4, for the
// creatures pass. Pure.
//
// A mesh built in code (the woodlouse and the beetle, under-log-meshes.js) brings its own `bind`:
// the bone and weight of every vertex, each leg's root and each antenna's base. Then nothing is
// guessed from the outline, and the antennae get a bone each that sways (after the legs' bones).

/**
 * @typedef {{ pivot: number[], side: number, band: number }} Leg
 * @typedef {{ joints: Uint8Array, weights: Uint8Array, legs: Leg[], antennae: Leg[] }} LegRig
 *   antennae: none for a guessed rig; their bones come after the legs' (1 + legs.length + k)
 * @typedef {{ bone: Uint8Array, w: Float32Array, legs: Leg[], antennae: Leg[] }} Bind
 *   bone: 0 the body, 1 + i leg i (side 1's bands first), 1 + legs + k antenna k; w: 0..1 on it
 */

/**
 * Bind a mesh (models.js joinParts layout: 9 floats a vertex, base on y = 0, facing +z, legs out
 * along x) to a shell bone and a bone a leg (and one an antenna, when the mesh brings a bind).
 * @param {{ vertices: Float32Array, count: number, bind?: Bind }} mesh
 * @param {{ shellShare?: number, bands?: number }} [o] shellShare: how much of the half width is
 *   shell (legs start past it); bands: legs a side. Both unused when the mesh brings a bind.
 * @returns {LegRig}
 */
export function legRig(mesh, o = {}) {
  const n = mesh.count;
  if (mesh.bind) {
    // A built mesh says which bone each vertex follows.
    const B = mesh.bind, joints = new Uint8Array(n * 4), weights = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const wl = Math.round(Math.max(0, Math.min(1, B.w[i])) * 255);
      joints[i * 4] = 0; joints[i * 4 + 1] = B.bone[i];
      weights[i * 4] = 255 - wl; weights[i * 4 + 1] = wl;
    }
    return { joints, weights, legs: B.legs, antennae: B.antennae };
  }
  const V = mesh.vertices;
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
  return { joints, weights, legs, antennae: [] };
}

/**
 * A bone turning about a pivot: M = T(p) R T(-p), R given as its 3x3 columns. @param {number[]} R
 * @param {number[]} p @param {Float32Array} out @param {number} at
 */
function about(R, p, out, at) {
  const [px, py, pz] = p;
  const tx = px - (R[0] * px + R[3] * py + R[6] * pz);
  const ty = py - (R[1] * px + R[4] * py + R[7] * pz);
  const tz = pz - (R[2] * px + R[5] * py + R[8] * pz);
  out.set([R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, tx, ty, tz, 1], at);
}

/**
 * The bone matrices for a step phase (radians, about 2 pi a step): bone 0 still, each leg lifted
 * and swept about its root. By default neighbours and the leg across are out of step (with three
 * bands that is the tripod gait an insect runs on); with `wave` each band steps that many radians
 * after the one behind it, a wave running forward along the body, as a woodlouse's legs do. Band 0
 * moves by `clawShare` (a crab's claws, 0.35 when left out). Antennae, when the rig has them, sway
 * slowly by `antennaDeg` at `antennaRate` of the step phase (still when antennaDeg is left out).
 * @param {LegRig} rig @param {number} phase
 * @param {{ liftDeg: number, sweepDeg: number, clawShare?: number, wave?: number, antennaDeg?: number, antennaRate?: number }} g
 * @param {Float32Array} [out] @returns {Float32Array}
 */
export function legBones(rig, phase, g, out = new Float32Array((rig.legs.length + (rig.antennae?.length ?? 0) + 1) * 16)) {
  out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  rig.legs.forEach((L, i) => {
    const across = L.side > 0 ? 0 : Math.PI;
    const ph = g.wave === undefined ? phase + (L.band % 2) * Math.PI + across : phase + L.band * g.wave + across;
    const share = L.band === 0 ? g.clawShare ?? 0.35 : 1;
    // Lift: about the forward axis (z), the tip rising on its own side; sweep: about up (y).
    const lift = (Math.max(0, Math.sin(ph)) * g.liftDeg * share * Math.PI) / 180 * L.side;
    const sweep = (Math.cos(ph) * g.sweepDeg * share * Math.PI) / 180;
    const cz = Math.cos(lift), sz = Math.sin(lift), cy = Math.cos(sweep), sy = Math.sin(sweep);
    // R = Ry(sweep) * Rz(lift), column-major.
    about([cy * cz, sz, -sy * cz, -cy * sz, cz, sy * sz, sy, 0, cy], L.pivot, out, (i + 1) * 16);
  });
  const ants = rig.antennae ?? [];
  ants.forEach((A, k) => {
    const deg = g.antennaDeg ?? 0, ph = phase * (g.antennaRate ?? 0.2) + k * 1.7;
    // Sway side to side about up (y), and lift the tip a little about across (x).
    const sweep = (Math.sin(ph) * deg * Math.PI) / 180 * A.side;
    const tilt = -((0.5 + 0.5 * Math.sin(ph * 1.3 + k)) * deg * 0.4 * Math.PI) / 180;
    const cy = Math.cos(sweep), sy = Math.sin(sweep), cx = Math.cos(tilt), sx = Math.sin(tilt);
    // R = Ry(sweep) * Rx(tilt), column-major.
    about([cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx], A.pivot, out, (1 + rig.legs.length + k) * 16);
  });
  return out;
}
