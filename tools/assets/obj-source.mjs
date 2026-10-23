// A source model given as an OBJ with no UVs or paint (Matt's single log, cut out of the log pile
// and remeshed, October 22, 2026), read into a glTF document for build-models.mjs: one mesh, its
// faces fanned into triangles, smooth normals, laid with its long axis along +x, and painted in
// vertex colours from another model's base colour map (models.json `paint`).
//
// The paint cannot be copied point by point: the log was remeshed in its own units and frame, so it
// has no exact match on the pile's surface. Instead the pile's own colours are read from its map
// (its bark, the darker bulk; its cut ends, the palest few) and laid on the log by where each vertex
// faces: bark along the sides, with seeded streaks along the grain, and end grain with rings on the
// two cut ends. Deterministic: the same files give the same colours.

import { readFileSync } from 'node:fs';
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';

/** @param {string} text @returns {{ V: number[][], T: number[] }} positions and triangle indices */
function parseObj(text) {
  /** @type {number[][]} */ const V = [];
  /** @type {number[]} */ const T = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) V.push(line.trim().split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('f ')) {
      const f = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1);
      for (let k = 1; k + 1 < f.length; k++) T.push(f[0], f[k], f[k + 1]);
    }
  }
  return { V, T };
}

/** The long axis by power iteration on the covariance, and the middle. @param {number[][]} V */
function longAxis(V) {
  const c = [0, 0, 0];
  for (const p of V) for (let i = 0; i < 3; i++) c[i] += p[i] / V.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of V) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (p[i] - c[i]) * (p[j] - c[j]);
  let v = [1, 0.3, 0.2];
  for (let it = 0; it < 200; it++) {
    const w = [0, 1, 2].map((i) => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]);
    const l = Math.hypot(...w);
    v = w.map((x) => x / l);
  }
  return { c, v };
}

/**
 * The direction across the long axis in which the points spread least (the second axis by power
 * iteration with the long axis taken out, then square to both).
 * @param {number[][]} V @param {number[]} c @param {number[]} v the long axis
 */
function thinnest(V, c, v) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of V) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], t = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    const q = [d[0] - t * v[0], d[1] - t * v[1], d[2] - t * v[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += q[i] * q[j];
  }
  let w = [v[1], -v[0], 0.3];
  for (let it = 0; it < 200; it++) {
    const n = [0, 1, 2].map((i) => C[i][0] * w[0] + C[i][1] * w[1] + C[i][2] * w[2]);
    const l = Math.hypot(...n) || 1;
    w = n.map((x) => x / l);
  }
  const s = [v[1] * w[2] - v[2] * w[1], v[2] * w[0] - v[0] * w[2], v[0] * w[1] - v[1] * w[0]];
  return s[1] < 0 ? s.map((x) => -x) : s;
}

/** A small seeded hash to 0..1. @param {number} a @param {number} b @param {number} c */
function hash01(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}

const toLinear = (/** @type {number} */ c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/**
 * The bark and end-grain colours of a model's base colour map, linear: the mean of the middle of its
 * pixels by brightness (the bark) and of its brightest few (cut ends).
 * @param {import('@gltf-transform/core').Document} from
 */
async function paletteOf(from) {
  const mat = from.getRoot().listMaterials()[0];
  const tex = mat?.getBaseColorTexture();
  if (!tex) throw new Error('the paint source has no base colour map');
  const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(128, 128, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  /** @type {number[][]} */ const px = [];
  for (let i = 0; i < info.width * info.height; i++) px.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);
  const luma = (/** @type {number[]} */ p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  px.sort((a, b) => luma(a) - luma(b));
  /** @param {number} a @param {number} b */
  const mean = (a, b) => {
    const s = px.slice(Math.floor(px.length * a), Math.floor(px.length * b));
    return [0, 1, 2].map((c) => s.reduce((t, p) => t + toLinear(p[c]), 0) / s.length);
  };
  return { bark: mean(0.15, 0.65), end: mean(0.88, 0.99), dark: mean(0.3, 0.6), mid: mean(0.6, 0.9) };
}

/**
 * Each triangle into four, through its edges' midpoints (shared, so the mesh stays joined). The
 * shape stays as it was; there are only more vertices to paint. In place.
 * @param {number[][]} P @param {number[]} T
 */
function subdivide(P, T) {
  /** @type {Map<string, number>} */ const mid = new Map();
  /** @param {number} a @param {number} b */
  const at = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let i = mid.get(k);
    if (i === undefined) { i = P.length; P.push([0, 1, 2].map((c) => (P[a][c] + P[b][c]) / 2)); mid.set(k, i); }
    return i;
  };
  const out = [];
  for (let t = 0; t < T.length; t += 3) {
    const [a, b, c] = [T[t], T[t + 1], T[t + 2]], ab = at(a, b), bc = at(b, c), ca = at(c, a);
    out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  T.length = 0;
  T.push(...out);
}

/**
 * Read an OBJ source into a document, laid along +x and painted.
 * @param {string} path @param {{ paint?: { from: string } }} m @param {(p: string) => Promise<import('@gltf-transform/core').Document>} read
 * @param {string} sourceDir
 */
export async function readObjSource(path, m, read, sourceDir) {
  const { V, T } = parseObj(readFileSync(path, 'utf8'));
  // Lay the long axis along +x, about the middle (y keeps up as near as it can).
  const { c, v } = longAxis(V);
  // Up: as near the file's up as it can be, or (restFlat, a stone) its thinnest direction, so it
  // lies on its flattest side.
  const up0 = m.restFlat ? thinnest(V, c, v) : Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const d = v[0] * up0[0] + v[1] * up0[1] + v[2] * up0[2];
  let y = [up0[0] - d * v[0], up0[1] - d * v[1], up0[2] - d * v[2]];
  const yl = Math.hypot(...y); y = y.map((q) => q / yl);
  const z = [v[1] * y[2] - v[2] * y[1], v[2] * y[0] - v[0] * y[2], v[0] * y[1] - v[1] * y[0]];
  const P = V.map((p) => { const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [q[0] * v[0] + q[1] * v[1] + q[2] * v[2], q[0] * y[0] + q[1] * y[1] + q[2] * y[2], q[0] * z[0] + q[1] * z[1] + q[2] * z[2]]; });

  // A light model gets more vertices to carry its paint (each triangle into four, `subdivide` times).
  for (let s = 0; s < (m.subdivide ?? 0); s++) subdivide(P, T);

  // Smooth normals, area weighted.
  const N = P.map(() => [0, 0, 0]);
  for (let t = 0; t < T.length; t += 3) {
    const [a, b, e] = [P[T[t]], P[T[t + 1]], P[T[t + 2]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const i of [T[t], T[t + 1], T[t + 2]]) for (let k = 0; k < 3; k++) N[i][k] += n[k];
  }
  for (const n of N) { const l = Math.hypot(...n) || 1; for (let k = 0; k < 3; k++) n[k] /= l; }

  // Paint: bark along the sides with streaks along the grain; end grain with rings on the ends.
  const pal = await paletteOf(await read(`${sourceDir}/${m.paint?.from}`));
  let x0 = Infinity, x1 = -Infinity, R = 0;
  for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); R = Math.max(R, Math.hypot(p[1], p[2])); }
  const colors = new Float32Array(P.length * 4);
  if (m.paint?.style === 'stone') {
    // A stone: its pile's greys in soft blotches at two sizes, with pale flecks (lichen, quartz).
    const span = x1 - x0;
    P.forEach((p, i) => {
      const q = (/** @type {number} */ s) => p.map((x) => Math.floor((x / span) * s));
      const blot = 0.6 * hash01(...q(5)) + 0.4 * hash01(...q(13).map((x, k) => x + 31 * k));
      const fleck = hash01(...q(40).map((x, k) => x * 3 + k)) > 0.94 ? 1 : 0;
      for (let k = 0; k < 3; k++) {
        const base = pal.dark[k] * (1 - blot) + pal.mid[k] * blot;
        colors[i * 4 + k] = base * (1 - fleck) + pal.end[k] * fleck;
      }
      colors[i * 4 + 3] = 1;
    });
  } else P.forEach((p, i) => {
    const ang = Math.atan2(p[2], p[1]);
    // Streaks: by angle round the log (along the grain), with a little along its length.
    const streak = 0.78 + 0.34 * hash01(Math.floor((ang + Math.PI) * 18), Math.floor((p[0] - x0) * 6), 7);
    const ends = Math.min(1, Math.max(0, (Math.abs(N[i][0]) - 0.55) / 0.3));
    const ring = 0.9 + 0.1 * Math.cos((Math.hypot(p[1], p[2]) / R) * 9 * Math.PI);
    for (let k = 0; k < 3; k++) colors[i * 4 + k] = pal.bark[k] * streak * (1 - ends) + pal.end[k] * ring * ends;
    colors[i * 4 + 3] = 1;
  });

  const doc = new Document();
  const buf = doc.createBuffer();
  const acc = (/** @type {string} */ type, /** @type {any} */ arr) => doc.createAccessor().setType(/** @type {any} */ (type)).setArray(arr).setBuffer(buf);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', Float32Array.from(P.flat())))
    .setAttribute('NORMAL', acc('VEC3', Float32Array.from(N.flat())))
    .setAttribute('COLOR_0', acc('VEC4', colors))
    .setIndices(acc('SCALAR', Uint32Array.from(T)))
    .setMaterial(doc.createMaterial('log').setRoughnessFactor(0.9).setMetallicFactor(0));
  const mesh = doc.createMesh('log').addPrimitive(prim);
  const node = doc.createNode('log').setMesh(mesh);
  doc.createScene('scene').addChild(node);
  return doc;
}
