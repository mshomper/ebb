// @ts-check
// Field sketches of autumn's two finds (doc 13; src/world/finds/autumn.js), in the journal pen.
// Fungi on logs: a length of old log seen from the side, turkey tail brackets stacked in tiers along
// its near flank and a tuft of sulphur tuft on its top, each traced from the game's own fungus
// meshes (autumn-meshes.js, via tools/gen-sketch-outlines.mjs), at one scale; a kind shows once its
// page has learned it (label keys show-<id>), both in pencil before. Dewy orb webs: drawn by hand
// from the same spokes and spiral the web shader spins, beads of dew along the spiral, grass stems
// it hangs between, and the garden spider at its hub.
//
// Same layout as living.js and finds.js: the drawing in x 40..236, a scale bar at x 30, labels from x 250.

import { WASH } from './living.js';
import { standTraced, drawTraced, tracedSize } from './traced.js';

/** Fungi on a log. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function fungi(p, scale) {
  const f = p.f, s = 1250;
  // The log: a long rounded body from the left edge, its broken end on the right with rings.
  const top = 104, bot = 196, mid = (top + bot) / 2;
  p.shape(`M40 ${top + 4}C90 ${top - 2} 150 ${top + 2} 214 ${top}C232 ${top + 6} 236 ${mid} 236 ${mid}C236 ${bot - 6} 226 ${bot} 212 ${bot}C150 ${bot + 2} 90 ${bot - 2} 40 ${bot - 2}Z`, WASH.grey, 0.35, 1.5);
  p.oval(220, mid, 14, (bot - top) / 2 - 3, WASH.spent, 0.45, 1.2);
  p.fine(`M220 ${mid}m-6 0a6 9 0 1 0 12 0a6 9 0 1 0 -12 0M220 ${mid}m-11 0a11 22 0 1 0 22 0`, 0.7, 0.5);
  // Grain along it, and a crack or two.
  p.fine(`M48 ${top + 16}C100 ${top + 12} 150 ${top + 18} 200 ${top + 14}M52 ${mid + 6}C110 ${mid + 2} 150 ${mid + 9} 204 ${mid + 4}M46 ${bot - 14}C96 ${bot - 18} 160 ${bot - 12} 200 ${bot - 16}`, 0.8, 0.45);
  p.fine(`M128 ${top + 24}l22 3M86 ${mid + 14}l18 -2`, 0.9, 0.6);
  const has = (/** @type {string} */ id) => p.pencil || p.knows(`show-${id}`);
  /** @type {{ w: number, h: number } | null} */ let bracket = null;
  if (has('turkeytail')) {
    // Tiers along the near flank: three low shelves and two above, each traced from the bracket mesh.
    const { widthM, aspect } = tracedSize('fungus-bracket');
    /** @type {[number, number, number][]} x middle, top y, size */
    const tiers = [[92, mid - 12, 0.8], [134, mid - 14, 0.75], [74, mid + 8, 0.95], [116, mid + 10, 1], [156, mid + 6, 0.85]];
    for (const [x, y, k] of tiers) {
      const w = widthM * s * k;
      drawTraced(p, 'fungus-bracket', x - w / 2, y - aspect * w * 0.5, w, { creases: 6, hatch: 4 });
      // The zones round the rim, drawn in by hand: the mesh's colours are too fine to trace.
      const h = aspect * w, cx = x, cy = y - h * 0.5 + h * 0.18;
      p.fine(`M${f(cx - w * 0.36)} ${f(cy + h * 0.3)}Q${f(cx)} ${f(cy + h * 0.62)} ${f(cx + w * 0.36)} ${f(cy + h * 0.3)}M${f(cx - w * 0.24)} ${f(cy + h * 0.24)}Q${f(cx)} ${f(cy + h * 0.46)} ${f(cx + w * 0.24)} ${f(cy + h * 0.24)}`, 0.7, 0.55);
      bracket = { w, h };
    }
  }
  /** @type {{ w: number, h: number } | null} */ let cap = null;
  if (has('sulphurtuft')) {
    // A tuft on the log's top, the outer caps leaning out.
    cap = standTraced(p, 'fungus-cap', 186, top + 4, s * 0.95, { creases: 6 });
    standTraced(p, 'fungus-cap-lean', 206, top + 5, s * 0.75, { creases: 4 });
    standTraced(p, 'fungus-cap-lean', 168, top + 5, s * 0.8, { mirror: true, creases: 4 });
    standTraced(p, 'fungus-cap', 194, top + 7, s * 0.5, { creases: 3 });
  }
  if (cap) p.label('caps', 250, 36, 190, top + 4 - cap.h * 0.85);
  if (bracket) p.label('bands', 250, 92, 136, mid - 16);
  if (bracket) p.label('pores', 250, 150, 120, mid + 16);
  p.label('wood', 250, 206, 176, bot - 12);
  p.scale(30, mid - 31, mid + 31, scale);
  return p.svg(380, 240,'Field sketch of fungi on an old log: turkey tail brackets in tiers along its side and a tuft of sulphur tuft on top');
}

/** A dewy orb web in the tall grass. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function webs(p, scale) {
  const f = p.f;
  const cx = 138, cy = 112, R = 74, K = 16, rounds = 9;
  p.tint('M40 30H236V236H40Z', WASH.water, 0.18);
  // Grass stems on either side, the web hung between them.
  p.line('M48 236C50 190 56 120 66 40M60 236C64 196 74 150 92 96', 1.3);
  p.line('M226 236C224 186 220 120 210 46M214 236C210 200 202 160 188 110', 1.3);
  p.fine('M40 236C80 228 120 232 160 228C190 226 214 232 236 228', 0.9, 0.5);
  // The same irregular spokes the shader spins: a little off even, longer below.
  const spokes = Array.from({ length: K }, (_, k) => {
    const a = ((k + 0.35 * (Math.sin(k * 12.9898) * 0.5)) / K) * Math.PI * 2;
    return { a, len: (0.86 + 0.12 * Math.sin(k * 3.7)) * (1 + 0.1 * Math.sin(a)) };
  });
  const at = (/** @type {number} */ k, /** @type {number} */ r) => { const s = spokes[((k % K) + K) % K]; return [cx + Math.cos(s.a) * s.len * r * R, cy + Math.sin(s.a) * s.len * r * R]; };
  let d = '';
  for (let k = 0; k < K; k++) { const [x0, y0] = at(k, 0.06), [x1, y1] = at(k, 1); d += `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`; }
  p.line(d, 0.9);
  // The frame round the rim, and two anchors out to the stems.
  let frame = '';
  for (let k = 0; k <= K; k++) { const [x, y] = at(k, 1); frame += `${k ? 'L' : 'M'}${f(x)} ${f(y)}`; }
  p.line(frame, 1);
  p.fine(`M${f(at(8, 1)[0])} ${f(at(8, 1)[1])}L70 ${f(cy - 4)}M${f(at(0, 1)[0])} ${f(at(0, 1)[1])}L206 ${f(cy + 6)}`, 0.8, 0.7);
  // The capture spiral, round by round, and its beads of dew.
  let spiral = '';
  /** @type {number[][]} */ const beads = [];
  for (let i = 0; i < rounds; i++) for (let k = 0; k < K; k++) {
    const r0 = 0.18 + 0.78 * (i + k / K) / rounds, r1 = 0.18 + 0.78 * (i + (k + 1) / K) / rounds;
    const [x0, y0] = at(k, r0), [x1, y1] = at(k + 1, r1);
    spiral += `${i || k ? 'L' : 'M'}${f(x0)} ${f(y0)}`;
    if ((i * 7 + k * 3) % 4 === 0) beads.push([(x0 * 2 + x1) / 3, (y0 * 2 + y1) / 3, 1.2 + ((i + k) % 3) * 0.5]);
    if (i === rounds - 1 && k === K - 1) spiral += `L${f(x1)} ${f(y1)}`;
  }
  p.fine(spiral, 0.8, 0.75);
  for (const [x, y, r] of beads) p.dot(x, y, r, WASH.water);
  // The garden spider at the hub: a round abdomen and legs held out.
  p.oval(cx, cy + 4, 5, 6.5, WASH.brown, 0.7, 1.2);
  p.oval(cx, cy - 4, 3, 3, WASH.brown, 0.7, 1.1);
  p.fine(`M${cx - 3} ${cy - 4}l-8 -6M${cx + 3} ${cy - 4}l8 -6M${cx - 3} ${cy - 2}l-9 2M${cx + 3} ${cy - 2}l9 2M${cx - 3} ${cy}l-7 8M${cx + 3} ${cy}l7 8`, 0.9, 0.8);
  p.label('spokes', 250, 42, at(13, 0.7)[0], at(13, 0.7)[1]);
  p.label('spiral', 250, 98, at(1, 0.8)[0], at(1, 0.8)[1]);
  p.label('dew', 250, 160, at(3, 0.62)[0], at(3, 0.62)[1]);
  p.label('spider', 250, 222, cx + 4, cy + 8);
  p.scale(30, cy - R, cy + R, scale);
  return p.svg(380, 250, 'Field sketch of an orb web strung with dew between grass stems, the spider at its hub');
}
