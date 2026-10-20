// Bake a downloaded glTF into a find model (docs/future/11, src/world/finds/models.js): node
// transforms applied, the base color texture sampled into linear vertex colors (COLOR_0), all
// meshes joined, simplified to about a target triangle count, set base down on y = 0 at a height
// of 1, and written as a small .gltf with its .bin. No textures, skins, UVs or animation.
//
//   node tools/bake-find-model.mjs <in.gltf> <out-name> [--tris 1000] [--align valve] [--top]
//
// The two finds baked with it so far:
//   node tools/bake-find-model.mjs <mussel>/scene.gltf mussel-valve --tris 1600 --align valve
//   node tools/bake-find-model.mjs <sand dollar>/scene.gltf sand-dollar --tris 1800 --top
//
// --align valve: a bivalve's single valve (the mussel). Turned so its length runs along x with the
// hinge end (the narrow beak) at -x, its depth along y with the rim on y = 0 and the cup below, so
// the game can mirror it into the other valve and open the pair about the hinge.
//
// Simplification is vertex clustering on a grid, each cluster placed by its vertices' quadric
// error (Lindstrom 2000), which keeps edges and ridges. Run on Matt's machine or here; it is a
// one-off per model, and the output goes under assets/models/finds/ with a line in CREDITS.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (/** @type {string} */ k, /** @type {string} */ d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inPath, outName] = args;
if (!inPath || !outName) { console.error('usage: node tools/bake-find-model.mjs <in.gltf> <out-name> [--tris 1000] [--align valve]'); process.exit(1); }
const target = Number(opt('--tris', '1000'));
const align = opt('--align', '');
const outDir = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '../assets/models/finds');

// ---- read ----
const gltf = JSON.parse(readFileSync(inPath, 'utf8'));
const base = dirname(inPath);
const buffers = gltf.buffers.map((/** @type {any} */ b) => readFileSync(join(base, b.uri)));
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPES = { 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
/** @param {number} i */
function accessor(i) {
  const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView];
  const n = COMP[a.type], [size, get] = TYPES[a.componentType];
  const stride = v.byteStride ?? n * size, off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const buf = buffers[v.buffer], dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[get](off + k * stride + c * size, true);
  if (a.normalized && a.componentType === 5121) for (let k = 0; k < out.length; k++) out[k] /= 255;
  if (a.normalized && a.componentType === 5123) for (let k = 0; k < out.length; k++) out[k] /= 65535;
  return out;
}

// ---- PNG (8-bit, non-interlaced; grey, RGB, RGBA, palette) ----
/** @param {Buffer} png */
function decodePng(png) {
  let p = 8, w = 0, h = 0, depth = 0, type = 0; /** @type {Buffer[]} */ const idat = []; let pal = null;
  while (p < png.length) {
    const len = png.readUInt32BE(p), t = png.toString('ascii', p + 4, p + 8), d = png.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; if (d[12]) throw new Error('interlaced PNG'); }
    else if (t === 'PLTE') pal = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG depth ${depth}`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = inflateSync(Buffer.concat(idat)), row = w * ch, img = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)], src = y * (row + 1) + 1, dst = y * row;
    for (let x = 0; x < row; x++) {
      const a = x >= ch ? img[dst + x - ch] : 0, b = y ? img[dst - row + x] : 0, c = x >= ch && y ? img[dst - row + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      img[dst + x] = v & 255;
    }
  }
  return { w, h, rgb: (/** @type {number} */ i) => (type === 3 ? [pal[img[i] * 3], pal[img[i] * 3 + 1], pal[img[i] * 3 + 2]] : ch < 3 ? [img[i * ch], img[i * ch], img[i * ch]] : [img[i * ch], img[i * ch + 1], img[i * ch + 2]]) };
}
const lin = (/** @type {number} */ c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

// ---- gather every mesh under the scene, transformed ----
/** @param {number[]} a @param {number[]} b column-major 4x4 */
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** @param {any} n */
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
/** @type {number[]} */ const P = []; /** @type {number[]} */ const C = []; /** @type {number[]} */ const T = [];
const textures = new Map();
/** @param {number} ni @param {number[]} M */
function walk(ni, M) {
  const n = gltf.nodes[ni], W = mul(M, local(n));
  if (n.mesh !== undefined) for (const pr of gltf.meshes[n.mesh].primitives) {
    const pos = accessor(pr.attributes.POSITION), v0 = P.length / 3;
    const uv = pr.attributes.TEXCOORD_0 !== undefined ? accessor(pr.attributes.TEXCOORD_0) : null;
    const col = pr.attributes.COLOR_0 !== undefined ? accessor(pr.attributes.COLOR_0) : null;
    const colN = col ? COMP[gltf.accessors[pr.attributes.COLOR_0].type] : 0;
    const mat = gltf.materials?.[pr.material]?.pbrMetallicRoughness ?? {};
    const factor = mat.baseColorFactor ?? [1, 1, 1, 1];
    let tex = null;
    if (mat.baseColorTexture && uv) {
      const src = gltf.textures[mat.baseColorTexture.index].source;
      if (!textures.has(src)) textures.set(src, decodePng(readFileSync(join(base, gltf.images[src].uri))));
      tex = textures.get(src);
    }
    for (let i = 0; i < pos.length / 3; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      P.push(W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]);
      let c = [0.8, 0.8, 0.8];
      if (tex) {
        const u = ((uv[i * 2] % 1) + 1) % 1, v = ((uv[i * 2 + 1] % 1) + 1) % 1;
        const px = Math.min(tex.w - 1, Math.floor(u * tex.w)), py = Math.min(tex.h - 1, Math.floor(v * tex.h));
        c = tex.rgb(py * tex.w + px).map(lin);
      } else if (col) c = [col[i * colN], col[i * colN + 1], col[i * colN + 2]];
      C.push(c[0] * factor[0], c[1] * factor[1], c[2] * factor[2]);
    }
    const idx = pr.indices !== undefined ? accessor(pr.indices) : Array.from({ length: pos.length / 3 }, (_, i) => i);
    for (const k of idx) T.push(k + v0);
  }
  for (const c of n.children ?? []) walk(c, W);
}
for (const r of gltf.scenes[gltf.scene ?? 0].nodes) walk(r, I);
console.log(`read ${P.length / 3} vertices, ${T.length / 3} triangles`);

// ---- align ----
if (align === 'valve') alignValve();
function alignValve() {
  const n = P.length / 3;
  let m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] += P[i * 3 + k] / n;
  // Covariance and its axes (power iteration): length, width, depth.
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) { const d = [0, 1, 2].map((k) => P[i * 3 + k] - m[k]); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b] += d[a] * d[b]; }
  const axes = [];
  let A = cov.slice();
  for (let e = 0; e < 3; e++) {
    let v = [1, 0.3, 0.2];
    for (let it = 0; it < 200; it++) { const w = [0, 1, 2].map((r) => A[r * 3] * v[0] + A[r * 3 + 1] * v[1] + A[r * 3 + 2] * v[2]); const l = Math.hypot(...w) || 1; v = w.map((x) => x / l); }
    for (const u of axes) { const d = v[0] * u[0] + v[1] * u[1] + v[2] * u[2]; v = v.map((x, k) => x - d * u[k]); const l = Math.hypot(...v); v = v.map((x) => x / l); }
    const lam = [0, 1, 2].reduce((s, r) => s + v[r] * (A[r * 3] * v[0] + A[r * 3 + 1] * v[1] + A[r * 3 + 2] * v[2]), 0);
    axes.push(v);
    A = A.map((x, k) => x - lam * v[Math.floor(k / 3)] * v[k % 3]);
  }
  let [ax, az, ay] = axes; // biggest spread: length; then width; least: depth
  const proj = (/** @type {number} */ i, /** @type {number[]} */ u) => (P[i * 3] - m[0]) * u[0] + (P[i * 3 + 1] - m[1]) * u[1] + (P[i * 3 + 2] - m[2]) * u[2];
  // The rim is the depth level where the outline is widest: the mean depth of the points furthest out in plane.
  const pts = Array.from({ length: n }, (_, i) => ({ i, r: Math.hypot(proj(i, ax), proj(i, az)), d: proj(i, ay) })).sort((a, b) => b.r - a.r);
  const rim = pts.slice(0, Math.max(10, Math.floor(n * 0.03))).reduce((s, p) => s + p.d, 0) / Math.max(10, Math.floor(n * 0.03));
  let dmin = Infinity, dmax = -Infinity;
  for (const p of pts) { dmin = Math.min(dmin, p.d); dmax = Math.max(dmax, p.d); }
  // The cup goes below the rim: flip depth if the rim sits nearer the low side.
  if (rim - dmin < dmax - rim) ay = ay.map((x) => -x);
  // The beak (hinge end) is the narrower end along the length.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const x = proj(i, ax); lo = Math.min(lo, x); hi = Math.max(hi, x); }
  let wLo = 0, wHi = 0;
  for (let i = 0; i < n; i++) { const x = proj(i, ax), w = Math.abs(proj(i, az)); if (x < lo + 0.15 * (hi - lo)) wLo = Math.max(wLo, w); if (x > hi - 0.15 * (hi - lo)) wHi = Math.max(wHi, w); }
  if (wHi < wLo) ax = ax.map((x) => -x);
  // Keep it right-handed: z = x cross y.
  az = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]];
  const rimD = rim - dmin < dmax - rim ? -rim : rim;
  for (let i = 0; i < n; i++) {
    const x = proj(i, ax), y = proj(i, ay) - rimD, z = proj(i, az);
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
  }
  console.log(`valve: rim on y = 0, cup below; length along x, beak at -x`);
}

// --top: keep only the faces that look up (a thin flat thing lying on the ground, such as the
// sand dollar), so simplifying never folds its underside through its top.
if (args.includes('--top')) {
  const keep = [];
  for (let t = 0; t < T.length; t += 3) {
    const [a, b, c] = [T[t], T[t + 1], T[t + 2]];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny > 0.2 * Math.hypot(nx, ny, nz)) keep.push(a, b, c);
  }
  console.log(`top: kept ${keep.length / 3} of ${T.length / 3} triangles`);
  T.length = keep.length;
  for (let i = 0; i < keep.length; i++) T[i] = keep[i];
}

// ---- simplify: vertex clustering with quadrics ----
const N0 = P.length / 3;
let bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < N0; i++) for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], P[i * 3 + k]); bmax[k] = Math.max(bmax[k], P[i * 3 + k]); }
/** @param {number} res cells along the longest side */
function cluster(res) {
  const ext = Math.max(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]), cell = ext / res;
  const key = new Map(), cid = new Int32Array(N0);
  for (let i = 0; i < N0; i++) {
    const k = [0, 1, 2].map((a) => Math.min(res, Math.floor((P[i * 3 + a] - bmin[a]) / cell))).join(',');
    if (!key.has(k)) key.set(k, key.size);
    cid[i] = key.get(k);
  }
  const tris = [];
  const seen = new Set();
  for (let t = 0; t < T.length; t += 3) {
    const a = cid[T[t]], b = cid[T[t + 1]], c = cid[T[t + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].slice().sort((x, y) => x - y).join(',') + (((b - a) * (c - a) > 0) ? '+' : '-');
    if (seen.has(s)) continue;
    seen.add(s);
    tris.push(a, b, c);
  }
  return { cid, count: key.size, tris };
}
let lo = 4, hi = 400, best = cluster(hi);
while (hi - lo > 1) { const mid = (lo + hi) >> 1; const c = cluster(mid); if (c.tris.length / 3 > target) hi = mid; else { lo = mid; best = c; } }
if (best.tris.length / 3 > target * 1.2) best = cluster(lo);
// Each cluster's place: minimise the summed plane quadrics of its triangles (falls back to the mean).
const K = best.count, Q = new Float64Array(K * 10), mean = new Float64Array(K * 3), cnt = new Float64Array(K), col = new Float64Array(K * 3);
for (let i = 0; i < N0; i++) { const c = best.cid[i]; cnt[c]++; for (let k = 0; k < 3; k++) { mean[c * 3 + k] += P[i * 3 + k]; col[c * 3 + k] += C[i * 3 + k]; } }
for (let t = 0; t < T.length; t += 3) {
  const [a, b, c] = [T[t], T[t + 1], T[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
  const area = Math.hypot(nx, ny, nz); if (!area) continue;
  nx /= area; ny /= area; nz /= area;
  const d = -(nx * a[0] + ny * a[1] + nz * a[2]), q = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
  for (const i of [T[t], T[t + 1], T[t + 2]]) { const cc = best.cid[i]; for (let k = 0; k < 10; k++) Q[cc * 10 + k] += q[k] * area; }
}
const outP = new Float32Array(K * 3), outC = new Float32Array(K * 3);
for (let c = 0; c < K; c++) {
  const m = [0, 1, 2].map((k) => mean[c * 3 + k] / cnt[c]);
  const q = Q.subarray(c * 10, c * 10 + 10);
  // Solve [q0 q1 q2; q1 q4 q5; q2 q5 q7] x = -[q3 q6 q8], kept near the mean (a little regularisation).
  const r = 1e-6 * (q[0] + q[4] + q[7] + 1e-12);
  const M = [q[0] + r, q[1], q[2], q[1], q[4] + r, q[5], q[2], q[5], q[7] + r];
  const bb = [-q[3] + r * m[0], -q[6] + r * m[1], -q[8] + r * m[2]];
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  let x = m;
  if (Math.abs(det) > 1e-30) {
    const inv = [M[4] * M[8] - M[5] * M[7], M[2] * M[7] - M[1] * M[8], M[1] * M[5] - M[2] * M[4], M[5] * M[6] - M[3] * M[8], M[0] * M[8] - M[2] * M[6], M[2] * M[3] - M[0] * M[5], M[3] * M[7] - M[4] * M[6], M[1] * M[6] - M[0] * M[7], M[0] * M[4] - M[1] * M[3]].map((v) => v / det);
    const s = [inv[0] * bb[0] + inv[1] * bb[1] + inv[2] * bb[2], inv[3] * bb[0] + inv[4] * bb[1] + inv[5] * bb[2], inv[6] * bb[0] + inv[7] * bb[1] + inv[8] * bb[2]];
    // Trust the solve only inside the cluster's neighbourhood.
    const ext = Math.max(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]) / lo;
    if (Math.hypot(s[0] - m[0], s[1] - m[1], s[2] - m[2]) < ext) x = s;
  }
  outP.set(x, c * 3);
  for (let k = 0; k < 3; k++) outC[c * 3 + k] = col[c * 3 + k] / cnt[c];
}
// ---- base on y = 0, height 1 (a valve: its depth below the rim is kept as it is, scaled with it) ----
let y0 = Infinity, y1 = -Infinity;
for (let i = 0; i < K; i++) { y0 = Math.min(y0, outP[i * 3 + 1]); y1 = Math.max(y1, outP[i * 3 + 1]); }
const scale = 1 / (align === 'valve' ? Math.max(...[0, 2].map((k) => { let a = Infinity, b = -Infinity; for (let i = 0; i < K; i++) { a = Math.min(a, outP[i * 3 + k]); b = Math.max(b, outP[i * 3 + k]); } return b - a; })) : y1 - y0);
const lift = align === 'valve' ? 0 : -y0;
let cx = 0, cz = 0;
for (let i = 0; i < K; i++) { cx += outP[i * 3] / K; cz += outP[i * 3 + 2] / K; }
for (let i = 0; i < K; i++) {
  outP[i * 3] = align === 'valve' ? outP[i * 3] * scale : (outP[i * 3] - cx) * scale;
  outP[i * 3 + 1] = (outP[i * 3 + 1] + lift) * scale;
  outP[i * 3 + 2] = (outP[i * 3 + 2] - (align === 'valve' ? 0 : cz)) * scale;
}
const idx = Uint32Array.from(best.tris);

// ---- write ----
let pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < K; i++) for (let k = 0; k < 3; k++) { pmin[k] = Math.min(pmin[k], outP[i * 3 + k]); pmax[k] = Math.max(pmax[k], outP[i * 3 + k]); }
const bin = Buffer.concat([Buffer.from(idx.buffer), Buffer.from(outP.buffer), Buffer.from(outC.buffer)]);
const out = {
  asset: { version: '2.0', generator: 'ebb tools/bake-find-model.mjs', extras: gltf.asset?.extras ?? {} },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: outName }],
  meshes: [{ name: outName, primitives: [{ attributes: { POSITION: 1, COLOR_0: 2 }, indices: 0, mode: 4 }] }],
  buffers: [{ byteLength: bin.length, uri: `${outName}.bin` }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: idx.byteLength, target: 34963 },
    { buffer: 0, byteOffset: idx.byteLength, byteLength: outP.byteLength, target: 34962 },
    { buffer: 0, byteOffset: idx.byteLength + outP.byteLength, byteLength: outC.byteLength, target: 34962 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5125, count: idx.length, type: 'SCALAR' },
    { bufferView: 1, componentType: 5126, count: K, type: 'VEC3', min: pmin, max: pmax },
    { bufferView: 2, componentType: 5126, count: K, type: 'VEC3' },
  ],
};
writeFileSync(join(outDir, `${outName}.gltf`), JSON.stringify(out, null, 1));
writeFileSync(join(outDir, `${outName}.bin`), bin);
console.log(`wrote ${outName}: ${K} vertices, ${idx.length / 3} triangles, size ${pmax.map((v, k) => (v - pmin[k]).toFixed(3)).join(' x ')}`);
