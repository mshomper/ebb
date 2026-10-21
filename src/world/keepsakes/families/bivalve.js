// @ts-check
// Bivalve half-shells (docs/future/12): the beach's most familiar shells, one valve of a pair lying
// cupped side up. Scallops (a fan of ribs with two ears at the hinge), cockles (round, deeply ribbed),
// clams (smooth with growth rings) and razors (long and narrow). Coloured in rays from the hinge and
// rings of growth. The rare mark is a pair still joined: both valves, closed.

import { builder } from '../../finds/procedural.js';
import { closedBody, draws } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function bivalveNumbers(h0, rarity, K) {
  const S = K.bivalves, Tr = S.tiers[rarity], d = draws(h0);
  const pair = d.chance(S.marks.pair.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  const form = S.forms[d.pick(Tr.forms, 2)];
  const bi = d.pick(Tr.base, 9);
  const base = d.tone(S.colors.base[bi], S.colors.jitter, 10);
  return {
    family: 'bivalve', gen: S.gen, rarity, form: form.id,
    sizeM: d.range(form.sizeM, 3), cup: d.range(form.cup, 4), ribs: d.int(form.ribs, 5), ribAmp: d.range(form.ribAmp, 6),
    rings: d.int([5, 12], 7), rays: d.chance(Tr.raysChance, 8) ? d.int([3, 9], 11) : 0,
    base, baseName: S.colors.baseNames[bi], mark2: S.colors.mark[d.pick(Tr.mark, 12)].slice(),
    pair, mark: pair ? 'pair' : null,
  };
}

/** @param {any} n @param {any} K */
export function bivalveWords(n, K) {
  const form = K.bivalves.forms.find((/** @type {any} */ f) => f.id === n.form);
  let line = `a ${n.baseName} ${form?.word ?? 'half-shell'}`;
  if (n.rays) line += ', rayed';
  if (n.mark) line += ', ' + K.bivalves.marks.pair.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function bivalveMesh(n, K) {
  const M = K.bivalves.mesh, b = builder();
  closedBody(b, M.rows, M.cols, n.sizeM, (dir, th, ph) => {
    // The outline seen from above, by form; the hinge is at -z.
    const x = dir[0], z = dir[2], hyp = Math.hypot(x, z) || 1, ux = x / hyp, uz = z / hyp;
    const front = (uz + 1) / 2;
    let reach = 1, sx = 1, sz = 1;
    if (n.form === 'scallop') {
      reach = 0.3 + 0.7 * Math.pow(front, 0.6);
      // The ears: square lobes either side of the hinge.
      if (front < 0.3) reach = Math.max(reach, 0.58 - 0.4 * Math.abs(Math.abs(ux) - 0.75));
    } else if (n.form === 'cockle') { reach = 0.92 + 0.08 * front; sz = 0.95; }
    else if (n.form === 'clam') { sx = 1; sz = 0.78; reach = 0.9 + 0.1 * front; }
    else if (n.form === 'razor') { sx = 1; sz = 0.2; }
    // The angle round the hinge, for ribs and rays that fan out from it.
    const fan = Math.atan2(x * sx, (z * sz + 1.05) || 1e-6);
    const rib = n.ribAmp * Math.pow(Math.abs(Math.cos(fan * n.ribs)), 3);
    const rr = Math.hypot(x * sx * reach, (z * sz * reach + 1) / 2);
    const top = dir[1] > 0;
    const dome = n.cup * (1 + (top ? rib * 4 : 0));
    // A half-shell is a dome on a thin lip; a pair is two domes, closed.
    const y = top ? dir[1] * dome : dir[1] * (n.pair ? dome : n.cup * 0.15);
    // Colour: rays fanning from the hinge, and rings of growth.
    const ray = n.rays && Math.cos(fan * n.rays * 2) > 0.55;
    const ring = Math.cos(rr * n.rings * Math.PI * 2) > 0.8;
    const c = n.base.map((/** @type {number} */ v, /** @type {number} */ i) => (ray ? v + (n.mark2[i] - v) * 0.7 : v) * (ring ? 0.85 : 1) * (n.ribs ? 0.78 + 0.22 * Math.abs(Math.cos(fan * n.ribs)) : 1));
    return { p: [x * sx * reach, y, z * sz * reach], c };
  });
  return b.done();
}
