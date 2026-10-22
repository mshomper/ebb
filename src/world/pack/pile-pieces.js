// @ts-check
// A pile builds up the way a real one does (Matt, October 22, 2026): its model is split into its
// separate pieces (each log, each stone), ordered from the bottom up, and a pile that is not yet full
// shows only its first pieces, at their real size. A small heap shows the bottom few; the whole
// model is only the full pile.
//
// Pieces are the mesh's connected parts. Vertices split at a UV seam share a position, so they are
// joined by position (to a millimeter) before the parts are found. Parts are ordered by the height
// of their lowest point, then by distance from the middle, so a piece never shows before those it
// rests on. Pure.

/** @typedef {import('./pickup-meshes.js').Mesh} Mesh */

/**
 * The pieces of a mesh in the creature pass's layout (9 floats a vertex, position first), bottom up:
 * its indices reordered piece by piece, and where each piece's triangles end.
 * @param {Mesh} m
 * @returns {{ indices: Uint32Array, ends: number[] }} ends: index count after each piece, in order
 */
export function splitPieces(m) {
  const n = m.count;
  // One id per position (seams split vertices that share a place).
  /** @type {Map<string, number>} */ const at = new Map();
  const weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(m.vertices[i * 9] * 1000)},${Math.round(m.vertices[i * 9 + 1] * 1000)},${Math.round(m.vertices[i * 9 + 2] * 1000)}`;
    let id = at.get(k);
    if (id === undefined) { id = at.size; at.set(k, id); }
    weld[i] = id;
  }
  // Union-find over the welded positions, joined along every triangle.
  const parent = new Int32Array(at.size).map((_, i) => i);
  /** @param {number} a */
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const tris = m.indices.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = find(weld[m.indices[t * 3]]), b = find(weld[m.indices[t * 3 + 1]]), c = find(weld[m.indices[t * 3 + 2]]);
    parent[b] = a; parent[find(c)] = a;
  }
  // Each piece: its triangles, its lowest point and its middle.
  /** @type {Map<number, { tris: number[], minY: number, sx: number, sz: number, k: number }>} */ const pieces = new Map();
  for (let t = 0; t < tris; t++) {
    const root = find(weld[m.indices[t * 3]]);
    let p = pieces.get(root);
    if (!p) { p = { tris: [], minY: Infinity, sx: 0, sz: 0, k: 0 }; pieces.set(root, p); }
    p.tris.push(t);
    for (let j = 0; j < 3; j++) {
      const v = m.indices[t * 3 + j];
      p.minY = Math.min(p.minY, m.vertices[v * 9 + 1]);
      p.sx += m.vertices[v * 9]; p.sz += m.vertices[v * 9 + 2]; p.k++;
    }
  }
  const list = [...pieces.values()].sort((a, b) =>
    a.minY - b.minY || Math.hypot(a.sx / a.k, a.sz / a.k) - Math.hypot(b.sx / b.k, b.sz / b.k));
  const indices = new Uint32Array(m.indices.length);
  /** @type {number[]} */ const ends = [];
  let o = 0;
  for (const p of list) {
    for (const t of p.tris) { indices[o++] = m.indices[t * 3]; indices[o++] = m.indices[t * 3 + 1]; indices[o++] = m.indices[t * 3 + 2]; }
    ends.push(o);
  }
  return { indices, ends };
}

/**
 * Does the mesh come apart into pieces a pile can build up from? Not when one piece holds most of
 * it: a scanned pile fused into one surface (as the camp's log and stone piles are, October 22, 2026)
 * would show nearly whole from the first handful.
 * @param {{ ends: number[] }} split @param {number} [mostShare] the largest piece's share of the triangles above which it does not
 */
export function buildsUp(split, mostShare = 0.5) {
  let most = 0, prev = 0;
  for (const e of split.ends) { most = Math.max(most, e - prev); prev = e; }
  return split.ends.length > 1 && most <= mostShare * prev;
}

/**
 * The mesh scaled about its base middle (for a pile that cannot build up piece by piece).
 * @param {Mesh} m @param {number} k @returns {Mesh}
 */
export function scaledMesh(m, k) {
  const vertices = m.vertices.slice();
  for (let i = 0; i < m.count; i++) for (let c = 0; c < 3; c++) vertices[i * 9 + c] *= k;
  return { vertices, count: m.count, indices: m.indices };
}

/**
 * The mesh showing only its first share of pieces (at least one), bottom up.
 * @param {Mesh} m @param {{ indices: Uint32Array, ends: number[] }} split @param {number} share 0..1
 * @returns {Mesh}
 */
export function firstPieces(m, split, share) {
  const n = split.ends.length;
  const keep = Math.max(1, Math.min(n, Math.ceil(share * n)));
  return { vertices: m.vertices, count: m.count, indices: split.indices.slice(0, split.ends[keep - 1]) };
}
