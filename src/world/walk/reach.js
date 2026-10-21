// @ts-check
// Never trapped (doc 23, the walker; approved October 21, 2026). The mainland is the biggest
// stretch of ground you can walk around without climbing a cliff or swimming, found by flooding
// the walk grid with the same rules the way-finding uses. After every stroke the figure is asked
// whether it still stands on the mainland as it would be at low water (so waiting on the islet
// for the tide is fine, and a ring of terraces round you is not); I'm stuck asks the same with the
// water as it is now. Either way, the answer is the nearest spot on the mainland.
// Pure: safe to import from tools pages and tests.

import { isOpen } from './path.js';

const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Label every open cell by the stretch of ground it belongs to; the biggest stretch is the mainland.
 * @param {import('./grid.js').WalkGrid} g @param {import('./path.js').WalkRules} r
 * @returns {{ label: Int32Array, main: number, joined: (k: number) => boolean }}
 *   label: -1 where you can't stand; main: the mainland's label (-1 if there is no ground at all)
 */
export function mainland(g, r) {
  const N = g.w * g.h;
  const open = new Uint8Array(N);
  for (let k = 0; k < N; k++) open[k] = isOpen(g, r, k) ? 1 : 0;
  const label = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  let next = 0, main = -1, mainSize = 0;
  for (let s = 0; s < N; s++) {
    if (!open[s] || label[s] >= 0) continue;
    const id = next++;
    let top = 0, size = 0;
    stack[top++] = s;
    label[s] = id;
    while (top) {
      const k = stack[--top];
      size++;
      const i = k % g.w, j = (k - i) / g.w;
      for (const [di, dj] of NEIGH) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
        const nk = nj * g.w + ni;
        if (!open[nk] || label[nk] >= 0) continue;
        const diag = di !== 0 && dj !== 0;
        if (diag && (!open[j * g.w + ni] || !open[nj * g.w + i])) continue;
        if (Math.abs(g.height[nk] - g.height[k]) > r.maxStepM * (diag ? Math.SQRT2 : 1)) continue;
        label[nk] = id;
        stack[top++] = nk;
      }
    }
    if (size > mainSize) { mainSize = size; main = id; }
  }
  return { label, main, joined: (k) => k >= 0 && main >= 0 && label[k] === main };
}

/**
 * The nearest mainland cell to a point, or -1 if there is none.
 * @param {import('./grid.js').WalkGrid} g @param {ReturnType<typeof mainland>} land @param {number} x @param {number} z
 * @param {(k: number) => boolean} [ok] also required of the cell (standing room now)
 */
export function nearestJoined(g, land, x, z, ok = () => true) {
  const ci = Math.floor((x - g.minX) / g.cellM), cj = Math.floor((z - g.minZ) / g.cellM);
  const most = Math.max(g.w, g.h);
  let best = -1, bestD = Infinity;
  for (let ring = 0; ring <= most; ring++) {
    for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const k = j * g.w + i;
      if (!land.joined(k) || !ok(k)) continue;
      const [cx, cz] = g.center(k);
      const d = Math.hypot(cx - x, cz - z);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best >= 0 && bestD <= ring * g.cellM) break;
  }
  return best;
}
