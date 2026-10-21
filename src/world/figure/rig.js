// @ts-check
// The walker's rig (doc 23, W5): 20 bones read from recipes/world/figure.json, the arms' pivots
// from the model's own extras (where tools/figure-prep/prep.py found each shoulder and arm axis),
// and skin weights from the part label prep gave every vertex: each part blends between bones along
// a height or along its arm, at anchors the recipe lists. The body and both arms become one packed
// mesh (bodies.js format), so the creature pass draws the figure in one call.
// Pure: no DOM, no GPU.

import { packMesh } from '../creatures/bodies.js';
import { meshesByName } from '../../render/gltf.js';

/** @typedef {{ name: string, parent: number, pivot: number[] }} Bone */
/** @typedef {{ shoulder: number[], axis: number[], lengthM: number }} ArmInfo */

/**
 * The skeleton, parents first, with every pivot in rest-pose body metres.
 * @param {any} R recipes/world/figure.json @param {Record<string, ArmInfo>} arms the model's extras.arms
 * @returns {Bone[]}
 */
export function figureSkeleton(R, arms) {
  const names = R.bones.map((/** @type {any} */ b) => b.name);
  return R.bones.map((/** @type {any} */ b) => {
    let pivot = b.pivot;
    if (b.arm) {
      const a = arms[b.arm];
      if (!a) throw new Error(`figure: the model has no ${b.arm}`);
      pivot = a.shoulder.map((v, i) => v + a.axis[i] * b.t);
    }
    const parent = b.parent ? names.indexOf(b.parent) : -1;
    if (b.parent && parent < 0) throw new Error(`figure: bone ${b.name} has an unknown parent ${b.parent}`);
    return { name: b.name, parent, pivot: pivot.slice() };
  });
}

/**
 * Weights between bones along anchors: below the first anchor or above the last, that anchor's bone
 * alone; between two, a blend by how far along. @param {[number, string][]} anchors sorted by value
 * @param {number} v @returns {[string, number][]} bone names and weights (summing to 1)
 */
export function anchorWeights(anchors, v) {
  if (v <= anchors[0][0]) return [[anchors[0][1], 1]];
  for (let i = 1; i < anchors.length; i++) {
    const [a, ba] = anchors[i - 1], [b, bb] = anchors[i];
    if (v <= b) {
      if (ba === bb) return [[ba, 1]];
      const t = (v - a) / Math.max(b - a, 1e-9);
      const s = t * t * (3 - 2 * t);
      return [[ba, 1 - s], [bb, s]];
    }
  }
  return [[anchors[anchors.length - 1][1], 1]];
}

/**
 * The figure's mesh, skinned: positions, normals and linear colours from the model, joints and
 * weights from the part labels.
 * @param {import('../../render/gltf.js').Glb} glb assets/figures/walker.glb, read
 * @param {any} R recipes/world/figure.json
 * @returns {{ data: ArrayBuffer, indices: Uint32Array, count: number, skeleton: Bone[], arms: Record<string, ArmInfo>, parts: Record<string, number> }}
 */
export function buildFigure(glb, R) {
  const arms = glb.json.extras?.arms ?? {};
  const partIds = glb.json.extras?.parts ?? {};
  const partName = Object.fromEntries(Object.entries(partIds).map(([k, v]) => [v, k]));
  const skeleton = figureSkeleton(R, arms);
  const boneIndex = new Map(skeleton.map((b, i) => [b.name, i]));
  const meshes = meshesByName(glb);
  let count = 0, tris = 0;
  for (const m of meshes.values()) { count += m.attributes.POSITION.length / 3; tris += m.indices.length; }
  const vertices = new Float32Array(count * 9);
  const joints = new Uint8Array(count * 4), weights = new Uint8Array(count * 4);
  const indices = new Uint32Array(tris);
  let v0 = 0, i0 = 0;
  for (const [name, m] of meshes) {
    const P = m.attributes.POSITION, N = m.attributes.NORMAL, C = m.attributes.COLOR_0, L = m.attributes._PART;
    const n = P.length / 3;
    const arm = arms[name];
    for (let k = 0; k < n; k++) {
      const o = (v0 + k) * 9;
      for (let a = 0; a < 3; a++) {
        vertices[o + a] = P[k * 3 + a];
        vertices[o + 3 + a] = N[k * 3 + a];
        vertices[o + 6 + a] = C ? C[k * 3 + a] : 0.5;
      }
      // Which part, and where along it.
      const part = arm ? name : partName[L ? L[k] : 0] ?? 'torso';
      const S = R.skin[part] ?? R.skin.torso;
      const value = S.along === 't' && arm
        ? (P[k * 3] - arm.shoulder[0]) * arm.axis[0] + (P[k * 3 + 1] - arm.shoulder[1]) * arm.axis[1] + (P[k * 3 + 2] - arm.shoulder[2]) * arm.axis[2]
        : P[k * 3 + 1];
      const w = anchorWeights(S.anchors, value);
      let left = 255;
      w.forEach(([bone, wt], j) => {
        const b = boneIndex.get(bone);
        if (b === undefined) throw new Error(`figure: skin names an unknown bone ${bone}`);
        const byte = j === w.length - 1 ? left : Math.round(wt * 255);
        joints[(v0 + k) * 4 + j] = b;
        weights[(v0 + k) * 4 + j] = byte;
        left -= byte;
      });
    }
    for (let t = 0; t < m.indices.length; t++) indices[i0 + t] = m.indices[t] + v0;
    v0 += n;
    i0 += m.indices.length;
  }
  const data = packMesh({ vertices, count }, joints, weights);
  return { data, indices, count, skeleton, arms, parts: partIds };
}
