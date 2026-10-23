// @ts-check
// Shared pieces for the item icons (F7, docs/future/13 section 4; the approved sheet of October 23,
// 2026): the fill attributes, each family's drawing cue, and small path generators. Same grid and
// stroke as icons.js: 24 px, 2 px padding, stroke 1.75, round caps and joins, currentColor.

/** The family fill: the family's palette tint (--fam, set on the icon by items.js), solid. */
export const A = 'style="fill:var(--fam,currentColor);fill-opacity:var(--fam-op,1)" stroke="none"';
/** The house accent: ink at 20 percent, for a second shape that should not take the tint. */
export const A2 = 'fill="currentColor" fill-opacity="0.2" stroke="none"';
/** A dark fill for black things (charcoal, King Alfred's cakes, the dye pot). */
export const D = 'fill="currentColor" fill-opacity="0.7" stroke="none"';
/** A knockout stroke in the colour behind the icon (--icon-bg), for cracks across a dark fill. */
export const K = 'style="stroke:var(--icon-bg,#fffaf0)"';

const f = (/** @type {number} */ n) => +n.toFixed(2);

/** A shape drawn twice: filled with the family tint, then outlined. @param {string} attrs */
export const both = (attrs) => `<path ${A} ${attrs}/><path ${attrs}/>`;
/** A small solid dot. @param {number} x @param {number} y @param {number} [r] */
export const dot = (x, y, r = 0.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
/** A tinted, outlined circle. @param {number} x @param {number} y @param {number} r */
export const ring = (x, y, r) => `<circle ${A} cx="${x}" cy="${y}" r="${r}"/><circle cx="${x}" cy="${y}" r="${r}"/>`;

// Family cues: each family's glyphs share one of these.
/** Stones (and the earth's heaps) rest on a ground line. */
export const GROUND = '<path d="M2.5 20.5H21.5"/>';
/** Herbs: one picked stem, its foot cut on a slant. */
export const CUT = '<path d="M10.4 21.5L13.6 19.9"/>';
/** Berries and nuts sit in a bowl's curve. */
export const BOWL = '<path d="M3 16.8C4.6 21.4 19.4 21.4 21 16.8"/>';
/** Sea things lie above a wave line. */
export const WAVE = '<path d="M2.5 20.5C4 19.4 5.5 19.4 7 20.5S10 21.6 11.5 20.5S14.5 19.4 16 20.5S19 21.6 21.5 20.3"/>';
/** Fibres: a bundle tied once at its waist; the tie carries the tint. */
export const TIE = `<path ${A} d="M8.2 11.6C10.6 12.2 13.4 12.2 15.8 11.6V14C13.4 14.6 10.6 14.6 8.2 14Z"/><path d="M8.2 11.6C10.6 12.2 13.4 12.2 15.8 11.6M8.2 14C10.6 14.6 13.4 14.6 15.8 14"/>`;
/** Made things stand on a short shelf line. */
export const BASE = '<path d="M7.5 21.2H16.5"/>';
/** Keepsakes rest on a little shelf. */
export const PLANK = '<path d="M3.5 20.6H20.5M6.2 20.6V22M17.8 20.6V22"/>';
/** Treats are set out on a flat offering stone, which carries the tint. */
export const STONE = `<path ${A} d="M3.5 19.8C6 18 18 18 20.5 19.8C18 21.6 6 21.6 3.5 19.8Z"/><path d="M3.5 19.8C6 18 18 18 20.5 19.8C18 21.6 6 21.6 3.5 19.8Z"/>`;

/**
 * A flower outline of n rounded petals between radii r1 and r2.
 * @param {number} cx @param {number} cy @param {number} r1 @param {number} r2 @param {number} n @param {number} [rot]
 */
export function petals(cx, cy, r1, r2, n, rot = 0) {
  let s = '';
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const t = rot + i * step;
    const p = (/** @type {number} */ r, /** @type {number} */ a) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
    s += `${i ? 'L' : 'M'}${p(r1, t - step / 2)}C${p(r2 * 1.15, t - step * 0.32)} ${p(r2 * 1.15, t + step * 0.32)} ${p(r1, t + step / 2)}`;
  }
  return s + 'Z';
}

/** Short spokes between radii r1 and r2. @param {number} cx @param {number} cy @param {number} r1 @param {number} r2 @param {number} n @param {number} [rot] */
export function radial(cx, cy, r1, r2, n, rot = 0) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const t = rot + (i * Math.PI * 2) / n;
    s += `M${f(cx + r1 * Math.cos(t))} ${f(cy + r1 * Math.sin(t))}L${f(cx + r2 * Math.cos(t))} ${f(cy + r2 * Math.sin(t))}`;
  }
  return s;
}

/** A pointy-topped hexagon. @param {number} cx @param {number} cy @param {number} r */
export function hex(cx, cy, r) {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const t = Math.PI / 6 + (i * Math.PI) / 3;
    s += `${i ? 'L' : 'M'}${f(cx + r * Math.cos(t))} ${f(cy + r * Math.sin(t))}`;
  }
  return s + 'Z';
}

/** A star of n points between radii r1 (inner) and r2. @param {number} cx @param {number} cy @param {number} r1 @param {number} r2 @param {number} n */
export function star(cx, cy, r1, r2, n) {
  let s = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r1 : r2, t = -Math.PI / 2 + (i * Math.PI) / n;
    s += `${i ? 'L' : 'M'}${f(cx + r * Math.cos(t))} ${f(cy + r * Math.sin(t))}`;
  }
  return s + 'Z';
}

/**
 * Another drawing scaled into this one, with its stroke widened so the whole icon keeps one weight.
 * @param {string} body @param {number} x @param {number} y @param {number} s
 */
export const placed = (body, x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke-width="${f(1.75 / s)}">${body}</g>`;
