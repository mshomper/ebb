// @ts-check
// The teal's body (B3 wave 3): Matt's model (assets/models/teal, a textured GLB with no rig) put on
// the small-bird rig (src/world/creatures/bird-rig.js) in code. Its units become real metres
// (recipes/birds/teal.json model.unitM), then each vertex is skinned: the legs below the body to
// their side's shank and foot, everything else along the spine line, blending between the two
// bones at the ends of the nearest stretch (tail into body, body into neck, neck into head). Each
// flank's folded wing is copied, lifted a hair off the body and skinned whole, its front to the arm
// bone and its back to the hand bone, so it opens in flight while the body under it keeps its own
// painted wing (as the hen's, src/world/hen/rig.js). A vertex's colour slot holds its UV and a 2,
// so the hen's draw (hen-draw.wgsl) samples the model's own colour map.
// Pure: the same file gives the same mesh.

import { meshesByName } from '../../render/gltf.js';
import { packMesh } from '../creatures/bodies.js';
import { birdRig } from '../creatures/bird-rig.js';

/** The nearest point on segment a-b to p: how far along (0..1) and how far away. @param {number[]} p @param {number[]} a @param {number[]} b */
export function nearOnSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)) : 0;
  return { t, d: Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t) };
}

/**
 * Which bones a vertex follows, and how much (rest real metres). Legs: below legY and ahead of
 * legZ, to the foot under footY, else the shank, of the vertex's own side. The rest: the nearest
 * stretch of the spine, between its two ends' bones by how far along it lies.
 * @param {number[]} p @param {any} K recipes/birds/teal.json skin @param {Record<string, number>} at the rig's bone indices
 * @returns {[number, number][]} up to two [bone, weight], weights summing to 1
 */
export function skinOf(p, K, at) {
  if (p[1] < K.legY && p[2] > K.legZ && Math.abs(p[0]) > 0.004) {
    const s = p[0] > 0 ? 'l' : 'r';
    return [[at[p[1] < K.footY ? `foot.${s}` : `shank.${s}`], 1]];
  }
  let best = { d: Infinity, t: 0, i: 0 };
  for (let i = 0; i + 1 < K.spine.length; i++) {
    const r = nearOnSegment(p, K.spine[i].at, K.spine[i + 1].at);
    if (r.d < best.d) best = { d: r.d, t: r.t, i };
  }
  const a = at[K.spine[best.i].bone], b = at[K.spine[best.i + 1].bone];
  if (a === b) return [[a, 1]];
  const w = best.t * best.t * (3 - 2 * best.t);
  return [[a, 1 - w], [b, w]];
}

/**
 * The teal's skinned mesh from its GLB: packed for the creature pass, the rig it is skinned to and
 * how many vertices and triangles its wing copies added.
 * @param {import('../../render/gltf.js').Glb} glb @param {any} B recipes/birds/teal.json
 */
export function buildTeal(glb, B) {
  const rig = birdRig(B.shape);
  const m = [...meshesByName(glb).values()][0];
  if (!m?.attributes.TEXCOORD_0) throw new Error('teal: the model has no UVs');
  const P = m.attributes.POSITION, N = m.attributes.NORMAL, UV = m.attributes.TEXCOORD_0, u = B.model.unitM;
  const count = P.length / 3;
  const src = m.indices;
  const W = B.wings;
  // The wing copies: each side's triangles whose three corners lie in its wing's region.
  const inWing = (/** @type {number} */ v, /** @type {number} */ side) => {
    const x = P[v * 3] * u * side, y = P[v * 3 + 1] * u, z = P[v * 3 + 2] * u;
    return x >= W.xMin && y >= W.y[0] && y <= W.y[1] && z >= W.z[0] && z <= W.z[1];
  };
  /** @type {{ side: number, verts: number[], tris: number[] }[]} */ const wings = [];
  for (const side of [1, -1]) {
    /** @type {Map<number, number>} */ const map = new Map();
    /** @type {number[]} */ const tris = [];
    for (let i = 0; i < src.length; i += 3) {
      const a = src[i], b = src[i + 1], c = src[i + 2];
      if (!inWing(a, side) || !inWing(b, side) || !inWing(c, side)) continue;
      for (const v of [a, b, c]) { if (!map.has(v)) map.set(v, map.size); tris.push(/** @type {number} */ (map.get(v))); }
    }
    wings.push({ side, verts: [...map.keys()], tris });
  }
  const extra = wings.reduce((s, w) => s + w.verts.length, 0), extraTris = wings.reduce((s, w) => s + w.tris.length, 0);
  const total = count + extra;
  const vertices = new Float32Array(total * 9), joints = new Uint8Array(total * 4), weights = new Uint8Array(total * 4);
  /** Write vertex v of the file as vertex o, lifted along its normal. @param {number} v @param {number} o @param {number} lift */
  const put = (v, o, lift) => {
    for (let a = 0; a < 3; a++) {
      vertices[o * 9 + a] = P[v * 3 + a] * u + N[v * 3 + a] * lift;
      vertices[o * 9 + 3 + a] = N[v * 3 + a];
    }
    vertices[o * 9 + 6] = UV[v * 2]; vertices[o * 9 + 7] = UV[v * 2 + 1]; vertices[o * 9 + 8] = 2;
  };
  for (let v = 0; v < count; v++) {
    put(v, v, 0);
    const s = skinOf([P[v * 3] * u, P[v * 3 + 1] * u, P[v * 3 + 2] * u], B.skin, rig.at);
    let left = 255;
    s.forEach(([bone, w], i) => {
      const byte = i === s.length - 1 ? left : Math.round(w * 255);
      joints[v * 4 + i] = bone; weights[v * 4 + i] = byte; left -= byte;
    });
  }
  const indices = new Uint32Array(src.length + extraTris);
  indices.set(src);
  let o = count, ti = src.length;
  for (const w of wings) {
    const base = o, sd = w.side > 0 ? 'l' : 'r';
    for (const v of w.verts) {
      put(v, o, W.liftM);
      joints[o * 4] = rig.at[P[v * 3 + 2] * u > W.splitZ ? `wing.${sd}` : `hand.${sd}`];
      weights[o * 4] = 255;
      o++;
    }
    for (const t of w.tris) indices[ti++] = base + t;
  }
  const data = packMesh({ vertices, count: total }, joints, weights);
  return { data, indices, count: total, rig, wingVerts: extra, wingTris: extraTris / 3 };
}
