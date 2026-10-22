// @ts-check
// The island's water table (docs/07, "The water table"): a freshwater lens standing at mean sea
// level along the shore and rising gently inland, plus the season curve that lowers rain-fed ponds
// in summer. Pure and worker-safe; the water summary calls it. Integer math throughout, except one
// square root per cell, which IEEE 754 rounds exactly the same on every device.

/** Chamfer steps on the 0.5 m grid: 3 to a side neighbor, 4 to a diagonal (Borgefors 1986). */
const SIDE = 3, DIAG = 4;
const FAR = 0x3fffffff;

/**
 * Distance to the sea per cell, in chamfer units (3 per 0.5 m), by the two-pass 3-4 chamfer
 * transform. Sea cells are 0.
 * @param {Uint8Array} sea 1 for sea cells @param {number} w @param {number} h
 * @returns {Int32Array}
 */
export function seaDistance(sea, w, h) {
  const d = new Int32Array(w * h);
  for (let k = 0; k < d.length; k++) d[k] = sea[k] ? 0 : FAR;
  /** @param {number} k @param {number} q @param {number} c */
  const relax = (k, q, c) => { if (d[q] + c < d[k]) d[k] = d[q] + c; };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!d[k]) continue;
      if (i > 0) relax(k, k - 1, SIDE);
      if (j > 0) {
        relax(k, k - w, SIDE);
        if (i > 0) relax(k, k - w - 1, DIAG);
        if (i < w - 1) relax(k, k - w + 1, DIAG);
      }
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      if (!d[k]) continue;
      if (i < w - 1) relax(k, k + 1, SIDE);
      if (j < h - 1) {
        relax(k, k + w, SIDE);
        if (i < w - 1) relax(k, k + w + 1, DIAG);
        if (i > 0) relax(k, k + w - 1, DIAG);
      }
    }
  }
  return d;
}

/**
 * Water table height above mean sea level per cell, in height steps. On each landmass (8-connected
 * non-sea cells) h = maxQ sqrt(f (2 - f)) with f = d / L, d the cell's distance to the sea and L the
 * largest on that landmass: the Dupuit island lens, steep near the shore and flat in the middle.
 * Sea cells and landmasses that never reach the sea (none on a real island) get 0.
 * @param {Uint8Array} sea @param {number} w @param {number} h @param {number} maxQ table height at
 *   the middle of a landmass (height steps) @param {Int32Array} queue scratch, length >= w * h
 * @returns {Uint16Array}
 */
export function waterTable(sea, w, h, maxQ, queue) {
  const n = w * h;
  const dist = seaDistance(sea, w, h);
  const out = new Uint16Array(n);
  if (maxQ <= 0) return out;
  const land = new Int32Array(n);   // landmass id, 1-based
  for (let k0 = 0; k0 < n; k0++) {
    if (sea[k0] || land[k0]) continue;
    const id = k0 + 1;
    let qh = 0, qt = 0, L = 0;
    land[k0] = id;
    queue[qt++] = k0;
    while (qh < qt) {
      const k = queue[qh++];
      if (dist[k] < FAR && dist[k] > L) L = dist[k];
      const i = k % w, j = (k - i) / w;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di, nj = j + dj;
          if ((!di && !dj) || ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const q = nj * w + ni;
          if (sea[q] || land[q]) continue;
          land[q] = id;
          queue[qt++] = q;
        }
      }
    }
    if (!L) continue;
    for (let p = 0; p < qt; p++) {
      const k = queue[p], d = dist[k];
      if (d >= FAR) continue;
      out[k] = Math.floor((maxQ * Math.sqrt(d * (2 * L - d))) / L);
    }
  }
  return out;
}

/**
 * How far into its summer lowering the year is, 0..1000 (integers): 0 from mid-autumn through
 * winter and spring, rising smoothly from days[0] to 1000 at days[1] (late summer), falling back to
 * 0 by days[2]. Days count from the first day of spring, 0..55.
 * @param {number} yearDay @param {number[]} days [start, peak, end]
 */
export function drawdownShare(yearDay, days) {
  const [a, b, c] = days;
  const day = yearDay | 0;
  let p;
  if (day <= a || day >= c) return 0;
  if (day < b) p = Math.floor(((day - a) * 1000) / (b - a));
  else p = Math.floor(((c - day) * 1000) / (c - b));
  // Smoothstep 3p^2 - 2p^3 in thousandths.
  return Math.floor((p * p * (3000 - 2 * p)) / 1000000);
}
