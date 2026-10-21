// @ts-check
// Bottle keepsakes (docs/future/12): the only made thing the sea brings to the shore. A turned glass
// profile (base, body, shoulder, neck, lip) in a tint, frosted by sand to a degree, sometimes still
// stoppered. It lies on its side. The rare mark is a message inside, picked by seed from
// recipes/world/bottle-messages.json (placeholder lines until the writer's words come).

import { builder } from '../../finds/procedural.js';
import { draws, fitTo, gridMesh } from './common.js';

/** @typedef {import('../rarity.js').Rarity} Rarity */

/** @param {number} h0 @param {Rarity} rarity @param {any} K keepsakes.json */
export function bottleNumbers(h0, rarity, K) {
  const S = K.bottles, Tr = S.tiers[rarity], d = draws(h0);
  const gi = d.pick(Tr.glass, 9), shape = S.shapes[d.pick(Tr.shapes, 2)];
  const message = d.chance(S.marks.message.chance * (Tr.markLean ?? 1), 20) ? 1 : 0;
  return {
    family: 'bottle', gen: S.gen, rarity, form: shape.id,
    sizeM: d.range(Tr.sizeM, 3), body: d.range(shape.body, 4), shoulder: d.range(shape.shoulder, 5),
    neck: d.range(shape.neck, 6), neckLen: d.range(shape.neckLen, 7), lip: d.range([0.08, 0.2], 8),
    glass: S.colors.glass[gi].slice(), glassName: S.colors.glassNames[gi], frost: d.range(Tr.frost, 10),
    stopper: d.chance(Tr.stopperChance, 11) ? 1 : 0,
    message, messageIndex: d.int([0, 9999], 21), mark: message ? 'message' : null,
  };
}

/** @param {any} n @param {any} K */
export function bottleWords(n, K) {
  const S = K.bottles;
  const shape = S.shapes.find((/** @type {any} */ s) => s.id === n.form);
  let line = `a ${n.frost > 0.5 ? 'frosted ' : ''}${n.glassName} ${shape?.word ?? 'bottle'}`;
  if (n.stopper) line += ', still stoppered';
  if (n.mark === 'message') line += ', ' + S.marks.message.word;
  return line[0].toUpperCase() + line.slice(1) + '.';
}

/** The message in a bottle, if it has one. @param {any} n @param {any} messages bottle-messages.json */
export function bottleMessage(n, messages) {
  if (!n.message || !messages?.lines?.length) return null;
  return messages.lines[n.messageIndex % messages.lines.length];
}

/** @param {any} n @param {any} K @returns {import('../../finds/procedural.js').Mesh} */
export function bottleMesh(n, K) {
  const M = K.bottles.mesh, b = builder();
  // The profile from the base up: [radius, height] as shares of the height.
  const R = n.body, Rn = n.neck * R, H = 1, sh = n.shoulder, nl = n.neckLen;
  const prof = [
    [0, 0], [R * 0.92, 0], [R, 0.04], [R, sh], [R * 0.75, sh + (1 - nl - sh) * 0.45], [Rn * 1.15, 1 - nl],
    [Rn, 1 - nl + 0.03], [Rn, H - n.lip * 0.4], [Rn * 1.3, H - n.lip * 0.35], [Rn * 1.3, H], [Rn * 0.8, H],
  ];
  const frost = (/** @type {number[]} */ c) => c.map((x) => x + (0.86 - x) * n.frost);
  const glass = frost(n.glass);
  const cols = M.sides, rows = prof.length;
  // Lying on its side: the bottle's axis runs along x.
  const P = new Float32Array(rows * cols * 3), C = new Float32Array(P.length), cen = new Float32Array(rows * 3);
  for (let i = 0; i < rows; i++) {
    const [r, h] = prof[i];
    cen.set([h, r ? 0 : 0, 0], i * 3);
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * Math.PI * 2;
      const k = (i * cols + j) * 3;
      P.set([h, Math.sin(a) * r, Math.cos(a) * r], k);
      // The glass is darker where it is thick (base and lip) and lighter on the body.
      const thick = i < 2 || i > rows - 4 ? 0.8 : 1;
      C.set(glass.map((x) => x * thick), k);
    }
  }
  /** @type {{ P: Float32Array, C: Float32Array, cen: Float32Array, rows: number }[]} */
  const parts = [{ P, C, cen, rows }];
  if (n.stopper) {
    // A cork in the neck, standing a little proud.
    const cr = [[Rn * 0.95, H - 0.06], [Rn * 1.05, H + 0.07], [Rn * 0.95, H + 0.1], [0, H + 0.1]];
    const sP = new Float32Array(cr.length * cols * 3), sC = new Float32Array(sP.length), sc = new Float32Array(cr.length * 3);
    for (let i = 0; i < cr.length; i++) {
      sc.set([cr[i][1], 0, 0], i * 3);
      for (let j = 0; j < cols; j++) {
        const a = (j / cols) * Math.PI * 2, k = (i * cols + j) * 3;
        sP.set([cr[i][1], Math.sin(a) * cr[i][0], Math.cos(a) * cr[i][0]], k);
        sC.set(K.bottles.colors.cork, k);
      }
    }
    parts.push({ P: sP, C: sC, cen: sc, rows: cr.length });
  }
  const allP = new Float32Array(parts.reduce((s, q) => s + q.P.length, 0)), allC = new Float32Array(parts.reduce((s, q) => s + q.cen.length, 0));
  let o = 0, oc = 0;
  for (const q of parts) { allP.set(q.P, o); allC.set(q.cen, oc); o += q.P.length; oc += q.cen.length; }
  fitTo(allP, allC, n.sizeM);
  o = 0; oc = 0;
  for (const q of parts) {
    gridMesh(b, allP.subarray(o, o + q.P.length), q.C, q.rows, cols, allC.subarray(oc, oc + q.cen.length));
    o += q.P.length; oc += q.cen.length;
  }
  return b.done();
}
