// Web copies of Matt's models (docs/future/13, the keeper's camp): reads each glb listed in
// models.json from the source folder, and writes a small copy to assets/models/camp/ that looks the
// same in the game, with all its paint carried over. Build-time only; the game never loads this.
//
//   cd tools/assets
//   npm install
//   node build-models.mjs              every model in models.json
//   node build-models.mjs tent boat    only these (by `out` name)
//
// Each model: its node transforms baked into the mesh; turned (yawDeg) so its front faces +z;
// scaled to its real size; set with the center of its base at the origin, on the ground (y = 0);
// welded and thinned to its triangle target with meshoptimizer, which keeps UV seams in place so the
// paint maps still fit; its maps resized and saved as WebP (EXT_texture_webp). Geometry stays plain
// (no Draco or meshopt packing), so src/render/gltf.js reads it as it is. The originals are never
// copied into the repo. A report of every model goes to assets/models/camp/report.json.

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, getBounds, transformMesh } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const list = JSON.parse(readFileSync(join(here, 'models.json'), 'utf8'));
const only = process.argv.slice(2);
// Separate (not interleaved) vertex arrays: src/render/gltf.js reads tightly packed attributes.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
await MeshoptSimplifier.ready;

/** Column-major 4 x 4 multiply, a * b. @param {number[]} a @param {number[]} b */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
/** Triangles in a document. @param {import('@gltf-transform/core').Document} doc */
function triangles(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
  }
  return Math.round(n);
}

const outDir = join(repo, list.outDir);
mkdirSync(outDir, { recursive: true });
let report = {};
try { report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')); } catch { /* first run */ }

for (const m of list.models) {
  if (only.length && !only.includes(m.out)) continue;
  const src = join(list.sourceDir, m.source);
  const t0 = Date.now();
  const doc = await io.read(src);
  const root = doc.getRoot();
  const trisBefore = triangles(doc);

  // Bake each mesh node's world transform into its vertices, then clear the transforms.
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh) transformMesh(mesh, node.getWorldMatrix());
  }
  for (const node of root.listNodes()) { node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }

  // Thin to the target, keeping UV seams (the paint maps stay where they were).
  const ratio = Math.min(1, m.triangles / Math.max(1, trisBefore));
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: m.error ?? 0.02, lockBorder: false }),
  );

  // Turn so its front faces +z, scale to its real size, base center to the origin (after thinning,
  // so the copy's own bounds are exact).
  const yaw = (m.yawDeg ?? 0) * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
  const turn = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  for (const mesh of root.listMeshes()) transformMesh(mesh, turn);
  let b = getBounds(root.listScenes()[0]);
  const span = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const k = m.sizeM / (m.along === 'height' ? span[1] : Math.max(...span));
  const place = mul([k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2, 1]);
  for (const mesh of root.listMeshes()) transformMesh(mesh, place);

  // Paint maps: color and roughness/metal as WebP at the map size; normals a little gentler.
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [m.maps, m.maps], quality: 88, slots: /^(baseColor|metallicRoughness|occlusion|emissive)/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [m.maps, m.maps], quality: 94, slots: /^normal/ }),
    dedup(),
    prune(),
  );
  root.getAsset().generator = 'ebb tools/assets/build-models.mjs';

  const outPath = join(outDir, `${m.out}.glb`);
  await io.write(outPath, doc);
  b = getBounds(root.listScenes()[0]);
  const entry = {
    source: m.source, file: `${m.out}.glb`, bytes: statSync(outPath).size, sourceBytes: statSync(src).size,
    trianglesBefore: trisBefore, triangles: triangles(doc), maps: m.maps,
    bounds: { min: b.min.map((v) => +v.toFixed(3)), max: b.max.map((v) => +v.toFixed(3)) },
  };
  report[m.out] = entry;
  console.log(`${m.out}: ${(entry.sourceBytes / 1048576).toFixed(1)} MB -> ${(entry.bytes / 1048576).toFixed(2)} MB, ` +
    `${trisBefore} -> ${entry.triangles} triangles, ${(Date.now() - t0) / 1000} s`);
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify({ ...report, note: 'Written by tools/assets/build-models.mjs: each web copy against its source.' }, null, 1) + '\n');
