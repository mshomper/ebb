// The herb bunches lifted off Matt's drying rack (drop-paint.mjs, keep), told apart (models.json
// `bunches`): each bunch is many leaf pieces close together, so triangles whose middles fall in
// touching cells of cellShare of the model's height are one bunch. The bunches of at least minTris
// triangles, in rows from the top and left to right in each, with where each hangs from its bar (the
// middle of its top). With `bunchOf: i`, only bunch i is kept, to be drawn on its own. Build-time only.

import { compactPrimitive } from '@gltf-transform/functions';

/**
 * @param {import('@gltf-transform/core').Primitive} p
 * @param {{ cellShare: number, minTris: number, rowShare: number }} rule rowShare: tops this near (share
 *   of the height) are one row
 * @returns {{ tris: number[][], hangs: number[][] }} each bunch's triangle starts, and its hang point
 */
export function findBunches(p, rule) {
  const pos = /** @type {Float32Array} */ (p.getAttribute('POSITION').getArray()), ix = p.getIndices().getArray();
  let lo = Infinity, hi = -Infinity;
  for (let v = 1; v < pos.length; v += 3) { lo = Math.min(lo, pos[v]); hi = Math.max(hi, pos[v]); }
  const cell = (hi - lo) * rule.cellShare;
  const mid = (/** @type {number} */ t, /** @type {number} */ k) => (pos[ix[t] * 3 + k] + pos[ix[t + 1] * 3 + k] + pos[ix[t + 2] * 3 + k]) / 3;
  /** @type {Map<string, number[]>} */ const cells = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    const key = [0, 1, 2].map((k) => Math.floor(mid(t, k) / cell)).join(',');
    const s = cells.get(key) ?? [];
    s.push(t);
    cells.set(key, s);
  }
  // Flood the touching cells into bunches.
  /** @type {Set<string>} */ const seen = new Set();
  /** @type {number[][]} */ const found = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const stack = [start], tris = [];
    seen.add(start);
    while (stack.length) {
      const key = /** @type {string} */ (stack.pop());
      tris.push(.../** @type {number[]} */ (cells.get(key)));
      const [a, b, c] = key.split(',').map(Number);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const n = `${a + i},${b + j},${c + k}`;
        if (cells.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    if (tris.length >= rule.minTris) found.push(tris);
  }
  const hangOf = (/** @type {number[]} */ tris) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = -Infinity;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = ix[t + k];
      x0 = Math.min(x0, pos[v * 3]); x1 = Math.max(x1, pos[v * 3]); z0 = Math.min(z0, pos[v * 3 + 2]); z1 = Math.max(z1, pos[v * 3 + 2]);
      top = Math.max(top, pos[v * 3 + 1]);
    }
    return [(x0 + x1) / 2, top, (z0 + z1) / 2];
  };
  const rowM = (hi - lo) * rule.rowShare;
  const order = found.map((tris) => ({ tris, hang: hangOf(tris) }))
    .sort((a, b) => (Math.abs(a.hang[1] - b.hang[1]) > rowM ? b.hang[1] - a.hang[1] : a.hang[0] - b.hang[0]));
  return { tris: order.map((o) => o.tris), hangs: order.map((o) => o.hang) };
}

/**
 * Only one bunch kept. @param {import('@gltf-transform/core').Primitive} p @param {number[]} tris
 */
export function keepBunch(p, tris) {
  const ix = p.getIndices().getArray(), keep = [];
  for (const t of tris) keep.push(ix[t], ix[t + 1], ix[t + 2]);
  p.getIndices().setArray(keep.every((i) => i < 65536) ? Uint16Array.from(keep) : Uint32Array.from(keep));
  compactPrimitive(p);
}
