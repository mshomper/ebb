// @ts-check
// Mermaid's purses (docs/future/12): the empty egg cases of skates and rays, dried black or olive on
// the strandline. A flat pillow, longer than wide, with a short horn at each corner. The rare mark
// is a catshark's purse: smaller and paler, with long tendrils curling from its corners, made to
// wind round seaweed.

import { builder } from '../../finds/procedural.js';
import { closedBody, draws, gridMesh } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function purseNumbers(h0, rarity, K) {
  const S = K.purses, Tr = S.tiers[rarity], d = draws(h0);
  const curly = d.chance(S.marks.curly.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const bi = d.pick(curly ? S.curlyBase : Tr.base, 9);
  return {
    family: 'purse', gen: S.gen, rarity, form: curly ? 'catshark' : 'skate',
    sizeM: d.range(curly ? S.curlySizeM : Tr.sizeM, 3), aspect: d.range(curly ? [0.38, 0.48] : [0.55, 0.75], 4),
    puff: d.range([0.12, 0.22], 5), horn: d.range(curly ? [1.2, 2.0] : [0.25, 0.55], 6), hornCurl: d.range([0.5, 1.3], 7),
    base: d.tone(S.colors.base[bi], S.colors.jitter, 10), baseName: S.colors.baseNames[bi],
    mark: curly ? 'curly' : null,
  };
}

/** @param {any} n @param {any} K */
export function purseWords(n, K) {
  let line = `a ${n.baseName} mermaid's purse`;
  if (n.mark) line += ', ' + K.purses.marks.curly.word;
  else line += n.horn > 0.45 ? ', long-horned' : ', its horns short';
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function purseMesh(n, K) {
  const M = K.purses.mesh, b = builder();
  // The pillow, in units where it is 1 long (x) and aspect wide (z).
  const L = 0.5, Wd = 0.5 * n.aspect;
  const body = builder();
  closedBody(body, M.rows, M.cols, 1, (dir) => {
    // A rounded rectangle outline (a superellipse), puffed in the middle, thin at the edge.
    const ax = Math.abs(dir[0]), az = Math.abs(dir[2]), e = 4;
    const s = Math.pow(Math.pow(ax / L, e) + Math.pow(az / Wd, e), -1 / e);
    const x = dir[0] * s, z = dir[2] * s;
    const rim = 1 - Math.min(1, Math.hypot(x / L, z / Wd));
    return { p: [x, dir[1] * n.puff * (0.25 + rim), z], c: n.base.map((/** @type {number} */ v) => v * (0.85 + 0.3 * rim)) };
  });
  const bm = body.done();
  // Copy the pillow in, then a horn from each corner: a tapering tube that curls as it goes.
  for (let i = 0; i < bm.count; i++) b.vert([bm.vertices[i * 9], bm.vertices[i * 9 + 1], bm.vertices[i * 9 + 2]], [bm.vertices[i * 9 + 3], bm.vertices[i * 9 + 4], bm.vertices[i * 9 + 5]], [bm.vertices[i * 9 + 6], bm.vertices[i * 9 + 7], bm.vertices[i * 9 + 8]]);
  for (let t = 0; t < bm.indices.length; t += 3) b.tri(bm.indices[t], bm.indices[t + 1], bm.indices[t + 2]);
  let midY = 0;
  for (let i = 0; i < bm.count; i++) midY += bm.vertices[i * 9 + 1];
  midY /= bm.count;
  const rows = M.hornRows, cols = M.hornSides;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const P = new Float32Array(rows * cols * 3), C = new Float32Array(P.length), cen = new Float32Array(rows * 3);
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1), len = n.horn * 0.35 * t;
      // Out along the corner's diagonal, curling round toward the side.
      const a = Math.atan2(sz * Wd, sx * L) + sx * sz * n.hornCurl * t * t * (n.mark ? 3 : 1);
      const cx = sx * L * 0.88 + Math.cos(a) * len, cz = sz * Wd * 0.85 + Math.sin(a) * len;
      const r = 0.035 * (1 - 0.85 * t) + 0.004;
      cen.set([cx, midY, cz], i * 3);
      for (let j = 0; j < cols; j++) {
        const w = (j / cols) * Math.PI * 2, k = (i * cols + j) * 3;
        P.set([cx - Math.sin(a) * Math.cos(w) * r, midY + Math.sin(w) * r, cz + Math.cos(a) * Math.cos(w) * r], k);
        C.set(n.base.map((/** @type {number} */ v) => v * 0.8), k);
      }
    }
    gridMesh(b, P, C, rows, cols, cen, { capEnd: true });
  }
  const m = b.done();
  // Scale the whole purse, horns and all, to its size, centred on x and z.
  const V = m.vertices, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.count; i++) for (let r = 0; r < 3; r++) { lo[r] = Math.min(lo[r], V[i * 9 + r]); hi[r] = Math.max(hi[r], V[i * 9 + r]); }
  const sc = n.sizeM / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  for (let i = 0; i < m.count; i++) { V[i * 9] = (V[i * 9] - cx) * sc; V[i * 9 + 1] = (V[i * 9 + 1] - lo[1]) * sc; V[i * 9 + 2] = (V[i * 9 + 2] - cz) * sc; }
  return m;
}
