// @ts-check
// A small bird's body, made in code (B3 R1): the recipe's shape (recipes/birds/<id>.json) turned into
// blended pieces on the small-bird rig's bones (bird-rig.js), baked by surface nets (body-bake.js),
// skinned by each piece's pull, and painted per vertex from the recipe's plumage (linear albedo: the
// palette is applied at the tonemap, never here). Each wing is two flat panels baked on their own and
// skinned whole to their bone: the arm panel tucked under the hand panel when folded, so the wing
// can telescope open (bird-rig.js wingMoves). The turnstone is the first (assets/models/turnstone).
// Pure and worker-safe: the same recipe gives the same mesh.

import { bakeBody, bodyDistance } from './body-bake.js';
import { packMesh, skinWeights } from './bodies.js';
import { BIRD_ROLES, birdRig, sideOf } from './bird-rig.js';
import { decimate } from '../mesh/decimate.js';

const DEG = Math.PI / 180;

/** A smooth 0..1 value noise in 3D (its own lattice hash, so a bird's mottle is its own). @param {number} x @param {number} y @param {number} z */
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => {
    let n = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
  };
  const l = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
  return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}

/**
 * The body's blended pieces (everything but the wings), each on its bone and named by its part.
 * @param {any} S recipes/birds/<id>.json shape @returns {any[]}
 */
export function bodyPrims(S) {
  const K = S.blend, L = S.leg;
  /** @type {any[]} */ const P = [
    { type: 'ellipsoid', c: S.body.c, r: S.body.r, rot: [S.body.pitchDeg ?? 0, 0, 0], bone: 'body', part: 'body', k: 0 },
    { type: 'ellipsoid', c: S.breast.c, r: S.breast.r, bone: 'body', part: 'breast', k: K.bodyK },
    { type: 'capsule', a: S.neck.base, b: S.neck.top, r: S.neck.r, bone: 'neck', part: 'neck', k: K.bodyK },
    { type: 'ellipsoid', c: S.head.c, r: S.head.r, bone: 'head', part: 'head', k: K.headK },
    { type: 'roundCone', a: S.bill.base, b: S.bill.tip, ra: S.bill.r[0], rb: S.bill.r[1], scale: [1, S.bill.flat, 1], bone: 'head', part: 'bill', k: 0.003 },
    { type: 'ellipsoid', c: S.tail.c, r: S.tail.r, rot: [S.tail.pitchDeg ?? 0, 0, 0], bone: 'tail', part: 'tail', k: 0.008 },
  ];
  for (const [s, side] of /** @type {const} */ ([['l', 1], ['r', -1]])) {
    // The feathered thigh to just above the ankle, the bare shin below it, then the leg and toes.
    const hip = sideOf(L.hip, side), ankle = sideOf(L.ankle, side), foot = sideOf(L.foot, side);
    const knee = hip.map((h, a) => h + (ankle[a] - h) * 0.55);
    P.push({ type: 'capsule', a: hip, b: knee, r: L.thighR, bone: `leg.${s}`, part: 'thigh', k: K.legK * 2 });
    P.push({ type: 'capsule', a: knee, b: ankle, r: [L.tarsusR * 1.1, L.tarsusR], bone: `leg.${s}`, part: 'leg', k: K.legK });
    P.push({ type: 'capsule', a: ankle, b: foot, r: [L.tarsusR, L.tarsusR * 0.9], bone: `shank.${s}`, part: 'leg', k: K.legK });
    const toeY = L.toeR;
    L.toesM.forEach((len, i) => {
      const yaw = (i - 1) * L.toeSpreadDeg * DEG * side;
      P.push({ type: 'capsule', a: [foot[0], toeY, foot[2]], b: [foot[0] + Math.sin(yaw) * len, toeY * 0.8, foot[2] + Math.cos(yaw) * len],
        r: [L.toeR, L.toeR * 0.7], bone: `foot.${s}`, part: 'toe', k: K.toeK });
    });
    P.push({ type: 'capsule', a: [foot[0], toeY * 1.2, foot[2]], b: [foot[0], toeY * 1.4, foot[2] - L.hindToeM], r: [L.toeR * 0.8, L.toeR * 0.6], bone: `foot.${s}`, part: 'toe', k: K.toeK });
  }
  return P;
}

/**
 * The left wing's two panels, each straight along -z from its pivot (the hand is turned to point at
 * the folded tip after baking): the arm under the hand, both flat across x.
 * @param {any} S @returns {{ arm: any, hand: any, wrist: number[] }}
 */
export function wingPanels(S) {
  const W = S.wing, sh = W.shoulder;
  const rig = birdRig(S);
  const wrist = rig.wings[0].wrist;
  const arm = { type: 'ellipsoid', c: [sh[0] - W.insetM, sh[1], sh[2] - W.armM / 2], r: [W.thickM / 2, W.armChordM / 2, W.armM / 2], k: 0 };
  const hand = { type: 'roundCone', a: wrist, b: [wrist[0], wrist[1], wrist[2] - W.handM], ra: W.handChordM[0] / 2, rb: W.handChordM[1] / 2,
    scale: [W.thickM / W.handChordM[0], 1, 1], k: 0 };
  return { arm, hand, wrist };
}

/** Rest-space colour of a body vertex. @param {any} S @param {any} PL plumage @param {string} part @param {number[]} p @param {number[]} n */
function bodyColour(S, PL, part, p, n) {
  const C = PL.parts;
  if (part === 'bill') return C.bill;
  if (part === 'eye') return C.eye;
  if (part === 'leg' || part === 'toe') return C.leg;
  if (part === 'thigh') return C.under;
  if (part === 'tail') {
    // Pale at the base (the rump), a dark band, a pale tip; pale beneath.
    const T = S.tail, along = (T.c[2] + T.r[2] - p[2]) / (2 * T.r[2]);
    if (n[1] < -0.3) return C.under;
    return along < 0.3 ? C.rump : along > 0.88 ? C.under : C.tail;
  }
  let col = n[1] < -0.15 || (part === 'breast' && n[1] < 0.2) ? C.under : part === 'head' ? C.head : C.upper;
  // Mottled upperparts: dark centres and pale fringes in value noise.
  const M = PL.mottle;
  if (col === C.upper && M) {
    const v = noise(p[0] * M.scale, p[1] * M.scale, p[2] * M.scale);
    if (v < M.amount * 0.75) col = M.color;
    else if (v > 1 - M.paleShare) col = M.pale;
  }
  for (const mk of PL.marks ?? []) {
    if (!mk.on.includes(part)) continue;
    if (mk.below && n[1] > 0.3) continue;
    const d = Math.hypot((Math.abs(p[0]) - mk.c[0]) / mk.r[0], (p[1] - mk.c[1]) / mk.r[1], (p[2] - mk.c[2]) / mk.r[2]);
    if (d > 1) continue;
    if (mk.patchy && noise(p[0] * 260 + 7, p[1] * 260, p[2] * 260) < mk.patchy * d) continue;
    col = C[mk.color];
  }
  return col;
}

/**
 * Rest-space colour of a wing vertex, from where it lies on its straight panel: along 0 at the pivot
 * to 1 at the end, across -1 to 1 (top +1, which the open wing turns into its trailing edge), and
 * whether it faces out (the upper side once open).
 * @param {any} PL @param {any} WP recipes/birds/<id>.json wingPattern @param {'arm' | 'hand'} which @param {number} along @param {number} across @param {boolean} out
 */
function wingColour(PL, WP, which, along, across, out) {
  const C = PL.parts;
  if (!out) return C.wingUnder;
  let col = C.wingUpper;
  if (which === 'arm' && along >= WP.barAlong[0] && along <= WP.barAlong[1] && across >= WP.barAcross[0] && across <= WP.barAcross[1]) col = C.wingBar;
  if (which === 'hand') {
    if (along >= WP.handBarAlong[0] && along <= WP.handBarAlong[1] && across >= WP.handBarAcross[0] && across <= WP.handBarAcross[1]) col = C.wingBar;
    else if (along > WP.tipDark) col = WP.tipColor;
    for (const mk of PL.wingMarks ?? []) if (along >= mk.along[0] && along <= mk.along[1] && across >= mk.across[0] && across <= mk.across[1]) col = C[mk.color];
  }
  return col;
}

/** The turn that carries (0, 0, -1) onto a direction: a pitch about x, then a yaw about y. @param {number[]} d @returns {(v: number[]) => number[]} */
export function aimer(d) {
  const l = Math.hypot(d[0], d[1], d[2]);
  const pitch = Math.asin(d[1] / l), yaw = Math.atan2(-d[0] / l, -d[2] / l);
  const ca = Math.cos(pitch), sa = Math.sin(pitch), cb = Math.cos(yaw), sb = Math.sin(yaw);
  return (v) => {
    const y1 = v[1] * ca - v[2] * sa, z1 = v[1] * sa + v[2] * ca;
    return [v[0] * cb + z1 * sb, y1, -v[0] * sb + z1 * cb];
  };
}

/**
 * Bake one panel and colour it. @param {any} prim @param {number} cellM
 * @param {(p: number[], n: number[]) => number[]} colour
 */
function bakePanel(prim, cellM, colour) {
  const m = bakeBody({ prims: [prim], albedo: { back: [0, 0, 0] } }, cellM);
  for (let v = 0; v < m.count; v++) {
    const o = v * 9;
    m.vertices.set(colour([m.vertices[o], m.vertices[o + 1], m.vertices[o + 2]], [m.vertices[o + 3], m.vertices[o + 4], m.vertices[o + 5]]), o + 6);
  }
  return m;
}

/**
 * A baked piece cut to about `target` triangles by quadric edge collapse (src/world/mesh/decimate.js):
 * each vertex's colour (and its skin weights, when it has them) rides along, so plumage edges and the
 * joints keep their vertices; a kept vertex keeps its own colour and skin, and normals are summed
 * again from the triangles left. A piece already under the target is left as it is.
 * @param {{ vertices: Float32Array, indices: Uint32Array, count: number }} m @param {number} target
 * @param {number} attrWeight @param {Uint8Array | null} [joints] @param {Uint8Array | null} [weights]
 * @returns {{ m: { vertices: Float32Array, indices: Uint32Array, count: number }, joints: Uint8Array | null, weights: Uint8Array | null, from: Int32Array }}
 */
export function cutPiece(m, target, attrWeight, joints = null, weights = null) {
  if (m.indices.length / 3 <= target) return { m, joints, weights, from: Int32Array.from({ length: m.count }, (_, i) => i) };
  const nb = BIRD_ROLES.length, stride = 3 + (joints ? nb : 0);
  const attr = new Float32Array(m.count * stride), pos = new Float32Array(m.count * 3);
  for (let v = 0; v < m.count; v++) {
    pos.set(m.vertices.subarray(v * 9, v * 9 + 3), v * 3);
    // Colour compared by its square root, nearer how it looks: dark on dark (an eye on a brown head)
    // differs as much as it seems to.
    for (let k = 0; k < 3; k++) attr[v * stride + k] = Math.sqrt(Math.max(0, m.vertices[v * 9 + 6 + k]));
    if (joints && weights) for (let s = 0; s < 4; s++) attr[v * stride + 3 + joints[v * 4 + s]] += weights[v * 4 + s] / 255;
  }
  const c = decimate(pos, m.indices, target, { attr, stride, weight: attrWeight });
  const vertices = new Float32Array(c.count * 9);
  const J = joints ? new Uint8Array(c.count * 4) : null, Wt = weights ? new Uint8Array(c.count * 4) : null;
  for (let v = 0; v < c.count; v++) {
    const o = c.from[v];
    vertices.set([c.pos[v * 3], c.pos[v * 3 + 1], c.pos[v * 3 + 2]], v * 9);
    vertices.set(m.vertices.subarray(o * 9 + 6, o * 9 + 9), v * 9 + 6);
    if (J && joints) J.set(joints.subarray(o * 4, o * 4 + 4), v * 4);
    if (Wt && weights) Wt.set(weights.subarray(o * 4, o * 4 + 4), v * 4);
  }
  // Normals: each triangle's (area-weighted) added to its corners.
  for (let i = 0; i < c.idx.length; i += 3) {
    const [a, b, d] = [c.idx[i], c.idx[i + 1], c.idx[i + 2]];
    const u = [0, 1, 2].map((k) => vertices[b * 9 + k] - vertices[a * 9 + k]), w = [0, 1, 2].map((k) => vertices[d * 9 + k] - vertices[a * 9 + k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const x of [a, b, d]) for (let k = 0; k < 3; k++) vertices[x * 9 + 3 + k] += n[k];
  }
  for (let v = 0; v < c.count; v++) {
    const o = v * 9 + 3, l = Math.hypot(vertices[o], vertices[o + 1], vertices[o + 2]) || 1;
    for (let k = 0; k < 3; k++) vertices[o + k] /= l;
  }
  return { m: { vertices, indices: c.idx, count: c.count }, joints: J, weights: Wt, from: c.from };
}

/**
 * An eye: a small ball of its own (rings by segments), whole on the head bone, so no cut can lose it.
 * @param {number[]} c @param {number} r @param {number[]} colour @param {number} [rings] @param {number} [segs]
 * @returns {{ vertices: Float32Array, indices: Uint32Array, count: number }}
 */
export function eyeBall(c, r, colour, rings = 5, segs = 8) {
  /** @type {number[]} */ const V = [], I = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    for (let j = 0; j < segs; j++) {
      const ph = (j / segs) * Math.PI * 2, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      V.push(c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, n[0], n[1], n[2], colour[0], colour[1], colour[2]);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + (j + 1) % segs, d = a + segs, e = b + segs;
    if (i > 0) I.push(a, b, d);
    if (i < rings - 1) I.push(b, e, d);
  }
  return { vertices: Float32Array.from(V), indices: Uint32Array.from(I), count: V.length / 9 };
}

/**
 * Worker job: bake a small bird in one plumage: its body (skinned by each piece's pull) and both
 * wings (each panel whole on its bone), cut to `maxTris` triangles in all (the recipe's budget;
 * none when left out), packed for the creatures pass, with its skeleton.
 * @param {{ shape: any, plumage: any, wingPattern: any, cellM: number, wingCellM?: number, blendM?: number,
 *   maxTris?: number, wingShare?: number, attrWeight?: number }} a
 *   wingShare: the share of maxTris all four wing panels get (the arm 40% of a wing's, the hand 60%)
 * @returns {{ data: ArrayBuffer, indices: Uint32Array, count: number, bones: import('./bird-rig.js').Bone[], parts: Record<string, number>, __transfer: ArrayBuffer[] }}
 */
export function bakeBird(a) {
  const S = a.shape, PL = a.plumage, WP = a.wingPattern;
  const rig = birdRig(S);
  const prims = bodyPrims(S);
  const body = bakeBody({ prims, albedo: { back: [0, 0, 0], eye: [0, 0, 0], eyeRing: [0, 0, 0] } }, a.cellM);
  /** @type {string[]} */ const partOf = [];
  for (let v = 0; v < body.count; v++) {
    const o = v * 9, p = [body.vertices[o], body.vertices[o + 1], body.vertices[o + 2]];
    const part = prims[bodyDistance(prims, p).near].part;
    partOf.push(part);
    body.vertices.set(bodyColour(S, PL, part, p, [body.vertices[o + 3], body.vertices[o + 4], body.vertices[o + 5]]), o + 6);
  }
  const skin0 = skinWeights(prims, rig.skeleton, body.vertices, body.count, a.blendM ?? 0.004);
  // The budget: the wing panels get their share, the body the rest.
  const max = a.maxTris ?? Infinity, ws = (a.wingShare ?? 0.16) / 2, aw = a.attrWeight ?? 2e-6;
  const cutBody = cutPiece(body, max * (1 - 2 * ws) - 128, aw, skin0.joints, skin0.weights);
  const skin = { joints: /** @type {Uint8Array} */ (cutBody.joints), weights: /** @type {Uint8Array} */ (cutBody.weights) };
  /** @type {Record<string, number>} */ const parts = {};
  for (const o of cutBody.from) parts[partOf[o]] = (parts[partOf[o]] ?? 0) + 1;

  // The left wing's panels, then the right as their mirror.
  const { arm, hand, wrist } = wingPanels(S);
  const W = S.wing, wc = a.wingCellM ?? a.cellM;
  const armM = cutPiece(bakePanel(arm, wc, (p, n) => wingColour(PL, WP, 'arm', (arm.c[2] + W.armM / 2 - p[2]) / W.armM, (p[1] - arm.c[1]) / arm.r[1], n[0] > 0)),
    max * ws * 0.4, aw).m;
  const handM = cutPiece(bakePanel(hand, wc, (p, n) => {
    const along = Math.max(0, Math.min(1, (wrist[2] - p[2]) / W.handM));
    const half = (W.handChordM[0] + (W.handChordM[1] - W.handChordM[0]) * along) / 2;
    return wingColour(PL, WP, 'hand', along, (p[1] - wrist[1]) / half, n[0] > 0);
  }), max * ws * 0.6, aw).m;
  // The hand turned about the wrist to point at the folded tip.
  const turn = aimer([W.tip[0] - wrist[0], W.tip[1] - wrist[1], W.tip[2] - wrist[2]]);
  for (let v = 0; v < handM.count; v++) {
    const o = v * 9, q = turn([handM.vertices[o] - wrist[0], handM.vertices[o + 1] - wrist[1], handM.vertices[o + 2] - wrist[2]]);
    const nn = turn([handM.vertices[o + 3], handM.vertices[o + 4], handM.vertices[o + 5]]);
    handM.vertices.set([q[0] + wrist[0], q[1] + wrist[1], q[2] + wrist[2], nn[0], nn[1], nn[2]], o);
  }
  // Both panels leaned in about the shoulder's long axis, so the folded wing lies against the body
  // (the rig takes the lean back out as it opens the wing).
  const lean = (W.leanDeg ?? 0) * DEG, cl = Math.cos(lean), sl = Math.sin(lean), sh = W.shoulder;
  for (const m of [armM, handM]) {
    for (let v = 0; v < m.count; v++) {
      const o = v * 9, x = m.vertices[o] - sh[0], y = m.vertices[o + 1] - sh[1], nx = m.vertices[o + 3], ny = m.vertices[o + 4];
      m.vertices[o] = sh[0] + cl * x - sl * y; m.vertices[o + 1] = sh[1] + sl * x + cl * y;
      m.vertices[o + 3] = cl * nx - sl * ny; m.vertices[o + 4] = sl * nx + cl * ny;
    }
  }
  const pieces = [{ m: cutBody.m, joints: skin.joints, weights: skin.weights }];
  const head = BIRD_ROLES.indexOf('head');
  for (const side of [1, -1]) {
    const e = eyeBall(sideOf(S.eye.c, side), S.eye.r, PL.parts.eye);
    const joints = new Uint8Array(e.count * 4), weights = new Uint8Array(e.count * 4);
    for (let v = 0; v < e.count; v++) { joints[v * 4] = head; weights[v * 4] = 255; }
    pieces.push({ m: e, joints, weights });
    parts.eye = (parts.eye ?? 0) + e.count;
  }
  for (const [s, side] of /** @type {const} */ ([['l', 1], ['r', -1]])) {
    for (const [m, role] of /** @type {const} */ ([[armM, `wing.${s}`], [handM, `hand.${s}`]])) {
      const verts = m.vertices.slice();
      const idx = m.indices.slice();
      if (side < 0) {
        for (let v = 0; v < m.count; v++) { verts[v * 9] = -verts[v * 9]; verts[v * 9 + 3] = -verts[v * 9 + 3]; }
        for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      }
      const joints = new Uint8Array(m.count * 4), weights = new Uint8Array(m.count * 4);
      const b = BIRD_ROLES.indexOf(/** @type {any} */ (role));
      for (let v = 0; v < m.count; v++) { joints[v * 4] = b; weights[v * 4] = 255; }
      pieces.push({ m: { vertices: verts, indices: idx, count: m.count }, joints, weights });
      parts[role] = m.count;
    }
  }
  // Join them into one mesh.
  const count = pieces.reduce((s, x) => s + x.m.count, 0), nIdx = pieces.reduce((s, x) => s + x.m.indices.length, 0);
  const vertices = new Float32Array(count * 9), joints = new Uint8Array(count * 4), weights = new Uint8Array(count * 4), indices = new Uint32Array(nIdx);
  let vAt = 0, iAt = 0;
  for (const x of pieces) {
    vertices.set(x.m.vertices, vAt * 9); joints.set(x.joints, vAt * 4); weights.set(x.weights, vAt * 4);
    for (let i = 0; i < x.m.indices.length; i++) indices[iAt + i] = x.m.indices[i] + vAt;
    vAt += x.m.count; iAt += x.m.indices.length;
  }
  const data = packMesh({ vertices, count }, joints, weights);
  return { data, indices, count, bones: rig.skeleton, parts, __transfer: [data, /** @type {ArrayBuffer} */ (indices.buffer)] };
}
