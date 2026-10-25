// Parting a fused model by its paint (models.json `dropPaint`): a generated model comes as one mesh,
// so a part that should come and go in the game (the herb bunches baked onto Matt's drying rack)
// cannot be dropped by node name. The mesh is split into its connected pieces (corners at the same
// spot count as joined); each piece's paint is averaged over its triangles from the base colour map,
// and a piece whose average is not in the kept band (hueDeg, at least minSat, HSV) is left out, with
// the vertices nothing uses any more. With `keep: true` it goes the other way: only those pieces
// stay (the bunches on their own). Build-time only.

import { compactPrimitive } from '@gltf-transform/functions';
import sharp from 'sharp';

/** Hue (degrees) and saturation (0..1) of a colour. @param {number} r @param {number} g @param {number} b */
export function hueSat(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return [0, 0];
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, mx === 0 ? 0 : d / mx];
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{ hueDeg: [number, number], minSat: number, minTris?: number, keep?: boolean, tri?: { hueDeg: [number, number], minSat: number },
 *   hang?: { endsShare: number, reachShare: number, tolShare: number }, scrapTris?: number, tallShare?: number }} rule
 *   scrapTris: kept scraps smaller than this go too; tallShare: a lifted group taller than this share
 *   of the model is frame after all;
 *   hang: { endsShare, reachShare, tolShare }: bunches fused onto the frame, found by shape (below);
 *   tri: inside a kept piece, a triangle whose own paint is mostly outside this wider band goes too;
 *   hueDeg, minSat: the paint a kept piece averages to (the rack's brown wood and tan cord);
 *   minTris: and at least this many triangles (dried leaves are tan too, but small);
 *   keep: keep only the other pieces instead
 * @returns {Promise<{ before: number, after: number, pieces: number, dropped: number }>}
 */
export async function dropPaint(doc, rule) {
  let before = 0, after = 0, pieces = 0, dropped = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const tex = p.getMaterial()?.getBaseColorTexture(), uv = p.getAttribute('TEXCOORD_0'), idx = p.getIndices();
    if (!tex || !uv || !idx) continue;
    const { data, info } = await sharp(Buffer.from(/** @type {Uint8Array} */ (tex.getImage()))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const pos = /** @type {Float32Array} */ (p.getAttribute('POSITION').getArray()), uvs = /** @type {Float32Array} */ (uv.getArray()), ix = idx.getArray();
    // Corners at one spot are one corner, so a piece split by UV seams stays whole.
    const nv = pos.length / 3, spot = new Map(), of = new Int32Array(nv);
    for (let v = 0; v < nv; v++) {
      const k = `${pos[v * 3].toFixed(4)},${pos[v * 3 + 1].toFixed(4)},${pos[v * 3 + 2].toFixed(4)}`;
      if (!spot.has(k)) spot.set(k, spot.size);
      of[v] = spot.get(k);
    }
    const parent = Int32Array.from({ length: spot.size }, (_, i) => i);
    const find = (/** @type {number} */ a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let t = 0; t < ix.length; t += 3) {
      const a = find(of[ix[t]]);
      parent[find(of[ix[t + 1]])] = a;
      parent[find(of[ix[t + 2]])] = a;
    }
    // Each piece's paint, averaged at its triangles' middles.
    /** @type {Map<number, number[]>} */ const sum = new Map();
    for (let t = 0; t < ix.length; t += 3) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k++) { u += uvs[ix[t + k] * 2] / 3; v += uvs[ix[t + k] * 2 + 1] / 3; }
      const x = Math.min(W - 1, Math.max(0, Math.floor((u - Math.floor(u)) * W))), y = Math.min(H - 1, Math.max(0, Math.floor((v - Math.floor(v)) * H)));
      const o = (y * W + x) * 4, c = find(of[ix[t]]), s = sum.get(c) ?? [0, 0, 0, 0];
      s[0] += data[o]; s[1] += data[o + 1]; s[2] += data[o + 2]; s[3]++;
      sum.set(c, s);
    }
    /** The pieces whose average paint is the kept band's. @type {Set<number>} */ const wooden = new Set();
    for (const [c, s] of sum) {
      const [h, sat] = hueSat(s[0] / s[3], s[1] / s[3], s[2] / s[3]);
      if (h >= rule.hueDeg[0] && h <= rule.hueDeg[1] && sat >= rule.minSat && s[3] >= (rule.minTris ?? 0)) wooden.add(c);
    }
    // Leaves fused onto a kept piece: inside it, a triangle whose own paint (most of its corners and
    // middle) is outside the wider triangle band goes with the other pieces.
    /** Is a triangle's own paint leafy? @param {number} t */
    const leafy = (t) => {
      const T = rule.tri;
      if (!T) return false;
      let n = 0;
      const us = [0, 1, 2].map((k) => uvs[ix[t + k] * 2]), vs = [0, 1, 2].map((k) => uvs[ix[t + k] * 2 + 1]);
      us.push((us[0] + us[1] + us[2]) / 3); vs.push((vs[0] + vs[1] + vs[2]) / 3);
      for (let k = 0; k < 4; k++) {
        const x = Math.min(W - 1, Math.max(0, Math.floor((us[k] - Math.floor(us[k])) * W))), y = Math.min(H - 1, Math.max(0, Math.floor((vs[k] - Math.floor(vs[k])) * H)));
        const o = (y * W + x) * 4, [h, sat] = hueSat(data[o], data[o + 1], data[o + 2]);
        if (!(h >= T.hueDeg[0] && h <= T.hueDeg[1] && sat >= T.minSat)) n++;
      }
      return n >= 3;
    };
    // Bunches fused onto the frame and painted like it: between the end posts, a bar runs on to
    // either side of any point on it, a bunch (narrow, hanging) does not. A kept triangle there with
    // no frame reachShare of the width away on both sides, within tolShare of the height up, down,
    // fore or aft, hangs off a bar, and goes with the bunches.
    /** @type {(t: number) => boolean} */ let hangs = () => false;
    if (rule.hang) {
      const G = rule.hang, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v * 3 + k]); hi[k] = Math.max(hi[k], pos[v * 3 + k]); }
      const cx = (lo[0] + hi[0]) / 2, inner = ((hi[0] - lo[0]) / 2) * (1 - G.endsShare);
      const reach = (hi[0] - lo[0]) * G.reachShare, tol = (hi[1] - lo[1]) * G.tolShare;
      const mid = (/** @type {number} */ t, /** @type {number} */ k) => (pos[ix[t] * 3 + k] + pos[ix[t + 1] * 3 + k] + pos[ix[t + 2] * 3 + k]) / 3;
      const key = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => `${Math.floor(x / tol)},${Math.floor(y / tol)},${Math.floor(z / tol)}`;
      /** @type {Set<string>} */ const frame = new Set();
      for (let t = 0; t < ix.length; t += 3) if (wooden.has(find(of[ix[t]]))) frame.add(key(mid(t, 0), mid(t, 1), mid(t, 2)));
      /** Is there frame near (x, y, z), a cell either way? */
      const near = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (frame.has(key(x + a * tol, y + b * tol, z + c * tol))) return true;
        return false;
      };
      hangs = (t) => {
        const x = mid(t, 0), y = mid(t, 1), z = mid(t, 2);
        return Math.abs(x - cx) <= inner && !(near(x - reach, y, z) && near(x + reach, y, z));
      };
    }
    const wood = new Uint8Array(ix.length / 3);
    for (let t = 0; t < ix.length; t += 3) wood[t / 3] = wooden.has(find(of[ix[t]])) && !leafy(t) && !hangs(t) ? 1 : 0;
    /**
     * The joined groups among the triangles whose flag is `want`: each triangle's group and each
     * group's triangle count and height. @param {number} want
     */
    const groups = (want) => {
      const p2 = Int32Array.from({ length: spot.size }, (_, i) => i);
      const f2 = (/** @type {number} */ a) => { while (p2[a] !== a) { p2[a] = p2[p2[a]]; a = p2[a]; } return a; };
      for (let t = 0; t < ix.length; t += 3) if (wood[t / 3] === want) { const a = f2(of[ix[t]]); p2[f2(of[ix[t + 1]])] = a; p2[f2(of[ix[t + 2]])] = a; }
      /** @type {Map<number, { n: number, lo: number, hi: number }>} */ const g = new Map();
      for (let t = 0; t < ix.length; t += 3) if (wood[t / 3] === want) {
        const c = f2(of[ix[t]]), s = g.get(c) ?? { n: 0, lo: Infinity, hi: -Infinity };
        s.n++;
        for (let k = 0; k < 3; k++) { s.lo = Math.min(s.lo, pos[ix[t + k] * 3 + 1]); s.hi = Math.max(s.hi, pos[ix[t + k] * 3 + 1]); }
        g.set(c, s);
      }
      return { of: (/** @type {number} */ t) => /** @type {{ n: number, lo: number, hi: number }} */ (g.get(f2(of[ix[t]]))) };
    };
    // Scraps left floating once the bunches are gone (fewer than scrapTris joined triangles) go with them.
    if (rule.scrapTris) {
      const g = groups(1);
      for (let t = 0; t < ix.length; t += 3) if (wood[t / 3] && g.of(t).n < rule.scrapTris) wood[t / 3] = 0;
    }
    // Strips of the frame taken for bunches (the end legs' inner faces) are taller than any bunch:
    // a lifted group taller than tallShare of the model goes back to the frame.
    if (rule.tallShare) {
      let lo = Infinity, hi = -Infinity;
      for (let v = 0; v < nv; v++) { lo = Math.min(lo, pos[v * 3 + 1]); hi = Math.max(hi, pos[v * 3 + 1]); }
      const g = groups(0);
      for (let t = 0; t < ix.length; t += 3) if (!wood[t / 3]) { const s = g.of(t); if (s.hi - s.lo > (hi - lo) * rule.tallShare) wood[t / 3] = 2; }
      for (let t = 0; t < ix.length; t += 3) if (wood[t / 3] === 2) wood[t / 3] = 1;
    }
    /** @type {number[]} */ const keep = [];
    for (let t = 0; t < ix.length; t += 3) if (!!wood[t / 3] !== !!rule.keep) keep.push(ix[t], ix[t + 1], ix[t + 2]);
    before += ix.length / 3; after += keep.length / 3; pieces += sum.size; dropped += rule.keep ? wooden.size : sum.size - wooden.size;
    idx.setArray(keep.every((i) => i < 65536) ? Uint16Array.from(keep) : Uint32Array.from(keep));
    compactPrimitive(p);
  }
  return { before, after, pieces, dropped };
}
