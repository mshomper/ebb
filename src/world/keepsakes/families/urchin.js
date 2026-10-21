// @ts-check
// Sea urchin tests (docs/future/12): the shell a sea urchin leaves, spines worn away. A dome,
// flatter beneath, with five double rows of pores running from the top down its sides (the
// ambulacra) between broad plates studded with knobs where the spines were. Coloured lilac, rose,
// green or cream, the pore rows paler. The rare mark is six-rayed: a rare twist of growth that gives
// six rows instead of five.

import { builder } from '../../finds/procedural.js';
import { closedBody, draws } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function urchinNumbers(h0, rarity, K) {
  const S = K.urchins, Tr = S.tiers[rarity], d = draws(h0);
  const six = d.chance(S.marks.sixRayed.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const bi = d.pick(Tr.base, 9);
  return {
    family: 'urchin', gen: S.gen, rarity, form: d.u(2) < Tr.flatShare ? 'flat' : 'round',
    sizeM: d.range(Tr.sizeM, 3), height: d.range(Tr.height, 4), knobs: d.range(Tr.knobs, 5), knobRows: d.int([6, 11], 6),
    rays: six ? 6 : 5, poreWidth: d.range([0.14, 0.22], 7), wobble: d.range([0, 0.06], 8),
    base: d.tone(S.colors.base[bi], S.colors.jitter, 10), baseName: S.colors.baseNames[bi], pore: S.colors.pore[d.pick(Tr.pore, 11)].slice(),
    mark: six ? 'sixRayed' : null,
  };
}

/** @param {any} n @param {any} K */
export function urchinWords(n, K) {
  let line = `a ${n.baseName} sea urchin's shell${n.form === 'flat' ? ', low and wide' : ''}`;
  if (n.knobs > 0.07) line += ', knobbly';
  if (n.mark) line += ', ' + K.urchins.marks.sixRayed.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function urchinMesh(n, K) {
  const M = K.urchins.mesh, b = builder();
  closedBody(b, M.rows, M.cols, n.sizeM, (dir, th, ph) => {
    // How far this point is from the nearest pore row, as a share of the gap between rows.
    const q = ((ph * n.rays) / (Math.PI * 2)) % 1, gap = Math.min(q, 1 - q);
    const onPores = gap < n.poreWidth;
    // Knobs: small bumps on the broad plates, in rows from the top down.
    const knob = !onPores ? Math.max(0, Math.cos(th * n.knobRows * 2) * Math.cos(ph * n.rays * 4)) ** 6 * n.knobs : 0;
    const groove = onPores ? -0.025 : 0;
    const r = 1 + knob + groove + n.wobble * Math.sin(ph * 3 + th * 2);
    // Flatter beneath: the lower half pressed up.
    const y = dir[1] > 0 ? dir[1] * n.height : dir[1] * n.height * 0.35;
    const pores = onPores && Math.cos(th * n.knobRows * 4) > 0.2;
    const c = onPores ? n.base.map((/** @type {number} */ x, /** @type {number} */ i) => x + (n.pore[i] - x) * (pores ? 0.9 : 0.45)) : n.base;
    return { p: [dir[0] * r, y * r, dir[2] * r], c };
  });
  return b.done();
}
