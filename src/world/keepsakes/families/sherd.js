// @ts-check
// Sherds (docs/future/13 10.6.3, D-21): bits of the old keeper's pots, dug near an old hearth once
// the walker has fired a pot of their own. Each is a curved piece cut from a turned pot profile
// (procedural.js latheArc): a round-bellied pot of some size, the piece taken from its belly or its
// rim, with broken, wandering edges and a wall a few millimetres thick. Buff, red-brown or
// smoke-blackened clay; a thumb-pressed rim or rows of cord marks, or plain. The rare mark is a
// fingerprint pressed into the clay before it was fired, as on real old pottery. Lies convex side up.

import { builder, latheArc } from '../../finds/procedural.js';
import { hash32 } from '../../../core/rng.js';
import { draws, u01 } from './common.js';

/** @param {number} h0 @param {import('../rarity.js').Rarity} rarity @param {any} K keepsakes.json */
export function sherdNumbers(h0, rarity, K) {
  const S = K.sherds, Tr = S.tiers[rarity], d = draws(h0);
  const ware = d.u(2) < Tr.smoke ? 'smoke' : d.pick(['buff', 'red'], 3);
  const deco = d.u(4) < S.rimShare ? 'rim' : d.u(5) < Tr.cord ? 'cord' : 'plain';
  const print = d.chance(S.marks.fingerprint.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  return {
    family: 'sherd', gen: S.gen, rarity, form: deco, ware, deco,
    sizeM: d.range(Tr.sizeM, 6), potR: d.range(S.potR, 7), thick: d.range(S.thickM, 8), aspect: d.range([0.6, 1], 9),
    belly: d.range([0.25, 0.7], 10), jag: d.range(S.jag, 11), phase: d.range([0, 6.283], 12), tone: d.range([0.9, 1.1], 13),
    smoke: ware === 'smoke' ? d.range([0.55, 0.9], 14) : d.range([0, 0.25], 14), print, mark: print ? 'fingerprint' : null,
  };
}

/** @param {any} n @param {any} K */
export function sherdWords(n, K) {
  const W = K.sherds.words;
  let line = `${W.ware[n.ware]} ${W.deco[n.deco]}`;
  if (n.mark) line += ', ' + K.sherds.marks.fingerprint.word;
  return line[0].toUpperCase() + line.slice(1) + (n.deco === 'rim' ? W.likeYours : '.');
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function sherdMesh(n, K) {
  const S = K.sherds, M = S.mesh, C = S.colors, b = builder();
  const base = C[n.ware].map((/** @type {number} */ v) => v * n.tone);
  const inside = C.inside.map((/** @type {number} */ v, /** @type {number} */ i) => (v + base[i]) / 2);
  // The pot: height 1.6 of its widest radius, round-bellied, narrowing to a short neck and out to its lip.
  const H = n.potR * 1.6;
  const rOf = (/** @type {number} */ v) => n.potR * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, v * 1.05)) + (v > 0.86 ? 0.9 * (v - 0.86) : 0));
  // How much of a turn and of the height the piece takes; a rim piece reaches the lip.
  const a = (n.sizeM / 2) / n.potR, span = (n.sizeM * n.aspect) / H;
  const rim = n.deco === 'rim';
  // A rim piece sits high enough that its outline crosses the lip, which cuts it straight.
  const vm = rim ? 1 - span * 0.32 : Math.min(0.85 - span / 2, Math.max(0.04 + span / 2, n.belly)), rm = rOf(vm), ym = vm * H;
  // The broken outline: an irregular polygon of straight breaks round the piece's middle, its corners
  // at seeded angles and reaches (a sherd breaks in straight-ish cracks, not in waves).
  const key = Math.round(n.phase * 1e4), corners = 5 + (hash32(key, 1) % 3);
  /** @type {number[][]} */ const poly = [];
  for (let i = 0; i < corners; i++) {
    const ang = ((i + 0.7 * (u01(hash32(key, 10 + i)) - 0.5)) / corners) * Math.PI * 2;
    const reach = 1 - n.jag * 3.2 * u01(hash32(key, 30 + i));
    poly.push([Math.cos(ang) * reach, Math.sin(ang) * reach]);
  }
  /** How far the outline reaches along a direction from the middle (the ray's crossing of its edge). @param {number} dx @param {number} dy */
  const reachAt = (dx, dy) => {
    for (let i = 0; i < corners; i++) {
      const p = poly[i], q = poly[(i + 1) % corners], ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const tr = (p[0] * ey - p[1] * ex) / den, u = (p[0] * dy - p[1] * dx) / den;
      if (tr > 0 && u >= -1e-9 && u <= 1 + 1e-9) return tr;
    }
    return 1;
  };
  latheArc(b, M.rows, M.cols, (s, t) => {
    // The square grid to a disc (an elliptical grid mapping), then out to the outline.
    const ga = 2 * s - 1, gb = 2 * t - 1;
    const ex = ga * Math.sqrt(1 - (gb * gb) / 2), ey = gb * Math.sqrt(1 - (ga * ga) / 2);
    const d = Math.hypot(ex, ey), k = d > 1e-9 ? reachAt(ex / d, ey / d) : 1;
    const th = ex * k * a;
    const v = Math.min(1, Math.max(0, vm + ey * k * span * 0.5));
    let r = rOf(v);
    let shade = 1;
    // Its decoration: thumb pressings along the lip, or rows of slanting cord marks on the belly.
    if (rim && v > 0.88) {
      const press = Math.pow(Math.max(0, Math.cos((th * n.potR) / S.thumbM * Math.PI * 2)), 2) * Math.min(1, (v - 0.88) / 0.06);
      r -= press * S.thumbDepthM; shade *= 1 - 0.18 * press;
    } else if (n.deco === 'cord' && v > 0.3 && v < 0.85) {
      const g = ((v * H) / S.cordRowM + (th * n.potR) / S.cordTwistM) % 1;
      const groove = (g + 1) % 1 < 0.35 ? 1 : 0;
      r -= groove * S.cordDepthM; shade *= 1 - 0.2 * groove;
    }
    const y = v * H;
    // The fingerprint: fine ridges in a small oval near the piece's middle, pressed in.
    if (n.print) {
      const du = th * rm, dw = y - ym - n.sizeM * 0.08, d = Math.hypot(du / 0.85, dw);
      if (d < S.printM) {
        const ridge = 0.5 + 0.5 * Math.cos((d / S.ridgeM) * Math.PI * 2 + du * 40);
        r -= ridge * 0.0003; shade *= 1 - 0.16 * ridge * (1 - d / S.printM);
      }
    }
    // Smoke from an old fire, in patches.
    const soot = Math.min(1, Math.max(0, n.smoke * (0.7 + 0.5 * Math.sin(th * 9 + n.phase) * Math.sin(v * 11 - n.phase))));
    const c = base.map((/** @type {number} */ x, /** @type {number} */ i) => (x * (1 - soot) + C.soot[i] * soot) * shade);
    // The profile's slope gives the wall's outward direction.
    const dv = 0.01, dr = rOf(Math.min(1, v + dv)) - rOf(Math.max(0, v - dv)), dy = H * 2 * dv;
    const l = Math.hypot(dr, dy) || 1, nr = dy / l, ny = -dr / l;
    const ct = Math.cos(th), st = Math.sin(th);
    // Into the piece's own frame: x along the turn, y out of the pot (convex up), z up the pot.
    return { p: [r * st, r * ct - rm, y - ym], out: [st * nr, ct * nr, ny], c, inner: inside, thick: n.thick };
  });
  return b.done();
}
