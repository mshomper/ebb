// @ts-check
// Quadric edge collapse (Garland and Heckbert): cuts a closed mesh down to about a triangle count,
// spending what is left where the surface bends most. Each vertex keeps the summed planes of the
// triangles it touched (area weighted); the cheapest edge folds into the one point that strays least
// from those planes, over and over, until the count is reached. A fold is refused if it would make the
// mesh pinch (the two ends sharing more than the two triangles across the edge), turn a triangle over
// or leave a sliver. Deterministic: ties go by edge order. Used by tools/hollow-prep/watcher.mjs, so
// the barnacles keep their shells while the smooth pebble round them is cut hardest.

/** A binary min-heap of [cost, a, b, stamp a, stamp b]. */
function heap() {
  /** @type {number[][]} */ const h = [];
  const less = (/** @type {number[]} */ p, /** @type {number[]} */ q) => p[0] < q[0] || (p[0] === q[0] && (p[1] < q[1] || (p[1] === q[1] && p[2] < q[2])));
  return {
    get size() { return h.length; },
    /** @param {number[]} e */
    push(e) {
      h.push(e);
      let i = h.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (!less(h[i], h[p])) break; [h[i], h[p]] = [h[p], h[i]]; i = p; }
    },
    pop() {
      const top = h[0], last = /** @type {number[]} */ (h.pop());
      if (h.length) {
        h[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < h.length && less(h[l], h[m])) m = l;
          if (r < h.length && less(h[r], h[m])) m = r;
          if (m === i) break;
          [h[i], h[m]] = [h[m], h[i]]; i = m;
        }
      }
      return top;
    },
  };
}

/**
 * Cut a closed triangle mesh to about `target` triangles.
 * @param {ArrayLike<number>} pos0 positions, 3 a vertex @param {ArrayLike<number>} idx0 triangles, 3 a face
 * @param {number} target triangles to keep
 * @returns {{ pos: Float64Array, idx: Uint32Array, count: number }}
 */
export function decimate(pos0, idx0, target) {
  const n = pos0.length / 3, m = idx0.length / 3;
  const pos = Float64Array.from(pos0), F = Int32Array.from(idx0);
  const faceAlive = new Uint8Array(m).fill(1), alive = new Uint8Array(n).fill(1), stamp = new Int32Array(n);
  /** @type {number[][]} */ const vf = Array.from({ length: n }, () => []);
  for (let f = 0; f < m; f++) for (let k = 0; k < 3; k++) vf[F[f * 3 + k]].push(f);
  // Each vertex's quadric: the sum over its triangles of area * (plane)(plane)^T, 10 numbers.
  const Q = new Float64Array(n * 10);
  /** A triangle's normal (not unit; its length is twice the area). @param {number} f @param {number} [who] @param {number[]} [at] */
  const normal = (f, who = -1, at = []) => {
    const P = [0, 1, 2].map((k) => { const v = F[f * 3 + k]; return v === who ? at : [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]; });
    const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], w = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    return { n: [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], P };
  };
  for (let f = 0; f < m; f++) {
    const { n: nn, P } = normal(f), l = Math.hypot(nn[0], nn[1], nn[2]);
    if (l < 1e-20) continue;
    const a = nn[0] / l, b = nn[1] / l, c = nn[2] / l, d = -(a * P[0][0] + b * P[0][1] + c * P[0][2]), w = l / 2;
    const q = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d];
    for (let k = 0; k < 3; k++) { const v = F[f * 3 + k]; for (let j = 0; j < 10; j++) Q[v * 10 + j] += q[j] * w; }
  }
  /** The error of point p against quadric q. @param {Float64Array | number[]} q @param {number} o @param {number[]} p */
  const err = (q, o, p) => {
    const [x, y, z] = p;
    return q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x + q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y + q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];
  };
  /** Where edge a-b folds to and what it costs. @param {number} a @param {number} b */
  const plan = (a, b) => {
    const q = new Float64Array(10);
    for (let j = 0; j < 10; j++) q[j] = Q[a * 10 + j] + Q[b * 10 + j];
    const pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], pb = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    // The best point solves the quadric's 3x3 system (Cramer's rule); flat or folded spots fall back.
    const [A, B, C, D, E, Fq, G, H, I] = [q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]];
    const det = A * (E * H - Fq * Fq) - B * (B * H - Fq * C) + C * (B * Fq - E * C);
    /** @type {number[][]} */ const tries = [mid, pa, pb];
    const scale = Math.max(Math.abs(A), Math.abs(E), Math.abs(H), 1e-30);
    if (Math.abs(det) > 1e-9 * scale * scale * scale) {
      const x = (-D * (E * H - Fq * Fq) + B * (G * H - Fq * I) - C * (G * Fq - E * I)) / det;
      const y = (A * (-G * H + Fq * I) + D * (B * H - Fq * C) - C * (B * I - G * C)) / det;
      const z = (A * (-E * I + G * Fq) - B * (-B * I + G * C) - D * (B * Fq - E * C)) / det;
      // Keep it near the edge, so a nearly flat patch can't throw it far.
      const L = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      if (Math.hypot(x - mid[0], y - mid[1], z - mid[2]) < L * 2) tries.unshift([x, y, z]);
    }
    let best = tries[0], cost = Infinity;
    for (const p of tries) { const e = err(q, 0, p); if (e < cost - 1e-18) { cost = e; best = p; } }
    return { p: best, cost: Math.max(0, cost) };
  };
  /** The vertices around v. @param {number} v */
  const ring = (v) => {
    const s = new Set();
    for (const f of vf[v]) if (faceAlive[f]) for (let k = 0; k < 3; k++) { const u = F[f * 3 + k]; if (u !== v) s.add(u); }
    return s;
  };
  const H = heap();
  const push = (/** @type {number} */ a, /** @type {number} */ b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    H.push([plan(lo, hi).cost, lo, hi, stamp[lo], stamp[hi]]);
  };
  const seen = new Set();
  for (let f = 0; f < m; f++) for (let k = 0; k < 3; k++) {
    const a = F[f * 3 + k], b = F[f * 3 + (k + 1) % 3], key = Math.min(a, b) * n + Math.max(a, b);
    if (!seen.has(key)) { seen.add(key); push(a, b); }
  }
  let faces = m;
  while (faces > target && H.size) {
    const [, a, b, sa, sb] = H.pop();
    if (!alive[a] || !alive[b] || stamp[a] !== sa || stamp[b] !== sb) continue;
    // Pinching: the ends may share only the two corners across the edge.
    const ra = ring(a), rb = ring(b);
    if (!ra.has(b)) continue;
    let shared = 0;
    for (const u of ra) if (rb.has(u)) shared++;
    if (shared !== 2) continue;
    const { p } = plan(a, b);
    // No triangle may turn over or become a sliver.
    let ok = true;
    for (const v of [a, b]) {
      for (const f of vf[v]) {
        if (!faceAlive[f]) continue;
        const has = [0, 1, 2].map((k) => F[f * 3 + k]);
        if (has.includes(a) && has.includes(b)) continue;
        const before = normal(f).n, after = normal(f, v, p);
        const lb = Math.hypot(...before), la = Math.hypot(...after.n);
        if (la < 1e-14 || (before[0] * after.n[0] + before[1] * after.n[1] + before[2] * after.n[2]) / (lb * la || 1) < 0.2) { ok = false; break; }
        const P = after.P, e2 = [0, 1, 2].reduce((s, k) => { const q = P[(k + 1) % 3]; return s + (P[k][0] - q[0]) ** 2 + (P[k][1] - q[1]) ** 2 + (P[k][2] - q[2]) ** 2; }, 0);
        if (2 * Math.sqrt(3) * la / e2 < 0.08) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // Fold b into a.
    pos[a * 3] = p[0]; pos[a * 3 + 1] = p[1]; pos[a * 3 + 2] = p[2];
    for (const f of vf[b]) {
      if (!faceAlive[f]) continue;
      const has = [0, 1, 2].map((k) => F[f * 3 + k]);
      if (has.includes(a)) { faceAlive[f] = 0; faces--; continue; }
      for (let k = 0; k < 3; k++) if (F[f * 3 + k] === b) F[f * 3 + k] = a;
      vf[a].push(f);
    }
    vf[a] = vf[a].filter((f) => faceAlive[f]);
    vf[b] = [];
    alive[b] = 0;
    for (let j = 0; j < 10; j++) Q[a * 10 + j] += Q[b * 10 + j];
    // Only a's own edges change (its place and quadric); b's are gone with it.
    stamp[a]++;
    for (const u of ring(a)) push(a, u);
  }
  // Compact: live vertices in order, live triangles in order.
  const remap = new Int32Array(n).fill(-1);
  let count = 0;
  const out = [];
  for (let f = 0; f < m; f++) if (faceAlive[f]) for (let k = 0; k < 3; k++) {
    const v = F[f * 3 + k];
    if (remap[v] < 0) remap[v] = count++;
    out.push(remap[v]);
  }
  const P = new Float64Array(count * 3);
  for (let v = 0; v < n; v++) if (remap[v] >= 0) P.set([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], remap[v] * 3);
  return { pos: P, idx: Uint32Array.from(out), count };
}
