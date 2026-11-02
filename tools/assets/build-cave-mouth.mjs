// The cave mouth in the stack's foot (docs/future/19): Matt's model (Ebb_Cave+Mouth.obj, November 2,
// 2026; his original stays untouched in Documents\Ebb\_assets) made into the game's copy. Build-time
// only, never loaded by the game. Run from tools/assets after npm install: node build-cave-mouth.mjs
//
// It reads recipes/setpieces/stack.json mouthModel: turns the model so its opening faces +z (toward
// the island) with y up, scales it so the opening stands openingM tall, sets the origin at the
// opening's foot on its front plane, welds and thins it to about `triangles` (Matt: decimating is
// fine), and writes:
//   assets/models/stack/cave-mouth.bin   'EBM2', vertex count, index count (uint32), then positions
//                                        (float32 x, y, z in meters), each vertex's ambient occlusion
//                                        (float32 0..1, how much open sky it sees: its chamber goes dark
//                                        in any weather) and triangle indices (uint32)
//   assets/models/stack/cave-mouth-footprint.json  where the rock stands solid at kneeM above its
//                                        foot, on cellM cells: the game raises the ground there (hidden
//                                        inside the rock) so the walker cannot walk through its walls

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const R = JSON.parse(readFileSync(`${ROOT}recipes/setpieces/stack.json`, 'utf8')).mouthModel;
await MeshoptSimplifier.ready;

// ---- read ----
/** @type {number[]} */ const P = []; /** @type {number[]} */ const T = [];
for (const line of readFileSync(R.source, 'utf8').split('\n')) {
  if (line.startsWith('v ')) P.push(...line.trim().split(/\s+/).slice(1, 4).map(Number));
  else if (line.startsWith('f ')) {
    const f = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1);
    for (let k = 1; k + 1 < f.length; k++) T.push(f[0], f[k], f[k + 1]);
  }
}
const n0 = P.length / 3;
let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < n0; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i * 3 + a]); hi[a] = Math.max(hi[a], P[i * 3 + a]); }

// ---- place: opening toward +z, y up, meters, origin at the opening's foot on the front plane ----
const s = R.openingM / R.openingUnits;
const pos = new Float32Array(n0 * 3);
for (let i = 0; i < n0; i++) {
  pos[i * 3] = (P[i * 3] - R.openingCenterX) * s;
  pos[i * 3 + 1] = (P[i * 3 + 1] - lo[1] - R.openingFloorUnits) * s;
  pos[i * 3 + 2] = (P[i * 3 + 2] - hi[2]) * s;
}

// ---- weld, then thin ----
const key = (/** @type {number} */ i) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
const remap = new Uint32Array(n0), seen = new Map();
/** @type {number[]} */ const wp = [];
for (let i = 0; i < n0; i++) {
  const k = key(i);
  let j = seen.get(k);
  if (j === undefined) { j = wp.length / 3; seen.set(k, j); wp.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
  remap[i] = j;
}
const wpos = new Float32Array(wp), widx = new Uint32Array(T.map((v) => remap[v]));
const target = Math.min(widx.length, R.triangles * 3);
const [thin, err] = MeshoptSimplifier.simplify(widx, wpos, 3, target, R.error, []);
// Keep only the vertices still used, in first-use order.
const use = new Int32Array(wpos.length / 3).fill(-1);
/** @type {number[]} */ const op = []; const oi = new Uint32Array(thin.length);
for (let k = 0; k < thin.length; k++) {
  const v = thin[k];
  if (use[v] < 0) { use[v] = op.length / 3; op.push(wpos[v * 3], wpos[v * 3 + 1], wpos[v * 3 + 2]); }
  oi[k] = use[v];
}
const out = new Float32Array(op);

// ---- where it stands solid at knee height (a slice through it, filled by crossings) ----
const F = R.footprint, y0 = F.kneeM;
/** @type {number[][]} */ const segs = [];
for (let k = 0; k < oi.length; k += 3) {
  const t = [0, 1, 2].map((q) => oi[k + q]), pts = [];
  for (let e = 0; e < 3; e++) {
    const a = t[e], b = t[(e + 1) % 3], ya = out[a * 3 + 1] - y0, yb = out[b * 3 + 1] - y0;
    if ((ya < 0) !== (yb < 0)) { const f = ya / (ya - yb); pts.push([out[a * 3] + (out[b * 3] - out[a * 3]) * f, out[a * 3 + 2] + (out[b * 3 + 2] - out[a * 3 + 2]) * f]); }
  }
  if (pts.length === 2) segs.push([...pts[0], ...pts[1]]);
}
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (let i = 0; i < out.length; i += 3) { x0 = Math.min(x0, out[i]); x1 = Math.max(x1, out[i]); z0 = Math.min(z0, out[i + 2]); z1 = Math.max(z1, out[i + 2]); }
const c = F.cellM, gx = Math.floor(x0 / c) * c, gz = Math.floor(z0 / c) * c, w = Math.ceil((x1 - gx) / c), h = Math.ceil((z1 - gz) / c);
const solid = new Uint8Array(w * h);
for (let j = 0; j < h; j++) {
  const zc = gz + (j + 0.5) * c, xs = [];
  for (const [ax, az, bx, bz] of segs) if ((az < zc) !== (bz < zc)) xs.push(ax + (bx - ax) * (zc - az) / (bz - az));
  xs.sort((a, b) => a - b);
  for (let q = 0; q + 1 < xs.length; q += 2) {
    for (let i = Math.max(0, Math.ceil((xs[q] - gx) / c - 0.5)); i < w && gx + (i + 0.5) * c <= xs[q + 1]; i++) solid[j * w + i] = 1;
  }
}
// Shrunk by F.insetCells so the raised ground stays inside the rock.
const keep = solid.slice();
for (let r = 0; r < F.insetCells; r++) {
  const prev = keep.slice();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!prev[j * w + i]) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= w || b >= h || !prev[b * w + a]) { keep[j * w + i] = 0; break; }
    }
  }
}

// ---- ambient occlusion: rays through a voxel grid of the rock (and the ground under it) ----
const A = R.ao, vc = A.voxelM;
const bx0 = x0 - 0.5, by0 = -0.5, bz0 = z0 - 0.5;
let ymax = 0; for (let i = 1; i < out.length; i += 3) ymax = Math.max(ymax, out[i]);
const nx = Math.ceil((x1 - bx0 + 0.5) / vc), ny = Math.ceil((ymax - by0 + 0.5) / vc), nz = Math.ceil((z1 - bz0 + 0.5) / vc);
const vox = new Uint8Array(nx * ny * nz);
const vid = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
  const i = Math.floor((x - bx0) / vc), j = Math.floor((y - by0) / vc), k = Math.floor((z - bz0) / vc);
  return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : (k * ny + j) * nx + i;
};
for (let t = 0; t < oi.length; t += 3) {
  const a = oi[t] * 3, b = oi[t + 1] * 3, cc = oi[t + 2] * 3;
  const len = Math.max(Math.hypot(out[b] - out[a], out[b + 1] - out[a + 1], out[b + 2] - out[a + 2]), Math.hypot(out[cc] - out[a], out[cc + 1] - out[a + 1], out[cc + 2] - out[a + 2]));
  const steps = Math.max(1, Math.ceil(len / (vc * 0.5)));
  for (let u = 0; u <= steps; u++) for (let v = 0; v <= steps - u; v++) {
    const fu = u / steps, fv = v / steps, fw = 1 - fu - fv;
    const k = vid(out[a] * fw + out[b] * fu + out[cc] * fv, out[a + 1] * fw + out[b + 1] * fu + out[cc + 1] * fv, out[a + 2] * fw + out[b + 2] * fu + out[cc + 2] * fv);
    if (k >= 0) vox[k] = 1;
  }
}
// A fixed set of directions over the sphere (golden spiral).
const dirs = Array.from({ length: A.rays }, (_, i) => {
  const yv = 1 - (2 * (i + 0.5)) / A.rays, r = Math.sqrt(1 - yv * yv), th = i * 2.399963;
  return [Math.cos(th) * r, yv, Math.sin(th) * r];
});
/** How much open sky a point sees round a normal (cosine-weighted; rays into the ground count half). */
function skyAt(/** @type {number[]} */ p, /** @type {number[]} */ n) {
  let open = 0, all = 0;
  for (const d of dirs) {
    const cw = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (cw <= 0.02) continue;
    all += cw;
    let hit = false;
    for (let t = A.startM; t < A.reachM; t += vc * 0.6) {
      const x = p[0] + d[0] * t, y = p[1] + d[1] * t, z = p[2] + d[2] * t;
      if (y < 0) { open += cw * A.groundShare; hit = true; break; }
      const k = vid(x, y, z);
      if (k < 0) break;
      if (vox[k]) { hit = true; break; }
    }
    if (!hit) open += cw;
  }
  return all > 0 ? open / all : 1;
}
// Smooth normals for the bake.
const nrm = new Float32Array(out.length);
for (let t = 0; t < oi.length; t += 3) {
  const a = oi[t] * 3, b = oi[t + 1] * 3, cc = oi[t + 2] * 3;
  const ux = out[b] - out[a], uy = out[b + 1] - out[a + 1], uz = out[b + 2] - out[a + 2], wx = out[cc] - out[a], wy = out[cc + 1] - out[a + 1], wz = out[cc + 2] - out[a + 2];
  const qx = uy * wz - uz * wy, qy = uz * wx - ux * wz, qz = ux * wy - uy * wx;
  for (const v of [a, b, cc]) { nrm[v] += qx; nrm[v + 1] += qy; nrm[v + 2] += qz; }
}
const ao = new Float32Array(out.length / 3);
for (let i = 0; i < ao.length; i++) {
  const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1, n = [nrm[i * 3] / l, nrm[i * 3 + 1] / l, nrm[i * 3 + 2] / l];
  ao[i] = skyAt([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]], n);
}
// The floor under its roof: each footprint cell's sky, facing up (1 out in the open).
const floorAO = [];
for (let j = 0; j < h; j++) {
  let r = '';
  for (let i = 0; i < w; i++) r += String.fromCharCode(48 + Math.round(9 * skyAt([gx + (i + 0.5) * c, 0.05, gz + (j + 0.5) * c], [0, 1, 0])));
  floorAO.push(r);
}

// ---- write ----
mkdirSync(`${ROOT}assets/models/stack`, { recursive: true });
const head = new Uint32Array([0x324d4245, out.length / 3, oi.length]);
const bin = new Uint8Array(12 + out.byteLength + ao.byteLength + oi.byteLength);
bin.set(new Uint8Array(head.buffer), 0); bin.set(new Uint8Array(out.buffer), 12); bin.set(new Uint8Array(ao.buffer), 12 + out.byteLength);
bin.set(new Uint8Array(oi.buffer), 12 + out.byteLength + ao.byteLength);
writeFileSync(`${ROOT}assets/models/stack/cave-mouth.bin`, bin);
let rows = [];
for (let j = 0; j < h; j++) { let r = ''; for (let i = 0; i < w; i++) r += keep[j * w + i] ? '1' : '0'; rows.push(r); }
writeFileSync(`${ROOT}assets/models/stack/cave-mouth-footprint.json`, JSON.stringify({ note: 'Built by tools/assets/build-cave-mouth.mjs: where the cave mouth stands solid at kneeM above its foot, on cellM cells from x0, z0 (meters, the model frame: +z out of the opening, x across); rows run along x, one per z. floorAO: each cell open sky facing up on the floor, 0 to 9 (9 out in the open).', kneeM: y0, cellM: c, x0: gx, z0: gz, w, h, rows, floorAO }, null, 0));
const size = [x1 - x0, Math.max(...Array.from({ length: out.length / 3 }, (_, i) => out[i * 3 + 1])), z1 - z0];
console.log(`cave mouth: ${T.length / 3} triangles to ${oi.length / 3} (error ${err.toFixed(4)}), ${out.length / 3} vertices; ${size.map((v) => v.toFixed(2)).join(' x ')} m; footprint ${w} x ${h} cells, ${keep.reduce((a, b) => a + b, 0)} solid`);
