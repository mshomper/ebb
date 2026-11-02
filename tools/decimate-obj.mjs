// Cut an OBJ mesh to fewer triangles (quadric edge collapse, Garland and Heckbert), for a game copy
// of a supplied model. Only with Matt's go for that model (the seal: Matt, November 1, 2026). The
// source file is only read; the cut copy is written where you say.
//
//   node tools/decimate-obj.mjs <in.obj> <out.obj> <triangles>
//
// Each edge's cost is the summed plane distance squared at the collapsed spot (the best of the two
// ends and the middle); the cheapest goes first, and a collapse that would flip a triangle or join
// two open edges' far sides is skipped. Positions only: the copy keeps no normals (the game works
// them out).

import fs from 'node:fs';

const [, , inPath, outPath, target] = process.argv;
if (!inPath || !outPath || !target) { console.error('usage: node tools/decimate-obj.mjs <in.obj> <out.obj> <triangles>'); process.exit(1); }

const text = fs.readFileSync(inPath, 'utf8').split(/\r?\n/);
/** @type {number[][]} */ const P = [];
/** @type {number[][]} */ let F = [];
for (const l of text) {
  if (l.startsWith('v ')) P.push(l.trim().split(/\s+/).slice(1, 4).map(Number));
  else if (l.startsWith('f ')) {
    const ids = l.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1);
    for (let i = 1; i + 1 < ids.length; i++) F.push([ids[0], ids[i], ids[i + 1]]);
  }
}
const want = Number(target);
console.log(`${inPath}: ${P.length} vertices, ${F.length} triangles -> ${want}`);

/** @param {number[]} a @param {number[]} b */ const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a @param {number[]} b */ const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {number[]} a @param {number[]} b */ const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A triangle's unit normal and area. @param {number[]} f */
function faceN(f) {
  const n = cross(sub(P[f[1]], P[f[0]]), sub(P[f[2]], P[f[0]]));
  const l = Math.hypot(n[0], n[1], n[2]);
  return { n: l > 0 ? n.map((x) => x / l) : [0, 0, 0], area: l / 2 };
}

// Quadrics: 10 numbers a vertex (the symmetric 4x4), area weighted.
const Q = P.map(() => new Float64Array(10));
/** @param {Float64Array} q @param {number[]} n @param {number} d @param {number} w */
function addPlane(q, n, d, w) {
  const [a, b, c] = n;
  q[0] += w * a * a; q[1] += w * a * b; q[2] += w * a * c; q[3] += w * a * d;
  q[4] += w * b * b; q[5] += w * b * c; q[6] += w * b * d;
  q[7] += w * c * c; q[8] += w * c * d; q[9] += w * d * d;
}
/** @param {Float64Array} q @param {number[]} v */
function cost(q, v) {
  const [x, y, z] = v;
  return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
}
for (const f of F) {
  const { n, area } = faceN(f);
  const d = -dot(n, P[f[0]]);
  for (const v of f) addPlane(Q[v], n, d, area);
}
// Open edges hold their place: a steep plane through each, along the face.
/** @type {Map<string, number>} */ const edgeUse = new Map();
const ek = (/** @type {number} */ a, /** @type {number} */ b) => (a < b ? `${a},${b}` : `${b},${a}`);
for (const f of F) for (let i = 0; i < 3; i++) { const k = ek(f[i], f[(i + 1) % 3]); edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1); }
for (const f of F) {
  const { n } = faceN(f);
  for (let i = 0; i < 3; i++) {
    const a = f[i], b = f[(i + 1) % 3];
    if (edgeUse.get(ek(a, b)) !== 1) continue;
    const e = sub(P[b], P[a]), el = Math.hypot(...e);
    const m = cross(e, n), ml = Math.hypot(...m) || 1, mn = m.map((x) => x / ml);
    addPlane(Q[a], mn, -dot(mn, P[a]), el * el * 100);
    addPlane(Q[b], mn, -dot(mn, P[b]), el * el * 100);
  }
}

// Vertex to faces.
/** @type {Set<number>[]} */ const vf = P.map(() => new Set());
F.forEach((f, i) => f.forEach((v) => vf[v].add(i)));
const alive = F.map(() => true);
let live = F.length;

/** The best spot and cost to join a and b. @param {number} a @param {number} b */
function plan(a, b) {
  const q = new Float64Array(10);
  for (let i = 0; i < 10; i++) q[i] = Q[a][i] + Q[b][i];
  const mid = [0, 1, 2].map((i) => (P[a][i] + P[b][i]) / 2);
  let best = mid, c = cost(q, mid);
  for (const v of [P[a], P[b]]) { const cv = cost(q, v); if (cv < c) { c = cv; best = v.slice(); } }
  return { at: best, cost: c };
}

// A binary heap of edges by cost; stale entries are skipped by version.
/** @type {{ c: number, a: number, b: number, ver: number }[]} */ const heap = [];
const ver = new Map();
function push(/** @type {{ c: number, a: number, b: number, ver: number }} */ e) {
  heap.push(e);
  let i = heap.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (heap[p].c <= heap[i].c) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
}
function pop() {
  const top = heap[0], last = heap.pop();
  if (heap.length && last) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < heap.length && heap[l].c < heap[m].c) m = l;
      if (r < heap.length && heap[r].c < heap[m].c) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
    }
  }
  return top;
}
/** @param {number} a @param {number} b */
function queue(a, b) {
  const k = ek(a, b), v = (ver.get(k) ?? 0) + 1;
  ver.set(k, v);
  push({ c: plan(a, b).cost, a: Math.min(a, b), b: Math.max(a, b), ver: v });
}
for (const k of edgeUse.keys()) { const [a, b] = k.split(',').map(Number); queue(a, b); }

const merged = P.map((_, i) => i);
/** Would moving the faces of v (all but those shared with u) to `at` flip any? @param {number} v @param {number} u @param {number[]} at */
function flips(v, u, at) {
  for (const fi of vf[v]) {
    const f = F[fi];
    if (f.includes(u)) continue;
    const before = faceN(f).n;
    const g = f.map((x) => (x === v ? -1 : x));
    const pts = g.map((x) => (x === -1 ? at : P[x]));
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    const l = Math.hypot(...n);
    if (l < 1e-12 || dot(n, before) / l < 0.2) return true;
  }
  return false;
}
/** Neighbours of v. @param {number} v */
function ring(v) { const s = new Set(); for (const fi of vf[v]) for (const x of F[fi]) if (x !== v) s.add(x); return s; }

while (live > want && heap.length) {
  const e = pop();
  if (ver.get(ek(e.a, e.b)) !== e.ver) continue;
  const { a, b } = e;
  if (merged[a] !== a || merged[b] !== b) continue;
  // Link condition: they share exactly the faces' third vertices (keeps the surface a manifold).
  const ra = ring(a), rb = ring(b);
  let shared = 0;
  for (const x of ra) if (rb.has(x)) shared++;
  const sharedFaces = [...vf[a]].filter((fi) => F[fi].includes(b)).length;
  if (shared !== sharedFaces) continue;
  const { at } = plan(a, b);
  if (flips(a, b, at) || flips(b, a, at)) continue;
  // Join b into a.
  P[a] = at;
  for (let i = 0; i < 10; i++) Q[a][i] += Q[b][i];
  merged[b] = a;
  for (const fi of [...vf[b]]) {
    const f = F[fi];
    if (f.includes(a)) { alive[fi] = false; live--; for (const x of f) vf[x].delete(fi); continue; }
    F[fi] = f.map((x) => (x === b ? a : x));
    vf[a].add(fi);
  }
  vf[b].clear();
  for (const x of ring(a)) queue(a, x);
}

// Write the survivors, renumbered.
const keep = new Map();
const out = [`# ${inPath.split(/[\\/]/).pop()} cut to ${live} triangles by tools/decimate-obj.mjs`];
/** @type {string[]} */ const faces = [];
F.forEach((f, i) => {
  if (!alive[i]) return;
  const ids = f.map((v) => { if (!keep.has(v)) { keep.set(v, keep.size + 1); out.push(`v ${P[v].map((x) => +x.toFixed(4)).join(' ')}`); } return keep.get(v); });
  faces.push(`f ${ids.join(' ')}`);
});
fs.writeFileSync(outPath, [...out, ...faces, ''].join('\n'));
console.log(`${outPath}: ${keep.size} vertices, ${live} triangles`);
