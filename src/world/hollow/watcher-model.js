// @ts-check
// The hagstone watcher's model (H2; the orchestrator's draft 2, approved by Matt on October 27, 2026):
// assets/models/hollow/watcher.glb, made by tools/hollow-prep/watcher.mjs from a signed field. Metres,
// Y up, the hole looking along +z, the origin at the stone's middle. Its rig is in the node's extras:
// a root (the float, the turn) and each wrack blade's chain of bones; and the hole (its middle, radius
// and flare), for the shader's light. Packed as the creatures' meshes are (bodies.js packMesh:
// position, normal, a colour slot, four joints, four weights): on the stone the colour slot carries its
// place in the baked maps (u, v, 2), on the weed its linear albedo. The maps (albedo, and the fine
// field's normals in object space) come back as image bytes for the pass.

import { readGlb, meshesByName, materialMaps } from '../../render/gltf.js';
import { packMesh } from '../creatures/bodies.js';

/**
 * @typedef {{
 *   data: ArrayBuffer, indices: Uint32Array, count: number, triangles: number, parts: { stone: number, weed: number },
 *   skeleton: { name: string, parent: number, pivot: number[] }[], blades: { lengthM: number, root: number[], tip: number[] }[],
 *   hole: { x: number, y: number, rM: number, flareShare: number, halfDepthM: number },
 *   widthM: number, heightM: number, depthM: number, weedLowM: number, barnacles: number, cutFrom: number,
 *   joints: Uint8Array, weights: Uint8Array, positions: Float32Array, stoneVerts: number,
 *   albedo: { bytes: Uint8Array, mimeType: string } | null, normal: { bytes: Uint8Array, mimeType: string } | null,
 * }} WatcherModel
 */

/** @param {string | URL} url @returns {Promise<WatcherModel>} */
export async function loadWatcherModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The watcher model did not load (${res.status}).`);
  return watcherModel(readGlb(await res.arrayBuffer()));
}

/** @param {import('../../render/gltf.js').Glb} glb @returns {WatcherModel} */
export function watcherModel(glb) {
  const mesh = meshesByName(glb).get('watcher');
  if (!mesh) throw new Error('watcher.glb has no mesh named watcher');
  const A = mesh.attributes, P = A.POSITION, N = A.NORMAL, C = A.COLOR_0, n = P.length / 3;
  const vertices = new Float32Array(n * 9);
  let stoneVerts = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { vertices[i * 9 + k] = P[i * 3 + k]; vertices[i * 9 + 3 + k] = N[i * 3 + k]; vertices[i * 9 + 6 + k] = C[i * 3 + k]; }
    if (C[i * 3 + 2] > 1.5) stoneVerts++;
  }
  const joints = /** @type {Uint8Array} */ (A.JOINTS_0), weights = /** @type {Uint8Array} */ (A.WEIGHTS_0);
  const x = glb.json.nodes.find((/** @type {any} */ nd) => nd.name === 'watcher')?.extras ?? {};
  const maps = materialMaps(glb);
  return {
    data: packMesh({ vertices, count: n }, joints, weights), indices: mesh.indices, count: n, triangles: mesh.indices.length / 3, parts: x.triangles,
    skeleton: x.skeleton, blades: x.blades, hole: x.hole, widthM: x.widthM, heightM: x.heightM, depthM: x.depthM, weedLowM: x.weedLowM,
    barnacles: x.barnacles, cutFrom: x.cutFrom, joints, weights, positions: /** @type {Float32Array} */ (P), stoneVerts,
    albedo: maps.baseColor, normal: maps.normal,
  };
}
