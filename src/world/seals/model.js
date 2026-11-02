// @ts-check
// The grey seal's body and rig (B3 wave 3): Matt's model (assets/models/seal, credited there), the
// body a game copy cut to about 6,000 triangles (tools/decimate-obj.mjs, Matt's go of November 1,
// 2026), the eyes and jaw as he made them. The files carry no UVs or normals and lie head toward +x,
// about 115 units long; here they are turned head toward +z, scaled to body.lengthM, stood on y = 0
// with the body's middle over the origin, and given smooth normals.
//
// The rig is made in code from the shape: a spine chain (tail, lumbar, root, chest, neck, head) with
// the jaw on the head, two fore flippers on the chest and two hind flippers on the tail. Pivots are
// the body's own middles at stations along it (recipes/species/seal.json rig, in the file's units);
// each body vertex is weighted along the spine by where it falls on the chain, blended into a
// flipper where it stands out past the body's side (fore) or past the tail (hind). The eyes ride the
// head, the jaw its own bone. The colour slot carries which part a vertex is (0 coat, 1 eye, 2 jaw)
// and where it was at rest, for the coat painted in seal-draw.wgsl. Pure: no DOM, no GPU.

import { packMesh } from '../creatures/bodies.js';

/** The bones, parents first. Moves are written against these roles (motion.js). */
export const SEAL_BONES = Object.freeze(['root', 'lumbar', 'tail', 'hindL', 'hindR', 'chest', 'neck', 'head', 'jaw', 'foreL', 'foreR']);
const PARENT = [-1, 0, 1, 2, 2, 0, 5, 6, 7, 5, 5];
/** Bone numbers by name. */
export const B = Object.freeze(Object.fromEntries(SEAL_BONES.map((n, i) => [n, i])));

/**
 * An OBJ's positions and triangles (fans split). @param {string} text
 * @returns {{ p: number[][], f: number[][] }}
 */
export function readObj(text) {
  /** @type {number[][]} */ const p = [];
  /** @type {number[][]} */ const f = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) p.push(line.trim().split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1);
      for (let i = 1; i + 1 < ids.length; i++) f.push([ids[0], ids[i], ids[i + 1]]);
    }
  }
  return { p, f };
}

/** @param {number} a @param {number} b @param {number} x */
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The body's middle and half width at a station x (file units): from the vertices within 2 units
 * of it standing above `aboveY` (the flippers lie lower, so they are left out).
 * @param {number[][]} p @param {number} x @param {number} aboveY
 */
function slice(p, x, aboveY) {
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of p) {
    if (Math.abs(v[0] - x) > 2) continue;
    if (v[1] < y0) y0 = v[1];
    if (v[1] > y1) y1 = v[1];
    if (v[1] < aboveY) continue;
    if (v[2] < z0) z0 = v[2];
    if (v[2] > z1) z1 = v[2];
  }
  if (!Number.isFinite(z0)) { z0 = -1; z1 = 1; }
  return { zc: (z0 + z1) / 2, hw: (z1 - z0) / 2, y0, y1 };
}

/**
 * The seal, built: packed mesh, skeleton (game metres) and counts.
 * @param {{ body: string, eyes: string, jaw: string }} files the three OBJ texts
 * @param {any} R recipes/species/seal.json
 * @returns {{ data: ArrayBuffer, indices: Uint32Array, count: number, tris: number, skeleton: { name: string, parent: number, pivot: number[] }[], lengthM: number, heightM: number }}
 */
export function buildSeal(files, R) {
  const G = R.rig, body = readObj(files.body), eyes = readObj(files.eyes), jaw = readObj(files.jaw);
  const P = body.p;
  // The file's length, and the scale to body.lengthM.
  let x0 = Infinity, x1 = -Infinity, low = Infinity;
  for (const v of P) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); low = Math.min(low, v[1]); }
  const k = R.body.lengthM / (x1 - x0), xMid = (x0 + x1) / 2;
  // Spine stations: each its middle (z) and half height (y), from the body above the flippers.
  const S = G.spine.map((/** @type {{ bone: string, x: number, y?: number }} */ s) => {
    const c = slice(P, s.x, G.aboveY);
    return { bone: B[s.bone], x: s.x, y: s.y ?? (c.y0 + c.y1) / 2, zc: c.zc };
  });
  const zMid = S.find((/** @type {any} */ s) => s.bone === B.root).zc;
  /** File units to game metres: head toward +z, the body's middle over the origin, soles on y = 0. @param {number[]} v */
  const toGame = (v) => [-(v[2] - zMid) * k, (v[1] - low) * k, (v[0] - xMid) * k];

  // Pivots (file units first).
  /** @type {number[][]} */ const pivF = new Array(SEAL_BONES.length);
  for (const s of S) pivF[s.bone] = [s.x, s.y, s.zc];
  const J = G.jaw, F = G.fore, H = G.hind;
  pivF[B.jaw] = J.pivot;
  // Left is the seal's own left (game +x, the file's -z side); its two fore flippers sit at different
  // stations, as Matt posed them.
  const fl = slice(P, F.L.x, F.aboveY), fr = slice(P, F.R.x, F.aboveY), hc = slice(P, H.x, G.aboveY);
  pivF[B.foreL] = [F.L.x, F.y, fl.zc - fl.hw * F.side];
  pivF[B.foreR] = [F.R.x, F.y, fr.zc + fr.hw * F.side];
  pivF[B.hindL] = [H.x, H.y, hc.zc - H.spread];
  pivF[B.hindR] = [H.x, H.y, hc.zc + H.spread];
  const skeleton = SEAL_BONES.map((name, i) => ({ name, parent: PARENT[i], pivot: toGame(pivF[i]) }));

  // Weights. The spine as a polyline in the side view (x, y), tail to head and on to the nose.
  const chain = S.map((/** @type {any} */ s) => ({ bone: s.bone, x: s.x, y: s.y }));
  /** Where a point falls on the chain: the nearest segment and how far along. @param {number} x @param {number} y */
  function onChain(x, y) {
    let best = 0, bestU = 0, bestD = Infinity;
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      const d = (a.x + u * dx - x) ** 2 + (a.y + u * dy - y) ** 2;
      if (d < bestD) { bestD = d; best = i; bestU = u; }
    }
    // Past either end the end bone holds it all.
    if (best === 0 && x < chain[0].x) bestU = 0;
    return { i: best, u: bestU };
  }
  const zcAt = (/** @type {number} */ x) => {
    // The middle between stations, as a line through them.
    for (let i = 0; i + 1 < S.length; i++) if (x <= S[i + 1].x) { const u = Math.max(0, Math.min(1, (x - S[i].x) / (S[i + 1].x - S[i].x))); return S[i].zc + (S[i + 1].zc - S[i].zc) * u; }
    return S[S.length - 1].zc;
  };
  // Half widths along the body, once (whole units of x), for the fore flipper test.
  /** @type {Map<number, number>} */ const hwAt = new Map();
  for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) hwAt.set(x, slice(P, x, F.aboveY).hw);
  /** A body vertex's weights by bone. @param {number[]} v */
  function weigh(v) {
    const w = new Float64Array(SEAL_BONES.length);
    const c = onChain(v[0], v[1]);
    const a = chain[c.i].bone, b = chain[c.i + 1].bone;
    // Blended over the middle of each segment, so the joints bend softly.
    const t = smooth(0.25, 0.75, c.u);
    // Fore flippers: out past the body's side near the shoulder, low down.
    const side = v[2] - zcAt(v[0]);
    const hw = hwAt.get(Math.round(v[0])) ?? 0, S4 = side >= 0 ? F.R : F.L;
    const wf = smooth(S4.span[0], S4.span[0] + 4, v[0]) * (1 - smooth(S4.span[1] - 4, S4.span[1], v[0])) * (1 - smooth(F.yMax - 4, F.yMax, v[1])) * smooth(hw - F.in, hw + F.out, Math.abs(side));
    // Hind flippers: behind the tail station.
    const wh = 1 - smooth(H.from - H.blend, H.from, v[0]);
    const spine = 1 - Math.min(1, wf + wh);
    w[a] += spine * (1 - t); w[b] += spine * t;
    w[side >= 0 ? B.foreR : B.foreL] += wf;
    w[v[2] - hc.zc >= 0 ? B.hindR : B.hindL] += Math.min(wh, 1 - wf);
    return w;
  }

  // One list of vertices and triangles: body, eyes, jaw.
  const parts = [{ m: body, part: 0 }, { m: eyes, part: 1 }, { m: jaw, part: 2 }];
  const count = parts.reduce((s, q) => s + q.m.p.length, 0), tris = parts.reduce((s, q) => s + q.m.f.length, 0);
  const vertices = new Float32Array(count * 9), J4 = new Uint8Array(count * 4), W4 = new Uint8Array(count * 4);
  const indices = new Uint32Array(tris * 3);
  let vi = 0, ti = 0;
  for (const { m, part } of parts) {
    const base = vi;
    // Smooth normals: each vertex the area-weighted sum of its triangles' (in game space).
    const g = m.p.map(toGame), n = m.p.map(() => [0, 0, 0]);
    for (const f of m.f) {
      const [a, b, c] = f.map((i) => g[i]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      for (const i of f) { n[i][0] += cr[0]; n[i][1] += cr[1]; n[i][2] += cr[2]; }
      indices[ti++] = base + f[0]; indices[ti++] = base + f[1]; indices[ti++] = base + f[2];
    }
    m.p.forEach((v, i) => {
      const l = Math.hypot(n[i][0], n[i][1], n[i][2]) || 1;
      // Colour slot: part, and the body length share along the body (0 tail .. 1 nose), for the coat.
      vertices.set([...g[i], n[i][0] / l, n[i][1] / l, n[i][2] / l, part, (v[0] - x0) / (x1 - x0), 0], vi * 9);
      /** @type {Float64Array} */ let w;
      if (part === 0) w = weigh(v);
      else { w = new Float64Array(SEAL_BONES.length); w[part === 2 ? B.jaw : B.head] = 1; }
      // The four strongest bones, as bytes summing to 255.
      const top = [...w.keys()].filter((q) => w[q] > 1e-4).sort((p, q) => w[q] - w[p] || p - q).slice(0, 4);
      const sum = top.reduce((s, q) => s + w[q], 0) || 1;
      let left = 255;
      top.forEach((q, j) => {
        const byte = j === top.length - 1 ? left : Math.min(left, Math.round((255 * w[q]) / sum));
        J4[vi * 4 + j] = q; W4[vi * 4 + j] = byte; left -= byte;
      });
      if (!top.length) W4[vi * 4] = 255;
      vi++;
    });
  }
  let hi = 0;
  for (let v = 0; v < count; v++) hi = Math.max(hi, vertices[v * 9 + 1]);
  return { data: packMesh({ vertices, count }, J4, W4), indices, count, tris, skeleton, lengthM: R.body.lengthM, heightM: hi };
}
