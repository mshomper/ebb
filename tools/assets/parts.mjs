// Separate pieces fused into one mesh (models.json `part`: Matt's two driftwood staves in one file,
// C2, October 27, 2026), told apart by connected triangles: triangles sharing a corner (by position,
// so UV seams do not split a piece) are one piece. Pieces of at least minTris triangles, ordered left to
// right along x; `keep` keeps one. Build-time only.

import { compactPrimitive } from '@gltf-transform/functions';

/**
 * @param {import('@gltf-transform/core').Primitive} p
 * @param {{ keep: number, minTris?: number }} rule
 * @returns {{ pieces: number, triangles: number[] }} how many pieces there were, and each one's triangles
 */
export function keepPart(p, rule) {
  const pos = /** @type {Float32Array} */ (p.getAttribute('POSITION').getArray()), ix = p.getIndices().getArray();
  const nv = pos.length / 3, spot = new Map(), of = new Uint32Array(nv);
  for (let v = 0; v < nv; v++) {
    const key = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`;
    if (!spot.has(key)) spot.set(key, spot.size);
    of[v] = spot.get(key);
  }
  // Union the corners of each triangle.
  const up = Int32Array.from({ length: spot.size }, (_, i) => i);
  const find = (/** @type {number} */ a) => { while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; } return a; };
  for (let t = 0; t < ix.length; t += 3) {
    const a = find(of[ix[t]]), b = find(of[ix[t + 1]]), c = find(of[ix[t + 2]]);
    up[b] = a; up[find(c)] = a;
  }
  /** @type {Map<number, { tris: number[], x: number }>} */ const groups = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    const g = find(of[ix[t]]), e = groups.get(g) ?? { tris: [], x: 0 };
    e.tris.push(t);
    e.x += (pos[ix[t] * 3] + pos[ix[t + 1] * 3] + pos[ix[t + 2] * 3]) / 3;
    groups.set(g, e);
  }
  const pieces = [...groups.values()].filter((g) => g.tris.length >= (rule.minTris ?? 100))
    .map((g) => ({ ...g, x: g.x / g.tris.length })).sort((a, b) => a.x - b.x);
  const keep = [];
  for (const t of pieces[rule.keep]?.tris ?? []) keep.push(ix[t], ix[t + 1], ix[t + 2]);
  p.getIndices().setArray(keep.every((i) => i < 65536) ? Uint16Array.from(keep) : Uint32Array.from(keep));
  compactPrimitive(p);
  return { pieces: pieces.length, triangles: pieces.map((g) => g.tris.length) };
}
