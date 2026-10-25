// @ts-check
// Fossil keepsakes (docs/future/12): an ammonite set into a flat slab of stone. The ammonite is a
// shell keepsake's coil (Raup, flat, strongly ribbed) turned to stone; the slab is a stone keepsake
// pressed flat. Most are broken, showing part of the coil; the rare mark is a complete ammonite.
// The very rarest have turned to gold-coloured pyrite.

import { shellMesh } from './shell.js';
import { stoneMesh } from './stone.js';
import { draws, closedBody } from './common.js';
import { builder } from '../../finds/procedural.js';

/** @typedef {import('../rarity.js').Rarity} Rarity */

/** @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json */
export function fossilNumbers(h0, rarity, K) {
  const S = K.fossils, Tr = S.tiers[rarity], d = draws(h0);
  const complete = d.chance(S.marks.complete.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const ri = d.pick(Tr.rock, 9), fi = d.pick(Tr.fossil, 10);
  const rock = d.tone(S.colors.rock[ri], 0.06, 11);
  return {
    family: 'fossil', gen: S.gen, rarity, form: 'ammonite',
    sizeM: d.range(Tr.sizeM, 3), W: d.range([1.8, 2.4], 4), D: d.range([0.2, 0.42], 5), S: d.range([0.9, 1.25], 6),
    whorls: d.range([3.6, 5], 7), ribCount: d.int([12, 26], 8), ribAmp: d.range(Tr.ribAmp, 12),
    shown: complete ? 1 : d.range([0.45, 0.8], 13), lumpSeed: d.int([0, 1e6], 14), flat: d.range([0.22, 0.32], 15),
    rock, rockName: S.colors.rockNames[ri], fossil: S.colors.fossil[fi].slice(), fossilName: S.colors.fossilNames[fi],
    complete, mark: complete ? 'complete' : null,
  };
}

/**
 * A belemnite (docs/future/13 10.5, dug from the blue-grey clay): the guard of a squid-like animal, a
 * tapering bullet of glassy brown, honey or black stone; sometimes the hollow cone shows at its blunt
 * end (the mark); at the top tiers it has turned to pyrite. Tiers in keepsakes.json fossils.belemnite.
 * @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json
 */
export function belemniteNumbers(h0, rarity, K) {
  const B = K.fossils.belemnite, Tr = B.tiers[rarity], d = draws(h0);
  const cone = d.chance(B.marks.cone.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const ci = d.pick(Tr.color, 9);
  return {
    family: 'fossil', gen: K.fossils.gen, rarity, form: 'belemnite',
    sizeM: d.range(Tr.sizeM, 3), girth: d.range(B.girth, 4), taper: d.range(B.taper, 5), bend: d.range(B.bend, 6),
    color: d.tone(B.colors.base[ci], 0.06, 10), colorName: B.colors.names[ci], gloss: d.range(Tr.gloss, 11),
    cone, mark: cone ? 'cone' : null,
  };
}

/** @param {any} n @param {any} K */
export function fossilWords(n, K) {
  const S = K.fossils;
  if (n.form === 'belemnite') {
    const B = S.belemnite;
    let line = `a fossil like a stone bullet, ${n.colorName}`;
    if (n.mark === 'cone') line += ', ' + B.marks.cone.word;
    return line[0].toUpperCase() + line.slice(1) + '.';
  }
  let line = n.complete ? `an ammonite in ${n.rockName} stone` : `part of an ammonite in ${n.rockName} stone`;
  if (n.fossilName !== 'stone') line += `, turned to ${n.fossilName}`;
  if (n.mark === 'complete') line += ', ' + S.marks.complete.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function fossilMesh(n, K) {
  if (n.form === 'belemnite') return belemniteMesh(n, K);
  // The slab: a flat stone, a little wider than the coil.
  const slab = stoneMesh({
    family: 'stone', sizeM: n.sizeM, flat: n.flat, long: 0.85, lump: 0.05, lumpSeed: n.lumpSeed,
    veinCount: 0, veinWidth: 0, veinTilt: 0, veinPhase: 0, grain: 0.18, base: n.rock, vein: n.rock, mark: null,
  }, K);
  // The coil: a flat, ribbed shell; a broken one shows only its outer part of a turn's worth less.
  const coil = shellMesh({
    family: 'shell', gen: 1, rarity: n.rarity, form: 'coil', W: n.W, D: n.D, T: 0, S: n.S,
    whorls: n.whorls * n.shown, sizeM: n.sizeM * 0.7, ribCount: n.ribCount, ribAmp: n.ribAmp,
    cordCount: 0, cordAmp: 0, spinePerWhorl: 0, spineLen: 0, bandCount: 0, bandWidth: 0,
    pattern: 'spiral', patFreq: 0, bandPhase: 0, base: n.fossil, band: n.fossil, apex: null, apexMix: 1,
    canal: 0, left: 0, mark: null,
  }, K.shells.mesh);
  // Set the coil into the top of the slab, about half sunk.
  let top = 0, ch = 0;
  for (let i = 0; i < slab.count; i++) top = Math.max(top, slab.vertices[i * 9 + 1]);
  for (let i = 0; i < coil.count; i++) ch = Math.max(ch, coil.vertices[i * 9 + 1]);
  const lift = top * 0.92 - ch * 0.55;
  const vertices = new Float32Array(slab.vertices.length + coil.vertices.length);
  vertices.set(slab.vertices, 0);
  vertices.set(coil.vertices, slab.vertices.length);
  for (let i = slab.count; i < slab.count + coil.count; i++) vertices[i * 9 + 1] += lift;
  // A thin slab can let the coil reach below it: set the whole piece back on the ground.
  let lo = Infinity;
  for (let i = 0; i < slab.count + coil.count; i++) lo = Math.min(lo, vertices[i * 9 + 1]);
  for (let i = 0; i < slab.count + coil.count; i++) vertices[i * 9 + 1] -= lo;
  const indices = new Uint32Array(slab.indices.length + coil.indices.length);
  indices.set(slab.indices, 0);
  for (let i = 0; i < coil.indices.length; i++) indices[slab.indices.length + i] = coil.indices[i] + slab.count;
  return { vertices, count: slab.count + coil.count, indices };
}

/**
 * A belemnite's mesh: a closed body lying along its length (x), rounded at the blunt end and drawn
 * to a point, a little bent; glossy along its top, darker in the hollow cone at the blunt end when
 * it shows. @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh}
 */
function belemniteMesh(n, K) {
  const M = K.fossils.belemnite.mesh, b = builder();
  closedBody(b, M.rows, M.cols, n.sizeM, (dir) => {
    // u along the length: -1 the blunt end, 1 the point; (cs, sn) round the body.
    const u = dir[1], s = Math.max(Math.hypot(dir[0], dir[2]), 1e-6), cs = dir[0] / s, sn = dir[2] / s;
    const cap = u < -0.75 ? Math.sqrt(Math.max(0, 1 - ((u + 0.75) / 0.25) ** 2)) : 1;
    const r = n.girth * cap * (u > 0 ? Math.pow(1 - u, n.taper) : 1);
    const y = sn * r * 0.95 + n.bend * (1 - u * u) * 0.05;
    const dark = n.cone && u < -0.82 ? 0.5 : 1;
    const sheen = 1 + n.gloss * Math.max(0, sn) * (1 - Math.abs(u));
    return { p: [u * 0.5, y, cs * r], c: n.color.map((/** @type {number} */ v) => Math.min(1, v * dark * sheen)) };
  });
  return b.done();
}