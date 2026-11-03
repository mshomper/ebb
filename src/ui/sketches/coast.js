// @ts-check
// Field sketches of B3's coast and pond lives (doc 13, the autumn and winter creatures): the ruddy
// turnstone flipping wrack on the strandline, the purple sandpiper hunched on wet rock, the European
// eel on the pond bed, the teal on the water and the grey seal hauled out with her pup. Drawn by hand
// in the pen, as the turtle and the hen are, each at its own shape (no outline is shared). Layout as
// living.js: the drawing in x 40..236, a scale bar at x 30, labels from x 250.

import { blade, wave } from './pen.js';
import { WASH } from './living.js';
import { tube } from './animals.js';

const TURN_BACK = '#8A5A34', TURN_DARK = '#2F2A26', ORANGE = '#D98A3A';
const SLATE = '#6E737A', SHEEN = '#7A6E86', PIPER_LEG = '#D6B24A';
const EEL = '#5A5532', EEL_FIN = '#3F3B26';
const TEAL_HEAD = '#8A4A2E', TEAL_GREEN = '#3F7A5A';
const SEAL = '#8C8E8A', SEAL_DARK = '#4E504C';

/**
 * Ruddy turnstone: long and low, side on along the strandline, head down and its short, slightly
 * upturned wedge of a bill under a strand of wrack it is flipping over: the white head with its
 * black harlequin bands running into the breast band, chestnut and black back, white belly, short
 * orange legs.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function turnstone(p, scale) {
  const g = 206;
  p.tint(`M40 ${g}H236V250H40Z`, WASH.sand, 0.4);
  p.line(`M40 ${g}C90 ${g - 2} 170 ${g + 2} 236 ${g - 1}`, 1.3);
  // Wrack along the line behind it, a pebble.
  p.shape(`M44 ${g + 6}C70 ${g + 1} 96 ${g + 10} 120 ${g + 4}C112 ${g + 12} 80 ${g + 16} 44 ${g + 12}Z`, WASH.brown, 0.55, 1);
  for (const [x, y] of [[62, g + 9], [84, g + 10], [104, g + 7]]) p.oval(x, y, 3, 2.4, WASH.mud, 0.6, 0.8);
  p.oval(170, g + 12, 8, 4.5, WASH.grey, 0.45, 1.1);
  // The short tail, then the far leg, behind the body.
  p.shape('M76 134L50 138L74 150Z', TURN_DARK, 0.6, 1.2);
  p.shape(`M144 172L148 172L150 ${g - 2}L146 ${g - 2}Z`, ORANGE, 0.8, 1);
  p.line(`M148 ${g - 1}L160 ${g}M148 ${g - 1}L140 ${g}M148 ${g - 1}L154 ${g - 4}`, 1.1);
  // The long, low body, its back nearly level, and the white belly.
  p.shape('M72 138C86 122 126 116 158 120C182 124 196 136 198 150C198 164 184 172 160 174C128 176 96 170 82 162C74 156 70 146 72 138Z', TURN_BACK, 0.55, 1.5);
  p.tint('M92 166C120 174 160 176 188 164C194 158 198 154 198 150C182 160 140 166 92 166Z', WASH.petal, 0.8);
  // The folded wing, chestnut with black patches, the white stripe along it.
  p.shape('M92 134C114 124 150 120 176 128C170 144 148 152 122 154C106 154 96 148 92 142C90 139 90 136 92 134Z', TURN_BACK, 0.6, 1.1);
  p.shape('M98 146C120 144 146 140 168 134L170 138C148 146 122 150 100 150Z', WASH.petal, 0.8, 0.8);
  p.fine('M110 132l12 -3M132 128l10 1M150 130l12 -1M118 140l10 0M140 138l12 -2', 2.2, 0.6);
  p.fine('M98 150l-6 4M106 152l-5 5M114 153l-3 6', 0.9, 0.7);
  // The black breast band, reaching up the neck to the lowered head.
  p.shape('M178 128C192 134 204 146 210 160L198 170C192 162 184 154 172 148C174 140 176 134 178 128Z', TURN_DARK, 0.65, 1.1);
  // The white head held low, its black bands, the eye.
  p.oval(207, 168, 13, 10.5, WASH.petal, 0.8, 1.3);
  p.fine('M196 162C202 166 210 166 216 162M200 172C206 176 212 176 218 172', 1.6, 0.8);
  p.oval(206, 164, 2, 1.8, WASH.tip, 0.9, 0.7);
  p.dot(206.2, 164, 0.9);
  // The wrack strand it is turning, lifted on the short wedge of its bill.
  p.shape(`M196 ${g - 2}C208 186 222 180 236 182L235 188C224 188 212 192 202 ${g + 2}Z`, WASH.brown, 0.6, 1);
  p.oval(226, 184, 2.6, 2.2, WASH.mud, 0.6, 0.8);
  p.shape('M217 170L233 179L216 176Z', WASH.tip, 0.85, 1);
  // The near leg and its toes.
  p.shape(`M128 174L132 174L134 ${g - 2}L130 ${g - 2}Z`, ORANGE, 0.8, 1);
  p.line(`M132 ${g - 1}L146 ${g + 1}M132 ${g - 1}L122 ${g}M132 ${g - 1}L138 ${g - 4}`, 1.2);
  p.label('bill', 250, 60, 228, 177);
  p.label('breast', 250, 116, 190, 146);
  p.label('wings', 250, 172, 140, 144);
  p.label('legs', 250, 228, 133, 194);
  p.scale(30, 116, g, scale);
  return p.svg(400, 260, 'Field sketch of a ruddy turnstone on the strandline, head down, flipping a strand of wrack');
}

/**
 * Purple sandpiper: round and hunched on wet, weedy rock, its head pulled in close with no neck to
 * see, the long bill a little drooped, slate grey with a purple sheen and pale feather edges on the
 * wing, the short yellow legs.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function sandpiper(p, scale) {
  const g = 206;
  p.tint('M40 236H236V252H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 236, 1.3, 26), 1.2);
  // The rock it stands on, wet and weedy.
  p.shape(`M48 ${g + 2}C70 ${g - 6} 196 ${g - 8} 226 ${g}C236 ${g + 12} 230 ${g + 30} 214 238H60C46 ${g + 28} 42 ${g + 12} 48 ${g + 2}Z`, WASH.grey, 0.5, 1.4);
  p.fine(`M76 ${g + 10}l16 6M170 ${g + 6}l-12 10M128 ${g + 22}l10 -4`, 0.9, 0.5);
  for (const x of [60, 72, 196, 210]) p.shape(blade(x, 236, x + 4, 222, 2.6, 3), WASH.green, 0.5, 0.9);
  // The short tail tipped down, the far leg.
  p.shape('M92 166L66 180L94 178Z', SLATE, 0.6, 1.2);
  p.shape(`M152 186L156 186L158 ${g - 2}L154 ${g - 2}Z`, PIPER_LEG, 0.8, 1);
  p.line(`M156 ${g - 1}L168 ${g}M156 ${g - 1}L148 ${g}M156 ${g - 1}L162 ${g - 4}`, 1.1);
  // The round, hunched body, the pale belly under it, the sheen on the breast.
  p.shape('M86 158C86 126 116 108 148 108C178 108 198 128 198 154C198 178 178 192 146 192C114 192 86 182 86 158Z', SLATE, 0.55, 1.5);
  p.tint('M100 178C124 190 168 192 190 174C194 168 196 164 196 160C180 176 140 184 100 178Z', WASH.petal, 0.75);
  p.tint('M170 126C186 132 196 146 196 160C186 152 176 146 164 142Z', SHEEN, 0.5);
  p.fine('M176 164l-6 6M166 168l-6 6M186 166l-4 6', 1, 0.6);
  // The folded wing, its feathers edged pale, the thin white bar along it.
  p.shape('M100 144C122 130 158 128 180 140C174 160 152 172 126 172C110 172 100 164 96 156C96 150 97 147 100 144Z', SLATE, 0.6, 1.1);
  p.tint('M110 136C130 130 156 130 172 138C150 140 128 142 110 136Z', SHEEN, 0.45);
  p.shape('M106 160C126 156 150 154 170 148L172 152C152 159 128 163 108 164Z', WASH.petal, 0.8, 0.8);
  let edges = '';
  for (let i = 0; i < 6; i++) edges += `M${110 + i * 11} ${146 - i * 1.2}q5 4 10 0`;
  p.fine(edges, 0.9, 0.6);
  // The head pulled in close on the body, the pale ring round the eye, the long, drooped bill.
  p.oval(186, 118, 15, 13.5, SLATE, 0.55, 1.3);
  p.oval(191, 114, 3, 2.8, WASH.petal, 0.9, 0.7);
  p.dot(191.2, 114, 1.1);
  p.shape('M199 118C212 120 224 126 234 135C223 133 211 128 200 125Z', WASH.tip, 0.85, 1);
  p.tint('M199 118C204 119 208 120 211 121L201 124Z', PIPER_LEG, 0.8);
  // The near leg and its toes.
  p.shape(`M136 188L140 188L142 ${g - 2}L138 ${g - 2}Z`, PIPER_LEG, 0.8, 1);
  p.line(`M140 ${g - 1}L154 ${g + 1}M140 ${g - 1}L130 ${g}M140 ${g - 1}L146 ${g - 4}`, 1.2);
  p.label('bill', 250, 60, 228, 131);
  p.label('breast', 250, 116, 186, 140);
  p.label('wings', 250, 172, 140, 158);
  p.label('legs', 250, 228, 141, 198);
  p.scale(30, 108, g, scale);
  return p.svg(400, 260, 'Field sketch of a purple sandpiper hunched on a wet, weedy rock');
}

/**
 * European eel: a yellow eel lying in a slow S along the pond bed among the weed, its fin running
 * round the tail from the middle of its back, the pale yellow belly, the small eye on a flat head.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function eel(p, scale) {
  const f = p.f;
  p.tint('M40 96H236V244H40Z', WASH.water, 0.32);
  p.line(wave(40, 236, 96, 1.3, 26), 1.2);
  // The bed: soft mud and a few weed stems.
  p.tint('M40 214C90 208 170 218 236 210V244H40Z', WASH.mud, 0.35);
  p.line('M40 214C90 208 170 218 236 210', 1.2);
  for (const [x, h, b] of [[44, 96, 8], [54, 74, -6], [232, 88, -7]]) p.shape(blade(x, 214, x + b, 214 - h, 2.6, b), WASH.green, 0.45, 0.9);
  // The center line, head on the right, and the body's half width along it.
  /** @type {number[][]} */ const c = [];
  /** @type {number[]} */ const r = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    c.push([224 - s * 160, 168 + Math.sin(s * Math.PI * 3 - 0.3) * 24 * (0.45 + 0.55 * s)]);
    r.push(s < 0.08 ? 5.5 + (s / 0.08) * 3 : s < 0.33 ? 8.5 + ((s - 0.08) / 0.25) * 1 : 9.5 * (1 - 0.82 * ((s - 0.33) / 0.67)));
  }
  // The fin: along the back from a third of the way, under the belly from the middle, round the tail.
  const ramp = (/** @type {number} */ s, /** @type {number} */ from) => Math.max(0, Math.min(1, (s - from) / 0.08));
  const finR = (/** @type {number} */ i, /** @type {number} */ from) => r[i] + 4 * ramp(i / N, from);
  /** @type {number[][]} */ const back = [], belly = [];
  for (let i = 0; i <= N; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(N, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    back.push([c[i][0] + nx * finR(i, 0.33), c[i][1] + ny * finR(i, 0.33)]);
    belly.push([c[i][0] - nx * finR(i, 0.55), c[i][1] - ny * finR(i, 0.55)]);
  }
  const tip = c[N];
  const fin = `M${[...back, [tip[0] - 5, tip[1]], ...belly.reverse()].map((q) => `${f(q[0])} ${f(q[1])}`).join('L')}Z`;
  p.shape(fin, EEL_FIN, 0.55, 1);
  let rays = '';
  for (let i = 16; i < N; i += 2) rays += `M${f(c[i][0])} ${f(c[i][1] - r[i])}L${f(back[i][0])} ${f(back[i][1])}`;
  p.fine(rays, 0.6, 0.45);
  // The body over it, the pale belly along its lower side.
  p.shape(tube(c, r, f), EEL, 0.6, 1.4);
  p.tint(tube(c.slice(2, 26).map((q, j) => [q[0], q[1] + r[j + 2] * 0.45]), r.slice(2, 26).map((v) => v * 0.45), f), WASH.yellow, 0.7);
  // The line down its side.
  p.fine(`M${c.slice(4, 34).map((q) => `${f(q[0])} ${f(q[1] - 1)}`).join('L')}`, 0.7, 0.45);
  // The head: a small fin behind it, the small eye, the mouth.
  p.shape(`M${f(c[5][0])} ${f(c[5][1] + 3)}l-7 6l2 -8Z`, EEL_FIN, 0.6, 0.9);
  p.oval(c[1][0] - 1, c[1][1] - 2.4, 1.8, 1.6, WASH.gold, 0.9, 0.6);
  p.dot(c[1][0] - 0.8, c[1][1] - 2.4, 0.9);
  p.fine(`M${f(c[0][0] + 3)} ${f(c[0][1] + 1)}l-6 1.5`, 0.9, 0.8);
  p.label('head', 250, 70, c[1][0], c[1][1] - 6);
  p.label('belly', 250, 132, c[12][0], c[12][1] + r[12] * 0.6);
  p.label('fin', 250, 196, c[36][0], c[36][1] - 8);
  p.scale(30, 120, 214, scale);
  return p.svg(400, 252, 'Field sketch of a yellow European eel lying in an S along the pond bed among the weed');
}

/**
 * Teal: a drake side on, swimming to the right: the chestnut head with its green stripe back from
 * the eye, the small dark bill, grey flanks, the green patch on the wing, and the yellow patch
 * under the tail.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function teal(p, scale) {
  const w = 188;
  p.tint(`M40 ${w}H236V252H40Z`, WASH.water, 0.32);
  p.line(wave(40, 236, w, 1.3, 26), 1.2);
  p.fine(`M70 ${w + 14}C100 ${w + 10} 150 ${w + 16} 196 ${w + 11}M90 ${w + 28}C120 ${w + 25} 160 ${w + 30} 186 ${w + 26}`, 1, 0.45);
  // The tail cocked up behind.
  p.shape(`M78 ${w - 12}L54 ${w - 28}L60 ${w - 12}Z`, WASH.tip, 0.6, 1.1);
  // The body riding on the water, grey with fine lines.
  p.shape(`M70 ${w}C64 172 80 154 108 150C140 146 172 150 188 162C194 170 192 180 186 ${w}Z`, WASH.grey, 0.5, 1.5);
  p.fine('M100 168C120 164 150 164 176 170M96 176C120 172 150 172 180 178M92 183C120 180 150 180 182 185', 0.7, 0.45);
  // The yellow patch under the tail, edged in black.
  p.shape(`M70 ${w - 2}C74 176 82 172 92 174L90 ${w - 2}Z`, WASH.yellow, 0.75, 1.1);
  // The wing folded along the side: the white line above it and the green patch at its back.
  p.shape('M98 160C118 152 152 152 174 160C164 168 140 172 116 172C106 172 98 168 98 160Z', WASH.grey, 0.55, 1.1);
  p.shape('M104 158C124 152 150 152 168 156L168 158C150 155 124 156 104 161Z', WASH.petal, 0.8, 0.7);
  p.shape('M104 166C112 162 124 162 132 166L128 171C120 171 110 170 104 166Z', TEAL_GREEN, 0.75, 1);
  // The neck and the chestnut head, the green stripe sweeping back from the eye.
  p.shape('M168 158C170 148 174 140 182 134L198 150C190 156 180 160 168 158Z', TEAL_HEAD, 0.6, 1.2);
  p.shape('M174 146C170 128 182 116 198 116C212 116 220 126 218 138C216 146 208 150 198 152C188 154 178 154 174 146Z', TEAL_HEAD, 0.6, 1.3);
  p.shape('M200 130C190 128 182 132 176 142C184 140 192 140 202 136Z', TEAL_GREEN, 0.75, 0.9);
  p.fine('M202 136C206 140 206 146 202 150', 0.8, 0.6);
  p.oval(201, 129, 2.2, 2, WASH.tip, 0.9, 0.7);
  p.dot(201.3, 129, 1);
  // The small dark bill.
  p.shape('M216 132L232 137L230 142L215 140Z', WASH.tip, 0.85, 1);
  p.label('head', 250, 60, 196, 122);
  p.label('bill', 250, 116, 228, 139);
  p.label('speculum', 250, 172, 124, 168);
  p.label('tail', 250, 228, 80, 182);
  p.scale(30, 112, w, scale);
  return p.svg(400, 260, 'Field sketch of a drake teal swimming, its chestnut head striped with green');
}

/**
 * Grey seal: a cow hauled out on the sandbar, her head raised, the long straight Roman nose, her
 * grey coat blotched dark, the hind flippers together behind; once the pup has been seen, the pup
 * in its white coat lying beside her.
 * @param {import('./pen.js').Pen} p @param {string} [scale]
 */
export function seal(p, scale) {
  const g = 196;
  p.tint(`M40 ${g}H236V254H40Z`, WASH.sand, 0.4);
  p.line(`M40 ${g}C100 ${g - 2} 170 ${g + 2} 236 ${g - 1}`, 1.3);
  p.fine(`M60 ${g + 40}C90 ${g + 36} 130 ${g + 44} 170 ${g + 38}M180 ${g + 22}C200 ${g + 18} 214 ${g + 24} 230 ${g + 20}`, 0.9, 0.45);
  // The hind flippers, together, raised a little off the sand.
  p.shape(`M64 ${g - 6}L42 ${g - 20}L46 ${g - 11}L38 ${g - 6}L47 ${g - 3}L42 ${g + 3}L64 ${g - 1}Z`, SEAL_DARK, 0.55, 1.1);
  // The long body, the back rising to the shoulders.
  p.shape(`M60 ${g - 2}C66 176 98 164 136 160C160 156 178 152 190 144L212 164C208 180 196 ${g - 2} 176 ${g}H70C62 ${g} 58 ${g} 60 ${g - 2}Z`, SEAL, 0.55, 1.5);
  // Dark blotches over the coat.
  for (const [x, y, rx, ry] of [[88, 180, 5, 3], [106, 172, 7, 4], [128, 178, 4, 3], [146, 168, 6, 3.5], [166, 176, 5, 3], [120, 188, 4, 2.5], [180, 162, 4, 3]]) p.oval(x, y, rx, ry, SEAL_DARK, 0.55, 0.7);
  // The fore flipper on the sand.
  p.shape(`M150 ${g - 2}C154 ${g + 4} 166 ${g + 6} 174 ${g + 1}L166 186Z`, SEAL_DARK, 0.55, 1);
  p.fine(`M160 ${g + 3}l2 3M166 ${g + 3}l2 3`, 0.9, 0.7);
  // The head raised: the long, straight profile from brow to nose, the eye, the nostril, whiskers.
  p.shape('M182 152C184 134 194 120 206 117C214 115 222 119 229 126L243 137C245 141 241 145 235 146C227 147 219 149 213 156C207 164 194 166 186 162Z', SEAL, 0.55, 1.4);
  p.oval(211, 126, 2.6, 2.4, WASH.tip, 0.9, 0.8);
  p.dot(211.3, 126, 1.2);
  p.fine('M238 137l3 2M230 142C234 144 238 146 244 146M229 144C233 147 237 150 241 152', 0.8, 0.7);
  if (p.knows('pup')) {
    // The pup in its white coat, lying on the sand in front of her, its dark eye big.
    p.shape(`M84 ${g + 34}C86 ${g + 22} 104 ${g + 16} 124 ${g + 16}C140 ${g + 16} 150 ${g + 22} 150 ${g + 30}C150 ${g + 38} 138 ${g + 42} 120 ${g + 42}H92C86 ${g + 42} 84 ${g + 38} 84 ${g + 34}Z`, WASH.petal, 0.8, 1.3);
    p.shape(`M70 ${g + 36}L82 ${g + 30}L84 ${g + 40}Z`, WASH.petal, 0.8, 1);
    p.oval(156, g + 24, 11, 10, WASH.petal, 0.8, 1.2);
    p.oval(160, g + 21, 2.4, 2.4, WASH.tip, 0.9, 0.8);
    p.dot(160.2, g + 21, 1.2);
    p.fine(`M100 ${g + 26}C110 ${g + 22} 124 ${g + 22} 134 ${g + 26}`, 0.8, 0.4);
  }
  p.label('head', 250, 70, 228, 126);
  p.label('coat', 250, 128, 146, 168);
  p.label('flippers', 250, 186, 46, g - 10);
  p.label('pup', 250, 236, 124, g + 26);
  p.scale(30, 112, g, scale);
  return p.svg(400, 264, 'Field sketch of a grey seal hauled out on the sandbar, her head raised');
}
