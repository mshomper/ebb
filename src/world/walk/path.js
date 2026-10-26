// @ts-check
// Finding the way on the walk grid (doc 23, the walker; W1). A* over the eight neighbours of each
// cell, where a cell is open if it is not too steep and the water over it right now is shallower
// than knee deep; a step between neighbours may climb at most maxStepM (a cliff face is more), and
// a diagonal needs both cells beside it open, so the walker never cuts a corner. Wading costs more
// than dry ground, so the way goes round a pond when it can. The cell path is then pulled straight
// where a straight line stays open, so the figure walks in long lines, not along the grid.
// Pure: safe to import from tools pages and tests.

/** @typedef {import('./grid.js').WalkGrid} WalkGrid */

/**
 * @typedef {Object} WalkRules
 * @property {(k: number) => number} depth water over a cell right now (m)
 * @property {number} wadeM water must be shallower than this to walk through
 * @property {number} wadeCost extra cost of wading, at wadeM deep (1 doubles the cost)
 * @property {number} maxStepM the most the ground may climb or drop between two neighbours
 * @property {number} snapM a goal you can't stand on moves to the nearest open cell within this
 */

/**
 * @typedef {{ ok: true, points: [number, number][], goal: [number, number] }
 *   | { ok: false, reason: 'nowhere' | 'cut-off' }} PathResult
 *   points: from the start (exclusive) to the goal, world x, z; nowhere: no ground to stand on
 *   near the goal; cut-off: the goal can't be reached from the start on foot
 */

const SQRT2 = Math.SQRT2;
const NEIGH = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Is a cell open to stand on? @param {WalkGrid} g @param {WalkRules} r @param {number} k */
export function isOpen(g, r, k) {
  return k >= 0 && !g.steep[k] && !g.blocked?.[k] && r.depth(k) < r.wadeM;
}

/**
 * The nearest open cell to a point within a reach, or -1. Rings outward, nearest center first.
 * @param {WalkGrid} g @param {WalkRules} r @param {number} x @param {number} z @param {number} reachM
 */
export function nearestOpen(g, r, x, z, reachM) {
  const k0 = g.cellAt(x, z);
  if (isOpen(g, r, k0)) return k0;
  const ci = Math.floor((x - g.minX) / g.cellM), cj = Math.floor((z - g.minZ) / g.cellM);
  const n = Math.ceil(reachM / g.cellM);
  let best = -1, bestD = Infinity;
  for (let ring = 1; ring <= n; ring++) {
    for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const k = j * g.w + i;
      if (!isOpen(g, r, k)) continue;
      const [cx, cz] = g.center(k);
      const d = Math.hypot(cx - x, cz - z);
      if (d <= reachM && d < bestD) { bestD = d; best = k; }
    }
    // A ring further out can't hold anything nearer than this ring's best by more than a cell.
    if (best >= 0 && bestD <= ring * g.cellM) break;
  }
  return best;
}

/**
 * Can the walker go straight from a to b? Every cell the line passes through open, no step too
 * high, and where it crosses a corner both cells beside it open (no cutting corners, as A* rules).
 * The cells are walked exactly (Amanatides and Woo, "A Fast Voxel Traversal Algorithm", 1987): it
 * once sampled the line every quarter metre, which missed a cell the line only clipped at a corner,
 * so a straight leg over pond stones could cut through the deep water beside them (F10).
 * @param {WalkGrid} g @param {WalkRules} r @param {[number, number]} a @param {[number, number]} b
 */
export function lineOpen(g, r, a, b) {
  const c = g.cellM, dx = b[0] - a[0], dz = b[1] - a[1];
  let i = Math.floor((a[0] - g.minX) / c), j = Math.floor((a[1] - g.minZ) / c);
  const iEnd = Math.floor((b[0] - g.minX) / c), jEnd = Math.floor((b[1] - g.minZ) / c);
  const si = Math.sign(dx), sj = Math.sign(dz);
  const tdx = dx !== 0 ? c / Math.abs(dx) : Infinity, tdz = dz !== 0 ? c / Math.abs(dz) : Infinity;
  let tx = dx !== 0 ? ((i + (si > 0 ? 1 : 0)) * c + g.minX - a[0]) / dx : Infinity;
  let tz = dz !== 0 ? ((j + (sj > 0 ? 1 : 0)) * c + g.minZ - a[1]) / dz : Infinity;
  const idx = (/** @type {number} */ ci, /** @type {number} */ cj) => (ci < 0 || cj < 0 || ci >= g.w || cj >= g.h ? -1 : cj * g.w + ci);
  let prev = idx(i, j);
  /** Step into a cell from prev: open, and no climb or drop past the step limit. @param {number} k */
  const ok = (k) => isOpen(g, r, k) && (prev < 0 || Math.abs(g.height[k] - g.height[prev]) <= r.maxStepM);
  const EPS = 1e-9;
  for (let guard = 0; (i !== iEnd || j !== jEnd) && guard < g.w + g.h + 4; guard++) {
    if (Math.min(tx, tz) > 1 + EPS) break;
    if (Math.abs(tx - tz) <= EPS) {
      // Through a corner: both cells beside it must be open, and then the diagonal one.
      const side1 = idx(i + si, j), side2 = idx(i, j + sj);
      if (!ok(side1) || !ok(side2)) return false;
      i += si; j += sj; tx += tdx; tz += tdz;
    } else if (tx < tz) { i += si; tx += tdx; }
    else { j += sj; tz += tdz; }
    const k = idx(i, j);
    if (!ok(k)) return false;
    prev = k;
  }
  return true;
}

/**
 * The way from one point to another on foot.
 * @param {WalkGrid} g @param {WalkRules} r @param {[number, number]} from @param {[number, number]} to
 * @returns {PathResult}
 */
export function findPath(g, r, from, to) {
  const start = g.cellAt(from[0], from[1]);
  const goal = nearestOpen(g, r, to[0], to[1], r.snapM);
  if (goal < 0 || start < 0) return { ok: false, reason: 'nowhere' };
  const cells = goal === start ? [goal] : search(g, r, start, goal);
  if (!cells) return { ok: false, reason: 'cut-off' };
  // The tapped spot itself when it can be stood on, else the open cell's center.
  const end = /** @type {[number, number]} */ (g.cellAt(to[0], to[1]) === goal ? [to[0], to[1]] : g.center(goal));
  /** @type {[number, number][]} */
  const pts = [[from[0], from[1]], ...cells.slice(1, -1).map((k) => g.center(k)), end];
  return { ok: true, points: pull(g, r, pts).slice(1), goal: end };
}

/**
 * A* from start to goal; the cells in order, or null when the goal can't be reached.
 * @param {WalkGrid} g @param {WalkRules} r @param {number} start @param {number} goal
 */
function search(g, r, start, goal) {
  const N = g.w * g.h;
  const cost = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  /** Depth read once per cell (the live water is asked at most once). */
  const depth = new Float32Array(N).fill(NaN);
  const deep = (/** @type {number} */ k) => (Number.isNaN(depth[k]) ? (depth[k] = r.depth(k)) : depth[k]);
  const open = (/** @type {number} */ k) => !g.steep[k] && !g.blocked?.[k] && deep(k) < r.wadeM;
  const gi = goal % g.w, gj = Math.floor(goal / g.w);
  const guess = (/** @type {number} */ k) => {
    const dx = Math.abs((k % g.w) - gi), dz = Math.abs(Math.floor(k / g.w) - gj);
    return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * g.cellM;
  };
  const heap = createHeap();
  cost[start] = 0;
  heap.push(start, guess(start));
  while (heap.size) {
    const k = heap.pop();
    if (done[k]) continue;
    if (k === goal) break;
    done[k] = 1;
    const i = k % g.w, j = Math.floor(k / g.w);
    for (const [di, dj] of NEIGH) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
      const nk = nj * g.w + ni;
      if (done[nk] || !open(nk)) continue;
      const diag = di !== 0 && dj !== 0;
      if (diag && (!open(j * g.w + ni) || !open(nj * g.w + i))) continue;
      if (Math.abs(g.height[nk] - g.height[k]) > r.maxStepM * (diag ? SQRT2 : 1)) continue;
      const step = g.cellM * (diag ? SQRT2 : 1) * (1 + (r.wadeCost * deep(nk)) / r.wadeM);
      const c = cost[k] + step;
      if (c < cost[nk]) {
        cost[nk] = c;
        came[nk] = k;
        heap.push(nk, c + guess(nk));
      }
    }
  }
  if (came[goal] < 0) return null;
  const cells = [goal];
  for (let k = came[goal]; k >= 0; k = came[k]) cells.push(k);
  return cells.reverse();
}

/**
 * Pull a cell path straight: from each point, jump to the furthest later point in a clear line.
 * @param {WalkGrid} g @param {WalkRules} r @param {[number, number][]} pts
 */
function pull(g, r, pts) {
  /** @type {[number, number][]} */
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineOpen(g, r, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** A small binary min-heap of cell indices by priority. */
function createHeap() {
  /** @type {number[]} */ const keys = [];
  /** @type {number[]} */ const pri = [];
  return {
    get size() { return keys.length; },
    /** @param {number} k @param {number} p */
    push(k, p) {
      let n = keys.length;
      keys.push(k); pri.push(p);
      while (n > 0) {
        const up = (n - 1) >> 1;
        if (pri[up] <= p) break;
        keys[n] = keys[up]; pri[n] = pri[up];
        n = up;
      }
      keys[n] = k; pri[n] = p;
    },
    pop() {
      const top = keys[0];
      const k = /** @type {number} */ (keys.pop()), p = /** @type {number} */ (pri.pop());
      if (keys.length) {
        let n = 0;
        const len = keys.length;
        for (;;) {
          const a = 2 * n + 1, b = a + 1;
          let m = n, mp = p;
          if (a < len && pri[a] < mp) { m = a; mp = pri[a]; }
          if (b < len && pri[b] < mp) { m = b; mp = pri[b]; }
          if (m === n) break;
          keys[n] = keys[m]; pri[n] = pri[m];
          n = m;
        }
        keys[n] = k; pri[n] = p;
      }
      return top;
    },
  };
}
