// @ts-check
// The silt crawler's model (H2; Matt's, from nTop, October 27, 2026): assets/models/hollow/crawler.glb,
// made by tools/hollow-prep/crawler.py. Metres, Y up, facing +z, the origin on the ground under the
// body's middle, at the one enemy-space scale (recipes/world/hollow.json enemySpace). Its rig is in
// the node's extras: 16 bones (parents first, rest pivots), each leg's hip, knee and foot, the eye
// stalks. Packed as the creatures' meshes are (bodies.js packMesh: position, normal, a colour slot,
// four joints, four weights); the colour slot carries the surface zones (plate, underside, knob) and a
// second buffer Matt's modelled cobbles (seam, shade), that lib-crawler.wgsl draws from, since his OBJs
// have no UVs to carry textures.

import { readGlb, meshesByName } from '../../render/gltf.js';
import { packMesh } from '../creatures/bodies.js';

/**
 * @typedef {{ hip: number[], knee: number[], foot: number[], lengthM: number, radiusM: number, footLiftM: number }} CrawlerLeg
 * @typedef {{
 *   data: ArrayBuffer, indices: Uint32Array, count: number, triangles: number,
 *   skeleton: { name: string, parent: number, pivot: number[] }[],
 *   legs: Record<'fl' | 'fr' | 'hl' | 'hr', CrawlerLeg>, stalks: Record<'l' | 'r', { base: number[], tip: number[] }>,
 *   widthM: number, lengthM: number, heightM: number, mPerUnit: number, parts: Record<string, number>,
 *   joints: Uint8Array, weights: Uint8Array, positions: Float32Array, surface: Float32Array,
 * }} CrawlerModel surface: Matt's modelled cobbles a vertex (seam 0..1, cobble shade 0..1), a second vertex buffer
 */

/** @param {string | URL} url @returns {Promise<CrawlerModel>} */
export async function loadCrawlerModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The crawler model did not load (${res.status}).`);
  return crawlerModel(readGlb(await res.arrayBuffer()));
}

/** @param {import('../../render/gltf.js').Glb} glb @returns {CrawlerModel} */
export function crawlerModel(glb) {
  const mesh = meshesByName(glb).get('crawler');
  if (!mesh) throw new Error('crawler.glb has no mesh named crawler');
  const A = mesh.attributes, P = A.POSITION, N = A.NORMAL, C = A.COLOR_0, n = P.length / 3;
  const vertices = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { vertices[i * 9 + k] = P[i * 3 + k]; vertices[i * 9 + 3 + k] = N[i * 3 + k]; vertices[i * 9 + 6 + k] = C[i * 3 + k]; }
  }
  const joints = /** @type {Uint8Array} */ (A.JOINTS_0), weights = /** @type {Uint8Array} */ (A.WEIGHTS_0);
  const x = glb.json.nodes.find((/** @type {any} */ nd) => nd.name === 'crawler')?.extras ?? {};
  return {
    data: packMesh({ vertices, count: n }, joints, weights), indices: mesh.indices, count: n, triangles: mesh.indices.length / 3,
    skeleton: x.skeleton, legs: x.legs, stalks: x.stalks, widthM: x.widthM, lengthM: x.lengthM, heightM: x.heightM, mPerUnit: x.mPerUnit, parts: x.triangles,
    joints, weights, positions: /** @type {Float32Array} */ (P), surface: Float32Array.from(A._SURFACE),
  };
}
