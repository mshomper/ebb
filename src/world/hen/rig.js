// @ts-check
// The hen's rig (docs/future/15, slice 1): Matt's supplied model read as it is (assets/models/hen,
// credited there). Its 50 joints fold to the bones recipes/species/hen.json keeps: each joint's skin
// weight goes to its nearest kept ancestor (the toe joints into each foot), four strongest kept.
// Everything is in the rest pose's own space (the file's world at rest: metres, Y up, head toward +z),
// where every bone at rest is still, as pose.js wants. Its one clip, Idle, is sampled into each kept
// bone's move about its pivot, for the code clips to play over (motion.js).
// Pure: no DOM, no GPU.

import { packMesh } from '../creatures/bodies.js';
import { matQuat } from '../figure/kinematics.js';

/** @typedef {{ name: string, parent: number, pivot: number[] }} Bone */
/** @typedef {{ fps: number, frames: number, data: Float32Array }} IdleClip  data: per frame, per bone, a quaternion then a shift (7 floats) */

const ID = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a * b, column-major. @param {number[]} a @param {number[]} b */
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

/** The inverse of an affine column-major 4x4 (a general 3x3 part). @param {number[]} m */
function inv(m) {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  const r = [A * k, (c * h - b * i) * k, (b * f - c * e) * k, 0,
    B * k, (a * i - c * g) * k, (c * d - a * f) * k, 0,
    C * k, (b * g - a * h) * k, (a * e - b * d) * k, 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}

/** A node's own matrix from its TRS (or its matrix). @param {{ t?: number[], r?: number[], s?: number[], matrix?: number[] }} n */
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.r ?? [0, 0, 0, 1], [sx, sy, sz] = n.s ?? [1, 1, 1], t = n.t ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
}

/** A joint's name without the file's running number ("Hip_L_032" is "Hip_L"). @param {string} name */
export const jointBase = (name) => name.replace(/_\d+$/, '');

/**
 * Every node's world matrix, from each node's own (TRS or matrix) as given.
 * @param {any[]} nodes @param {Int32Array} parent @param {(i: number) => number[]} own
 */
function worlds(nodes, parent, own) {
  /** @type {(number[] | null)[]} */ const W = nodes.map(() => null);
  /** @param {number} i @returns {number[]} */
  const at = (i) => W[i] ?? (W[i] = parent[i] < 0 ? own(i) : mul(at(parent[i]), own(i)));
  return nodes.map((_, i) => at(i));
}

/**
 * A channel's value at time t (linear; step for STEP; a quaternion re-normalised). @param {Float32Array} times
 * @param {Float32Array} values @param {number} n floats a key @param {number} t @param {string} interp @param {boolean} quat
 */
function sampleAt(times, values, n, t, interp, quat) {
  const last = times.length - 1;
  let k = 0;
  while (k < last && times[k + 1] <= t) k++;
  const cubic = interp === 'CUBICSPLINE' ? 3 : 1, off = interp === 'CUBICSPLINE' ? n : 0;
  const get = (/** @type {number} */ i) => Array.from(values.subarray(i * n * cubic + off, i * n * cubic + off + n));
  if (k >= last || interp === 'STEP') return get(Math.min(k, last));
  const u = Math.min(1, Math.max(0, (t - times[k]) / Math.max(times[k + 1] - times[k], 1e-9)));
  const a = get(k), b = get(k + 1);
  if (quat && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) for (let i = 0; i < 4; i++) b[i] = -b[i];
  const v = a.map((x, i) => x + (b[i] - x) * u);
  if (quat) { const l = Math.hypot(v[0], v[1], v[2], v[3]) || 1; return v.map((x) => x / l); }
  return v;
}

/**
 * The hen, rigged: the packed mesh (the colour slot carries each vertex's UV and a 2, for the
 * colour map), her kept skeleton and the Idle clip as moves.
 * @param {import('../../render/gltf.js').Glb} glb assets/models/hen/hen.glb, read
 * @param {any} R recipes/species/hen.json
 * @param {{ idleFps?: number }} [o]
 * @returns {{ data: ArrayBuffer, indices: Uint32Array, count: number, skeleton: Bone[], idle: IdleClip | null, height: number }}
 */
export function buildHen(glb, R, o = {}) {
  const json = glb.json, nodes = json.nodes;
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((/** @type {number} */ c) => { parent[c] = i; }));
  const restOwn = nodes.map((/** @type {any} */ n) => trs({ t: n.translation, r: n.rotation, s: n.scale, matrix: n.matrix }));
  const rest = worlds(nodes, parent, (i) => restOwn[i]);
  const meshNode = nodes.findIndex((/** @type {any} */ n) => n.mesh !== undefined && n.skin !== undefined);
  if (meshNode < 0) throw new Error('hen: the model has no skinned mesh');
  const skin = json.skins[nodes[meshNode].skin];
  const joints = /** @type {number[]} */ (skin.joints);
  const ibm = glb.accessor(skin.inverseBindMatrices);
  // The kept bones, by their joints' names.
  const keptNode = R.bones.map((/** @type {any} */ b) => {
    const i = joints.find((j) => jointBase(nodes[j].name ?? '') === b.joint);
    if (i === undefined) throw new Error(`hen: the model has no joint ${b.joint}`);
    return i;
  });
  const keptOf = new Map(keptNode.map((n, k) => [n, k]));
  /** The kept bone a node folds into: itself if kept, else its nearest kept ancestor (the root if none). @param {number} n */
  const foldOf = (n) => { for (let p = n; p >= 0; p = parent[p]) { const k = keptOf.get(p); if (k !== undefined) return k; } return 0; };
  /** @type {Bone[]} */
  const skeleton = R.bones.map((/** @type {any} */ b, /** @type {number} */ k) => {
    const n = keptNode[k], m = rest[n];
    return { name: b.name, parent: parent[n] >= 0 && k > 0 ? foldOf(parent[n]) : -1, pivot: [m[12], m[13], m[14]] };
  });
  skeleton.forEach((b, k) => { if (b.parent >= k) throw new Error(`hen: bone ${b.name} comes before its parent`); });

  // The mesh at rest: each vertex through its joints' rest skin (world at rest times inverse bind).
  const prim = json.meshes[nodes[meshNode].mesh].primitives[0];
  const P = glb.accessor(prim.attributes.POSITION), N = glb.accessor(prim.attributes.NORMAL), UV = glb.accessor(prim.attributes.TEXCOORD_0);
  const J = glb.accessor(prim.attributes.JOINTS_0), Wt = glb.accessor(prim.attributes.WEIGHTS_0);
  const wScale = json.accessors[prim.attributes.WEIGHTS_0].componentType === 5126 ? 1 : json.accessors[prim.attributes.WEIGHTS_0].componentType === 5121 ? 1 / 255 : 1 / 65535;
  const skinMat = joints.map((n, j) => mul(rest[n], Array.from(ibm.subarray(j * 16, j * 16 + 16))));
  const jointFold = joints.map((n) => foldOf(n));
  const count = P.length / 3;
  const vertices = new Float32Array(count * 9);
  const outJ = new Uint8Array(count * 4), outW = new Uint8Array(count * 4);
  let low = Infinity, high = -Infinity;
  const acc = new Float64Array(skeleton.length);
  for (let v = 0; v < count; v++) {
    const p = [0, 0, 0], nn = [0, 0, 0];
    acc.fill(0);
    for (let s = 0; s < 4; s++) {
      const w = Wt[v * 4 + s] * wScale;
      if (w <= 0) continue;
      const m = skinMat[J[v * 4 + s]];
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      for (let a = 0; a < 3; a++) {
        p[a] += w * (m[a] * x + m[4 + a] * y + m[8 + a] * z + m[12 + a]);
        nn[a] += w * (m[a] * N[v * 3] + m[4 + a] * N[v * 3 + 1] + m[8 + a] * N[v * 3 + 2]);
      }
      acc[jointFold[J[v * 4 + s]]] += w;
    }
    const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    vertices.set([p[0], p[1], p[2], nn[0] / nl, nn[1] / nl, nn[2] / nl, UV[v * 2], UV[v * 2 + 1], 2], v * 9);
    low = Math.min(low, p[1]); high = Math.max(high, p[1]);
    // The four strongest kept bones, as bytes summing to 255.
    const top = [...acc.keys()].filter((b) => acc[b] > 0).sort((a, b) => acc[b] - acc[a] || a - b).slice(0, 4);
    const sum = top.reduce((s, b) => s + acc[b], 0) || 1;
    let left = 255;
    top.forEach((b, i) => {
      const byte = i === top.length - 1 ? left : Math.min(left, Math.round((255 * acc[b]) / sum));
      outJ[v * 4 + i] = b; outW[v * 4 + i] = byte; left -= byte;
    });
    if (!top.length) outW[v * 4] = 255;
  }
  const idx = glb.accessor(prim.indices);
  const indices = idx instanceof Uint32Array ? idx : Uint32Array.from(idx);
  const data = packMesh({ vertices, count }, outJ, outW);
  // The clip first, in the file's own space: a move about a pivot is the same once both are shifted.
  const idle = idleClip(json, glb, nodes, parent, restOwn, rest, keptNode, skeleton, o.idleFps ?? 30);
  // Stand her on y = 0: her lowest point is the soles of her feet.
  if (Math.abs(low) > 1e-4) {
    const f = new Float32Array(data);
    for (let v = 0; v < count; v++) f[v * 11 + 1] -= low;
    skeleton.forEach((b) => { b.pivot[1] -= low; });
  }
  return { data, indices, count, skeleton, idle, height: high - low };
}

/**
 * The Idle clip as each kept bone's move about its pivot, frame by frame: the bone's posed world
 * against its rest world (M = posed * rest^-1), taken relative to its kept parent's.
 * @param {any} json @param {import('../../render/gltf.js').Glb} glb @param {any[]} nodes @param {Int32Array} parent
 * @param {number[][]} restOwn @param {number[][]} rest @param {number[]} keptNode @param {Bone[]} skeleton @param {number} fps
 * @returns {IdleClip | null}
 */
function idleClip(json, glb, nodes, parent, restOwn, rest, keptNode, skeleton, fps) {
  const anim = (json.animations ?? []).find((/** @type {any} */ a) => /idle/i.test(a.name ?? '')) ?? json.animations?.[0];
  if (!anim) return null;
  const chans = anim.channels.map((/** @type {any} */ c) => {
    const s = anim.samplers[c.sampler];
    const path = c.target.path, n = path === 'rotation' ? 4 : 3;
    return { node: c.target.node, path, n, interp: s.interpolation ?? 'LINEAR', times: /** @type {Float32Array} */ (glb.accessor(s.input)), values: /** @type {Float32Array} */ (glb.accessor(s.output)) };
  });
  const length = Math.max(...chans.map((/** @type {any} */ c) => c.times[c.times.length - 1]));
  const frames = Math.max(1, Math.round(length * fps));
  const restInv = keptNode.map((n) => inv(rest[n]));
  const data = new Float32Array(frames * skeleton.length * 7);
  for (let f = 0; f < frames; f++) {
    const t = f / fps;
    /** @type {Record<number, { t?: number[], r?: number[], s?: number[] }>} */ const posed = {};
    for (const c of chans) {
      const v = sampleAt(c.times, c.values, c.n, t, c.interp, c.path === 'rotation');
      const e = posed[c.node] ?? (posed[c.node] = {});
      if (c.path === 'translation') e.t = v; else if (c.path === 'rotation') e.r = v; else if (c.path === 'scale') e.s = v;
    }
    const W = worlds(nodes, parent, (i) => {
      const p = posed[i];
      if (!p) return restOwn[i];
      const n = nodes[i];
      return trs({ t: p.t ?? n.translation, r: p.r ?? n.rotation, s: p.s ?? n.scale });
    });
    const M = keptNode.map((n, k) => mul(W[n], restInv[k]));
    skeleton.forEach((b, k) => {
      const local = b.parent < 0 ? M[k] : mul(inv(M[b.parent]), M[k]);
      const q = matQuat(local);
      const p = b.pivot;
      // The shift that carries the pivot: local(p) - p.
      const lp = [local[0] * p[0] + local[4] * p[1] + local[8] * p[2] + local[12], local[1] * p[0] + local[5] * p[1] + local[9] * p[2] + local[13],
        local[2] * p[0] + local[6] * p[1] + local[10] * p[2] + local[14]];
      data.set([q[0], q[1], q[2], q[3], lp[0] - p[0], lp[1] - p[1], lp[2] - p[2]], (f * skeleton.length + k) * 7);
    });
  }
  return { fps, frames, data };
}
