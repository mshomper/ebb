// @ts-check
// The asset lab's model side: reads a GLB (Matt's original or its web copy) with src/render/gltf.js,
// places it the way tools/assets/build-models.mjs does (node transforms baked in, turned by yawDeg so
// its front faces +z, scaled to its real size, base center on the ground at the origin), decodes its
// paint maps, and compares two color maps. No GPU here.

import { readGlb, materialMaps } from '../src/render/gltf.js';

/**
 * @typedef {Object} Placed
 * @property {Float32Array} positions
 * @property {Float32Array} normals
 * @property {Float32Array} uvs
 * @property {Uint32Array} indices
 * @property {number} triangles
 * @property {{ min: number[], max: number[] }} bounds
 * @property {Record<'baseColor' | 'metallicRoughness' | 'normal', { bytes: Uint8Array, mimeType: string } | null>} maps
 * @property {{ base: number[], metal: number, rough: number, normalScale: number }} factors
 */

/** A node's local matrix, column-major, from `matrix` or translation, rotation, scale. @param {any} node */
function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Column-major 4 x 4 multiply, a * b. @param {number[]} a @param {number[]} b */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/**
 * Read a GLB and place it as the build script does. Every triangle primitive of every mesh node is
 * merged into one mesh; the first primitive's material gives the maps.
 * @param {ArrayBuffer} buffer
 * @param {{ yawDeg?: number, sizeM: number, along: string }} place
 * @returns {Placed}
 */
export function readModel(buffer, place) {
  const glb = readGlb(buffer);
  const json = glb.json;
  /** @type {{ m: number[], prim: any }[]} */ const parts = [];
  /** @param {number} i @param {number[]} parent */
  const walk = (i, parent) => {
    const node = json.nodes[i];
    const world = mul(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) if ((prim.mode ?? 4) === 4) parts.push({ m: world, prim });
    }
    for (const c of node.children ?? []) walk(c, world);
  };
  const children = new Set((json.nodes ?? []).flatMap((/** @type {any} */ n) => n.children ?? []));
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((/** @type {any} */ _, /** @type {number} */ i) => i).filter((/** @type {number} */ i) => !children.has(i));
  const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of roots) walk(r, ID);
  if (!parts.length) throw new Error('no triangle mesh in this file');

  // Bake each part's world transform (normals by the cofactor matrix, which keeps them square to the surface).
  /** @type {number[][]} */ const P = [], N = [], T = [], I = [];
  let base = 0, nVerts = 0;
  for (const { m, prim } of parts) {
    if (prim.attributes.NORMAL === undefined) throw new Error('a mesh has no normals');
    const pos = glb.accessor(prim.attributes.POSITION), nrm = glb.accessor(prim.attributes.NORMAL);
    const uv = prim.attributes.TEXCOORD_0 !== undefined ? glb.accessor(prim.attributes.TEXCOORD_0) : new Float32Array(pos.length / 3 * 2);
    const count = pos.length / 3;
    const idx = prim.indices !== undefined ? glb.accessor(prim.indices) : Uint32Array.from({ length: count }, (_, i) => i);
    const c = [ // cofactor of the upper 3 x 3, column-major
      m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8],
      m[2] * m[9] - m[1] * m[10], m[0] * m[10] - m[2] * m[8], m[1] * m[8] - m[0] * m[9],
      m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4],
    ];
    const p = new Float32Array(count * 3), n = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      p[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      p[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      p[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      const a = nrm[v * 3], b = nrm[v * 3 + 1], d = nrm[v * 3 + 2];
      const nx = c[0] * a + c[1] * b + c[2] * d, ny = c[3] * a + c[4] * b + c[5] * d, nz = c[6] * a + c[7] * b + c[8] * d;
      const l = Math.hypot(nx, ny, nz) || 1;
      n[v * 3] = nx / l; n[v * 3 + 1] = ny / l; n[v * 3 + 2] = nz / l;
    }
    const o = new Uint32Array(idx.length);
    for (let k = 0; k < idx.length; k++) o[k] = idx[k] + base;
    P.push(/** @type {any} */ (p)); N.push(/** @type {any} */ (n)); T.push(/** @type {any} */ (uv)); I.push(/** @type {any} */ (o));
    base += count; nVerts += count;
  }
  const join = (/** @type {any[]} */ list, /** @type {any} */ Type) => {
    const out = new Type(list.reduce((s, a) => s + a.length, 0));
    let at = 0;
    for (const a of list) { out.set(a, at); at += a.length; }
    return out;
  };
  const positions = join(P, Float32Array), normals = join(N, Float32Array), uvs = join(T, Float32Array);
  const indices = join(I, Uint32Array);

  // Turn about +y by yawDeg (the build script's matrix), then scale and set the base center at the origin.
  const yaw = (place.yawDeg ?? 0) * Math.PI / 180, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const arr of [positions, normals]) {
    for (let v = 0; v < nVerts; v++) {
      const x = arr[v * 3], z = arr[v * 3 + 2];
      arr[v * 3] = cy * x + sy * z;
      arr[v * 3 + 2] = -sy * x + cy * z;
    }
  }
  for (let v = 0; v < nVerts; v++) for (let k = 0; k < 3; k++) {
    const x = positions[v * 3 + k];
    if (x < min[k]) min[k] = x;
    if (x > max[k]) max[k] = x;
  }
  const span = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const s = place.sizeM / (place.along === 'height' ? span[1] : Math.max(...span));
  const off = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  for (let v = 0; v < nVerts; v++) for (let k = 0; k < 3; k++) positions[v * 3 + k] = (positions[v * 3 + k] + off[k]) * s;
  const bounds = { min: min.map((x, k) => (x + off[k]) * s), max: max.map((x, k) => (x + off[k]) * s) };

  const matIndex = parts[0].prim.material ?? 0;
  const mat = json.materials?.[matIndex] ?? {};
  const pbr = mat.pbrMetallicRoughness ?? {};
  return {
    positions, normals, uvs, indices, triangles: indices.length / 3, bounds,
    maps: materialMaps(glb, matIndex),
    factors: {
      base: pbr.baseColorFactor ?? [1, 1, 1, 1], metal: pbr.metallicFactor ?? 1, rough: pbr.roughnessFactor ?? 1,
      normalScale: mat.normalTexture?.scale ?? 1,
    },
  };
}

/**
 * Decode a paint map's bytes as stored (no color conversion, no premultiplying).
 * @param {{ bytes: Uint8Array, mimeType: string } | null} map
 * @returns {Promise<ImageBitmap | null>}
 */
export async function decodeMap(map) {
  if (!map) return null;
  return createImageBitmap(new Blob([/** @type {BlobPart} */ (map.bytes)], { type: map.mimeType }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

/** The heat ramp: pale, amber, deep red. @param {number} t 0..1 */
function ramp(t) {
  const a = [241, 233, 218], b = [227, 166, 74], c = [168, 50, 42];
  const mix = (/** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number} */ f) => p.map((x, i) => x + (q[i] - x) * f);
  return t < 0.25 ? mix(a, b, t / 0.25) : mix(b, c, (t - 0.25) / 0.75);
}

/**
 * Compare two color maps at the copy's size: the original is drawn down to it with high quality
 * smoothing. Each pixel's difference is the mean of |r|, |g|, |b| in 0..255 units. The heat image
 * shows the copy's lightness in grey under the difference colored from pale (0) to deep red (32+).
 * @param {ImageBitmap} original @param {ImageBitmap} copy
 * @returns {{ mean: number, p99: number, heat: ImageData }}
 */
export function colorDiff(original, copy) {
  const w = copy.width, h = copy.height;
  /** @param {ImageBitmap} img */
  const pixels = (img) => {
    const cv = new OffscreenCanvas(w, h);
    const g = /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };
  const a = pixels(original), b = pixels(copy);
  const heat = new ImageData(w, h);
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const d = (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2])) / 3;
    sum += d;
    hist[Math.min(255, Math.round(d))]++;
    const lum = (0.3 * b[o] + 0.59 * b[o + 1] + 0.11 * b[o + 2]) / 255;
    const grey = 150 + 90 * lum;
    const t = Math.min(1, d / 32), k = Math.min(1, Math.max(0, (d - 2) / 8));  // under 2 stays grey
    const c = ramp(t);
    heat.data[o] = grey + (c[0] - grey) * k;
    heat.data[o + 1] = grey + (c[1] - grey) * k;
    heat.data[o + 2] = grey + (c[2] - grey) * k;
    heat.data[o + 3] = 255;
  }
  let p99 = 0, seen = 0;
  const want = 0.99 * w * h;
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= want) { p99 = v; break; } }
  return { mean: sum / (w * h), p99, heat };
}
