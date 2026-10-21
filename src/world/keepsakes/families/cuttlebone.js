// @ts-check
// Cuttlebones (docs/future/12): the light inner shell of a cuttlefish, washed up white. A long flat
// oval, domed on one side, rounded at the head and narrowing to a small point at the tail, its
// back marked with fine growth lines and a faint pinkish blush. Most are chipped at the tail; the
// rare mark is a whole one, its little spine still there.

import { builder } from '../../finds/procedural.js';
import { closedBody, draws } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function cuttleNumbers(h0, rarity, K) {
  const S = K.cuttlebones, Tr = S.tiers[rarity], d = draws(h0);
  const whole = d.chance(S.marks.whole.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  return {
    family: 'cuttlebone', gen: S.gen, rarity, form: d.u(2) < 0.5 ? 'broad' : 'narrow',
    sizeM: d.range(Tr.sizeM, 3), width: d.range([0.42, 0.56], 4), dome: d.range([0.08, 0.14], 5),
    lines: d.int([14, 26], 6), blush: d.range(Tr.blush, 7), chip: whole ? 0 : d.range([0.04, 0.12], 8),
    base: S.colors.base.slice(), blushColor: S.colors.blush.slice(), whole, mark: whole ? 'whole' : null,
  };
}

/** @param {any} n @param {any} K */
export function cuttleWords(n, K) {
  let line = `a ${n.form} cuttlebone${n.blush > 0.35 ? ', blushed pink' : ''}`;
  if (n.mark) line += ', ' + K.cuttlebones.marks.whole.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function cuttleMesh(n, K) {
  const M = K.cuttlebones.mesh, b = builder();
  const w = n.form === 'broad' ? n.width * 1.15 : n.width;
  closedBody(b, M.rows, M.cols, n.sizeM, (dir, th, ph) => {
    // Along x: the head at +x is round, the tail at -x narrows to a point (shortened if chipped).
    const x = dir[0], t = (x + 1) / 2;
    const narrow = Math.pow(Math.max(0, t), 0.45) * (1 - 0.1 * t);
    const tail = x < -0.85 ? (n.whole ? 1.12 : 1 - n.chip) : 1;
    const z = dir[2] * w * narrow, y = dir[1] > 0 ? dir[1] * n.dome * (0.4 + narrow) : dir[1] * n.dome * 0.3;
    // Growth lines across the back, arcs that follow the head's round; a blush toward the head.
    const arc = Math.cos(n.lines * (t + 0.6 * (dir[2] * dir[2]))) > 0.75 && dir[1] > 0;
    const c = n.base.map((/** @type {number} */ v, /** @type {number} */ i) => {
      const blushed = v + (n.blushColor[i] - v) * n.blush * Math.max(0, t - 0.3);
      return arc ? blushed * 0.78 : blushed;
    });
    return { p: [x * tail, y, z], c };
  });
  return b.done();
}
