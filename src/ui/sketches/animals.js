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
