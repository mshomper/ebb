// @ts-check
// The soot mote's model (H2; Matt's, from nTop, October 27, 2026): assets/models/hollow/mote.glb, made
// by tools/hollow-prep/mote.py. Metres, Y up, facing +z, centred on its bounds, sizeM across when made;
// a mote is drawn at the recipe's sizeM, so scale() follows the recipe live. The eyes are not geometry:
// the node's extras give the shader's placements (lib-mote.wgsl), left (+x) first.

import { readGlb, meshesByName } from '../../render/gltf.js';

/**
 * @typedef {{
 *   data: Float32Array, indices: Uint32Array, triangles: number, acrossM: number,
 *   eyes: { centre: number[], axis: number[], radiusM: number }[],
 * }} MoteModel data: position and normal a vertex (6 floats)
 */

/** @param {string | URL} url @returns {Promise<MoteModel>} */
export async function loadMoteModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The mote model did not load (${res.status}).`);
  return moteModel(readGlb(await res.arrayBuffer()));
}

/** @param {import('../../render/gltf.js').Glb} glb @returns {MoteModel} */
export function moteModel(glb) {
  const mesh = meshesByName(glb).get('mote');
  if (!mesh) throw new Error('mote.glb has no mesh named mote');
  const P = mesh.attributes.POSITION, N = mesh.attributes.NORMAL, n = P.length / 3;
  const data = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { data[i * 6 + k] = P[i * 3 + k]; data[i * 6 + 3 + k] = N[i * 3 + k]; }
  }
  const x = glb.json.nodes.find((/** @type {any} */ nd) => nd.name === 'mote')?.extras ?? {};
  return { data, indices: mesh.indices, triangles: mesh.indices.length / 3, acrossM: x.acrossM, eyes: x.eyes };
}

/** Model metres to world metres, for a mote sizeM across. @param {MoteModel} model @param {number} sizeM */
export const moteScale = (model, sizeM) => sizeM / model.acrossM;
