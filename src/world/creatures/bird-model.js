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
    P.push({ type: 'sphere', c: sideOf(S.eye.c, side), r: S.eye.r, bone: 'head', part: 'eye', k: 0 });
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
 * Worker job: bake a small bird in one plumage: its body (skinned by each piece's pull) and both
 * wings (each panel whole on its bone), packed for the creatures pass, with its skeleton.
 * @param {{ shape: any, plumage: any, wingPattern: any, cellM: number, wingCellM?: number, blendM?: number }} a
 * @returns {{ data: ArrayBuffer, indices: Uint32Array, count: number, bones: import('./bird-rig.js').Bone[], parts: Record<string, number>, __transfer: ArrayBuffer[] }}
 */
export function bakeBird(a) {
  const S = a.shape, PL = a.plumage, WP = a.wingPattern;
  const rig = birdRig(S);
  const prims = bodyPrims(S);
  const body = bakeBody({ prims, albedo: { back: [0, 0, 0], eye: [0, 0, 0], eyeRing: [0, 0, 0] } }, a.cellM);
  /** @type {Record<string, number>} */ const parts = {};
  for (let v = 0; v < body.count; v++) {
    const o = v * 9, p = [body.vertices[o], body.vertices[o + 1], body.vertices[o + 2]];
    const part = prims[bodyDistance(prims, p).near].part;
    parts[part] = (parts[part] ?? 0) + 1;
    body.vertices.set(bodyColour(S, PL, part, p, [body.vertices[o + 3], body.vertices[o + 4], body.vertices[o + 5]]), o + 6);
  }
  const skin = skinWeights(prims, rig.skeleton, body.vertices, body.count, a.blendM ?? 0.004);

  // The left wing's panels, then the right as their mirror.
  const { arm, hand, wrist } = wingPanels(S);
  const W = S.wing, wc = a.wingCellM ?? a.cellM;
  const armM = bakePanel(arm, wc, (p, n) => wingColour(PL, WP, 'arm', (arm.c[2] + W.armM / 2 - p[2]) / W.armM, (p[1] - arm.c[1]) / arm.r[1], n[0] > 0));
  const handM = bakePanel(hand, wc, (p, n) => {
    const along = Math.max(0, Math.min(1, (wrist[2] - p[2]) / W.handM));
    const half = (W.handChordM[0] + (W.handChordM[1] - W.handChordM[0]) * along) / 2;
    return wingColour(PL, WP, 'hand', along, (p[1] - wrist[1]) / half, n[0] > 0);
  });
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
  const pieces = [{ m: body, joints: skin.joints, weights: skin.weights }];
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
      pieces.push({ m: { vertices: verts, indices: idx, count: m.count, bounds: m.bounds }, joints, weights });
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
