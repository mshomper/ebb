// @ts-check
// Drift seeds (docs/future/12): sea beans, seeds of tropical vines and trees carried across oceans
// for years and cast up on far beaches. A glossy, flattened seed, round or kidney-shaped, often with
// a dark band running round its edge (the hamburger bean), sometimes grey and stone-hard (the nickar
// nut). The rare mark is a sea heart: the big, flat, heart-shaped bean, long carried as a charm.

import { builder } from '../../finds/procedural.js';
import { closedBody, draws } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function seedNumbers(h0, rarity, K) {
  const S = K.seeds, Tr = S.tiers[rarity], d = draws(h0);
  const heart = d.chance(S.marks.seaHeart.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const kind = heart ? S.kinds.find((/** @type {any} */ k) => k.id === 'heart') : S.kinds[d.pick(Tr.kinds, 2)];
  const bi = d.pick(kind.base, 9);
  return {
    family: 'seed', gen: S.gen, rarity, form: kind.id,
    sizeM: d.range(kind.sizeM, 3), flat: d.range(kind.flat, 4), kidney: d.range(kind.kidney, 5),
    band: kind.band ? d.range([0.08, 0.16], 6) : 0, mottle: d.range(Tr.mottle, 7), seedNo: d.int([0, 1e6], 8),
    base: d.tone(S.colors.base[bi], S.colors.jitter, 10), baseName: S.colors.baseNames[bi],
    bandColor: S.colors.band.slice(), mark: heart ? 'seaHeart' : null,
  };
}

/** @param {any} n @param {any} K */
export function seedWords(n, K) {
  const kind = K.seeds.kinds.find((/** @type {any} */ k) => k.id === n.form);
  let line = `a ${n.baseName} ${kind?.word ?? 'drift seed'}`;
  if (n.band) line += ', banded round its edge';
  if (n.mottle > 0.1) line += ', mottled';
  if (n.mark) line += ', ' + K.seeds.marks.seaHeart.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function seedMesh(n, K) {
  const M = K.seeds.mesh, b = builder();
  const heart = n.form === 'heart';
  closedBody(b, M.rows, M.cols, n.sizeM, (dir, th, ph) => {
    // The outline seen from above: round, a kidney (a dent on one side), or a heart (a notch and a point).
    let reach = 1 - n.kidney * Math.max(0, Math.cos(ph)) ** 4;
    if (heart) reach = 0.78 + 0.22 * Math.abs(Math.sin(ph)) + 0.25 * Math.max(0, -Math.cos(ph)) ** 3 - 0.3 * Math.max(0, Math.cos(ph)) ** 8;
    const x = dir[0] * reach, z = dir[2] * reach * (heart ? 1 : 0.85), y = dir[1] * n.flat;
    // A dark band round the edge, and a soft mottle.
    const edge = Math.abs(dir[1]) < n.band;
    const m = 1 + n.mottle * (Math.sin(ph * 7 + n.seedNo) * Math.sin(th * 9 + n.seedNo * 0.3));
    const c = edge ? n.bandColor : n.base.map((/** @type {number} */ v) => v * m);
    return { p: [x, y, z], c };
  });
  return b.done();
}
