// @ts-check
// A moon jelly in the net (docs/future/12, K6): the stranded jellyfish's generator
// (src/world/finds/jelly.js), domed as a living bell instead of slumped on the sand, sized to the
// catch and turned into the creature pass's layout (its optical depth dropped). The rarer blue-ringed
// form only recolours the four rings. Pure.

import { jellyMesh, JELLY_FLOATS } from '../../finds/jelly.js';

/**
 * @param {{ lengthM: number, morph: boolean, variant: number }} n @param {any} kind
 *   recipes/world/nets.json catches.kinds.moonjelly
 * @returns {{ vertices: Float32Array, indices: Uint32Array, count: number }}
 */
export function jellyCatch(n, kind) {
  const S = n.morph && kind.morph?.rings ? { ...kind.shape, gonads: { ...kind.shape.gonads, albedo: kind.morph.rings } } : kind.shape;
  const m = jellyMesh(S, n.variant);
  const v = new Float32Array(m.count * 9);
  for (let i = 0; i < m.count; i++) {
    const s = i * JELLY_FLOATS;
    v[i * 9] = m.vertices[s] * n.lengthM; v[i * 9 + 1] = m.vertices[s + 1] * n.lengthM; v[i * 9 + 2] = m.vertices[s + 2] * n.lengthM;
    v.set(m.vertices.subarray(s + 3, s + 9), i * 9 + 3);
  }
  return { vertices: v, indices: m.indices, count: m.count };
}
