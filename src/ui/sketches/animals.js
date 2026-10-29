// @ts-check
// Field sketches of the animals (M2). The azure damselfly's body is traced from the game's own model
// at rest (outlines.js, tools/gen-sketch-outlines.mjs), so the drawing keeps its true shape; the pen
// adds the stem it clings to, its black bands and the labels. Spring's frogspawn and common toad and
// the pond turtle are drawn by hand in the pen, as the moon jellyfish and fungi are, since their
// game bodies are too simple to trace well. Layout as living.js: the drawing in x 40..236, a scale
// bar at x 30, labels from x 250.

import { blade, wave } from './pen.js';
import { WASH } from './living.js';
import { drawTraced } from './traced.js';
import { OUTLINES } from './outlines.js';

/** The azure's sky blue, as a wash on the journal page. */
const SKY = '#86B8DA';

/** A fixed scatter 0..1 for the i-th dot along one axis (warts, eggs, speckles). @param {number} i @param {number} axis */
const scatter = (i, axis) => { const s = Math.sin(i * 12.9898 + axis * 78.233) * 43758.5453; return s - Math.floor(s); };

/**
 * Where a traced outline's edge crosses u (0..1 across): its lowest and highest points there, as
 * shares of the width down from the top. @param {number[][]} pts a closed loop @param {number} u
 */
function spanAt(pts, u) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    if ((u < x0 && u < x1) || (u > x0 && u > x1) || x0 === x1) continue;
    const y = y0 + ((u - x0) * (y1 - y0)) / (x1 - x0);
    lo = Math.max(lo, y); hi = Math.min(hi, y);
  }
  return { lo, hi };
}

/**
 * Azure damselfly: a male at rest on a reed stem over the water, his wings folded together along
 * his back, the sky-blue abdomen ringed with black.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function damselfly(p, scale) {
  const f = p.f;
  const T = OUTLINES.damselfly;
  // The water and a reed stem rising out of it, a blade off its side.
  p.tint('M40 236H236V258H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 236, 1.3, 26), 1.3);
  p.fine('M58 246h22M120 250h18M168 245h16', 0.9, 0.5);
  p.shape(blade(222, 238, 168, 196, 3, 4), WASH.green, 0.4, 1.1);
  p.shape(blade(218, 238, 206, 22, 3.2, -4), WASH.green, 0.45, 1.3);
  // The damselfly, its head to the stem; the body's depth comes from the model.
  const W = 160, x0 = 44, y0 = 104;
  const body = drawTraced(p, 'damselfly', x0, y0, W, { wash: SKY, opacity: 0.55, hatch: 0, creases: 10 });
  /** A point on the drawing from the model's (u across, z along the body: meters, +z to the head). @param {number} z */
  const uOf = (z) => (z + 0.0286) / T.widthM;
  // Black rings at the end of segments two to seven, and the black tip, inked solid on the abdomen.
  if (!p.pencil) {
    const bands = [[-0.0068, -0.0058], [-0.0095, -0.0086], [-0.0123, -0.0114], [-0.0151, -0.0142], [-0.0179, -0.017], [-0.0207, -0.0198], [-0.0284, -0.0262]];
    let d = '';
    for (const [z0, z1] of bands) {
      for (let u = uOf(z0); u <= uOf(z1); u += 0.6 / W) {
        const { lo } = spanAt(T.outline, u);
        if (!Number.isFinite(lo)) continue;
        const [x, yb] = body.at(u, lo);
        d += `M${f(x)} ${f(yb - 0.6)}V${f(yb - 6.2)}`;
      }
    }
    p.fine(d, 1, 0.85);
  }
  // Legs gripping the stem, under the thorax.
  const [lx, ly] = body.at(uOf(0), spanAt(T.outline, uOf(0)).lo);
  p.line(`M${f(lx - 2)} ${f(ly - 1)}L${f(lx + 6)} ${f(ly + 10)}L${f(lx + 26)} ${f(ly + 6)}`, 1.1);
  p.line(`M${f(lx + 3)} ${f(ly - 1)}L${f(lx + 14)} ${f(ly + 4)}L${f(lx + 27)} ${f(ly - 4)}`, 1.1);
  // Labels: the folded wings above the back, a band, the wide-set eyes.
  const uw = uOf(-0.009), uh = uOf(0.0032), ub = uOf(-0.0147);
  const w = spanAt(T.outline, uw), h = spanAt(T.outline, uh), b = spanAt(T.outline, ub);
  const [wx, wy] = body.at(uw, w.hi + 0.004);
  p.label('wings', 250, 52, wx, wy);
  const [bx, by] = body.at(ub, b.lo - 0.01);
  p.label('bands', 250, 190, bx, by);
  const [hx, hy] = body.at(uh, (h.lo + h.hi) / 2);
  p.label('eyes', 250, 112, hx + 2, hy);
  // About 3 cm: the bar is 30 mm at the drawing's scale.
  const mm = W / (T.widthM * 1000);
  p.scale(30, 220 - 30 * mm, 220, scale);
  return p.svg(380, 268, 'Field sketch of an azure damselfly resting on a reed stem, its wings folded along its back');
}


/** Frogspawn's clear jelly, a toad's warm brown, a pond turtle's near-black shell and dark skin. */
const JELLY = '#C9D4C4', TOAD = '#8E6B48', SHELL = '#4A4A3C', SKIN = '#45463A';

/**
 * Frogspawn: a clump floating at the surface of the shallows, seen a little from above: balls of
 * clear jelly heaped together, a dark egg in each, and three tadpoles hatched from it swimming off.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function frogspawn(p, scale) {
  const f = p.f;
  p.tint('M40 104H236V248H40Z', WASH.water, 0.3);
  p.fine('M48 128h26M196 122h30M52 238h22M120 244h18', 0.8, 0.45);
  // The clump: rows of eggs from the back (smaller, higher) to the front, inside a low oval.
  const cx = 134, cy = 166, rx = 74, ry = 40;
  /** @type {[number, number, number][]} */ const eggs = [];
  let i = 0, row = 0;
  for (let y = cy - ry + 8; y <= cy + ry - 6; y += 10, row++) {
    // Each row's reach varies, so the heap's edge is lumpy rather than a clean oval.
    const half = (rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2)) - 8) * (0.78 + 0.3 * scatter(row, 3));
    const r = 8.2 + 2.8 * ((y - (cy - ry)) / (2 * ry));
    for (let x = cx - half + (row % 2) * r * 0.6; x <= cx + half; x += r * 1.3) {
      eggs.push([x + (scatter(i, 1) - 0.5) * 7, y + (scatter(i, 2) - 0.5) * 6, r * (0.9 + 0.2 * scatter(i, 4))]);
      i++;
    }
  }
  // A soft shadow of jelly under the heap, where it sinks into the water.
  p.tint(`M${cx - rx} ${cy + 6}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy + 6}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy + 6}Z`, JELLY, 0.35);
  for (const [x, y, r] of eggs) {
    p.oval(x, y, r, r * 0.9, JELLY, 0.55, 0.85);
    // The dark egg, a little up and to the left in its ball, and the jelly's glint.
    p.dot(x - r * 0.12, y - r * 0.08, r * 0.36);
    if (p.wash) p.raw(`<path d="M${f(x - r * 0.62)} ${f(y - r * 0.18)}A${f(r * 0.66)} ${f(r * 0.6)} 0 0 1 ${f(x - r * 0.1)} ${f(y - r * 0.66)}" fill="none" stroke="#FFFFFF" stroke-width="1.1" opacity="0.8"/>`);
  }
  // Ripples on the water round the clump.
  p.fine(`M${cx - rx - 10} ${cy + 4}c-6 2 -10 6 -10 10M${cx + rx + 10} ${cy + 2}c6 2 10 6 10 10`, 0.8, 0.5);
  // Three tadpoles swimming off, each a dark round body and a wavering tail with its fin.
  /** @param {number} x @param {number} y @param {number} dir 1 right, -1 left @param {number} bend */
  const tadpole = (x, y, dir, bend) => {
    const t = (/** @type {number} */ k) => x - dir * k;
    p.shape(`M${f(t(3))} ${f(y - 2.6)}C${f(t(10))} ${f(y - 6 + bend)} ${f(t(16))} ${f(y + 1 + bend)} ${f(t(24))} ${f(y - 1 + bend * 1.6)}C${f(t(16))} ${f(y + 5 + bend)} ${f(t(10))} ${f(y + 3)} ${f(t(3))} ${f(y + 2.6)}Z`, WASH.tip, 0.3, 0.8);
    p.oval(x, y, 5.2, 4, WASH.tip, 0.9, 0.9);
    p.dot(x + dir * 2.6, y - 1.4, 0.8, '#E8E2D4');
  };
  tadpole(78, 222, -1, 2);
  tadpole(150, 232, 1, -2);
  tadpole(204, 214, 1, 3);
  const top = eggs[Math.floor(eggs.length * 0.3)], side = eggs.reduce((a, b) => (b[0] > a[0] ? b : a));
  p.label('eggs', 250, 64, top[0] - top[2] * 0.12, top[1]);
  p.label('jelly', 250, 140, side[0] + side[2] * 0.7, side[1]);
  p.label('tadpoles', 250, 212, 210, 214);
  p.scale(30, cy - ry, cy + ry, scale);
  return p.svg(380, 256, 'Field sketch of a clump of frogspawn floating in the shallows, with tadpoles swimming off');
}

/**
 * Common toad: from the side on the bank, mid-stride, squat and broad, its back warty, the swollen
 * gland behind its copper eye, walking rather than hopping.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function toad(p, scale) {
  const g = 214;
  p.tint(`M40 ${g}H236V246H40Z`, WASH.mud, 0.28);
  p.line(`M40 ${g}C92 ${g - 3} 166 ${g + 3} 236 ${g - 1}`, 1.3);
  p.fine(`M52 ${g + 12}l16 -2M120 ${g + 18}l22 1M196 ${g + 10}l18 -2`, 0.8, 0.5);
  p.shape(blade(50, g, 44, g - 46, 2.8, -5), WASH.green, 0.42, 1);
  p.shape(blade(58, g, 64, g - 30, 2.4, 4), WASH.green, 0.42, 1);
  p.shape(blade(226, g, 232, g - 40, 2.6, 5), WASH.green, 0.42, 1);
  // The far legs, just showing behind.
  p.shape(`M182 196C186 202 188 207 190 212H197C195 206 192 200 188 194Z`, TOAD, 0.75, 1.1);
  p.shape(`M86 204C96 208 108 210 116 212H124C114 206 102 202 92 200Z`, TOAD, 0.75, 1.1);
  // The body: a low broad back, rump to blunt snout.
  const body = 'M62 204C52 190 56 170 74 160C92 148 132 144 160 152C178 157 192 160 202 168C212 176 216 184 212 190C206 196 192 197 176 199C150 204 110 208 62 204Z';
  p.shape(body, TOAD, 0.55, 1.5);
  // The paler throat and belly.
  p.tint('M70 202C100 205 150 202 176 197C192 195 204 193 210 189C200 196 176 202 140 205C110 207 84 207 70 202Z', WASH.sand, 0.55);
  // Warts over the back and flank, darker raised bumps.
  const warts = [[84, 170], [98, 162], [112, 158], [126, 156], [140, 157], [152, 162], [92, 182], [108, 176], [124, 172], [140, 174], [156, 176], [76, 186], [118, 190], [146, 188], [102, 194], [168, 182]];
  for (const [x, y] of warts) p.oval(x, y, 2.6, 2, '#6B4E33', 0.65, 0.8);
  // The parotoid gland behind the eye, a raised bean.
  p.shape('M164 162C168 154 182 153 186 160C184 166 170 168 164 162Z', '#7A5A3B', 0.7, 1.1);
  // The eye: a copper iris, a dark level pupil, the brow ridge over it; nostril and mouth.
  p.oval(193, 167, 6.4, 5.4, WASH.gold, 0.95, 1.1);
  p.oval(193, 167.4, 3.8, 1.5, WASH.tip, 1, 0.6);
  p.line('M184 162C189 157 197 157 201 162', 1.2);
  p.dot(209, 176, 1);
  p.fine('M213 187C204 190 194 190 186 187', 1, 0.8);
  // The near hind leg folded under the rump, its long foot forward along the ground, toes spread.
  p.shape('M68 198C70 182 96 176 108 188C112 196 104 204 88 205C78 206 70 204 68 198Z', TOAD, 0.6, 1.3);
  p.shape('M84 205C98 209 120 211 138 211L144 214H96C88 213 82 210 84 205Z', TOAD, 0.6, 1.2);
  p.fine('M138 212l7 1M136 210l7 -2M140 214l5 2', 1, 0.8);
  // The near foreleg, stepping forward, its fingers turned in.
  p.shape('M164 192C170 200 172 206 174 212L170 214H188L183 211C181 205 180 198 178 191Z', TOAD, 0.6, 1.2);
  p.fine('M171 214l-4 1M177 214l0 2M183 214l4 1', 1, 0.8);
  p.label('warts', 250, 74, 126, 156);
  p.label('glands', 250, 130, 176, 158);
  p.label('eyes', 250, 184, 197, 167);
  p.scale(30, 150, g, scale);
  return p.svg(380, 250, 'Field sketch of a common toad walking on the bank, warty and squat, with a copper eye');
}

/**
 * European pond turtle: basking on a stone at the water's edge, head stretched up to the sun, its
 * dark domed shell plated and speckled with yellow.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function turtle(p, scale) {
  const f = p.f;
  p.tint('M40 222H236V252H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 222, 1.3, 26), 1.2);
  // The stone it basks on, half out of the water.
  p.shape('M56 206C70 195 196 193 214 203C226 214 222 230 206 238H72C54 232 46 218 56 206Z', WASH.grey, 0.45, 1.4);
  p.fine('M92 216l14 6M168 210l-10 9M140 226l8 -4', 0.9, 0.5);
  // The far legs and the tail, behind the shell.
  p.shape('M150 186C156 192 160 196 160 202H170C168 196 164 190 158 184Z', SKIN, 0.6, 1.1);
  p.shape('M64 178C58 180 52 182 46 182C52 187 60 187 68 185Z', SKIN, 0.6, 1.1);
  // The carapace: a low dome.
  const shell = 'M62 188C64 152 96 128 128 128C160 128 186 150 190 186C168 192 84 194 62 188Z';
  p.shape(shell, SHELL, 0.55, 1.5);
  // The plastron's yellow edge under it.
  p.shape('M68 190C96 197 160 197 186 189L182 194C154 201 98 201 72 195Z', WASH.gold, 0.55, 1.1);
  // The plates: a row of three down the back, the side plates below, the small edge plates all round.
  p.fine('M102 134C108 146 108 158 104 168M128 128V166M154 134C148 146 148 158 152 168', 1, 0.75);
  p.fine('M78 162C100 168 154 170 178 162', 1, 0.75);
  p.fine('M90 150C98 154 110 156 116 154M140 154C148 156 160 154 168 150', 0.8, 0.55);
  let rim = '';
  for (let x = 70; x <= 182; x += 10) {
    const y = 189 - 2 * Math.sin(((x - 62) / 128) * Math.PI);
    rim += `M${f(x)} ${f(y)}l0 -6`;
  }
  p.fine(rim, 0.8, 0.6);
  // Yellow speckles on the shell, and on the head and neck.
  for (let i = 0; i < 26; i++) {
    const a = scatter(i, 1) * Math.PI, d = 0.25 + 0.65 * scatter(i, 2);
    p.dot(128 - Math.cos(a) * 58 * d, 186 - Math.sin(a) * 52 * d, 1.3, WASH.yellow);
  }
  // The neck stretched up and the head raised to the sun.
  p.shape('M178 178C186 168 194 158 202 152L212 158C204 168 196 178 188 186Z', SKIN, 0.6, 1.2);
  p.shape('M202 150C206 142 220 140 228 146C232 151 228 157 220 158C210 159 202 157 202 150Z', SKIN, 0.6, 1.3);
  for (const [x, y] of [[196, 166], [204, 160], [210, 150], [216, 145], [192, 174]]) p.dot(x, y, 1.1, WASH.yellow);
  p.oval(219, 147.5, 2.8, 2.6, WASH.gold, 0.9, 0.8);
  p.dot(219.4, 147.5, 1.2);
  p.fine('M229 150C225 153 220 154 214 153', 0.9, 0.8);
  // The near front and hind legs, clawed, gripping the stone.
  p.shape('M164 184C174 188 180 194 180 200L186 202H170C170 196 166 192 158 188Z', SKIN, 0.6, 1.2);
  p.fine('M172 202l-2 3M178 202l0 3M184 202l2 3', 1, 0.85);
  p.shape('M80 186C72 190 66 196 64 202H78C78 196 82 192 88 190Z', SKIN, 0.6, 1.2);
  p.fine('M66 202l-2 3M71 202l0 3M76 202l2 3', 1, 0.85);
  p.label('shell', 250, 70, 128, 138);
  p.label('head', 250, 128, 214, 144);
  p.label('feet', 250, 186, 178, 200);
  p.scale(30, 128, 202, scale);
  return p.svg(380, 256, 'Field sketch of a European pond turtle basking on a stone at the water\'s edge, its head raised');
}

/**
 * A smooth tube along a center line: the outline of a body of the given radius at each point (a
 * slow worm's, a lizard's tail), as one closed path. @param {number[][]} c center points
 * @param {number[]} r radius at each @param {(n: number) => string} f
 */
function tube(c, r, f) {
  /** @type {number[][]} */ const L = [], R = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    L.push([c[i][0] + nx * r[i], c[i][1] + ny * r[i]]);
    R.push([c[i][0] - nx * r[i], c[i][1] - ny * r[i]]);
  }
  const pts = [...L, ...R.reverse()];
  return `M${pts.map((q) => `${f(q[0])} ${f(q[1])}`).join('L')}Z`;
}

/** Bronze for a slow worm's back, warm brown for a lizard's. */
const BRONZE = '#B07A40', LIZARD = '#8A6A3E';

/**
 * Slow worm: basking on the ground in a lazy S beside the cut end of a log, smooth and bronze, its
 * small head lifted a little and its tail tapering away.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function slowworm(p, scale) {
  const f = p.f, g = 214;
  p.tint(`M40 ${g}H236V246H40Z`, WASH.mud, 0.25);
  // The log behind: its length running back, bark lines, and its cut end with rings.
  p.shape(`M40 162C64 158 120 158 146 163L146 ${g - 14}C120 ${g - 10} 64 ${g - 10} 40 ${g - 12}Z`, WASH.brown, 0.35, 1.4);
  p.fine('M48 172C76 168 116 170 140 174M46 186C80 183 116 184 142 188', 0.8, 0.5);
  p.oval(150, 182, 13, 21, '#C9A27A', 0.55, 1.4);
  p.fine('M150 170A7 11 0 1 1 149.9 170M150 177A3.5 5.5 0 1 1 149.9 177', 0.7, 0.55);
  p.line(`M40 ${g}C92 ${g - 3} 166 ${g + 3} 236 ${g - 1}`, 1.3);
  // The slow worm: a lazy S along the ground in front of the log, head to the right.
  /** @type {number[][]} */ const c = [];
  /** @type {number[]} */ const r = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    // Lying on the ground in front of the log, its head lifted a little at the right.
    const s = i / n, x = 226 - s * 180, y = g + 2 - Math.sin(s * Math.PI * 2) * 12 - (s < 0.08 ? (0.08 - s) * 140 : 0);
    c.push([x, y]);
    r.push(s < 0.06 ? 4.4 + s * 65 : s < 0.45 ? 8.2 : 8.2 * (1 - 0.85 * ((s - 0.45) / 0.55)));
  }
  p.shape(tube(c, r, f), BRONZE, 0.6, 1.3);
  // The dark line down its flank, and the shine along its back.
  p.fine(`M${c.slice(4, 34).map((q, i) => `${f(q[0])} ${f(q[1] + r[i + 4] * 0.35)}`).join('L')}`, 1, 0.7);
  if (p.wash) p.raw(`<path d="M${c.slice(3, 26).map((q, i) => `${f(q[0])} ${f(q[1] - r[i + 3] * 0.55)}`).join('L')}" fill="none" stroke="#FFFFFF" stroke-width="1" opacity="0.6"/>`);
  // The eye, near the snout.
  p.dot(c[2][0] - 1, c[2][1] - 1.2, 1.1);
  p.label('scales', 250, 74, c[14][0], c[14][1] - r[14]);
  p.label('eye', 250, 132, c[2][0] - 1, c[2][1] - 1.2);
  p.label('tail', 250, 190, c[36][0], c[36][1]);
  p.scale(30, 160, g + 14, scale);
  return p.svg(380, 250, 'Field sketch of a slow worm basking in a lazy curve beside a log');
}

/**
 * Common lizard: flat on the top of a sunny stone, legs splayed, its head lifted to look about and
 * its long tail curling down over the stone's edge.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function lizard(p, scale) {
  const f = p.f;
  // Gorse behind: a few spiny sprays with yellow flowers.
  for (const [x, y, s] of [[60, 132, 1], [214, 124, -1]]) {
    p.fine(`M${x} ${y + 58}C${x + 6 * s} ${y + 30} ${x + 2 * s} ${y + 12} ${x + 10 * s} ${y}M${x + 4 * s} ${y + 34}l${10 * s} -8M${x + 6 * s} ${y + 20}l${-8 * s} -6`, 1, 0.6);
    for (let k = 0; k < 5; k++) p.dot(x + s * (4 + 7 * scatter(k, x)), y + 4 + 40 * scatter(k, y), 1.6, WASH.yellow);
  }
  // The stone.
  p.shape('M52 214C60 186 104 176 140 176C178 176 214 186 224 214C214 226 66 228 52 214Z', WASH.grey, 0.45, 1.4);
  p.fine('M84 200l18 6M170 196l-12 8M130 214l10 -3', 0.9, 0.5);
  p.line('M40 216C92 213 166 219 236 215', 1.2);
  // The far legs, splayed out behind the body.
  p.shape('M164 174L172 166L180 165L179 168L173 169L167 177Z', LIZARD, 0.75, 1);
  p.shape('M126 175L118 166L110 165L111 168L116 169L122 178Z', LIZARD, 0.75, 1);
  // The body and its long tail, curling down over the stone's left edge; the snout at the right,
  // the head lifted on its neck.
  /** @type {number[][]} */ const c = [];
  /** @type {number[]} */ const r = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    let x, y;
    if (s < 0.4) { x = 206 - s * 220; y = 176 - (s < 0.14 ? (0.14 - s) * 70 : 0); }
    else { const u = (s - 0.4) / 0.6; x = 118 - u * 58 - Math.sin(u * Math.PI) * 8; y = 177 + u * u * 36; }
    c.push([x, y]);
    // A pointed snout, the head, a slimmer neck, the broad body, then the long tapering tail.
    r.push(s < 0.06 ? 1.6 + s * 55 : s < 0.1 ? 4.9 : s < 0.13 ? 4.1 : s < 0.32 ? 6.6 : s < 0.4 ? 6.6 - (s - 0.32) * 40 : 3.4 * (1 - 0.85 * ((s - 0.4) / 0.6)));
  }
  p.shape(tube(c, r, f), LIZARD, 0.62, 1.3);
  // The near legs, splayed flat on the stone, toes spread.
  p.shape('M166 181L176 190L186 190L185 186L178 186L172 178Z', LIZARD, 0.62, 1.1);
  p.fine('M186 190l3 -2M186 190l4 1M184 191l2 3', 0.9, 0.8);
  p.shape('M128 182L118 191L106 191L107 187L115 187L122 179Z', LIZARD, 0.62, 1.1);
  p.fine('M106 191l-3 -2M106 191l-4 1M108 192l-2 3', 0.9, 0.8);
  // The dark line down its back and the pale line along its flank, dotted.
  if (!p.pencil) for (let i = 7; i < 26; i += 2) p.dot(c[i][0], c[i][1] - r[i] * 0.35, 1.2);
  p.fine(`M${c.slice(7, 20).map((q, i) => `${f(q[0])} ${f(q[1] + r[i + 7] * 0.5)}`).join('L')}`, 0.9, 0.55);
  // Its eye and mouth.
  p.dot(c[3][0], c[3][1] - 1.4, 1.3);
  p.fine(`M${f(c[0][0])} ${f(c[0][1] + 0.6)}L${f(c[4][0])} ${f(c[4][1] + 1.6)}`, 0.8, 0.7);
  p.label('back', 250, 74, c[14][0], c[14][1] - r[14] * 0.35);
  p.label('legs', 250, 132, 181, 189);
  p.label('tail', 250, 190, c[40][0], c[40][1]);
  p.scale(30, 160, 216, scale);
  return p.svg(380, 250, 'Field sketch of a common lizard basking flat on a sunny stone, among the gorse');
}

/** A common frog's olive green, a minnow's olive and silver, a southern hawker's greens and blues. */
const FROG = '#7F8A4C', MINNOW = '#8C8A64', HAWKER = '#7FA36A', SPOT = '#6FA8C8';

/**
 * Common frog: sitting on the bank at the water's edge, side on, head up, its long hind legs folded
 * under it, the dark mask behind its gold eye and the blotches on its back.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function frog(p, scale) {
  const g = 206;
  p.tint(`M198 ${g}H236V248H198Z`, WASH.water, 0.32);
  p.line(wave(198, 236, g + 4, 1.2, 14), 1.1);
  p.tint(`M40 ${g}H202C196 ${g + 14} 196 ${g + 30} 202 246H40Z`, WASH.mud, 0.25);
  p.line(`M40 ${g}C100 ${g - 2} 170 ${g - 1} 202 ${g + 4}`, 1.3);
  p.shape(blade(52, g, 48, g - 54, 2.8, -5), WASH.green, 0.42, 1);
  p.shape(blade(60, g, 66, g - 38, 2.4, 4), WASH.green, 0.42, 1);
  // The far legs, just showing.
  p.shape('M150 186C154 194 156 200 158 205H165C162 198 159 191 155 184Z', FROG, 0.75, 1.1);
  // The body: haunches low at the back, the back rising to the head, the snout at the right.
  p.shape('M78 202C66 190 70 166 88 152C106 138 134 132 156 140C172 146 184 154 190 164C194 172 190 178 180 180C168 186 150 194 130 200C112 205 90 207 78 202Z', FROG, 0.55, 1.5);
  // The pale throat and belly.
  p.tint('M96 204C120 202 150 192 172 182C182 178 188 176 190 170C186 180 168 190 146 198C124 205 106 207 96 204Z', WASH.sand, 0.6);
  // Dark blotches over the back and flank.
  for (const [x, y, rx, ry] of [[104, 156, 6, 3.6], [122, 148, 5, 3.2], [96, 174, 5.4, 3.4], [116, 168, 4.6, 3], [138, 160, 4.2, 2.8], [88, 190, 4.2, 2.8]]) p.oval(x, y, rx, ry, '#4E5530', 0.6, 0.8);
  // The dark mask from the eye back over the ear, the gold eye on top of the head, a ridge down the back.
  p.shape('M160 152C166 150 174 154 176 160C170 164 162 164 156 160Z', '#3E3A2C', 0.7, 0.9);
  p.oval(168, 146, 6, 5.4, WASH.gold, 0.95, 1.1);
  p.oval(168, 146.4, 3.6, 1.6, WASH.tip, 1, 0.6);
  p.fine('M150 146C130 140 108 146 92 158', 0.9, 0.6);
  p.dot(186, 160, 0.9);
  p.fine('M190 168C182 171 172 171 166 168', 0.9, 0.8);
  // The long hind leg folded under: thigh, shin and the long webbed foot along the ground.
  p.shape('M76 196C78 176 104 170 116 182C120 192 110 200 94 202C84 203 76 202 76 196Z', FROG, 0.6, 1.3);
  p.shape('M92 202C106 205 128 206 146 206L152 209H100C92 208 88 205 92 202Z', FROG, 0.6, 1.2);
  p.fine('M146 207l7 1M144 205l7 -2M148 209l5 2', 1, 0.8);
  // The foreleg, straight down to its fingers.
  p.shape('M156 182C158 192 160 198 162 204L158 206H172L168 203C166 196 165 188 164 180Z', FROG, 0.6, 1.2);
  p.label('mask', 250, 70, 166, 158);
  p.label('blotches', 250, 128, 116, 168);
  p.label('legs', 250, 186, 104, 186);
  p.scale(30, 140, g, scale);
  return p.svg(380, 250, 'Field sketch of a common frog sitting on the bank at the water\'s edge');
}

/**
 * Common minnows: a few swimming together under the surface, side on, the dark bars along their
 * flanks, forked tails and small fins.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function minnows(p, scale) {
  const f = p.f;
  p.tint('M40 96H236V244H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 96, 1.3, 26), 1.2);
  p.fine('M50 236C80 230 120 240 150 234C180 228 210 236 236 232', 1, 0.5);
  /**
   * One minnow, its snout at (x, y), w long, heading left (dir -1) or right (1).
   * @param {number} x @param {number} y @param {number} w @param {number} dir
   */
  const fish = (x, y, w, dir) => {
    /** @type {number[][]} */ const c = [];
    /** @type {number[]} */ const r = [];
    for (let i = 0; i <= 20; i++) {
      const s = i / 20;
      c.push([x - dir * s * w * 0.82, y + Math.sin(s * Math.PI) * w * 0.02]);
      r.push(w * (s < 0.15 ? 0.03 + s * 0.48 : s < 0.45 ? 0.1 : 0.1 - 0.075 * ((s - 0.45) / 0.55)));
    }
    const tx = x - dir * w * 0.82;
    // The forked tail, then the body over it, the fins, the bars, the eye.
    p.shape(`M${f(tx)} ${f(y)}L${f(tx - dir * w * 0.2)} ${f(y - w * 0.11)}L${f(tx - dir * w * 0.13)} ${f(y)}L${f(tx - dir * w * 0.2)} ${f(y + w * 0.11)}Z`, MINNOW, 0.6, 1);
    p.shape(tube(c, r, f), MINNOW, 0.55, 1.2);
    p.shape(`M${f(x - dir * w * 0.42)} ${f(y - w * 0.09)}l${f(-dir * w * 0.06)} ${f(-w * 0.08)}l${f(-dir * w * 0.08)} ${f(w * 0.07)}Z`, MINNOW, 0.6, 0.9);
    p.shape(`M${f(x - dir * w * 0.5)} ${f(y + w * 0.09)}l${f(-dir * w * 0.05)} ${f(w * 0.07)}l${f(-dir * w * 0.08)} ${f(-w * 0.06)}Z`, MINNOW, 0.6, 0.9);
    p.tint(tube(c.slice(2, 18).map((q) => [q[0], q[1] + w * 0.035]), r.slice(2, 18).map((v) => v * 0.45), f), '#E6E2D4', 0.75);
    let bars = '';
    for (let i = 0; i < 8; i++) { const q = c[4 + i * 2]; bars += `M${f(q[0])} ${f(q[1] - w * 0.06)}l${f(-dir * 1.5)} ${f(w * 0.08)}`; }
    p.fine(bars, 1.8, 0.65);
    p.dot(x - dir * w * 0.08, y - w * 0.018, Math.max(1, w * 0.018));
    return c;
  };
  const a = fish(200, 136, 92, 1);
  fish(130, 172, 80, 1);
  fish(206, 206, 70, 1);
  p.label('bars', 250, 74, a[10][0], a[10][1] - 2);
  p.label('tail', 250, 132, 200 - 92 * 0.95, 136);
  p.label('school', 250, 196, 160, 200);
  p.scale(30, 120, 220, scale);
  return p.svg(380, 252, 'Field sketch of three common minnows swimming together under the water');
}

/**
 * Southern hawker: from above, hovering over the pond, its four clear wings held out flat, the
 * green and blue spots down its long abdomen and the big eyes meeting on top of its head.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function dragonfly(p, scale) {
  const f = p.f, cx = 138, top = 98;
  p.tint('M40 96H236V250H40Z', WASH.water, 0.22);
  p.fine('M52 236C80 232 110 240 140 236M170 116C190 112 210 118 230 114', 0.9, 0.4);
  // The four wings, clear with fine veins and a dark spot near each tip.
  /** @param {number} y0 @param {number} len @param {number} wid @param {number} side @param {number} sweep */
  const wing = (y0, len, wid, side, sweep) => {
    const x0 = cx + side * 6, x1 = cx + side * (6 + len);
    const d = `M${f(x0)} ${f(y0)}C${f(x0 + side * len * 0.4)} ${f(y0 - wid + sweep)} ${f(x1 - side * 10)} ${f(y0 - wid * 0.6 + sweep)} ${f(x1)} ${f(y0 + sweep)}C${f(x1 - side * 6)} ${f(y0 + wid * 0.7 + sweep)} ${f(x0 + side * len * 0.5)} ${f(y0 + wid * 0.6)} ${f(x0)} ${f(y0 + 4)}Z`;
    p.shape(d, '#DDE8EE', 0.45, 0.9);
    let v = '';
    for (let k = 1; k < 4; k++) v += `M${f(x0)} ${f(y0 + 1)}C${f(x0 + side * len * 0.4)} ${f(y0 - wid * 0.25 * k + sweep * 0.5)} ${f(x1 - side * 20)} ${f(y0 - wid * 0.1 * k + sweep)} ${f(x1 - side * 4)} ${f(y0 + sweep)}`;
    p.fine(v, 0.5, 0.4);
    p.oval(x1 - side * 10, y0 - 2 + sweep, 3.4, 1.6, WASH.tip, 0.9, 0.6);
  };
  for (const side of [-1, 1]) { wing(top + 34, 86, 13, side, -6); wing(top + 46, 80, 16, side, 6); }
  // The abdomen, long and slim, ringed and spotted.
  /** @type {number[][]} */ const c = [];
  /** @type {number[]} */ const r = [];
  for (let i = 0; i <= 24; i++) { const s = i / 24; c.push([cx, top + 52 + s * 96]); r.push(s < 0.08 ? 5 - s * 25 : s < 0.9 ? 3 : 3 + (s - 0.9) * 8); }
  p.shape(tube(c, r, f), '#4A4A38', 0.55, 1.2);
  let rings = '';
  for (let k = 1; k < 9; k++) { const y = top + 52 + k * 10.5; rings += `M${cx - 3} ${f(y)}h6`; }
  p.fine(rings, 0.8, 0.6);
  for (let k = 0; k < 8; k++) {
    const y = top + 58 + k * 10.5, col = k < 6 ? HAWKER : SPOT;
    p.dot(cx - 1.6, y, 1.4, col); p.dot(cx + 1.6, y, 1.4, col);
  }
  // The thorax, green-striped, and the head with its great eyes meeting on top.
  p.oval(cx, top + 40, 8, 13, HAWKER, 0.6, 1.2);
  p.fine(`M${cx - 4} ${top + 32}l2 14M${cx + 4} ${top + 32}l-2 14`, 1.2, 0.7);
  p.oval(cx - 5, top + 22, 6.2, 6, '#5E8C66', 0.75, 1.1);
  p.oval(cx + 5, top + 22, 6.2, 6, '#5E8C66', 0.75, 1.1);
  p.fine(`M${cx} ${top + 16}V${top + 28}`, 0.8, 0.7);
  p.label('eyes', 250, 74, cx + 7, top + 20);
  p.label('wings', 250, 132, cx + 70, top + 44);
  p.label('spots', 250, 190, cx + 2, top + 110);
  p.scale(30, top + 16, top + 148, scale);
  return p.svg(380, 256, 'Field sketch of a southern hawker from above, its four wings held out flat');
}

/**
 * Midges: a dancing cloud over the reeds at dusk, and one midge drawn large in a circle beside it:
 * a slim body, two narrow wings, long legs and feathery antennae.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function midges(p, scale) {
  const f = p.f;
  p.tint('M40 214H236V248H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 214, 1.2, 24), 1.1);
  for (const [bx, tx, ty, bend] of [[52, 50, 120, -4], [62, 70, 140, 5], [76, 74, 112, -3], [200, 206, 130, 4], [214, 210, 150, -4]]) p.shape(blade(bx, 214, tx, ty, 2.4, bend), WASH.green, 0.42, 1);
  // The cloud: a tall loose column of specks over the water, thicker in the middle.
  for (let i = 0; i < 90; i++) {
    const u = scatter(i, 5), v = scatter(i, 6);
    const y = 120 + v * 80, half = 6 + 18 * Math.sin(v * Math.PI);
    p.dot(104 + (u - 0.5) * 2 * half, y, 0.9);
  }
  // One midge, large, in a circle.
  const mx = 190, my = 74;
  p.oval(mx, my, 34, 34, '#F4EEE4', 0.2, 0.9);
  p.fine(`M${mx - 30} ${my + 16}L104 138`, 0.8, 0.4);
  p.shape(`M${mx - 18} ${my + 4}C${mx - 10} ${my} ${mx + 8} ${my - 2} ${mx + 18} ${my + 2}C${mx + 8} ${my + 6} ${mx - 10} ${my + 7} ${mx - 18} ${my + 4}Z`, '#6A6A52', 0.6, 1);
  p.oval(mx - 22, my + 2, 4.4, 3.8, '#55553F', 0.75, 1);
  p.shape(`M${mx - 6} ${my}C${mx} ${my - 18} ${mx + 14} ${my - 22} ${mx + 22} ${my - 18}C${mx + 14} ${my - 12} ${mx + 4} ${my - 6} ${mx - 2} ${my}Z`, '#DDE8EE', 0.5, 0.8);
  let legs = '';
  for (const [dx, ex, ey] of [[-10, -20, 18], [-4, -8, 22], [2, 6, 22]]) legs += `M${mx + dx} ${my + 5}L${mx + ex} ${my + ey}`;
  p.fine(legs, 0.8, 0.8);
  let ant = '';
  for (let k = 0; k < 6; k++) ant += `M${f(mx - 26 - k * 1.6)} ${f(my - k * 1.4)}l-3 -3M${f(mx - 26 - k * 1.6)} ${f(my - k * 1.4)}l-4 1`;
  p.fine(`M${mx - 25} ${my}L${mx - 35} ${my - 9}` + ant, 0.6, 0.8);
  p.label('cloud', 250, 150, 112, 150);
  p.label('midge', 250, 74, mx + 30, my - 6);
  p.scale(30, 120, 214, scale);
  return p.svg(380, 252, 'Field sketch of a cloud of midges dancing over the reeds, and one midge drawn large');
}

/** A feral hen's warm brown, her darker tail and wing, her pale yellow legs. */
const HEN = '#9A6438', HEN_DARK = '#5E3E26', HEN_LEG = '#D8B866';

/**
 * Feral hen: side on, mid-scratch on a patch of turned soil, standing on one leg while the other
 * foot rakes back, her body tipped forward, small comb and wattle, a short upturned tail, the wing
 * folded close (it never opens).
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function hen(p, scale) {
  const g = 214;
  p.tint(`M40 ${g}H236V246H40Z`, WASH.mud, 0.22);
  // The turned soil under her: a darker scraped patch, crumbs kicked back behind.
  p.tint(`M70 ${g - 2}C96 ${g - 6} 160 ${g - 6} 186 ${g - 1}C170 ${g + 8} 96 ${g + 9} 70 ${g - 2}Z`, WASH.brown, 0.4);
  p.line(`M40 ${g}C90 ${g - 3} 170 ${g + 2} 236 ${g - 1}`, 1.3);
  p.fine(`M84 ${g + 4}l10 -2M120 ${g + 6}l14 1M160 ${g + 4}l10 -1M206 ${g + 12}l16 -2`, 0.8, 0.5);
  for (const [x, y, r] of [[78, 202, 1.6], [70, 194, 1.2], [84, 190, 1], [64, 206, 1.4], [74, 184, 0.9]]) p.dot(x, y, r, WASH.brown);
  p.shape(blade(224, g, 228, g - 34, 2.4, 4), WASH.green, 0.42, 1);
  p.shape(blade(48, g, 44, g - 28, 2.2, -4), WASH.green, 0.42, 1);
  // The short tail, upturned behind.
  p.shape('M86 152C78 140 72 126 72 110C80 114 86 120 90 128C90 118 94 108 100 102C103 116 103 130 100 142Z', HEN_DARK, 0.65, 1.3);
  p.fine('M80 120C84 128 88 136 90 146M96 112C96 124 96 134 96 144', 0.9, 0.6);
  // The body, tipped forward: the back high at the rump, sloping to the neck.
  p.shape('M84 146C100 132 136 128 160 136C176 142 188 154 186 170C182 186 160 196 132 196C108 196 88 186 80 170C77 160 79 151 84 146Z', HEN, 0.55, 1.5);
  // The paler breast.
  p.tint('M176 156C186 164 186 178 174 188C164 192 152 194 144 194C160 186 174 174 176 156Z', WASH.sand, 0.5);
  // The folded wing over the flank, its flight feathers lying back along the side.
  p.shape('M100 148C120 140 152 142 168 152C164 166 148 176 126 178C112 178 100 172 94 164C92 156 95 151 100 148Z', WASH.brown, 0.55, 1.1);
  p.fine('M98 162l-8 4M104 168l-8 6M112 173l-6 6M120 176l-4 6', 0.9, 0.7);
  p.fine('M108 152C124 148 144 150 158 156M104 160C120 158 140 162 152 166', 0.8, 0.55);
  // Speckles on the breast and back.
  for (const [x, y] of [[176, 166], [170, 174], [180, 176], [162, 180], [130, 138], [146, 138], [116, 140]]) p.fine(`M${x - 2} ${y}l2 2l2 -2`, 0.8, 0.6);
  // The neck and head reaching forward and down.
  p.shape('M162 138C172 130 188 130 198 138L206 154C198 160 190 164 184 168C182 156 174 146 162 138Z', HEN, 0.55, 1.3);
  p.shape('M194 140C196 130 210 128 216 136C220 142 218 152 210 156C202 158 194 152 194 140Z', HEN, 0.55, 1.3);
  // Small comb and wattle, the beak, the eye.
  p.shape('M199 132C198 126 202 125 203 129C204 124 208 124 208 128C210 125 214 126 213 131C210 134 203 135 199 132Z', WASH.red, 0.7, 1);
  p.shape('M212 150C215 155 211 160 207 157C205 154 207 150 212 150Z', WASH.red, 0.7, 0.9);
  p.shape('M216 139L226 145L215 148Z', WASH.gold, 0.85, 1);
  p.oval(208, 139, 2.4, 2.2, WASH.gold, 0.9, 0.7);
  p.dot(208.4, 139, 1.1);
  // The standing leg: thigh feathers, a straight shank, toes spread on the ground.
  p.shape('M144 190C146 196 154 198 158 192Z', HEN, 0.6, 1);
  p.shape('M148 194L153 194L156 212L151 212Z', HEN_LEG, 0.8, 1);
  p.line(`M153 ${g - 1}L167 ${g + 1}M153 ${g - 1}L161 ${g - 4}M153 ${g - 1}L142 ${g}`, 1.2);
  // The raking leg, kicked back, toes trailing as they scrape.
  p.shape('M118 190C120 196 128 198 130 192Z', HEN, 0.6, 1);
  p.shape('M121 194L126 196L109 209L105 206Z', HEN_LEG, 0.8, 1);
  p.line('M107 208L91 211M107 208L93 203M107 208L96 215', 1.2);
  p.label('comb', 250, 66, 206, 127);
  p.label('tail', 250, 122, 88, 114);
  p.label('feet', 250, 186, 96, 208);
  p.scale(30, 124, g, scale);
  return p.svg(380, 252, 'Field sketch of a small brown feral hen scratching on turned soil, one foot raking back');
}
