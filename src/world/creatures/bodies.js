// @ts-check
// Creature bodies, posed by bones (S6b, doc 11): a species' body pieces, reshaped by its rig and by
// one of a few seeded variants (later also by a player's look), baked to a mesh (body-bake.js), and
// given a skeleton read from the pieces and skin weights from each piece's share of the blend.
// bakeVariant runs on the worker pool; nothing here touches the world, so bodies only have to look
// the same on every device. Pure and worker-safe.

import { hash32 } from '../../core/rng.js';
import { bakeBody, primDistance } from './body-bake.js';
import { FROG_BONES, FROG_SHAPE_KEYS, shapeFrogPrims } from './rigs/frog.js';

/** Rigs by species id: their bones, proportion names and reshaping. */
const RIGS = {
  frog: { bones: FROG_BONES, shapeKeys: FROG_SHAPE_KEYS, shape: shapeFrogPrims },
};

/** Bytes per vertex in a packed mesh: position, normal, albedo (9 floats), 4 bone indices, 4 weights. */
export const VERTEX_BYTES = 44;
/** Bones a creature may have (the draw pass keeps this many matrices per individual). */
export const MAX_BONES = 16;

/** Float 0..1 from a hash. @param {number} h */
const unit = (h) => (h >>> 8) / 16777216;

/** A small seed for a species id. @param {string} id */
function idSeed(id) {
  let h = 0x9e3779b9;
  for (let i = 0; i < id.length; i++) h = hash32(h, id.charCodeAt(i));
  return h;
}

/**
 * The proportions for one body variant: the recipe's shape, each nudged by up to `variation` for
 * this variant (variant -1 is the plain body, with no nudge), times a player's look (S6b: none).
 * @param {string} id species id @param {any} body the species recipe's body @param {number} variant @param {any} [look]
 * @returns {Record<string, number>}
 */
export function variantShape(id, body, variant, look = null) {
  const keys = RIGS[/** @type {keyof typeof RIGS} */ (id)]?.shapeKeys ?? [];
  const v = variant < 0 ? 0 : body.variation ?? 0;
  const seed = idSeed(id);
  /** @type {Record<string, number>} */ const out = {};
  keys.forEach((k, i) => {
    const base = body.shape?.[k] ?? 1;
    const nudge = v ? 1 + (unit(hash32(seed, variant, i)) * 2 - 1) * v : 1;
    const own = look?.shape?.[k] ?? 1;
    out[k] = nudge === 1 && own === 1 ? base : base * nudge * own;
  });
  return out;
}

/**
 * Everything one body variant needs to bake: the reshaped pieces and the blotch offset.
 * @param {string} id @param {any} body @param {number} variant @param {any} [look]
 */
export function bodyFor(id, body, variant, look = null) {
  const rig = RIGS[/** @type {keyof typeof RIGS} */ (id)];
  const prims = rig ? rig.shape(body.prims, variantShape(id, body, variant, look)) : body.prims;
  const seed = idSeed(id);
  const offset = variant < 0 ? [0, 0, 0] : [0, 1, 2].map((i) => unit(hash32(seed, 0xb10, variant, i)) * 40);
  return { ...body, prims, blotch: { ...body.blotch, offset } };
}

/**
 * The skeleton of a body: each bone's parent and pivot (body meters), read from its pieces.
 * @param {string} id @param {any[]} prims
 * @returns {{ name: string, parent: number, pivot: number[] }[]}
 */
export function skeletonOf(id, prims) {
  const rig = RIGS[/** @type {keyof typeof RIGS} */ (id)];
  if (!rig) return [{ name: 'root', parent: -1, pivot: [0, 0, 0] }];
  /** @type {Record<string, any>} */ const P = {};
  // A piece is known by its part name if it has one (a lid rides the head bone but is not the head).
  for (const q of prims) P[q.part ?? q.bone] = q;
  return rig.bones.map((b) => ({ name: b.name, parent: b.parent, pivot: b.pivot(P) }));
}

/**
 * Skin weights for each vertex: every piece's bone, weighted by how close the piece is compared
 * with the nearest one (blendM: how far past it a piece still pulls), the four strongest kept and
 * stored as bytes that sum to 255.
 * @param {any[]} prims @param {{ name: string }[]} bones @param {Float32Array} vertices 9 floats a vertex @param {number} count
 * @param {number} blendM
 */
export function skinWeights(prims, bones, vertices, count, blendM) {
  const boneOf = prims.map((q) => Math.max(0, bones.findIndex((b) => b.name === q.bone)));
  const joints = new Uint8Array(count * 4), weights = new Uint8Array(count * 4);
  const perBone = new Float64Array(bones.length);
  for (let v = 0; v < count; v++) {
    const p = [vertices[v * 9], vertices[v * 9 + 1], vertices[v * 9 + 2]];
    perBone.fill(Infinity);
    let dMin = Infinity, nearest = 0;
    prims.forEach((q, i) => {
      const d = primDistance(q, p);
      if (d < perBone[boneOf[i]]) perBone[boneOf[i]] = d;
      if (d < dMin) { dMin = d; nearest = i; }
    });
    // A stiff piece (an eyelid) moves with its own bone alone, so the eye can sink under it.
    if (prims[nearest].stiff) {
      joints[v * 4] = boneOf[nearest];
      weights[v * 4] = 255;
      continue;
    }
    /** @type {{ b: number, w: number }[]} */ const pulls = [];
    for (let b = 0; b < bones.length; b++) {
      if (perBone[b] === Infinity) continue;
      const w = Math.exp(-(perBone[b] - dMin) / blendM);
      if (w > 0.004) pulls.push({ b, w });
    }
    pulls.sort((x, y) => y.w - x.w || x.b - y.b);
    const top = pulls.slice(0, 4);
    const sum = top.reduce((a, x) => a + x.w, 0);
    let left = 255;
    top.forEach((x, i) => {
      const byte = i === top.length - 1 ? left : Math.round((255 * x.w) / sum);
      joints[v * 4 + i] = x.b;
      weights[v * 4 + i] = Math.max(0, Math.min(left, byte));
      left -= weights[v * 4 + i];
    });
  }
  return { joints, weights };
}

/**
 * Pack a baked mesh with its skin into one vertex buffer (VERTEX_BYTES a vertex). A mesh with no
 * skin follows bone 0 alone.
 * @param {{ vertices: Float32Array, count: number }} mesh @param {Uint8Array | null} [joints] @param {Uint8Array | null} [weights]
 */
export function packMesh(mesh, joints = null, weights = null) {
  const buf = new ArrayBuffer(mesh.count * VERTEX_BYTES);
  const f = new Float32Array(buf), u = new Uint8Array(buf);
  for (let v = 0; v < mesh.count; v++) {
    f.set(mesh.vertices.subarray(v * 9, v * 9 + 9), v * (VERTEX_BYTES / 4));
    for (let i = 0; i < 4; i++) {
      u[v * VERTEX_BYTES + 36 + i] = joints ? joints[v * 4 + i] : 0;
      u[v * VERTEX_BYTES + 40 + i] = weights ? weights[v * 4 + i] : i === 0 ? 255 : 0;
    }
  }
  return buf;
}

/**
 * Worker job: bake one variant of a species body at one level of detail, with its skeleton and skin.
 * @param {{ id: string, body: any, variant: number, cellM: number, look?: any }} args
 * @returns {{ data: ArrayBuffer, indices: Uint32Array, count: number, bones: { name: string, parent: number, pivot: number[] }[], __transfer: ArrayBuffer[] }}
 */
export function bakeVariant(args) {
  const body = bodyFor(args.id, args.body, args.variant, args.look ?? null);
  const mesh = bakeBody(body, args.cellM);
  const bones = skeletonOf(args.id, body.prims);
  const skin = skinWeights(body.prims, bones, mesh.vertices, mesh.count, body.skin?.blendM ?? 0.0025);
  const data = packMesh(mesh, skin.joints, skin.weights);
  return { data, indices: mesh.indices, count: mesh.count, bones, __transfer: [data, /** @type {ArrayBuffer} */ (mesh.indices.buffer)] };
}
