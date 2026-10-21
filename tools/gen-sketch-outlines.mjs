// Field sketch outlines from the find models (docs/future/11), so the journal's drawings keep each
// find's true shape. For every subject below: pose the model as the game does, look at it from the
// given side, and trace three things in a small raster: the outline, the creases you can see (ribs,
// whorls, leg joints: edges where the surface turns sharply), and the line where the shadow side
// starts (light from the upper left). Writes src/ui/sketches/outlines.js, which the sketches draw in
// the journal pen. Run with Node from the repo root after a model changes:
//   node tools/gen-sketch-outlines.mjs
// Pure Node: reads the glTF files directly, no packages.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { parseFindModel, joinParts } from '../src/world/finds/models.js';
import { parseRig, posedMesh } from '../src/world/finds/rig.js';
import { musselPair, musselBones } from '../src/world/finds/mussel.js';
import { fungusMeshes } from '../src/world/finds/autumn-meshes.js';
import { bakeBody } from '../src/world/creatures/body-bake.js';
import { skeletonOf, skinWeights } from '../src/world/creatures/bodies.js';
import { poseSkeleton, axisAngle } from '../src/world/creatures/pose.js';
import { posePatrol } from '../src/world/creatures/patrol.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const recipe = JSON.parse(readFileSync(join(ROOT, 'recipes/species/finds.json'), 'utf8'));
const K = recipe.kinds;
// Autumn's fungi are built in code (src/world/finds/autumn-meshes.js): traced from those meshes.
const fungi = fungusMeshes(JSON.parse(readFileSync(join(ROOT, 'recipes/species/autumn-finds.json'), 'utf8')).fungi);

/** @param {string} url */
function gltfAt(url) {
  const file = join(ROOT, url);
  const gltf = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const buffers = gltf.buffers.map((/** @type {any} */ b) => { const n = readFileSync(join(dirname(file), b.uri)); return n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength); });
  return { gltf, buffers };
}
/** @param {any} M a kind's or item's model block @param {(p: number[], k: number) => number[]} [move] */
function meshOf(M, move) {
  const { gltf, buffers } = gltfAt(M.url);
  if (M.rigged) return posedMesh(parseRig(gltf, buffers, M.heightM, M.rotDeg), 0);
  return joinParts(parseFindModel(gltf, buffers), M.heightM, M.rotDeg, move ?? ((p) => p), M.tint);
}
/** The anemone shut, as src/world/finds/index.js shutAnemone draws it. */
function shutMove(/** @type {any} */ A) {
  const parts = parseFindModel(...Object.values(gltfAt(A.url)));
  let top = 0;
  for (let i = 0; i < parts[A.bodyPart].count; i++) top = Math.max(top, parts[A.bodyPart].vertices[i * 9 + 1]);
  const S = A.shut;
  return (/** @type {number[]} */ p, /** @type {number} */ k) => {
    if (k === A.bodyPart) { const t = Math.max(0, Math.min(1, p[1] / top)); const r = S.widen * (1 - S.close * t * t); return [p[0] * r, p[1] * S.sink, p[2] * r]; }
    const r = S.fold * (1 - S.close);
    return [p[0] * r, top * S.sink + (p[1] - top) * S.fold, p[2] * r];
  };
}

const item = (/** @type {string} */ id) => K.shells.items.find((/** @type {any} */ i) => i.id === id).model;
// yaw turns the model about up before looking; pitch tips the view down toward the top (90: from above).
const SUBJECTS = {
  'anemone-open': { mesh: meshOf(K.anemone.model), yaw: 25, pitch: 8 },
  'anemone-shut': { mesh: meshOf(K.anemone.model, shutMove(K.anemone.model)), yaw: 25, pitch: 8 },
  periwinkle: { mesh: meshOf(K.periwinkle.model), yaw: 240, pitch: 20 },
  hermitcrab: { mesh: meshOf(K.hermitcrab.model), yaw: 90, pitch: 10 },
  ediblecrab: { mesh: meshOf(K.ediblecrab.model), yaw: 0, pitch: 75 },
  'shell-periwinkle': { mesh: meshOf(item('periwinkle')), yaw: 240, pitch: 30 },
  'shell-turret': { mesh: meshOf(item('turret')), yaw: 10, pitch: 25 },
  'shell-cockle': { mesh: meshOf(item('cockle')), yaw: 0, pitch: 70 },
  'shell-murex': { mesh: meshOf(item('murex')), yaw: 20, pitch: 25 },
  'shell-nautilus': { mesh: meshOf(item('nautilus')), yaw: 0, pitch: 85 },
  mussel: { mesh: musselOpen(K.mussels.model), yaw: 15, pitch: 12 },
  sanddollar: { mesh: meshOf(K.sanddollars.model), yaw: 0, pitch: 80 },
  'fungus-bracket': { mesh: fungi['bracket-0'], yaw: 0, pitch: 32 },
  'fungus-cap': { mesh: fungi['cap-0'], yaw: 0, pitch: 10 },
  'fungus-cap-lean': { mesh: fungi['cap-2'], yaw: 90, pitch: 10 },
  // Animals with a blended-SDF body (recipes/species), posed as the game poses them at rest.
  damselfly: { mesh: perchedBody('damselfly'), yaw: 90, pitch: 8 },
};

/**
 * A flying species' body as it rests on a perch (patrol.js posePatrol: a damselfly's wings folded
 * back along its abdomen), baked from its recipe and skinned to that pose.
 * @param {string} id recipes/species/<id>.json
 */
function perchedBody(id) {
  const rec = JSON.parse(readFileSync(join(ROOT, `recipes/species/${id}.json`), 'utf8'));
  const body = rec.body;
  const mesh = bakeBody(body, rec.bake.cellM);
  const bones = skeletonOf(id, body.prims, body.bones ?? null);
  const skin = skinWeights(body.prims, bones, mesh.vertices, mesh.count, body.skin?.blendM ?? 0.0025);
  const moves = posePatrol(bones, /** @type {any} */ ({ mode: 'perch', phase: 0 }), rec.motion, [0, 0, 0, 1], axisAngle);
  const B = new Float32Array(bones.length * 16);
  poseSkeleton(bones, moves, B, 0);
  const V = mesh.vertices;
  for (let i = 0; i < mesh.count; i++) {
    const p = [V[i * 9], V[i * 9 + 1], V[i * 9 + 2]], n = [V[i * 9 + 3], V[i * 9 + 4], V[i * 9 + 5]];
    const P = [0, 0, 0], N = [0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const w = skin.weights[i * 4 + j] / 255, o = skin.joints[i * 4 + j] * 16;
      if (!w) continue;
      for (let r = 0; r < 3; r++) {
        P[r] += w * (B[o + r] * p[0] + B[o + 4 + r] * p[1] + B[o + 8 + r] * p[2] + B[o + 12 + r]);
        N[r] += w * (B[o + r] * n[0] + B[o + 4 + r] * n[1] + B[o + 8 + r] * n[2]);
      }
    }
    const l = Math.hypot(...N) || 1;
    V.set([...P, N[0] / l, N[1] / l, N[2] / l], i * 9);
  }
  return mesh;
}

/** The mussel's pair, gaping as it does under water (src/world/finds/mussel.js). @param {any} M */
function musselOpen(M) {
  const pr = musselPair(meshOf(M));
  const B = musselBones(pr.hinge, (M.gapeDeg * Math.PI) / 180);
  const V = pr.mesh.vertices, half = pr.mesh.count / 2;
  for (let i = half; i < pr.mesh.count; i++) {
    const p = [V[i * 9], V[i * 9 + 1], V[i * 9 + 2]], n = [V[i * 9 + 3], V[i * 9 + 4], V[i * 9 + 5]];
    for (let r = 0; r < 3; r++) {
      V[i * 9 + r] = B[16 + r] * p[0] + B[20 + r] * p[1] + B[24 + r] * p[2] + B[28 + r];
      V[i * 9 + 3 + r] = B[16 + r] * n[0] + B[20 + r] * n[1] + B[24 + r] * n[2];
    }
  }
  return pr.mesh;
}

const N = 220;          // raster cells across the larger side
const CREASE = 38;      // degrees between faces that make a visible crease
const LIGHT = norm([-0.5, 0.75, 0.45]);

/** @param {number[]} v */
function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }

/** @param {{ vertices: Float32Array, count: number, indices: Uint32Array }} mesh @param {number} yawDeg @param {number} pitchDeg */
function trace(mesh, yawDeg, pitchDeg) {
  const V = mesh.vertices, I = mesh.indices;
  const cy = Math.cos((yawDeg * Math.PI) / 180), sy = Math.sin((yawDeg * Math.PI) / 180);
  const cp = Math.cos((pitchDeg * Math.PI) / 180), sp = Math.sin((pitchDeg * Math.PI) / 180);
  // View space: x right, y up on the page, z toward the viewer.
  const view = (/** @type {number[]} */ p) => {
    const x = cy * p[0] + sy * p[2], z = -sy * p[0] + cy * p[2];
    return [x, cp * p[1] - sp * z, sp * p[1] + cp * z];
  };
  const P = Array.from({ length: mesh.count }, (_, i) => view([V[i * 9], V[i * 9 + 1], V[i * 9 + 2]]));
  const Nn = Array.from({ length: mesh.count }, (_, i) => view([V[i * 9 + 3], V[i * 9 + 4], V[i * 9 + 5]]));
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of P) { lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])]; hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])]; }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  const cell = span / N, W = Math.ceil((hi[0] - lo[0]) / cell) + 4, H = Math.ceil((hi[1] - lo[1]) / cell) + 4;
  const toGrid = (/** @type {number[]} */ p) => [(p[0] - lo[0]) / cell + 2, (hi[1] - p[1]) / cell + 2];
  const depth = new Float32Array(W * H).fill(-Infinity), shade = new Float32Array(W * H);
  let tone = [0, 0, 0], toneW = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const A = toGrid(P[a]), B = toGrid(P[b]), C = toGrid(P[c]);
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const n = norm([0, 1, 2].map((k) => Nn[a][k] + Nn[b][k] + Nn[c][k]));
    const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    if (n[2] > 0) { for (let k = 0; k < 3; k++) tone[k] += (V[a * 9 + 6 + k] + V[b * 9 + 6 + k] + V[c * 9 + 6 + k]) / 3 * Math.abs(area); toneW += Math.abs(area); }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
      const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * P[a][2] + w1 * P[b][2] + w2 * P[c][2];
      const k = y * W + x;
      if (z > depth[k]) { depth[k] = z; shade[k] = lit; }
    }
  }
  const inside = (/** @type {number} */ x, /** @type {number} */ y) => x >= 0 && y >= 0 && x < W && y < H && depth[y * W + x] > -Infinity;
  // The outline: the mask's boundary, the longest loop.
  const mask = new Float32Array(W * H).map((_, k) => (depth[k] > -Infinity ? 1 : 0));
  const outline = longest(chains(iso(mask, W, H, 0.5)), true);
  // The shadow side: where the light falls off, inside the shape.
  const shadeField = new Float32Array(W * H).map((_, k) => (depth[k] > -Infinity ? shade[k] : 1));
  let smin = 1, smax = 0;
  for (let k = 0; k < W * H; k++) if (depth[k] > -Infinity) { smin = Math.min(smin, shade[k]); smax = Math.max(smax, shade[k]); }
  // The level sits a third of the way up from the darkest lit value seen.
  const level = smin + (smax - smin) * 0.33;
  const shadow = chains(iso(shadeField, W, H, level)).filter((c) => c.length > 10);
  if (process.env.DEBUG) console.log('  shade', smin.toFixed(2), smax.toFixed(2));
  // Creases you can see: edges between faces that turn sharply, whose middle is not hidden.
  const faceN = [];
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [P[I[t]], P[I[t + 1]], P[I[t + 2]]];
    faceN.push(norm([(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]));
  }
  /** @type {Map<string, number[]>} */ const edges = new Map();
  const key = (/** @type {number[]} */ p) => p.map((x) => Math.round(x * 1e6)).join(',');
  for (let t = 0, f = 0; t < I.length; t += 3, f++) for (let e = 0; e < 3; e++) {
    const a = I[t + e], b = I[t + ((e + 1) % 3)];
    const ka = key(P[a]), kb = key(P[b]);
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const list = edges.get(k);
    if (list) list.push(f, a, b); else edges.set(k, [f, a, b]);
  }
  /** @type {number[][][]} */ const creaseSegs = [];
  const cos = Math.cos((CREASE * Math.PI) / 180);
  for (const list of edges.values()) {
    if (list.length < 6) continue;
    const n1 = faceN[list[0]], n2 = faceN[list[3]];
    const d = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
    if (Math.abs(d) > cos) continue;
    if (n1[2] < 0 && n2[2] < 0) continue;   // both faces turned away
    const A = P[list[1]], B = P[list[2]];
    const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    const g = toGrid(m), gx = Math.floor(g[0]), gy = Math.floor(g[1]);
    if (!inside(gx, gy) || depth[gy * W + gx] - m[2] > cell * 2.5) continue;
    creaseSegs.push([toGrid(A), toGrid(B)]);
  }
  const creases = chains(creaseSegs).filter((c) => c.length >= 2 && pathLen(c) > 5).sort((a, b) => pathLen(b) - pathLen(a)).slice(0, 60);
  // Normalized: x 0..1 across the width, y down from 0, in the same units.
  const sx = 1 / W;
  const fit = (/** @type {number[][]} */ pts, /** @type {number} */ eps) => simplify(pts, eps).map(([x, y]) => [round(x * sx), round(y * sx)]);
  const t = toneW ? tone.map((x) => x / toneW) : [0.5, 0.5, 0.5];
  // Darkness on a coarse grid (GW across), for hatching the shadow side: a digit 0 (lit) .. 9
  // (darkest) per cell, '.' outside the shape. Rows joined by '/'.
  const GW = 40, gc = W / GW, GH = Math.max(1, Math.round(H / gc));
  const rows = [];
  for (let gy = 0; gy < GH; gy++) {
    let row = '';
    for (let gx = 0; gx < GW; gx++) {
      let n = 0, sum = 0, all = 0;
      for (let y = Math.floor(gy * gc); y < Math.min(H, Math.floor((gy + 1) * gc)); y++) for (let x = Math.floor(gx * gc); x < Math.min(W, Math.floor((gx + 1) * gc)); x++) {
        all++;
        if (depth[y * W + x] > -Infinity) { n++; sum += (shade[y * W + x] - smin) / Math.max(smax - smin, 1e-6); }
      }
      row += n * 2 < all ? '.' : String(Math.min(9, Math.round((1 - sum / n) * 9)));
    }
    rows.push(row);
  }
  return {
    // The width the outline spans, in meters at real size (raster margins included).
    widthM: Math.round(W * cell * 1e5) / 1e5,
    aspect: round(H / W), outline: fit(outline, 0.8), dark: rows.join('/'),
    creases: creases.map((c) => fit(c, 0.7)).filter((c) => c.length >= 2),
    shadow: shadow.map((c) => fit(c, 1.2)).filter((c) => c.length >= 3).slice(0, 6),
    tone: '#' + t.map((c) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join(''),
  };
}

/** @param {number} x */
function round(x) { return Math.round(x * 1000) / 1000; }
/** @param {number[][]} c */
function pathLen(c) { let s = 0; for (let i = 1; i < c.length; i++) s += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); return s; }

/** Marching squares: the segments where a field crosses a level. */
function iso(/** @type {Float32Array} */ F, /** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ lv) {
  /** @type {number[][][]} */ const segs = [];
  const at = (/** @type {number} */ x, /** @type {number} */ y) => F[y * W + x];
  const lerp = (/** @type {number[]} */ p, /** @type {number[]} */ q, /** @type {number} */ a, /** @type {number} */ b) => { const t = (lv - a) / (b - a || 1e-9); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
    const pa = [x, y], pb = [x + 1, y], pc = [x + 1, y + 1], pd = [x, y + 1];
    const e = [];
    if ((a < lv) !== (b < lv)) e.push(lerp(pa, pb, a, b));
    if ((b < lv) !== (c < lv)) e.push(lerp(pb, pc, b, c));
    if ((c < lv) !== (d < lv)) e.push(lerp(pc, pd, c, d));
    if ((d < lv) !== (a < lv)) e.push(lerp(pd, pa, d, a));
    if (e.length === 2) segs.push([e[0], e[1]]);
    else if (e.length === 4) { segs.push([e[0], e[1]]); segs.push([e[2], e[3]]); }
  }
  return segs;
}

/** Join segments that share ends into polylines. @param {number[][][]} segs */
function chains(segs) {
  const k = (/** @type {number[]} */ p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  /** @type {Map<string, number[]>} */ const ends = new Map();
  segs.forEach((s, i) => { for (const p of s) { const kk = k(p); (ends.get(kk) ?? ends.set(kk, []).get(kk)).push(i); } });
  const used = new Uint8Array(segs.length);
  /** @type {number[][][]} */ const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const endP = dir ? line[line.length - 1] : line[0];
        const next = (ends.get(k(endP)) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const s = segs[next];
        const other = k(s[0]) === k(endP) ? s[1] : s[0];
        if (dir) line.push(other); else line.unshift(other);
      }
    }
    out.push(line);
  }
  return out;
}

/** @param {number[][][]} cs @param {boolean} closed */
function longest(cs, closed) { return cs.sort((a, b) => pathLen(b) - pathLen(a))[0] ?? []; }

/** Ramer-Douglas-Peucker. @param {number[][]} pts @param {number} eps */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  // A closed loop: simplify its two halves, split at the point farthest from the start.
  const [s, e] = [pts[0], pts[pts.length - 1]];
  if (Math.hypot(s[0] - e[0], s[1] - e[1]) < 1e-6) {
    let far = 1, fd = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - s[0], pts[i][1] - s[1]); if (d > fd) { fd = d; far = i; } }
    return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
  }
  let idx = 0, dmax = 0;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[1] - a[1]) * pts[i][0] - (b[0] - a[0]) * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const out = {};
// `VIEWS=<subject>` writes that subject from twelve sides instead (<subject>@yaw,pitch), to choose a view.
if (process.env.VIEWS) {
  const base = SUBJECTS[process.env.VIEWS];
  for (const yaw of [0, 60, 120, 180, 240, 300]) for (const pitch of [5, 40]) SUBJECTS[`${process.env.VIEWS}@${yaw},${pitch}`] = { ...base, yaw, pitch };
  for (const k of Object.keys(SUBJECTS)) if (!k.includes('@')) delete SUBJECTS[k];
}
for (const [id, s] of Object.entries(SUBJECTS)) {
  out[id] = trace(s.mesh, s.yaw, s.pitch);
  console.log(id, 'outline', out[id].outline.length, 'creases', out[id].creases.length, 'shadow', out[id].shadow.length, 'tone', out[id].tone);
}
const text = `// Generated by tools/gen-sketch-outlines.mjs from the find models; do not edit by hand.
// Each subject: aspect (height over width), outline (one closed loop), creases (visible sharp
// edges) and shadow (where the shadow side starts), as points with x 0..1 across the width and y
// down from 0, and tone (the model's mean color as seen, sRGB).
export const OUTLINES = ${JSON.stringify(out)};
`;
writeFileSync(join(ROOT, process.env.VIEWS ? 'tools/sketch-views.js' : 'src/ui/sketches/outlines.js'), text);
console.log('wrote', process.env.VIEWS ? 'tools/sketch-views.js' : 'src/ui/sketches/outlines.js', Math.round(text.length / 1024), 'KB');
