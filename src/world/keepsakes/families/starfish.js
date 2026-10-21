// @ts-check
// Starfish (docs/future/12): a dried starfish found on the strandline. A low, flat star of five
// tapering arms, domed a little in the middle, its upper side rough with small knobs in a second
// colour. The rare mark is a starfish of four or six arms, which do turn up on real shores.

import { builder } from '../../finds/procedural.js';
import { closedBody, draws } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function starfishNumbers(h0, rarity, K) {
  const S = K.starfish, Tr = S.tiers[rarity], d = draws(h0);
  const odd = d.chance(S.marks.oddArms.chance * (Tr.markLean ?? 1), 20);
  const bi = d.pick(Tr.base, 9);
  return {
    family: 'starfish', gen: S.gen, rarity, form: d.u(2) < 0.5 ? 'slender' : 'stout',
    sizeM: d.range(Tr.sizeM, 3), arms: odd ? (d.u(21) < 0.5 ? 4 : 6) : 5, armShare: d.range(Tr.armShare, 4),
    curl: d.range([-0.25, 0.25], 5), knobs: d.range(Tr.knobs, 6), thick: d.range([0.14, 0.22], 7), twist: d.range([0, 6.283], 8),
    base: d.tone(S.colors.base[bi], S.colors.jitter, 10), baseName: S.colors.baseNames[bi], dots: S.colors.dots[d.pick(Tr.dots, 11)].slice(),
    mark: odd ? 'oddArms' : null,
  };
}

/** @param {any} n @param {any} K */
export function starfishWords(n, K) {
  let line = `a ${n.baseName} starfish, ${n.form}`;
  if (n.knobs > 0.08) line += ' and knobbly';
  if (n.mark) line += `, with ${n.arms === 4 ? 'four' : 'six'} arms`;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function starfishMesh(n, K) {
  const M = K.starfish.mesh, b = builder();
  const slender = n.form === 'slender' ? 1.6 : 1.0;
  closedBody(b, M.rows, M.cols, n.sizeM, (dir, th, ph) => {
    // How far out the outline reaches in this direction: arm tips where cos peaks, a small disc between.
    const a = 0.5 + 0.5 * Math.cos(n.arms * (ph + n.twist));
    const reach = n.armShare + (1 - n.armShare) * Math.pow(a, slender * 2.2);
    // Each arm curls a little to one side toward its tip.
    const p2 = ph + n.curl * a * reach;
    const knob = n.knobs * Math.max(0, Math.sin(th * 18) * Math.sin(ph * n.arms * 6)) ** 4;
    const r = reach * (1 + (dir[1] > 0 ? knob : 0));
    // Low and flat: thick over the middle, thin toward the tips, flat beneath.
    const up = dir[1] > 0 ? dir[1] * n.thick * (1.2 - 0.7 * reach) : dir[1] * n.thick * 0.25;
    const dot = dir[1] > 0 && knob > n.knobs * 0.3;
    return { p: [Math.sin(th) * Math.cos(p2) * r, up, Math.sin(th) * Math.sin(p2) * r], c: dot ? n.dots : n.base };
  });
  return b.done();
}
