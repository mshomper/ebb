// @ts-check
// A rigged find (the hermit crab): its glTF skin and walk clip, posed at a time into bone matrices
// for the creatures pass. The file keeps the mesh in its own space; the pose carries the scale to a
// real height, the base set on y = 0 and the turn from the recipe, so the pass draws it like any
// other find. Matrices are column-major 4x4, as in glTF and WGSL.

import { smoothNormals, fetchGltf, readAccessor } from './models.js';

/**
 * @typedef {{ parent: number, t: number[], r: number[], s: number[] }} Joint  rest pose, parent index (-1 root)
 * @typedef {{ joint: number, path: string, times: Float32Array, values: Float32Array, n: number, step: boolean }} Channel
 * @typedef {{ vertices: Float32Array, count: number, indices: Uint32Array, joints: Uint8Array, weights: Uint8Array,
 *   nodes: Joint[], skin: number[], ibm: Float32Array, channels: Channel[], duration: number, fit: Float32Array,
 *   gait?: { joint: number, axis: number[], amp: number, phase: number }[], gaitScale?: number }} Rig
 *   gaitScale: how far the legs swing, as a share of what the clip shows (each way)
 */

/**
 * Load a rigged find and fit it: heightM tall, base on y = 0, turned by rotDeg (x, y, z degrees).
 * @param {string} url @param {number} heightM @param {number[]} rotDeg @returns {Promise<Rig>}
 */
export async function loadRig(url, heightM, rotDeg) {
  const { gltf, buffers } = await fetchGltf(url);
  return parseRig(gltf, buffers, heightM, rotDeg);
}

/**
 * A rig from a parsed glTF and its buffers, fitted as loadRig does. Pure (tools/ scripts use it).
 * @param {any} gltf @param {ArrayBuffer[]} buffers @param {number} heightM @param {number[]} rotDeg @returns {Rig}
 */
export function parseRig(gltf, buffers, heightM, rotDeg) {
  /** @param {number} i */
  const read = (i) => readAccessor(gltf, buffers, i);
  const meshNode = gltf.nodes.findIndex((/** @type {any} */ n) => n.mesh !== undefined && n.skin !== undefined);
  const prim = gltf.meshes[gltf.nodes[meshNode].mesh].primitives[0];
  const skinDef = gltf.skins[gltf.nodes[meshNode].skin];
  const pos = read(prim.attributes.POSITION).data;
  const col = prim.attributes.COLOR_0 !== undefined ? read(prim.attributes.COLOR_0) : null;
  const J = read(prim.attributes.JOINTS_0).data, W = read(prim.attributes.WEIGHTS_0);
  const count = pos.length / 3;
  const indices = Uint32Array.from(read(prim.indices).data);
  const nor = smoothNormals(pos, indices);
  const vertices = new Float32Array(count * 9);
  const joints = new Uint8Array(count * 4), weights = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    vertices.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]], i * 9);
    vertices.set(col ? [col.data[i * col.n], col.data[i * col.n + 1], col.data[i * col.n + 2]] : [0.5, 0.5, 0.5], i * 9 + 6);
    // Weights as bytes that sum to 255, the pass's layout.
    const w = [0, 1, 2, 3].map((k) => (W.n === 4 ? W.data[i * 4 + k] : 0));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    let left = 255;
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = J[i * 4 + k];
      const b = k === 3 ? left : Math.round((w[k] / sum) * 255);
      weights[i * 4 + k] = Math.max(0, Math.min(left, b));
      left -= weights[i * 4 + k];
    }
  }
  // The skeleton: every node's rest pose and parent (joints are a subset, in skin order).
  const parent = new Array(gltf.nodes.length).fill(-1);
  gltf.nodes.forEach((/** @type {any} */ n, i) => (n.children ?? []).forEach((/** @type {number} */ c) => { parent[c] = i; }));
  /** @type {Joint[]} */
  const nodes = gltf.nodes.map((/** @type {any} */ n, i) => ({ parent: parent[i], t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
  const ibm = skinDef.inverseBindMatrices !== undefined ? read(skinDef.inverseBindMatrices).data : new Float32Array(skinDef.joints.length * 16).map((_, k) => (k % 17 === 0 ? 1 : 0));
  const anim = gltf.animations?.[0];
  /** @type {Channel[]} */
  const channels = (anim?.channels ?? []).map((/** @type {any} */ c) => {
    const s = anim.samplers[c.sampler];
    const vals = read(s.output);
    return { joint: c.target.node, path: c.target.path, times: read(s.input).data, values: vals.data, n: vals.n, step: s.interpolation === 'STEP' };
  }).filter((/** @type {Channel} */ c) => c.path !== 'weights');
  const duration = channels.reduce((m, c) => Math.max(m, c.times[c.times.length - 1] ?? 0), 0);
  /** @type {Rig} */
  const rig = { vertices, count, indices, joints, weights, nodes, skin: skinDef.joints, ibm, channels, duration, fit: identity() };
  // Fit from the rest pose: skin every vertex, measure, then scale, turn and set down.
  const rest = bones(rig, -1);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const R = rotation(rotDeg);
  for (let i = 0; i < count; i++) {
    const p = R(skinPoint(rig, rest, i));
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  const sc = heightM / Math.max(hi[1] - lo[1], 1e-6);
  const T = translate(-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2);
  rig.fit = mul(scale(sc), mul(T, rotMatrix(rotDeg)));
  rig.gait = gaitOf(rig);
  return rig;
}

/**
 * A walking gait from the rig itself. The model's own clip is a slow sway, not a walk, but it shows
 * how each leg joint bends: its hinge axis and how far it goes. Each leg (a chain of joints the clip
 * moves) gets a swing about those axes, a step out of time with its neighbours along its side and
 * with the leg across from it, so the legs move in turn.
 * @param {Rig} rig @returns {{ joint: number, axis: number[], amp: number, phase: number }[]}
 */
function gaitOf(rig) {
  const inSkin = new Set(rig.skin);
  /** @type {Map<number, { axis: number[], amp: number }>} */ const swing = new Map();
  for (const c of rig.channels) {
    if (c.path !== 'rotation' || !inSkin.has(c.joint)) continue;
    const r0 = rig.nodes[c.joint].r;
    let best = 0, axis = [0, 0, 1];
    for (let i = 0; i < c.times.length; i++) {
      const q = Array.from(c.values.subarray(i * 4, i * 4 + 4));
      const d = qmul(qconj(r0), q);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(d[3])));
      if (ang > best) { best = ang; const l = Math.hypot(d[0], d[1], d[2]) || 1, sg = d[3] < 0 ? -1 : 1; axis = [sg * d[0] / l, sg * d[1] / l, sg * d[2] / l]; }
    }
    if (best > (4 * Math.PI) / 180) swing.set(c.joint, { axis, amp: best / 2 });
  }
  // Each moving joint's leg: the topmost moving joint above it. Where legs sit: the rest pose.
  const rootOf = (/** @type {number} */ j) => { let r = j; while (swing.has(rig.nodes[r].parent)) r = rig.nodes[r].parent; return r; };
  const W = restWorld(rig);
  const roots = [...new Set([...swing.keys()].map(rootOf))].map((j) => ({ j, x: W[j][12], z: W[j][14] }));
  /** @type {Map<number, number>} */ const phaseOf = new Map();
  for (const side of [1, -1]) {
    const legs = roots.filter((r) => Math.sign(r.x || 1) === side).sort((a, b) => b.z - a.z);
    legs.forEach((r, i) => phaseOf.set(r.j, (i % 2) * Math.PI + (side > 0 ? 0 : Math.PI)));
  }
  return [...swing.entries()].map(([joint, s]) => ({ joint, axis: s.axis, amp: s.amp, phase: phaseOf.get(rootOf(joint)) ?? 0 }));
}

/** Every node's world matrix at rest, with the fit applied. @param {Rig} rig @returns {Float32Array[]} */
function restWorld(rig) {
  /** @type {(Float32Array | null)[]} */ const world = rig.nodes.map(() => null);
  /** @param {number} i @returns {Float32Array} */
  const at = (i) => {
    if (world[i]) return /** @type {Float32Array} */ (world[i]);
    const n = rig.nodes[i];
    const m = trs(n.t, n.r, n.s);
    const w = n.parent < 0 ? mul(rig.fit ?? identity(), m) : mul(at(n.parent), m);
    world[i] = w;
    return w;
  };
  return rig.nodes.map((_, i) => at(i));
}

/** @param {number[]} a @param {number[]} b quaternions (x, y, z, w) */
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
/** @param {number[]} q */
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];

/**
 * The bone matrices with the fit applied: at time t seconds into the clip (t < 0: the rest pose),
 * or, given a gait phase (radians, advancing about 2 pi per step while it walks), the rest pose
 * with the legs swung by the gait instead.
 * @param {Rig} rig @param {number} t @param {Float32Array} [out] @param {number | null} [gait] @returns {Float32Array}
 */
export function bones(rig, t, out = new Float32Array(rig.skin.length * 16), gait = null) {
  const local = rig.nodes.map((n) => ({ t: n.t, r: n.r, s: n.s }));
  if (gait !== null) {
    for (const g of rig.gait ?? []) {
      const a = g.amp * Math.sin(gait + g.phase) * (rig.gaitScale ?? 1), s = Math.sin(a);
      local[g.joint].r = qmul(rig.nodes[g.joint].r, [g.axis[0] * s, g.axis[1] * s, g.axis[2] * s, Math.cos(a)]);
    }
  } else if (t >= 0 && rig.duration > 0) {
    const tt = t % rig.duration;
    for (const c of rig.channels) {
      const v = sample(c, tt);
      const L = local[c.joint];
      if (c.path === 'translation') L.t = v; else if (c.path === 'rotation') L.r = v; else if (c.path === 'scale') L.s = v;
    }
  }
  /** @type {(Float32Array | null)[]} */ const world = rig.nodes.map(() => null);
  /** @param {number} i @returns {Float32Array} */
  const worldOf = (i) => {
    const w = world[i];
    if (w) return w;
    const L = local[i];
    const m = trs(L.t, L.r, L.s);
    const p = rig.nodes[i].parent;
    const out2 = p < 0 ? m : mul(worldOf(p), m);
    world[i] = out2;
    return out2;
  };
  rig.skin.forEach((j, k) => {
    const m = mul(rig.fit, mul(worldOf(j), rig.ibm.subarray(k * 16, k * 16 + 16)));
    out.set(m, k * 16);
  });
  return out;
}

/**
 * The mesh posed at time t on the CPU, in models.js's part layout (tools/finds-models.html plays
 * the walk with it; the game skins on the GPU).
 * @param {Rig} rig @param {number} t @param {number | null} [gait] a gait phase (see bones)
 * @returns {{ vertices: Float32Array, count: number, indices: Uint32Array }}
 */
export function posedMesh(rig, t, gait = null) {
  const B = bones(rig, t, undefined, gait);
  const v = new Float32Array(rig.vertices);
  for (let i = 0; i < rig.count; i++) {
    v.set(skinPoint(rig, B, i), i * 9);
    const n = skinPoint(rig, B, i, 3, 0);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    v.set([n[0] / l, n[1] / l, n[2] / l], i * 9 + 3);
  }
  return { vertices: v, count: rig.count, indices: rig.indices };
}

/**
 * One vertex skinned by these bones: its position (at 0, w 1) or its normal (at 3, w 0).
 * @param {Rig} rig @param {Float32Array} B @param {number} i @param {number} [at] @param {number} [w1]
 */
function skinPoint(rig, B, i, at = 0, w1 = 1) {
  const p = [rig.vertices[i * 9 + at], rig.vertices[i * 9 + at + 1], rig.vertices[i * 9 + at + 2]];
  const o = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const w = rig.weights[i * 4 + k] / 255;
    if (!w) continue;
    const m = B.subarray(rig.joints[i * 4 + k] * 16);
    for (let r = 0; r < 3; r++) o[r] += w * (m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * w1);
  }
  return o;
}

/** A channel's value at time t (linear, quaternions blended and renormalized). @param {Channel} c @param {number} t */
function sample(c, t) {
  const T = c.times, n = c.n;
  if (t <= T[0]) return Array.from(c.values.subarray(0, n));
  if (t >= T[T.length - 1]) return Array.from(c.values.subarray((T.length - 1) * n, T.length * n));
  let i = 0;
  while (T[i + 1] < t) i++;
  const a = c.values.subarray(i * n, i * n + n), b = c.values.subarray((i + 1) * n, (i + 1) * n + n);
  if (c.step) return Array.from(a);
  const f = (t - T[i]) / (T[i + 1] - T[i]);
  if (c.path === 'rotation') {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const sgn = d < 0 ? -1 : 1;
    const q = [0, 1, 2, 3].map((k) => a[k] * (1 - f) + b[k] * f * sgn);
    const l = Math.hypot(...q) || 1;
    return q.map((x) => x / l);
  }
  return Array.from({ length: n }, (_, k) => a[k] * (1 - f) + b[k] * f);
}

/** @returns {Float32Array} */
function identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
/** @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
/** @param {number[]} t @param {number[]} q @param {number[]} s */
function trs(t, q, s) {
  const [x, y, z, w] = q;
  return new Float32Array([
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1]);
}
/** @param {number} s */
function scale(s) { return new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]); }
/** @param {number} x @param {number} y @param {number} z */
function translate(x, y, z) { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]); }
/** Turn about x, then y, then z (degrees), as models.js joinParts does. @param {number[]} d */
function rotMatrix(d) {
  const [a, b, c] = d.map((x) => (x * Math.PI) / 180);
  const X = new Float32Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
  const Y = new Float32Array([Math.cos(b), 0, -Math.sin(b), 0, 0, 1, 0, 0, Math.sin(b), 0, Math.cos(b), 0, 0, 0, 0, 1]);
  const Z = new Float32Array([Math.cos(c), Math.sin(c), 0, 0, -Math.sin(c), Math.cos(c), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return mul(Z, mul(Y, X));
}
/** @param {number[]} d @returns {(p: number[]) => number[]} */
function rotation(d) {
  const m = rotMatrix(d);
  return (p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
}
