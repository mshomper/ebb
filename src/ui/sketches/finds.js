// @ts-check
// Field sketches of the finds (docs/future/11), the small lives of the shore. Each is drawn in the
// journal pen around its model's own traced shape (traced.js, outlines.js), at real scale, so a
// page shows the find as it is: the anemone open under water and shut out of it, the periwinkle on
// the weed, the hermit crab in its borrowed shell, the young edible crab from above, the shells
// found so far. The lugworm has no model (its cast is drawn into the sand), so its coil is drawn
// here from the same wandering spiral the sand shader uses. Barnacles and pond skaters are built
// from numbers in the game (world/finds/procedural.js), with nothing to trace, so they are drawn by hand;
// so is the moon jelly stranded on the summer strandline.
//
// Same layout as living.js: the drawing in x 40..236, a scale bar at x 30, labels from x 250.

import { wave, blade } from './pen.js';
import { WASH } from './living.js';
import { standTraced, drawTraced, tracedSize } from './traced.js';

/** The rock of a pool's floor or the shore, from x0 to x1 with its top at y. @param {import('./pen.js').Pen} p @param {number} y */
function rockLine(p, y, x0 = 40, x1 = 236) {
  p.shape(`M${x0} ${y}C${x0 + 30} ${y - 6} ${x0 + 70} ${y - 2} ${(x0 + x1) / 2} ${y}C${x1 - 60} ${y - 6} ${x1 - 30} ${y - 4} ${x1} ${y}V${y + 22}H${x0}Z`, WASH.grey, 0.4, 1.5);
  p.fine(`M${x0 + 20} ${y + 9}l14 -2M${x0 + 96} ${y + 13}l18 -1M${x1 - 50} ${y + 8}l12 2`, 0.8, 0.5);
}

/** Beadlet anemone: open under the pool's water on the left, shut on bare rock at low tide on the right. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function anemone(p, scale) {
  const ground = 214, s = 3800;
  // The pool's water over the left one; the right one stands where the tide has gone.
  p.tint(`M40 96H146V${ground}H40Z`, WASH.water, 0.32);
  p.line(wave(40, 146, 96, 1.4, 14), 1.3);
  p.fine('M146 96V212', 0.8, 0.35);
  rockLine(p, ground);
  const open = standTraced(p, 'anemone-open', 92, ground + 2, s, { sink: 0.17, creases: 30 });
  const shut = standTraced(p, 'anemone-shut', 192, ground + 2, s, { sink: 0.17, creases: 12 });
  // The beadlet's blue beads, round the rim of the shut one.
  const top = ground + 2 - shut.h * 0.83 + shut.h * 0.22;
  for (const [dx, dy] of [[-12, 10], [-4, 5], [6, 5], [13, 10]]) p.dot(192 + dx * (shut.w / 38), top + dy, 2.4, WASH.blue);
  p.label('tentacles', 250, 70, 104, ground - open.h * 0.7);
  p.label('beads', 250, 140, 200, top + 6);
  p.label('shut', 250, 192, 206, ground - shut.h * 0.35);
  p.scale(30, ground - open.h * 0.83, ground, scale);
  return p.svg(380, 250, 'Field sketch of beadlet anemones, open under water and shut at low tide');
}

/** Periwinkles: two grazing the wrack on a rock, the near one big enough to show its whorls. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function periwinkle(p, scale) {
  const ground = 210;
  p.shape('M40 214C60 190 120 182 170 186C206 190 228 202 236 214V236H40Z', WASH.grey, 0.4, 1.5);
  for (const [x0, y0, x1, y1, b] of [[52, 206, 124, 212, 4], [100, 196, 178, 202, -5], [150, 194, 230, 210, 6]]) p.shape(blade(x0, y0, x1, y1, 3.6, b), WASH.brown, 0.55, 1.1);
  const far = standTraced(p, 'periwinkle', 190, ground - 8, 5200, { mirror: true, creases: 14 });
  const near = standTraced(p, 'periwinkle', 104, ground + 2, 8600, { creases: 22 });
  p.label('shell', 250, 70, 98, ground - near.h * 0.75);
  p.label('door', 250, 132, 126, ground - near.h * 0.25);
  p.label('weed', 250, 196, 222, 206);
  p.scale(30, ground - near.h, ground, scale);
  void far;
  return p.svg(380, 240, 'Field sketch of periwinkles grazing the weed on a rock');
}

/**
 * Lugworm casts: the sand cut away to show the U of the burrow, the coil of spent sand heaped at one
 * end (lumps of squeezed sand along a wandering spiral, as the sand shader draws it), the dip at the other.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function lugworm(p, scale) {
  const top = 132;
  p.tint(`M40 ${top}H236V232H40Z`, WASH.sand, 0.4);
  p.line(`M40 ${top}H92C98 ${top} 102 ${top + 7} 110 ${top + 7}S122 ${top} 128 ${top}H236`, 1.6);
  for (const [x, y] of [[58, 160], [86, 204], [150, 218], [214, 170], [228, 214], [70, 182]]) p.dot(x, y, 1.1);
  // The U-shaped burrow under the sand, the worm lying in it.
  p.line(`M110 ${top + 7}C110 186 128 214 150 214S184 186 184 ${top}`, 4.5);
  p.shape(blade(124, 192, 166, 202, 4, 4), WASH.pink, 0.75, 1.1);
  // The cast: a tube of squeezed sand along a spiral that wanders, tightens and climbs, seen a
  // little from above. Drawn piece by piece from the bottom turn up, each piece an ink edge with a
  // sand middle, so every turn lies over the one below.
  const cx = 184, cy = top - 3, R = 30, turns = 3, n = 60;
  /** @type {[number, number, number][]} */ const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * Math.PI * 2 + 0.6;
    const wander = 1 + 0.16 * Math.sin(a * 1.7 + 1.3) + 0.08 * Math.sin(a * 3.1);
    const r = R * (1 - 0.74 * t) * wander;
    pts.push([cx + Math.cos(a) * r, cy - t * 18 + Math.sin(a) * r * 0.34, 9.5 - 3.5 * t + 0.9 * Math.sin(a * 2.6)]);
  }
  const fill = p.wash ? '#E2CFA6' : '#F4EEE4';
  for (let i = 1; i <= n; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1, w] = pts[i];
    const d = `M${p.f(x0)} ${p.f(y0)}L${p.f(x1)} ${p.f(y1)}`;
    p.line(d, w + 2.4);
    p.raw(`<path d="${d}" stroke="${fill}" stroke-width="${p.f(w)}" stroke-linecap="round" fill="none"/>`);
  }
  // Squeeze marks across the tube, here and there.
  p.fine(pts.filter((_, i) => i % 6 === 3).map(([x, y, w]) => `M${p.f(x - w * 0.3)} ${p.f(y - w * 0.25)}l${p.f(w * 0.5)} ${p.f(w * 0.45)}`).join(''), 0.7, 0.45);
  p.label('cast', 250, 72, 206, top - 20);
  p.label('burrow', 250, 178, 182, 176);
  p.label('dip', 250, 128, 112, top + 8);
  p.scale(30, top - 2 * R * 0.4 - 22, top, scale);
  return p.svg(380, 245, 'Field sketch of a lugworm burrow and its cast');
}

/** Hermit crab: in a borrowed shell on a pool floor, legs and claws out of the shell's mouth. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function hermitcrab(p, scale) {
  const ground = 210;
  p.tint(`M40 92H236V${ground}H40Z`, WASH.water, 0.28);
  p.line(wave(40, 236, 92, 1.4, 28), 1.3);
  rockLine(p, ground);
  const c = standTraced(p, 'hermitcrab', 138, ground + 2, 6400, { creases: 36 });
  const x0 = 138 - c.w / 2, y0 = ground + 2 - c.h;
  p.label('shell', 250, 70, x0 + c.w * 0.35, y0 + c.h * 0.2);
  p.label('claw', 250, 136, x0 + c.w * 0.82, y0 + c.h * 0.55);
  p.label('legs', 250, 196, x0 + c.w * 0.7, y0 + c.h * 0.92);
  p.scale(30, y0, ground, scale);
  return p.svg(380, 245, 'Field sketch of a hermit crab in a borrowed shell');
}

/** Young edible crab: from above on a weedy rock, its crimped shell edge and black-tipped claws. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function ediblecrab(p, scale) {
  // Seen from above, like the crab: a rock under it, strands of wrack across the rock.
  p.shape('M48 98C92 72 200 74 230 102C248 142 240 206 204 224C152 238 82 234 56 206C38 174 38 128 48 98Z', WASH.grey, 0.35, 1.4);
  for (const [x0, y0, x1, y1, b] of [[60, 204, 140, 218, 5], [150, 208, 226, 188, -4], [54, 120, 98, 94, 3]]) p.shape(blade(x0, y0, x1, y1, 3.4, b), WASH.brown, 0.5, 1.1);
  const { widthM, aspect } = tracedSize('ediblecrab');
  const w = widthM * 5000, h = aspect * w, x0 = 138 - w / 2, y0 = 154 - h / 2;
  drawTraced(p, 'ediblecrab', x0, y0, w, { creases: 40 });
  p.label('claws', 250, 80, x0 + w * 0.82, y0 + h * 0.18);
  p.label('shell', 250, 150, x0 + w * 0.6, y0 + h * 0.45);
  p.label('legs', 250, 200, x0 + w * 0.94, y0 + h * 0.7);
  p.scale(30, y0, y0 + h, scale);
  return p.svg(380, 250, 'Field sketch of a young edible crab from above');
}

/**
 * Shells: the ones found so far, laid out on the sand as they wash up on the strandline. A shell
 * shows once its page has learned it (the label keys show-<id>, whose text is empty); before any is
 * found, two faint common ones stand in, in pencil.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function shells(p, scale) {
  const ground = 214, s = 1300;
  p.tint(`M40 150H236V236H40Z`, WASH.sand, 0.35);
  p.line(`M40 ${ground}C90 ${ground - 4} 160 ${ground + 3} 236 ${ground - 2}`, 1.4);
  // A few strands of dried litter: this is the strandline.
  p.fine('M52 206l26 -3M96 210l18 2M160 207l30 -4M200 211l20 1', 0.9, 0.55);
  const has = (/** @type {string} */ id) => p.pencil ? id === 'turret' || id === 'cockle' : p.knows(`show-${id}`);
  // Back row the big ones, front row the small; each at real scale.
  /** @type {[string, number, number][]} id, middle x, base y */
  const place = [['nautilus', 98, ground - 22], ['murex', 186, ground - 18], ['cockle', 70, ground + 6], ['turret', 140, ground + 4], ['periwinkle', 204, ground + 6]];
  /** @type {Record<string, { w: number, h: number }>} */ const at = {};
  for (const [id, x, y] of place) {
    if (!has(id)) continue;
    at[id] = standTraced(p, `shell-${id}`, x, y, s, { creases: id === 'murex' ? 30 : 18 });
  }
  if (at.turret) p.label('spiral', 250, 196, 150, ground);
  if (at.cockle) p.label('ribs', 250, 150, 74, ground - at.cockle.h * 0.5);
  if (at.murex) p.label('spines', 250, 70, 196, ground - 18 - at.murex.h * 0.7);
  p.scale(30, ground - (at.nautilus?.h ?? at.murex?.h ?? 40) - 20, ground - 20, scale);
  return p.svg(380, 245, 'Field sketch of the shells found so far');
}

/**
 * Acorn barnacles (no model; drawn by hand): one open under the water on the left, its feathery legs
 * fanned out of the opening; on the right, two shut on bare rock at low tide, their openings closed by plates.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function barnacles(p, scale) {
  const ground = 214, f = p.f;
  p.tint(`M40 96H146V${ground}H40Z`, WASH.water, 0.32);
  p.line(wave(40, 146, 96, 1.4, 14), 1.3);
  p.fine('M146 96V212', 0.8, 0.35);
  rockLine(p, ground);
  /** A cone of plates: its outline, the seams between plates, and where the rim is. @param {number} cx @param {number} w @param {number} h */
  const cone = (cx, w, h) => {
    const r = w / 2, t = w * 0.18, top = ground + 1 - h;
    p.shape(`M${f(cx - r)} ${ground + 1}C${f(cx - r * 0.9)} ${f(ground - h * 0.5)} ${f(cx - t * 1.4)} ${f(top + h * 0.1)} ${f(cx - t)} ${f(top)}` +
      `H${f(cx + t)}C${f(cx + t * 1.4)} ${f(top + h * 0.1)} ${f(cx + r * 0.9)} ${f(ground - h * 0.5)} ${f(cx + r)} ${ground + 1}Z`, WASH.grey, 0.3, 1.5);
    p.fine(`M${f(cx - t * 0.5)} ${f(top + 2)}L${f(cx - r * 0.45)} ${ground}M${f(cx + t * 0.5)} ${f(top + 2)}L${f(cx + r * 0.45)} ${ground}M${f(cx - t * 1.2)} ${f(top + 4)}L${f(cx - r * 0.85)} ${ground - 2}M${f(cx + t * 1.2)} ${f(top + 4)}L${f(cx + r * 0.85)} ${ground - 2}`, 0.8, 0.5);
    return { top, t };
  };
  // Open: the dark opening and the cirri curling up out of it, each with a few fine side hairs.
  const o = cone(92, 74, 46);
  p.oval(92, o.top, o.t * 0.9, 2.6, WASH.tip, 0.8, 1.1);
  for (let i = 0; i < 6; i++) {
    const dx = (i - 2.5) * 11, tipY = o.top - 46 + Math.abs(i - 2.5) * 6;
    const hook = dx < 0 ? 7 : -7;
    p.line(`M92 ${f(o.top - 1)}Q${f(92 + dx * 0.25)} ${f(o.top - 30)} ${f(92 + dx)} ${f(tipY)}Q${f(92 + dx + hook * 0.3)} ${f(tipY - 7)} ${f(92 + dx + hook)} ${f(tipY + 2)}`, 1.2);
    p.fine(`M${f(92 + dx * 0.55)} ${f(o.top - 20)}l${f(-hook * 0.6)} -3M${f(92 + dx * 0.8)} ${f(tipY + 12)}l${f(-hook * 0.6)} -3`, 0.7, 0.5);
  }
  // Shut: the plates drawn together over the opening in a low peak, a seam down its middle.
  const s = cone(184, 60, 36);
  p.shape(`M${f(184 - s.t)} ${f(s.top)}L184 ${f(s.top - 6)}L${f(184 + s.t)} ${f(s.top)}Z`, WASH.grey, 0.5, 1.2);
  p.fine(`M184 ${f(s.top - 6)}V${f(s.top)}`, 0.8, 0.6);
  const s2 = cone(224, 22, 14);
  p.fine(`M${f(224 - s2.t)} ${f(s2.top)}L224 ${f(s2.top - 3)}L${f(224 + s2.t)} ${f(s2.top)}`, 0.9, 0.7);
  p.label('cirri', 250, 70, 92 + 11 * 1.5, o.top - 38);
  p.label('plates', 250, 140, 168, ground - 12);
  p.label('shut', 250, 196, 190, s.top - 3);
  p.scale(30, o.top, ground, scale);
  return p.svg(380, 250, 'Field sketch of acorn barnacles, one open under water and two shut at low tide');
}

/**
 * Pond skaters (no model; drawn by hand): one from above on still water, short front legs held up,
 * the long middle and hind legs splayed out, and a dimple ring where each long foot presses the surface.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function pondskaters(p, scale) {
  p.tint('M40 80H236V236H40Z', WASH.water, 0.3);
  p.fine('M48 92q20 -4 40 0M170 230q24 -4 48 0M52 178q14 -3 28 0', 0.8, 0.45);
  // The feet's dimples first, so the legs lie over them: a pale ring with a glint on its far side.
  /** @type {[number, number][]} */ const feet = [[60, 104], [216, 104], [72, 220], [204, 220]];
  for (const [x, y] of feet) {
    p.oval(x, y, 11, 5.5, WASH.water, 0.15, 1.1);
    p.fine(`M${x - 6} ${y - 2.5}q6 -2.4 12 0`, 0.9, 0.7);
  }
  // Legs, mirrored: middle legs out and forward, hind legs out and back, front legs short and raised.
  for (const side of [-1, 1]) {
    const x = (/** @type {number} */ d) => 138 + side * d;
    p.line(`M${x(5)} 140L${x(42)} 120L${x(78)} 104`, 1.6);
    p.line(`M${x(5)} 160L${x(38)} 190L${x(66)} 220`, 1.6);
    p.line(`M${x(4)} 124L${x(13)} 110L${x(16)} 100`, 1.4);
  }
  // Body: head, then a long slim body tapering behind.
  p.oval(138, 116, 5, 6.5, WASH.brown, 0.6, 1.4);
  p.shape('M138 122C143 122 145 130 145 142V168C145 184 141 194 138 196C135 194 131 184 131 168V142C131 130 133 122 138 122Z', WASH.brown, 0.6, 1.4);
  p.fine('M138 126V192M134 146h8', 0.7, 0.4);
  p.label('front', 250, 70, 152, 104);
  p.label('legs', 250, 140, 180, 120);
  p.label('dimples', 250, 200, 214, 218);
  p.scale(30, 104, 220, scale);
  return p.svg(380, 245, 'Field sketch of a pond skater from above, standing on the water');
}


/** Common mussels: a pair on a low rock with weed, the near one gaping a little as under water. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function mussels(p, scale) {
  const ground = 212;
  p.tint(`M40 92H236V${ground}H40Z`, WASH.water, 0.26);
  p.line(wave(40, 236, 92, 1.4, 28), 1.3);
  rockLine(p, ground);
  for (const [x0, y0, x1, y1, b] of [[46, 210, 110, 204, 4], [176, 206, 232, 212, -4]]) p.shape(blade(x0, y0, x1, y1, 3.2, b), WASH.brown, 0.5, 1.1);
  const far = standTraced(p, 'mussel', 202, ground - 2, 1300, { mirror: true, creases: 8 });
  const near = standTraced(p, 'mussel', 108, ground + 2, 2400, { creases: 14 });
  const x0 = 108 - near.w / 2, y0 = ground + 2 - near.h;
  p.label('hinge', 250, 70, x0 + near.w * 0.06, y0 + near.h * 0.55);
  p.label('valves', 250, 140, x0 + near.w * 0.55, y0 + near.h * 0.2);
  p.label('gape', 250, 196, x0 + near.w * 0.9, y0 + near.h * 0.5);
  p.scale(30, y0, ground, scale);
  void far;
  return p.svg(380, 245, 'Field sketch of common mussels on a low rock, one gaping a little');
}

/** Sand dollar: from above, half sunk in rippled sand, the five petals of its back drawn in. @param {import('./pen.js').Pen} p @param {string} [scale] */
export function sanddollars(p, scale) {
  p.tint('M40 96H236V232H40Z', WASH.sand, 0.4);
  for (let i = 0; i < 6; i++) p.fine(wave(40, 236, 104 + i * 22, 2.2, 22), 0.9, 0.45);
  const { widthM, aspect } = tracedSize('sanddollar');
  const w = widthM * 1900, h = aspect * w, x0 = 138 - w / 2, y0 = 164 - h / 2;
  drawTraced(p, 'sanddollar', x0, y0, w, { creases: 0 });
  // The five petals of its back, drawn in by hand: the scan is too fine to trace them.
  const cx = x0 + w / 2, cy = y0 + h / 2, r = Math.min(w, h) / 2;
  let petals = '';
  for (let k = 0; k < 5; k++) {
    const a = ((-90 + 72 * k) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const at = (/** @type {number} */ d, /** @type {number} */ off) => `${(cx + c * d * r - s * off * r).toFixed(1)} ${(cy + s * d * r + c * off * r).toFixed(1)}`;
    petals += `M${at(0.12, 0)}Q${at(0.4, 0.17)} ${at(0.66, 0)}Q${at(0.4, -0.17)} ${at(0.12, 0)}Z`;
  }
  p.line(petals, 1.2);
  p.label('petals', 250, 76, x0 + w * 0.5, y0 + h * 0.3);
  p.label('spines', 250, 140, x0 + w * 0.92, y0 + h * 0.5);
  p.label('sand', 250, 204, x0 + w * 0.8, y0 + h * 0.9);
  p.scale(30, y0, y0 + h, scale);
  return p.svg(380, 250, 'Field sketch of a sand dollar from above, half buried in the sand');
}

/** The pale violet of a moon jelly's four rings, a paper-and-ink wash like WASH. */
const VIOLET = '#B7A2CF';

/**
 * Moon jelly (no model; drawn by hand): stranded on the summer strandline, seen a little from above.
 * A low, flattened glassy bell with a scalloped margin of eight shallow notches fringed with short
 * tentacles, faint canals running out to the edge, and the four pale violet horseshoes seen through it.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function moonjelly(p, scale) {
  const f = p.f, cx = 138, cy = 168, rx = 82, ry = 50, k = ry / rx;
  p.tint('M40 104H236V236H40Z', WASH.sand, 0.4);
  // The strandline: a few strands of dried litter and grains in the sand.
  p.fine('M46 112l28 -3M120 116l20 2M196 110l30 -4M52 226l22 2M184 228l34 -3', 0.9, 0.55);
  for (const [x, y] of [[60, 140], [222, 150], [70, 206], [214, 214], [112, 124]]) p.dot(x, y, 1.1);
  // The wet stain the bell leaves on the sand, a little below and behind it.
  p.tint(`M${cx - rx - 6} ${cy + 6}A${rx + 6} ${ry + 4} 0 1 0 ${cx + rx + 6} ${cy + 6}A${rx + 6} ${ry + 4} 0 1 0 ${cx - rx - 6} ${cy + 6}Z`, WASH.mud, 0.18);
  /** A point on the bell at angle a (radians) and share d of its radius. @param {number} a @param {number} d */
  const at = (a, d) => `${f(cx + Math.cos(a) * rx * d)} ${f(cy + Math.sin(a) * ry * d)}`;
  // The margin: eight shallow lobes between eight notches.
  let edge = '';
  for (let i = 0; i < 8; i++) {
    const a0 = ((i + 0.5) / 8) * Math.PI * 2, a1 = ((i + 1.5) / 8) * Math.PI * 2, am = (a0 + a1) / 2;
    edge += `${i ? '' : `M${at(a0, 0.94)}`}Q${at(am, 1.09)} ${at(a1, 0.94)}`;
  }
  p.shape(edge + 'Z', WASH.water, 0.22, 1.4);
  // The fringe of short tentacles all round the edge.
  let fringe = '';
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    fringe += `M${at(a, 1.0)}l${f(c * 4)} ${f(s * 4 * k)}`;
  }
  p.fine(fringe, 0.6, 0.4);
  // The low rise of the dome, and the faint canals running out to the margin.
  p.fine(`M${f(cx - rx * 0.8)} ${f(cy - 2)}C${f(cx - rx * 0.6)} ${f(cy - ry * 0.95)} ${f(cx + rx * 0.6)} ${f(cy - ry * 0.95)} ${f(cx + rx * 0.8)} ${f(cy - 2)}`, 0.8, 0.35);
  let canals = '';
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; canals += `M${at(a, 0.5)}L${at(a, 0.93)}`; }
  p.fine(canals, 0.6, 0.3);
  // The four horseshoes, each a band bent round with its gap facing the middle.
  /** @param {number} hx @param {number} hy middle @param {number} face angle of the gap */
  const shoe = (hx, hy, face) => {
    const R = 13, r = 7, gap = 0.8, pt = (/** @type {number} */ a, /** @type {number} */ q) => `${f(hx + Math.cos(a) * q)} ${f(hy + Math.sin(a) * q * k)}`;
    const a0 = face + gap, a1 = face + Math.PI * 2 - gap;
    return `M${pt(a0, R)}A${R} ${f(R * k)} 0 1 1 ${pt(a1, R)}A${f((R - r) / 2)} ${f(((R - r) / 2) * k)} 0 0 1 ${pt(a1, r)}A${r} ${f(r * k)} 0 1 0 ${pt(a0, r)}A${f((R - r) / 2)} ${f(((R - r) / 2) * k)} 0 0 1 ${pt(a0, R)}Z`;
  };
  /** @type {[number, number][]} */ const rings = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const hx = cx + Math.cos(a) * rx * 0.4, hy = cy + Math.sin(a) * ry * 0.4;
    rings.push([hx, hy]);
    p.shape(shoe(hx, hy, a + Math.PI), VIOLET, 0.6, 1.2);
  }
  // The glassy glint on the top of the bell.
  p.fine(`M${f(cx - rx * 0.5)} ${f(cy - ry * 0.55)}Q${f(cx - rx * 0.25)} ${f(cy - ry * 0.78)} ${f(cx + rx * 0.05)} ${f(cy - ry * 0.74)}`, 1.4, 0.5);
  const [ux, uy] = rings[3];
  p.label('rings', 250, 76, ux + 12, uy - 6);
  p.label('bell', 250, 140, cx + rx * 0.62, cy + ry * 0.05);
  p.label('margin', 250, 204, cx + rx * 0.72, cy + ry * 0.72);
  p.scale(30, cy - ry, cy + ry, scale);
  return p.svg(380, 245, 'Field sketch of a moon jelly stranded on the sand, its four violet rings seen through the bell');
}

/**
 * The well shrimp (the pan finds, October 31, 2026): a pale, eyeless groundwater shrimp from the
 * spring's pool, curled on its side in the last of the water in a pan, its feelers long.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function wellshrimp(p, scale) {
  // The pan's bottom and the last of its water.
  p.tint('M30 90C80 60 300 60 350 90C330 220 50 220 30 90Z', WASH.water, 0.25);
  p.fine('M44 100C110 84 270 84 336 100M62 180C140 196 240 196 318 180', 0.8, 0.4);
  // The body: a curled crescent of segments, pale.
  p.shape('M110 160C100 120 136 92 184 92C232 92 268 116 270 148C248 136 222 132 200 138C176 144 164 162 168 186C140 192 116 184 110 160Z', '#E6DFD2', 0.55, 1.4);
  p.fine('M134 112L146 134M156 100L162 128M180 94L182 124M204 94L200 124M228 102L218 128', 0.8, 0.55);
  // Legs under the curl, and the tail fan.
  p.line('M150 150L140 176M170 146L166 174M192 140L194 166M214 138L222 162', 1.2);
  p.line('M168 186L150 206M168 186L176 210M168 186L162 212', 1.2);
  // The feelers: two long, two short, sweeping up from the head.
  p.line('M270 148C292 120 304 92 300 60M270 148C296 140 316 124 330 102', 1.1);
  p.line('M266 142C276 130 280 120 280 110', 1);
  p.label('feelers', 52, 62, 300, 70);
  p.label('noeyes', 52, 132, 262, 140);
  p.label('legs', 52, 196, 160, 166);
  p.label('tail', 52, 226, 164, 204);
  p.scale(30, 92, 206, scale);
  return p.svg(380, 245, 'Field sketch of a well shrimp curled in the last of the water in a pan');
}
