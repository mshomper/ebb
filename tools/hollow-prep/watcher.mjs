// @ts-check
// Makes assets/models/hollow/watcher.glb, the hagstone watcher (H2, doc 16; the orchestrator's draft 2,
// approved by Matt on October 27, 2026), rigged in code:
//
// 1. The stone (tools/hollow-prep/watcher-field.mjs) sampled at prep.cellM and meshed by the repo's
//    surface nets, then cut by quadric edge collapse (decimate.mjs) to prep.targetTris. A finer field
//    cut down keeps the barnacle shells and the rim where the surface bends, and spends little on the
//    smooth pebble round them; meshing coarser instead would round the shells away.
// 2. xatlas unwraps the cut stone (atlas.py), and each texel is carried back onto the fine field: its
//    albedo (sRGB JPEG) and the field's own normal there (object space in the rest pose, JPEG), so the
//    fine wear and the barnacles' pits stay sharp where the triangles are big. The stone is rigid, so
//    an object-space map turns with it.
// 3. The weed: four flat ribbons, both faces (vertex colour, lighter at the tips), each skinned along a
//    chain of prep.blades.bones bones, for the sway.
// 4. The rig: a root at the stone's middle (the float, the turn, the look) and each blade's chain on it.
//    The hole (its middle, axis and radius) goes in the extras, for the shader's light.
//
//    node tools/hollow-prep/watcher.mjs assets/models/hollow/watcher.glb [folder for before-and-after OBJs and stills]
//
// Needs Node and Python 3 with numpy, pillow and xatlas. Takes about a minute.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfaceNets } from '../../src/world/mesh/surface-nets.js';
import { watcherField } from './watcher-field.mjs';
import { decimate } from './decimate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RECIPE = join(HERE, '..', '..', 'recipes', 'world', 'hollow.json');
const BOUNDS = [[-0.46, -0.42, -0.26], [0.46, 0.42, 0.26]];

/** Sample fn on a grid of cell m over the stone's bounds and mesh it. @param {(x: number, y: number, z: number) => number} fn @param {number} cell */
function mesh(fn, cell) {
  const [lo, hi] = BOUNDS;
  const n = lo.map((l, i) => Math.ceil((hi[i] - l) / cell) + 1);
  const field = new Float32Array(n[0] * n[1] * n[2]);
  let w = 0;
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) field[w++] = fn(lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell);
  return surfaceNets(field, n, lo, cell);
}

/** A mesh as OBJ text (for the before and after). @param {ArrayLike<number>} pos @param {ArrayLike<number>} idx */
function obj(pos, idx) {
  const L = [];
  for (let v = 0; v < pos.length / 3; v++) L.push(`v ${pos[v * 3].toFixed(5)} ${pos[v * 3 + 1].toFixed(5)} ${pos[v * 3 + 2].toFixed(5)}`);
  for (let t = 0; t < idx.length; t += 3) L.push(`f ${idx[t] + 1} ${idx[t + 1] + 1} ${idx[t + 2] + 1}`);
  return L.join('\n');
}

/** Python 3 on this machine. */
const PY = process.platform === 'win32' ? 'python' : 'python3';

function main() {
  const [out, stills] = process.argv.slice(2);
  if (!out) { console.log('node tools/hollow-prep/watcher.mjs <out .glb> [folder for before-and-after OBJs and stills]'); process.exit(1); }
  const H = JSON.parse(readFileSync(RECIPE, 'utf8'));
  const P = H.foes.watcher.stone.prep, Bl = P.blades;
  const W = watcherField(P);
  const t0 = Date.now();

  // ---- 1. the stone: a fine field, cut down ----
  const fine = mesh(W.solid, P.cellM);
  const cut = decimate(fine.pos, fine.idx, P.targetTris);
  console.log(`stone: ${fine.idx.length / 3} triangles at ${P.cellM * 1000} mm, cut to ${cut.idx.length / 3} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (stills) {
    mkdirSync(stills, { recursive: true });
    const draft = mesh(W.solid, P.fineCellM);
    writeFileSync(join(stills, 'watcher-before.obj'), obj(draft.pos, draft.idx));
    writeFileSync(join(stills, 'watcher-after.obj'), obj(cut.pos, cut.idx));
    console.log(`before: the draft's ${P.fineCellM * 1000} mm cell, ${draft.idx.length / 3} triangles; after: ${cut.idx.length / 3}`);
  }

  // ---- 2. unwrap, then bake the albedo and the fine normals ----
  const tmp = mkdtempSync(join(tmpdir(), 'ebb-watcher-'));
  const size = P.textureSize;
  let vmap, uv, idx;
  try {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(cut.count, 0); head.writeUInt32LE(cut.idx.length / 3, 4);
    writeFileSync(join(tmp, 'mesh.bin'), Buffer.concat([head, Buffer.from(Float32Array.from(cut.pos).buffer), Buffer.from(cut.idx.buffer)]));
    execFileSync(PY, [join(HERE, 'atlas.py'), 'unwrap', join(tmp, 'mesh.bin'), join(tmp, 'atlas.bin'), String(size), '4'], { stdio: 'inherit' });
    const a = readFileSync(join(tmp, 'atlas.bin')), nv = a.readUInt32LE(0), ni = a.readUInt32LE(4);
    const buf = a.buffer.slice(a.byteOffset + 8, a.byteOffset + a.byteLength);
    vmap = new Uint32Array(buf, 0, nv); uv = new Float32Array(buf, nv * 4, nv * 2); idx = new Uint32Array(buf, nv * 12, ni * 3);
  } catch (e) { rmSync(tmp, { recursive: true, force: true }); throw e; }

  const grad = (/** @type {number[]} */ p, e = 0.0012) => {
    const g = [W.solid(p[0] + e, p[1], p[2]) - W.solid(p[0] - e, p[1], p[2]), W.solid(p[0], p[1] + e, p[2]) - W.solid(p[0], p[1] - e, p[2]), W.solid(p[0], p[1], p[2] + e) - W.solid(p[0], p[1], p[2] - e)];
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    return g.map((v) => v / l);
  };
  /** A point carried onto the fine surface along the field's slope. @param {number[]} p */
  const onto = (p) => { let q = p; for (let i = 0; i < 3; i++) { const d = W.solid(q[0], q[1], q[2]), g = grad(q); q = q.map((v, k) => v - d * g[k]); } return q; };
  const albedo = new Float32Array(size * size * 3), normal = new Float32Array(size * size * 3), filled = new Uint8Array(size * size);
  const nt = idx.length / 3;
  for (let t = 0; t < nt; t++) {
    const c = [0, 1, 2].map((k) => idx[t * 3 + k]);
    const T = c.map((v) => [uv[v * 2] * size - 0.5, uv[v * 2 + 1] * size - 0.5]);
    const X = c.map((v) => [cut.pos[vmap[v] * 3], cut.pos[vmap[v] * 3 + 1], cut.pos[vmap[v] * 3 + 2]]);
    const d = (T[1][1] - T[2][1]) * (T[0][0] - T[2][0]) + (T[2][0] - T[1][0]) * (T[0][1] - T[2][1]);
    if (Math.abs(d) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(T[0][0], T[1][0], T[2][0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(T[0][0], T[1][0], T[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(T[0][1], T[1][1], T[2][1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(T[0][1], T[1][1], T[2][1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const b0 = ((T[1][1] - T[2][1]) * (x - T[2][0]) + (T[2][0] - T[1][0]) * (y - T[2][1])) / d;
      const b1 = ((T[2][1] - T[0][1]) * (x - T[2][0]) + (T[0][0] - T[2][0]) * (y - T[2][1])) / d, b2 = 1 - b0 - b1;
      // Texel centres a little outside still count, so seams have no gaps.
      const tol = -0.02;
      if (b0 < tol || b1 < tol || b2 < tol) continue;
      const at = y * size + x;
      if (filled[at]) continue;
      const p = onto([0, 1, 2].map((k) => X[0][k] * b0 + X[1][k] * b1 + X[2][k] * b2));
      albedo.set(W.stoneColor(p[0], p[1], p[2]), at * 3);
      normal.set(grad(p), at * 3);
      filled[at] = 1;
    }
  }
  // Grow every chart's edge outward a few texels, so filtering never reads the empty atlas.
  for (let pass = 0; pass < 6; pass++) {
    const was = filled.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const at = y * size + x;
      if (was[at]) continue;
      const s = [0, 0, 0], q = [0, 0, 0];
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size || !was[yy * size + xx]) continue;
        const o = (yy * size + xx) * 3;
        for (let k = 0; k < 3; k++) { s[k] += albedo[o + k]; q[k] += normal[o + k]; }
        n++;
      }
      if (!n) continue;
      for (let k = 0; k < 3; k++) { albedo[at * 3 + k] = s[k] / n; normal[at * 3 + k] = q[k] / n; }
      filled[at] = 1;
    }
  }
  const srgb = (/** @type {number} */ c) => { const v = Math.max(0, Math.min(1, c)); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255); };
  const aBytes = new Uint8Array(size * size * 3), nBytes = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size * 3; i++) { aBytes[i] = srgb(albedo[i]); nBytes[i] = Math.round(Math.max(0, Math.min(1, normal[i] * 0.5 + 0.5)) * 255); }
  writeFileSync(join(tmp, 'albedo.bin'), aBytes); writeFileSync(join(tmp, 'normal.bin'), nBytes);
  execFileSync(PY, [join(HERE, 'atlas.py'), 'jpeg', join(tmp, 'albedo.bin'), String(size), join(tmp, 'albedo.jpg'), '90']);
  execFileSync(PY, [join(HERE, 'atlas.py'), 'jpeg', join(tmp, 'normal.bin'), String(size), join(tmp, 'normal.jpg'), '92']);
  const albedoJpg = readFileSync(join(tmp, 'albedo.jpg')), normalJpg = readFileSync(join(tmp, 'normal.jpg'));
  if (stills) { writeFileSync(join(stills, 'watcher-albedo.jpg'), albedoJpg); writeFileSync(join(stills, 'watcher-normal.jpg'), normalJpg); }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`baked ${size} maps: albedo ${albedoJpg.length} bytes, normals ${normalJpg.length} bytes (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // ---- 3 and 4. the skeleton, the stone's vertices and the weed's ----
  const NB = Bl.bones;
  const skeleton = [{ name: 'root', parent: -1, pivot: [0, 0, 0] }];
  W.blades.forEach((b, s) => {
    for (let j = 0; j < NB; j++) skeleton.push({ name: `weed.${s}.${j}`, parent: j === 0 ? 0 : skeleton.length - 1, pivot: W.along(b, j / NB).map((v) => +v.toFixed(5)) });
  });
  /** @type {number[]} */ const pos = [], nrm = [], col = [], jnt = [], wgt = [], tri = [];
  const sv = vmap.length;
  for (let v = 0; v < sv; v++) {
    const o = vmap[v], p = [cut.pos[o * 3], cut.pos[o * 3 + 1], cut.pos[o * 3 + 2]];
    pos.push(...p); nrm.push(...grad(p)); col.push(uv[v * 2], uv[v * 2 + 1], 2);
    jnt.push(0, 0, 0, 0); wgt.push(255, 0, 0, 0);
  }
  for (let t = 0; t < idx.length; t++) tri.push(idx[t]);
  const stoneTris = idx.length / 3;
  // The weed: a strip down each blade, front and back faces each with their own vertices and normals.
  const SEG = Bl.segments;
  W.blades.forEach((b, s) => {
    const rows = [];
    for (let j = 0; j <= SEG; j++) {
      const u = j / SEG, c = W.along(b, u), c2 = W.along(b, Math.min(1, u + 0.01)), c1 = W.along(b, Math.max(0, u - 0.01));
      const T = c2.map((v, k) => v - c1[k]), tl = Math.hypot(T[0], T[1], T[2]);
      for (let k = 0; k < 3; k++) T[k] /= tl;
      const ang = b.w0 + b.twist * u * Math.PI;
      let Wd = [Math.cos(ang), 0, Math.sin(ang)];
      const dt = Wd[0] * T[0] + Wd[1] * T[1] + Wd[2] * T[2];
      Wd = Wd.map((v, k) => v - dt * T[k]); const wl = Math.hypot(Wd[0], Wd[1], Wd[2]); Wd = Wd.map((v) => v / wl);
      const N = [T[1] * Wd[2] - T[2] * Wd[1], T[2] * Wd[0] - T[0] * Wd[2], T[0] * Wd[1] - T[1] * Wd[0]];
      const half = Bl.halfM[0] + Bl.halfM[1] * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.03));
      const frill = (/** @type {number} */ side) => 1 + Bl.frill * Math.sin(u * 28 + b.phase + side * 1.7) * Math.min(1, u * 4);
      // Its bone: the one whose pivot it hangs below, blended into the one above near each joint.
      const f = u * NB, seg = Math.min(NB - 1, Math.floor(f)), frac = f - seg;
      const bone = 1 + s * NB + seg, up = seg > 0 && frac < 0.3 ? (0.3 - frac) / 0.6 : 0;
      const edge = [-1, 1].map((side) => c.map((v, k) => v + Wd[k] * half * frill(side) * side));
      rows.push({ edge, N, u, bone, up });
    }
    for (const face of [1, -1]) {
      const base = pos.length / 3;
      for (const r of rows) for (const e of r.edge) {
        pos.push(...e); nrm.push(...r.N.map((v) => v * face)); col.push(...W.weedColor(r.u));
        const wu = Math.round(r.up * 255);
        jnt.push(r.bone, r.up > 0 ? r.bone - 1 : 0, 0, 0); wgt.push(255 - wu, wu, 0, 0);
      }
      for (let j = 0; j < SEG; j++) {
        const a = base + j * 2, bb = a + 1, c = a + 2, d = a + 3;
        if (face > 0) tri.push(a, c, bb, bb, c, d); else tri.push(a, bb, c, bb, d, c);
      }
    }
  });
  const weedTris = tri.length / 3 - stoneTris;
  // Which way the front faces point: the normal from the cross of the winding must agree with N.
  {
    const o = stoneTris * 3, [a, b, c] = [tri[o], tri[o + 1], tri[o + 2]];
    const A = pos.slice(a * 3, a * 3 + 3), B = pos.slice(b * 3, b * 3 + 3), C = pos.slice(c * 3, c * 3 + 3);
    const u = B.map((v, k) => v - A[k]), w = C.map((v, k) => v - A[k]);
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (g[0] * nrm[a * 3] + g[1] * nrm[a * 3 + 1] + g[2] * nrm[a * 3 + 2] < 0) {
      for (let t = stoneTris; t < tri.length / 3; t++) { const x = tri[t * 3 + 1]; tri[t * 3 + 1] = tri[t * 3 + 2]; tri[t * 3 + 2] = x; }
    }
  }

  // ---- the GLB ----
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < sv; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v * 3 + k]); hi[k] = Math.max(hi[k], pos[v * 3 + k]); }
  let weedLow = 0;
  for (let v = sv; v < pos.length / 3; v++) weedLow = Math.min(weedLow, pos[v * 3 + 1]);
  const r5 = (/** @type {number} */ v) => +v.toFixed(5);
  const extras = {
    note: 'The hagstone watcher (H2, the orchestrator\'s draft 2, approved October 27, 2026; tools/hollow-prep/watcher.mjs), metres, Y up, the hole looking along +Z, the origin at the stone\'s middle. '
      + 'skeleton: root (the float, the turn) then each blade\'s chain of bones, parents first, pivots in rest metres. COLOR_0: on the stone (u, v, 2), its place in the baked maps; on the weed, its linear albedo. '
      + 'Images: 0 the albedo (sRGB), 1 the fine field\'s normals in object space, rest pose (n * 0.5 + 0.5). hole: its middle (x, y), radius and how it flares toward the faces, for the shader\'s light.',
    widthM: r5(hi[0] - lo[0]), heightM: r5(hi[1] - lo[1]), depthM: r5(hi[2] - lo[2]), weedLowM: r5(weedLow),
    triangles: { stone: stoneTris, weed: weedTris }, cutFrom: fine.idx.length / 3, cellM: P.cellM, textureSize: size,
    barnacles: W.barnacles.length, skeleton,
    hole: { x: P.hole.x, y: P.hole.y, rM: P.hole.rM, flareShare: P.hole.flareShare, halfDepthM: P.radiiM[2] },
    blades: W.blades.map((b) => ({ lengthM: b.len, root: W.along(b, 0).map(r5), tip: W.along(b, 1).map(r5) })),
  };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeGlb(out, { pos, nrm, col, jnt, wgt, tri }, [albedoJpg, normalJpg], extras);
  console.log(`${stoneTris + weedTris} triangles (stone ${stoneTris}, weed ${weedTris}), ${pos.length / 3} vertices, ${skeleton.length} bones`);
  console.log(`${(extras.widthM * 100).toFixed(1)} cm across, ${(extras.heightM * 100).toFixed(1)} cm high, ${(extras.depthM * 100).toFixed(1)} cm thick; weed to ${(-weedLow * 100).toFixed(1)} cm below the middle; ${W.barnacles.length} barnacles`);
  console.log(`wrote ${out} (${statSync(out).size} bytes) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/**
 * @param {string} path @param {{ pos: number[], nrm: number[], col: number[], jnt: number[], wgt: number[], tri: number[] }} m
 * @param {Buffer[]} images JPEGs @param {any} extras
 */
function writeGlb(path, m, images, extras) {
  /** @type {Buffer[]} */ const blobs = [];
  /** @type {any[]} */ const views = [], accessors = [];
  let off = 0;
  /** @param {Buffer} data @param {number} [target] */
  const view = (data, target) => {
    const pad = (-off) % 4 === 0 ? 0 : 4 - (off % 4);
    if (pad) { blobs.push(Buffer.alloc(pad)); off += pad; }
    blobs.push(data);
    views.push({ buffer: 0, byteOffset: off, byteLength: data.length, ...(target ? { target } : {}) });
    off += data.length;
    return views.length - 1;
  };
  /** @param {ArrayBufferView} arr @param {number} comp @param {string} type @param {number} count @param {any} [more] */
  const acc = (arr, comp, type, count, more = {}) => {
    accessors.push({ bufferView: view(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), 34962), componentType: comp, count, type, ...more });
    return accessors.length - 1;
  };
  const n = m.pos.length / 3, P = Float32Array.from(m.pos);
  const lo = [0, 1, 2].map((k) => Math.min(...Array.from({ length: n }, (_, i) => P[i * 3 + k])));
  const hi = [0, 1, 2].map((k) => Math.max(...Array.from({ length: n }, (_, i) => P[i * 3 + k])));
  const attrs = {
    POSITION: acc(P, 5126, 'VEC3', n, { min: lo, max: hi }),
    NORMAL: acc(Float32Array.from(m.nrm), 5126, 'VEC3', n),
    COLOR_0: acc(Float32Array.from(m.col), 5126, 'VEC3', n),
    JOINTS_0: acc(Uint8Array.from(m.jnt), 5121, 'VEC4', n),
    WEIGHTS_0: acc(Uint8Array.from(m.wgt), 5121, 'VEC4', n, { normalized: true }),
  };
  const I = Uint32Array.from(m.tri);
  accessors.push({ bufferView: view(Buffer.from(I.buffer), 34963), componentType: 5125, count: I.length, type: 'SCALAR' });
  const indices = accessors.length - 1;
  const imgs = images.map((b) => ({ bufferView: view(b), mimeType: 'image/jpeg' }));
  let body = Buffer.concat(blobs);
  body = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
  const json = {
    asset: { version: '2.0', generator: 'ebb tools/hollow-prep/watcher.mjs' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'watcher', mesh: 0, extras }],
    meshes: [{ name: 'watcher', primitives: [{ attributes: attrs, indices, material: 0 }] }],
    materials: [{ name: 'hagstone', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.6 }, normalTexture: { index: 1 } }],
    textures: [{ source: 0 }, { source: 1 }], images: imgs,
    buffers: [{ byteLength: body.length }], bufferViews: views, accessors,
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
  head.writeUInt32LE(js.length, 12); head.write('JSON', 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(body.length, 0); bh.write('BIN\0', 4);
  writeFileSync(path, Buffer.concat([head, js, bh, body]));
}

main();
