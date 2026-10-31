// @ts-check
// The item icons (F7; approved by Matt on October 23, 2026, from the sheet in the session notes): one
// drawn glyph for every item and item set the roadmap names, in twelve families. A family shares
// one drawing cue and one tint from the brand palette, carried by the glyph's fill (--fam).
//
// The rule: the glyph says what a thing is; a small round chip in a button's corner says where it
// goes (chipSvg): the pouch (Gather, Take up), a pile (Set down), the offering stone (Set out), the
// pot. Pouches on the bar show their glyph standing in the mouth over the four fullness looks
// (itemPouchSvg). Which kind wears which glyph is src/ui/icons/item-registry.js.
//
// Composed glyphs, named '<rule>:<base>', are built on demand from another drawing:
//   seed:<base>     the plant (its species chip from icons.js, or its part glyph), small, seeds falling
//   clump:<base>    the plant over a root ball
//   dried:<herb>    the herb's glyph hung upside down from a loop (a bunch on the drying rack)
//   offered:<item>  the item, small, on the treats' offering stone
// The base keeps the house 20 percent ink and the composite's own part carries the family tint.

import { iconBody, ICON_NAMES } from './icons.js';
import { A, A2, CUT, STONE, placed } from './item-draw.js';
import { GATHERED } from './items-gathered.js';
import { MADE } from './items-made.js';
import { CAMP } from './items-camp.js';
import { METAL } from './items-metal.js';

/** The families: name, palette tint (null: the glyph carries its own colour), and the shared cue. */
export const FAMILIES = Object.freeze({
  fuel: { name: 'Fuel', tint: '#B39579', cue: 'laid on a rising slant' },
  stones: { name: 'Stones', tint: '#A9B4BE', cue: 'resting on a ground line' },
  fibres: { name: 'Fibres and cord', tint: '#E3B36E', cue: 'a bundle tied once at its waist' },
  herbs: { name: 'Herbs and flowers', tint: '#9DBB8B', cue: 'one picked stem, cut on a slant' },
  berries: { name: 'Berries and nuts', tint: '#E2A39B', cue: "held in a bowl's curve" },
  earth: { name: 'Earth', tint: '#D9BF97', cue: 'a heap on the ground' },
  sea: { name: 'Sea', tint: '#8FB3C2', cue: 'above a wave line' },
  seeds: { name: 'Seeds and clumps', tint: '#F2CF72', cue: "the plant's own chip with seeds falling, or over a root ball" },
  made: { name: 'Made things and tools', tint: '#E9B9A0', cue: 'from the front, on a short shelf line' },
  dyes: { name: 'Dyes', tint: null, cue: 'a cloth hung to dry, in its own colour' },
  keep: { name: 'Keepsakes', tint: '#F3D3B5', cue: 'resting on a little shelf' },
  treats: { name: 'Treats and offerings', tint: '#B8A9CC', cue: 'set out on a flat offering stone' },
});

/** @type {Record<string, [string, string]>} */
const ITEMS = { ...GATHERED, ...MADE, ...CAMP, ...METAL };

/** Names of every drawn item glyph (composites not included). */
export const ITEM_ICON_NAMES = Object.freeze(Object.keys(ITEMS));

const seedDrop = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r) =>
  `<g transform="translate(${x} ${y}) rotate(${r})"><path ${A} d="M0 -2.1C1.3 -0.6 1.3 1.2 0 1.9C-1.3 1.2 -1.3 -0.6 0 -2.1Z"/><path d="M0 -2.1C1.3 -0.6 1.3 1.2 0 1.9C-1.3 1.2 -1.3 -0.6 0 -2.1Z"/></g>`;

/** A drawing used as the base of a composite, its tint turned back to the house ink. @param {string} base */
function baseBody(base) {
  const own = ITEMS[base];
  if (own) return own[1].split(A).join(A2);
  if (ICON_NAMES.includes(base)) return iconBody(base);
  return ITEMS.seedhead[1].split(A).join(A2);
}

/** The composite rules: name prefix -> [family of the result, or null for the base's, builder]. */
const COMPOSE = {
  seed: ['seeds', (/** @type {string} */ b) => `${placed(baseBody(b), 0.4, 0.2, 0.74)}${seedDrop(17.2, 14.2, 25)}${seedDrop(20, 18, -15)}${seedDrop(15.4, 19.4, 50)}`],
  clump: ['seeds', (/** @type {string} */ b) => `${placed(baseBody(b), 4.6, 0, 0.62)}<path ${A} d="M7.4 12.9C7.4 17 9.4 19.2 12 19.2S16.6 17 16.6 12.9Z"/><path d="M7.4 12.9C7.4 17 9.4 19.2 12 19.2S16.6 17 16.6 12.9"/><path d="M9.8 18.6L8.8 21.2M12 19.2V21.6M14.2 18.6L15.2 21.2M9.4 15.2L10.6 16.4M13.8 14.4L14.8 15.6"/>`],
  dried: [null, (/** @type {string} */ b) => `<path d="M12 1.6C13.4 1.6 13.8 3.4 12 4C10.2 3.4 10.6 1.6 12 1.6ZM12 4V6.2M10.6 6.2H13.4"/><g transform="rotate(180 12 13.4)">${(ITEMS[b]?.[1] ?? '').split(CUT).join('')}</g>`],
  offered: ['treats', (/** @type {string} */ b) => `${STONE}${placed(baseBody(b), 4.1, 1.2, 0.66)}`],
};

/**
 * Is this a glyph the item icons can draw (a drawn one, or a composite of a known rule)?
 * @param {string} name
 */
export function hasItemIcon(name) {
  if (ITEMS[name]) return true;
  const [rule, base] = name.split(':');
  return !!base && rule in COMPOSE && (rule !== 'dried' || !!ITEMS[base]);
}

/** The family a glyph belongs to. @param {string} name @returns {keyof typeof FAMILIES} */
export function itemFamily(name) {
  if (ITEMS[name]) return /** @type {any} */ (ITEMS[name][0]);
  const [rule, base] = name.split(':');
  const c = COMPOSE[/** @type {keyof typeof COMPOSE} */ (rule)];
  return /** @type {any} */ (c?.[0] ?? (base && ITEMS[base]?.[0]) ?? 'seeds');
}

/** A glyph's family tint, or currentColor for the dyes. @param {string} name */
export const itemTint = (name) => FAMILIES[itemFamily(name)].tint ?? 'currentColor';

/** A glyph's drawing on the 24 px grid, composites built from their base. @param {string} name */
export function itemIconBody(name) {
  if (ITEMS[name]) return ITEMS[name][1];
  const [rule, base] = name.split(':');
  const c = COMPOSE[/** @type {keyof typeof COMPOSE} */ (rule)];
  return c && base ? c[1](base) : '';
}

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
const SPRITE_ID = 'ebb-item-sprite';
const symbolId = (/** @type {string} */ name) => `i-item-${name.replace(/[^a-z0-9.-]/gi, '--')}`;
const symbol = (/** @type {string} */ name) => `<symbol id="${symbolId(name)}" viewBox="0 0 24 24"><g ${STROKE}>${itemIconBody(name)}</g></symbol>`;

/** Inject the hidden item sprite (every drawn glyph) into document.body once. Safe to call again. */
export function ensureItemSprite() {
  const existing = document.getElementById(SPRITE_ID);
  if (existing) return existing;
  const holder = document.createElement('div');
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" id="${SPRITE_ID}" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">${ITEM_ICON_NAMES.map(symbol).join('')}</svg>`;
  const sprite = /** @type {Element} */ (holder.firstElementChild);
  document.body.prepend(sprite);
  return sprite;
}

/** Make sure a glyph's symbol is in the sprite (composites are added the first time they are used). @param {string} name */
function ensureSymbol(name) {
  if (typeof document === 'undefined') return;
  const sprite = ensureItemSprite();
  if (!document.getElementById(symbolId(name)) && hasItemIcon(name)) {
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.innerHTML = symbol(name);
    if (holder.firstElementChild) sprite.appendChild(holder.firstElementChild);
  }
}

/**
 * Markup for one item glyph, as a string for innerHTML:
 * `<svg class="icon item-icon" style="--fam:#..."><use href="#i-item-NAME"/></svg>`. Size and ink come
 * from CSS (`.icon` width/height, `color`), as for icons.js. Set `--icon-bg` on a container whose
 * background is not cream, for the few cracks drawn across a dark fill.
 * @param {string} name a drawn glyph or a composite ('seed:thrift') @param {string} [extraClass]
 */
export function itemIconSvg(name, extraClass = '') {
  if (!hasItemIcon(name)) console.warn(`[items] unknown item icon "${name}"`);
  ensureSymbol(name);
  return `<svg class="icon item-icon${extraClass ? ` ${extraClass}` : ''}" style="--fam:${itemTint(name)}" aria-hidden="true" focusable="false"><use href="#${symbolId(name)}"/></svg>`;
}

/**
 * A pouch on the bar holding a kind: its glyph standing in the pouch's mouth (about 0.9 of the
 * drawing's width, so 27 px in a 40 px drawing), over the four fullness looks of docs/future/13 K-03.
 * The fuller it is, the higher the glyph rides; full is tied, the glyph in front of the tie. An empty
 * pouch, or no glyph, lies flat and blank. Set `--icon-bg` to the bar's colour: the pouch's cloth is
 * filled with it so its mouth hides the glyph's foot.
 * @param {string | null} name the glyph @param {number} stage 0 flat, 1 a few, 2 half, 3 full and tied
 */
export function itemPouchSvg(name, stage) {
  const g = '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
  const acc = 'fill="currentColor" fill-opacity="0.2" stroke="none"';
  if (!name || stage <= 0) {
    return `<svg class="ebb-pouch__svg" viewBox="0 0 32 32" aria-hidden="true">${g}<path ${acc} d="M4 26C9 22.5 23 22.5 28 26C25 29 7 29 4 26Z"/><path d="M4 26C9 22.5 23 22.5 28 26C25 29 7 29 4 26Z"/><path d="M9 25.6C13 24.6 19 24.6 23 25.6"/></g></svg>`;
  }
  ensureSymbol(name);
  const look = [
    null,
    { y: 7.4, body: 'M8 25.4C6.2 27.8 7.6 30.8 16 30.8S25.8 27.8 24 25.4', mouth: '<ellipse cx="16" cy="25.4" rx="8" ry="1.8"/>', fill: 'M8 25.4C6.2 27.8 7.6 30.8 16 30.8S25.8 27.8 24 25.4C20.4 27.2 11.6 27.2 8 25.4Z' },
    { y: 3.6, body: 'M8.4 21.8C5.4 24.8 5.8 30.8 16 30.8S26.6 24.8 23.6 21.8', mouth: '<ellipse cx="16" cy="21.8" rx="7.6" ry="1.8"/>', fill: 'M8.4 21.8C5.4 24.8 5.8 30.8 16 30.8S26.6 24.8 23.6 21.8C20 23.6 12 23.6 8.4 21.8Z' },
    { y: -0.4, body: 'M12.4 20.6C6 21.8 5.2 30.8 16 30.8S26 21.8 19.6 20.6', mouth: '<path d="M12.4 20.6C14.6 21.4 17.4 21.4 19.6 20.6M19.4 21.2L23 23.4"/>', fill: 'M12.4 20.6C6 21.8 5.2 30.8 16 30.8S26 21.8 19.6 20.6C17.4 21.4 14.6 21.4 12.4 20.6Z' },
  ][Math.min(3, stage)];
  if (!look) return '';
  const glyph = `<use href="#${symbolId(name)}" x="5.2" y="${look.y}" width="21.6" height="21.6"/>`;
  const bag = `${g}<path style="fill:var(--icon-bg,#2b3431)" stroke="none" d="${look.fill}"/><path ${acc} d="${look.fill}"/><path d="${look.body}"/>${look.mouth}</g>`;
  return `<svg class="ebb-pouch__svg" viewBox="0 0 32 32" aria-hidden="true" style="--fam:${itemTint(name)};overflow:visible">${stage >= 3 ? bag + glyph : glyph + bag}</svg>`;
}

/** The chips: a solid picture of where a thing goes, drawn in the chip's ground colour on a disc. */
const CHIPS = {
  pack: '<path class="chip-f" d="M9.6 10.8C4.6 12 4.4 19.8 12 19.8S19.4 12 14.4 10.8C13 11.4 11 11.4 9.6 10.8Z"/><path class="chip-s" d="M10.2 10.4L8.4 5.6M12 10.6V5.2M13.8 10.4L15.6 5.6M14.6 11.2L18.2 13.2"/>',
  pile: '<circle class="chip-f" cx="7.8" cy="15.8" r="3.4"/><circle class="chip-f" cx="16.2" cy="15.8" r="3.4"/><circle class="chip-f" cx="12" cy="9" r="3.4"/>',
  offer: '<path class="chip-f" d="M3.6 16.6C7 14 17 14 20.4 16.6C17 19.2 7 19.2 3.6 16.6Z"/><circle class="chip-f" cx="8.6" cy="12.4" r="2"/><circle class="chip-f" cx="12.6" cy="11.4" r="2"/><circle class="chip-f" cx="16" cy="12.8" r="1.8"/>',
  pot: '<path class="chip-f" d="M5.6 10H16.4C17.2 11.6 17.4 14.2 16.4 16.2C15.6 18 13.6 19.4 11 19.4S6.4 18 5.6 16.2C4.6 14.2 4.8 11.6 5.6 10ZM4.4 7.4H17.6V9.2H4.4Z"/><path class="chip-s" d="M16.8 12.6L20.2 9.8"/>',
};

/** Which chip an action wears: where it sends the thing. */
export const CHIP_FOR = Object.freeze({ gather: 'pack', takeup: 'pack', setdown: 'pile', setout: 'offer', pot: 'pot' });

/**
 * A destination chip, for a button's corner (about 18 px in a 48 px button, 15 px on the here bar).
 * The disc is the ink colour (currentColor); the picture is drawn in `--chip-fg` (default cream), so
 * on a filled main button set `--chip-fg` to the button's colour. Place it in the corner with a
 * 2 px ring of the button's colour around it (box-shadow), so it parts from the glyph.
 * @param {keyof typeof CHIPS} dest
 */
export function chipSvg(dest) {
  return `<svg class="item-chip" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="currentColor"/>`
    + `<g style="fill:var(--chip-fg,#F4EEE4);stroke:var(--chip-fg,#F4EEE4)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${CHIPS[dest].replace(/class="chip-f"/g, 'stroke="none"').replace(/class="chip-s"/g, 'fill="none"')}</g></svg>`;
}

/** The chip names. */
export const CHIP_NAMES = Object.freeze(Object.keys(CHIPS));
