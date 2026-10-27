// @ts-check
// Item icons, part 2: what is made, dyed, kept and set out (F7; docs/future/13 sections 3.12, 6, 8
// and 9, docs/future/12). Each entry is [family, drawing] on the icons' 24 px grid. Family cues
// (item-draw.js): made things stand seen from the front on a short shelf line, dyes are a cloth
// hung to dry in their own colour, keepsakes rest on a little shelf, treats sit on a flat offering
// stone that carries the tint while the treat stays in ink.

import { A, A2, D, K, both, dot, ring, BASE, PLANK, STONE, radial, star } from './item-draw.js';

/** The dye palette (docs/future/13 section 9.2): id, name, the cloth's colour. */
export const DYES = Object.freeze([
  ['gorse-yellow', 'Gorse yellow', '#E3B84A'], ['bedstraw-red', 'Bedstraw red', '#B5533A'], ['woad-blue', 'Woad blue', '#4F6E96'],
  ['soft-olive', 'Soft olive', '#8A8F55'], ['berry-purple', 'Berry purple', '#7A4E78'], ['lichen-rust', 'Lichen rust', '#A6643A'],
  ['green', 'Green', '#5E8650'], ['warm-orange', 'Warm orange', '#D27A3C'], ['deep-purple', 'Deep purple', '#5A3F6E'],
  ['sea-green', 'Sea green', '#4F8A80'], ['dun', 'Dun', '#9C8A72'], ['slip-pale', 'Clay slip, pale', '#D9C3A5'], ['slip-dark', 'Clay slip, dark', '#4A4744'],
]);

/** A cloth hung on a line by two pegs, one drip below, in the dye's own colour. @param {string} c */
const cloth = (c) => `<path d="M3 4.6H21"/><path style="fill:${c}" stroke="none" d="M5.6 4.6H18.4V16.6C16.4 17.8 14.4 16.2 12 17.4S7.6 17.8 5.6 16.6Z"/>
  <path d="M5.6 4.6H18.4V16.6C16.4 17.8 14.4 16.2 12 17.4S7.6 17.8 5.6 16.6Z"/><path d="M8 3.2V6.4M16 3.2V6.4"/>
  <path style="fill:${c}" stroke="none" d="M12 18.8C11.2 19.8 10.9 20.4 10.9 20.9A1.1 1.1 0 0 0 13.1 20.9C13.1 20.4 12.8 19.8 12 18.8Z"/><path d="M12 18.8C11.2 19.8 10.9 20.4 10.9 20.9A1.1 1.1 0 0 0 13.1 20.9C13.1 20.4 12.8 19.8 12 18.8Z"/>`;

const POT_BODY = 'M4.6 9.6H19.4C20 11 20.4 13.6 19.4 16C18.6 18 16.6 19.6 14 19.6H10C7.4 19.6 5.4 18 4.6 16C3.6 13.6 4 11 4.6 9.6Z';

/** @type {Record<string, [string, string]>} */
export const MADE = {
  // ---- Made things and tools: from the front, on a short shelf line ----
  // Shovel: a stone blade lashed to a handle with a crosspiece grip.
  shovel: ['made', `<path d="M12 2.6V13.2M10.2 2.6H13.8M10.8 10.6L13.2 11.4M10.8 12L13.2 12.8"/>
    ${both('d="M8.4 13.4H15.6C16 13.4 16.2 13.8 16.1 14.2L15.2 18C14.9 19 14 19.6 13 19.6H11C10 19.6 9.1 19 8.8 18L7.9 14.2C7.8 13.8 8 13.4 8.4 13.4Z"')}${BASE}`],
  // The keeper's blade: a ground stone blade on its unwrapped cloth.
  'keepers-blade': ['made', `<path ${A2} d="M2.8 16.4L11.4 12.6L21.2 15.8L12.4 20.4Z"/><path d="M2.8 16.4L11.4 12.6L21.2 15.8L12.4 20.4Z"/>
    <g transform="rotate(-50 12 11)">${both('d="M10 3.6H14L16 14.6C16 16.4 14.2 17.4 12 17.4S8 16.4 8 14.6Z"')}<path d="M8.6 13.8C10 14.8 14 14.8 15.4 13.8"/></g>`],
  // Clam rake: a tined head lashed to a handle.
  'clam-rake': ['made', `<path d="M12 2.6V12.4M10.6 9.8L13.4 10.8"/><rect ${A} x="5" y="12.4" width="14" height="2.6" rx="1.2"/><rect x="5" y="12.4" width="14" height="2.6" rx="1.2"/>
    <path d="M6.6 15V19.2M9.4 15V19.6M12 15V19.8M14.6 15V19.6M17.4 15V19.2"/>`],
  // Fire steel: the C-shaped striker, a flint above it, sparks flying.
  'fire-steel': ['made', `<path d="M9.4 13.8H6C3.8 13.8 3.8 19 6 19H18C20.2 19 20.2 13.8 18 13.8H14.6"/>
    ${both('d="M7.4 11.2L9.4 4.8L13.8 6.4L13.2 11.4Z"')}${dot(16.6, 6, 0.85)}${dot(18.8, 8.8, 0.75)}${dot(18.6, 3.6, 0.65)}${BASE}`],
  // Lantern: a glass lantern on its ring, a small flame inside.
  lantern: ['made', `<path d="M10.2 4.2C10.2 2.6 13.8 2.6 13.8 4.2"/><path d="M8.6 6.4L10 4.2H14L15.4 6.4Z"/>
    ${both('d="M8.6 6.4H15.4V16.4H8.6Z"')}<path d="M12 9.4C11 10.6 10.8 11.6 10.8 12.4A1.2 1.2 0 0 0 13.2 12.4C13.2 11.6 13 10.6 12 9.4Z"/><path d="M8 16.4H16L15.4 18.6H8.6Z"/>${BASE}`],
  // Cooking pot: wide, pale and plain.
  'cooking-pot': ['made', `${both(`d="${POT_BODY}"`)}<path d="M3.6 9.6H20.4M5.4 9.6C5.4 8.6 6 8 7 8H17C18 8 18.6 8.6 18.6 9.6"/>${BASE}`],
  // Tea pot: small and lidded, with a spout and a handle, flecked with shell.
  'tea-pot': ['made', `${both('d="M7.4 10.6C5.6 12.4 5.6 17.6 8.6 19.6H15.4C18.4 17.6 18.4 12.4 16.6 10.6Z"')}
    <path d="M7.4 10.6H16.6M8.8 10.6C9 8.6 15 8.6 15.2 10.6M12 7.9V6.6M17.6 13.2C19.4 12.8 20.4 11.4 21 9.6M6.6 12C4.2 12 3.6 16.4 6.2 16.8"/>
    ${dot(10, 14.4, 0.55)}${dot(13.6, 15.6, 0.55)}${dot(11.6, 17.2, 0.55)}${dot(14.4, 13, 0.55)}${BASE}`],
  // Dye pot: deep, dark and stained down from the rim.
  'dye-pot': ['made', `<path ${D} d="M6.8 6.6H17.2C18.8 9.4 19 15.4 16.4 19.6H7.6C5 15.4 5.2 9.4 6.8 6.6Z"/><path d="M6.8 6.6H17.2C18.8 9.4 19 15.4 16.4 19.6H7.6C5 15.4 5.2 9.4 6.8 6.6Z"/>
    <path d="M5.6 6.6H18.4"/><path ${K} d="M14.4 8V11.6M10 8.2V9.6"/>${BASE}`],
  // The larger pot: tall and wide, with two lug handles.
  'larger-pot': ['made', `${both('d="M4.2 7.6H19.8C20.6 9.6 20.8 13.6 19.6 16.4C18.6 18.6 16.2 19.8 13.6 19.8H10.4C7.8 19.8 5.4 18.6 4.4 16.4C3.2 13.6 3.4 9.6 4.2 7.6Z"')}
    <path d="M3.2 7.6H20.8M4.2 10.4C2.6 10.4 2.6 12.8 4 13M19.8 10.4C21.4 10.4 21.4 12.8 20 13"/>`],
  // Fill the pot (the here bar at the spring): the cooking pot, a drop above it.
  'fill-pot': ['made', `${both('d="M4.6 11.2H19.4C20 12.4 20.4 14.6 19.4 16.6C18.6 18.4 16.6 19.6 14 19.6H10C7.4 19.6 5.4 18.4 4.6 16.6C3.6 14.6 4 12.4 4.6 11.2Z"')}
    <path d="M3.6 11.2H20.4"/><path d="M12 1.8C11 3.4 10.2 4.6 10.2 5.8A1.8 1.8 0 0 0 13.8 5.8C13.8 4.6 13 3.4 12 1.8Z"/><path d="M8.4 13.6C10.6 14.4 13.4 14.4 15.6 13.6" opacity=".6"/>${BASE}`],
  // Clay cup.
  cup: ['made', `${both('d="M6.6 9.4H15.4V14C15.4 17 13.4 19.6 11 19.6S6.6 17 6.6 14Z"')}<path d="M15.4 11C18.2 10.8 18.4 15.6 15.2 15.8"/>${BASE}`],
  // Clay bowl.
  bowl: ['made', `${both('d="M3.6 11.4H20.4C20.4 16.4 16.6 19.6 12 19.6S3.6 16.4 3.6 11.4Z"')}<path d="M3.6 11.4C5.8 9.8 18.2 9.8 20.4 11.4"/>${BASE}`],
  // Mortar and pebble: a hollowed stone, the pebble resting in it.
  mortar: ['made', `${both('d="M3.6 19.6C3.6 15.8 6.4 14.2 12 14.2S20.4 15.8 20.4 19.6Z"')}<path d="M7.6 15.6C9.4 16.8 14.6 16.8 16.4 15.6"/>
    <ellipse ${A} cx="14.4" cy="9.6" rx="2.4" ry="4.4" transform="rotate(35 14.4 9.6)"/><ellipse cx="14.4" cy="9.6" rx="2.4" ry="4.4" transform="rotate(35 14.4 9.6)"/>${BASE}`],
  // Sealed jar: its lid sealed with wax and tied.
  'sealed-jar': ['made', `${both('d="M7.6 8.8C5.6 10.2 5.4 17 7.6 19.6H16.4C18.6 17 18.4 10.2 16.4 8.8Z"')}<path d="M8.8 8.8V7H15.2V8.8"/>
    ${both('d="M8.2 7C8.2 4.6 15.8 4.6 15.8 7Z"')}<path d="M10 7V8.6M7.8 12H16.2"/>${BASE}`],
  // Clay lamp: a pinched saucer with a flame at its spout.
  'clay-lamp': ['made', `<g transform="translate(-1 0)">${both('d="M3.8 13.6H18.8L20.6 11.8C21 12.8 21 14 20.2 15.2C19 17.8 15.8 19.6 11.6 19.6S4.6 17.8 3.8 13.6Z"')}
    <path d="M6.6 13.6C7.6 12.4 13.6 12.4 15 13.6"/>${both('d="M20.4 10.4C19.4 9.2 19.6 7.4 20.8 6.2C21.2 7.6 22 8.4 21.6 9.8Z"')}</g>${BASE}`],
  // Dipped candles: a pair, joined by their wick.
  candles: ['made', `${both('d="M6.6 19.6L7.6 8.6H11L11.8 19.6Z"')}${both('d="M12.2 19.6L13 8.6H16.4L17.4 19.6Z"')}<path d="M9.3 8.6C9.3 4.8 14.7 4.8 14.7 8.6"/>${BASE}`],
  // Rush satchel: a woven bag with a flap and a strap (eight pouches).
  satchel: ['made', `<path d="M6.6 9C6.6 3 17.4 3 17.4 9"/>${both('d="M5 9H19V18C19 19 18.2 19.6 17.2 19.6H6.8C5.8 19.6 5 19 5 18Z"')}
    <path d="M5 9V12.4C9 14.2 15 14.2 19 12.4V9M12 13.6V15.2M8.6 15V18.4M15.4 15V18.4"/>${BASE}`],
  // Willow basket: woven, with a bowed handle (ten pouches).
  basket: ['made', `<path d="M6.6 10C6.6 3.2 17.4 3.2 17.4 10"/>${both('d="M4.4 10H19.6L17.8 18.4C17.6 19.2 17 19.6 16.2 19.6H7.8C7 19.6 6.4 19.2 6.2 18.4Z"')}
    <path d="M5.2 13.2H18.8M5.8 16.4H18.2"/><path d="M9 10V19.6M12 10V19.6M15 10V19.6" opacity=".6"/>${BASE}`],
  // The first pack: a soft cloth pack seen from the back, its flap tied down, two pouches at the foot (six pouches).
  pack: ['made', `<path d="M9 5.4C9 2.8 15 2.8 15 5.4"/>${both('d="M6.4 6.8C6.4 5.8 7.2 5.2 8.2 5.2H15.8C16.8 5.2 17.6 5.8 17.6 6.8V18.2C17.6 19 17 19.6 16.2 19.6H7.8C7 19.6 6.4 19 6.4 18.2Z"')}
    <path d="M6.4 10.4C9.6 11.8 14.4 11.8 17.6 10.4M12 11.4V13M7.8 15H11V18.4H7.8ZM13 15H16.2V18.4H13Z"/>${BASE}`],
  // The walker's hat: a tall soft cone tipping back, its wide brim drooping at the front, a band at its foot.
  hat: ['made', `${both('d="M8.4 14.2C9.4 10.8 10.6 7.4 12.8 4.4C13.8 3 15.6 2.6 17 3.6C15.4 4 14.6 5.4 14.6 7.2C14.6 9.4 15.4 12 15.8 14.2Z"')}
    <path d="M8.4 12.6H15.6"/><path d="M3 16.6C4.6 14.6 8 14 12 14S19.4 14.6 21 16.6C19.6 17.6 17 17.2 15.4 16.6C13.6 16.1 10.4 16.1 8.6 16.6C7 17.2 4.4 17.6 3 16.6Z"/>${BASE}`],
  // The walker's coat: long, on its shoulders, open down the front, a patch at one elbow.
  coat: ['made', `${both('d="M9.4 3.4L5.6 5.2L3.6 12.4L5.6 13.2L6.8 9.6V20.2H11.2L12 8.6L12.8 20.2H17.2V9.6L18.4 13.2L20.4 12.4L18.4 5.2L14.6 3.4C13.8 4.6 13 5.2 12 5.2S10.2 4.6 9.4 3.4Z"')}
    <path d="M9.4 3.4L12 8.6L14.6 3.4M8.4 14.4H10.2M13.8 14.4H15.6"/><rect x="3.9" y="9.6" width="2" height="2" rx=".5" transform="rotate(16 4.9 10.6)"/>`],
  // Driftwood frame: two bowed uprights and lashed crossbars, a flat stone shelf (twelve pouches).
  'driftwood-frame': ['made', `<path d="M7.6 3.2C8.2 8 6.8 14 6.2 20M16.4 3.2C15.8 8 17.2 14 17.8 20M7.4 7.6H16.6M7 12.6H17"/>
    <path d="M6.6 6.8L8.2 8.4M15.8 8.4L17.4 6.8M6.2 11.8L7.8 13.4M16.2 13.4L17.8 11.8"/><rect ${A} x="5.4" y="16.4" width="13.2" height="2.4" rx="1.2"/><rect x="5.4" y="16.4" width="13.2" height="2.4" rx="1.2"/>`],
  // Drying rack: forked posts, a crossbar, three bunches hung upside down.
  'drying-rack': ['made', `<path d="M5 21V5.8M19 21V5.8M5 6.2L3.6 3.8M5 6.2L6.4 3.8M19 6.2L17.6 3.8M19 6.2L20.4 3.8M3.8 6.6H20.2"/>
    ${[8.6, 12, 15.4].map((x) => `<path d="M${x} 6.6V8.4M${x - 0.8} 10H${x + 0.8}"/>${both(`d="M${x} 8.4L${(x - 1.6).toFixed(1)} 15H${(x + 1.6).toFixed(1)}Z"`)}`).join('')}`],
  // Workbench: a flat stone slab on two stones.
  workbench: ['made', `${both('d="M3 10.6H21V13.4H3Z"')}<path d="M5.4 13.4C4.4 15.4 4.6 18.8 6.4 19.6H9.2C10.8 18.8 10.8 15.4 10 13.4M14 13.4C13.2 15.4 13.2 18.8 14.8 19.6H17.6C19.4 18.8 19.6 15.4 18.6 13.4"/>
    <path d="M7 10.6V8.6H10.4V10.6M14.6 10.6C14.6 9 15.6 8 17 8"/>${BASE}`],
  // Apothecary bench: a plank on legs, a jar and the mortar on it.
  apothecary: ['made', `${both('d="M3 11.4H21V13.8H3Z"')}<path d="M5.6 13.8V20M18.4 13.8V20"/>
    <path d="M6.4 11.4V8.4C6.4 7.6 7 7 7.8 7H9.6C10.4 7 11 7.6 11 8.4V11.4M6.8 7V5.8H10.6V7M13 9C13 11 14.4 11.4 16 11.4S19 11 19 9ZM17.6 9L19.4 6"/>`],
  // Hearth stones: three standing stones, embers glowing between them.
  'hearth-stones': ['made', `${both('d="M3.6 19.6C3.4 16 4.6 13.4 6.6 13.4S9.6 16 9.4 19.6Z"')}${both('d="M14.6 19.6C14.4 16 15.6 13.4 17.6 13.4S20.6 16 20.4 19.6Z"')}
    ${both('d="M9.6 14.4C9.4 11.4 10.6 9.4 12.2 9.4S15 11.4 14.6 14.4Z"')}${dot(11.2, 17.6, 0.8)}${dot(12.8, 16.6, 0.7)}${dot(12.2, 18.8, 0.7)}${BASE}`],
  // Wood store: two forked stakes and a crossbar over a stack of logs.
  'wood-store': ['made', `<path d="M4.6 20.6V7.4M19.4 20.6V7.4M4.6 7.8L3.2 5.6M4.6 7.8L6 5.6M19.4 7.8L18 5.6M19.4 7.8L20.8 5.6M3.6 8.4H20.4"/>
    ${[[8.2, 18.4], [12, 18.4], [15.8, 18.4], [10.1, 15], [13.9, 15], [12, 11.6]].map(([x, y]) => ring(x, y, 1.8)).join('')}`],
  // Stone pile: a heap of stones in a scrape ringed by edging stones.
  'stone-pile': ['made', `<ellipse cx="12" cy="18.2" rx="9" ry="2.6" stroke-dasharray="2.2 1.8"/>
    ${[[8.8, 16.6, 2.6, 1.9], [14.6, 16.8, 2.8, 2], [11.6, 13.2, 2.6, 2], [16.4, 13.6, 1.8, 1.5]].map(([x, y, rx, ry]) => `<ellipse ${A} cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`).join('')}`],
  // Clay slab: a flat slab, a lump of clay on it.
  'clay-slab': ['made', `<path d="M3.4 17.4L6 14.6H18L20.6 17.4ZM3.4 17.4V19.2H20.6V17.4"/>
    ${both('d="M8.2 14.8C8.2 11.6 9.8 10 12 10S15.8 11.6 15.6 14.8Z"')}<path d="M10.6 12.4C11.4 11.8 12.6 11.8 13.2 12.6"/>`],
  // Log seat: a short log, its top worn flat for sitting.
  'log-seat': ['made', `<rect ${A} x="3" y="11.4" width="18" height="7.4" rx="3.2"/><rect x="3" y="11.4" width="18" height="7.4" rx="3.2"/>
    <circle cx="17.6" cy="15.1" r="1.6"/><path d="M5.6 13.4H14.4M6 16.4H13"/>${BASE}`],
  // Gift stone: a flat stone with a feather and a pebble left on it.
  'gift-stone': ['made', `${both('d="M3.6 19.4C4 16.6 6.6 15.4 12 15.4S20 16.6 20.4 19.4Z"')}
    <path ${A2} d="M7.4 15C7.8 11.4 10 8.8 13 7.8C12.6 11.2 10.4 13.8 7.4 15Z"/><path d="M7.4 15C7.8 11.4 10 8.8 13 7.8C12.6 11.2 10.4 13.8 7.4 15ZM6.6 16L12.2 9.4"/>
    <ellipse cx="16.2" cy="13.8" rx="2.2" ry="1.5"/>${BASE}`],
  // Bird-bath stone: a hollowed stone holding water, a small bird on its rim.
  'bird-bath': ['made', `${both('d="M3.4 14.2C3.4 18 7 20 12 20S20.6 18 20.6 14.2Z"')}<path d="M3.4 14.2C5.4 12.6 18.6 12.6 20.6 14.2M7 14.4C9.4 15.2 14.6 15.2 17 14.4"/>
    <path ${A2} d="M14.4 12.4C14.2 10.4 15.4 9 17 9.2L18.8 8L18.6 9.8C19.4 10.6 19 12 17.8 12.4Z"/><path d="M14.4 12.4C14.2 10.4 15.4 9 17 9.2L18.8 8L18.6 9.8C19.4 10.6 19 12 17.8 12.4Z"/>`],
  // Bee water dish: a clay saucer with pebbles standing out of its water.
  'bee-dish': ['made', `${both('d="M3.6 14.6C4.2 17.8 7.4 19.6 12 19.6S19.8 17.8 20.4 14.6Z"')}<path d="M3.6 14.6C6 13.2 18 13.2 20.4 14.6"/>
    <ellipse cx="8.6" cy="13.8" rx="1.8" ry="1.3"/><ellipse cx="12.8" cy="13.2" rx="1.6" ry="1.2"/><ellipse cx="16.2" cy="14" rx="1.4" ry="1"/><path d="M6 16.6H9M12.4 17H16" opacity=".6"/>${BASE}`],
  // Net stakes: three sharpened willow stakes, a cord slung between them.
  'net-stakes': ['made', `<path d="M6 20.6V5.4M12 20.6V3.8M18 20.6V5.4M6 8C8 9.6 10 9.6 12 8C14 9.6 16 9.6 18 8"/>
    <path ${A} d="M4.8 5.4L6 3.2L7.2 5.4ZM10.8 3.8L12 1.8L13.2 3.8ZM16.8 5.4L18 3.2L19.2 5.4Z"/><path d="M4.8 5.4L6 3.2L7.2 5.4ZM10.8 3.8L12 1.8L13.2 3.8ZM16.8 5.4L18 3.2L19.2 5.4Z"/>${BASE}`],
  // Mending coil: a coil of cord hung on a peg, its loose end trailing.
  'mending-coil': ['made', `<path d="M12 2.6V5.4"/>${ring(12, 12, 6.6)}<circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="2.2"/><path d="M16.6 16.8C17.6 18.4 18.8 19.6 20.6 20.2"/>`],
  // Driftwood floats: three floats threaded on a cord.
  floats: ['made', `<path d="M2.5 12C6 13.4 18 13.4 21.5 12"/>
    ${[3.6, 9.7, 15.8].map((x) => `<rect ${A} x="${x}" y="10" width="4.6" height="5" rx="1.8"/><rect x="${x}" y="10" width="4.6" height="5" rx="1.8"/>`).join('')}${BASE}`],
  // Grooved sinker stones: two stones with cord tied round their grooves.
  'sinker-stones': ['made', `<path d="M7 4.6H19M9 4.6V11M16.4 4.6V14"/>
    <ellipse ${A} cx="9" cy="14.6" rx="4.4" ry="3.6"/><ellipse cx="9" cy="14.6" rx="4.4" ry="3.6"/><path d="M4.8 14.2C7 15.6 11 15.6 13.2 14.2"/>
    <ellipse ${A} cx="16.4" cy="16.8" rx="3" ry="2.6"/><ellipse cx="16.4" cy="16.8" rx="3" ry="2.6"/><path d="M13.6 16.6C15 17.6 17.8 17.6 19.2 16.6"/>${BASE}`],
  // Hedgehog house: a dome of sticks and leaves with a low doorway.
  'hedgehog-house': ['made', `${both('d="M3.6 19.6C3.6 12.8 7.4 8.4 12 8.4S20.4 12.8 20.4 19.6Z"')}
    <path ${D} d="M9.6 19.6V17C9.6 15.6 10.6 14.6 12 14.6S14.4 15.6 14.4 17V19.6Z"/><path d="M9.6 19.6V17C9.6 15.6 10.6 14.6 12 14.6S14.4 15.6 14.4 17V19.6"/>
    <path d="M6 12.2L9.2 9.6M15 9.6L18.2 12.2M12 8.4V5.8M7.4 15.6L5.8 14.8M16.6 15.6L18.2 14.8"/>${BASE}`],
  // Seed balls: three balls of clay and soil, seeds showing, one sprouting.
  'seed-balls': ['made', `${ring(7.4, 16, 3)}${ring(15.4, 16.2, 3)}${ring(11.4, 10.6, 3)}
    ${dot(6.6, 15.4, 0.55)}${dot(8.2, 16.8, 0.55)}${dot(14.6, 15.4, 0.55)}${dot(16.2, 17, 0.55)}${dot(10.6, 10.2, 0.55)}${dot(12.4, 11.4, 0.55)}
    <path d="M11.4 7.6V5.6M11.4 6.4C12.2 5.4 13.2 5.2 14 5.6"/>${BASE}`],
  // Shell wind chime: shells hung on threads from a short stick.
  'wind-chime': ['made', `<path d="M4 4.6H20M7 4.6V10.8M12 4.6V13.8M17 4.6V9.8"/>
    ${[[7, 10.8, 1], [12, 13.8, 1.3], [17, 9.8, 1]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})" stroke-width="${(1.75 / s).toFixed(2)}">${both('d="M-2.2 3.2C-2.2 1.2 -1.2 0 0 0S2.2 1.2 2.2 3.2Z"')}<path d="M0 0.2V3M-1.2 0.6L-1 3M1.2 0.6L1 3"/></g>`).join('')}`],

  // ---- Dyes: a cloth hung to dry in its own colour ----
  ...Object.fromEntries(DYES.map(([id, , c]) => [`dye-${id}`, ['dyes', cloth(c)]])),

  // ---- Keepsakes: resting on a little shelf ----
  shell: ['keep', `${both('d="M5 19.4C4.4 14.8 7.6 11 12 11C15.8 11 18.6 13.6 19 19.4Z"')}
    <path d="M12 11C13.8 8.6 16.4 8.2 17.6 9.6C18.4 10.6 18 12.2 16.4 12.6C15 13 13.8 12 14.2 11"/><path d="M8 19.4C8 16.6 9.8 14.6 12.2 14.6C14 14.6 15.2 15.8 15.4 17.4"/>${PLANK}`],
  'keep-driftwood': ['keep', `${both('d="M3.6 17C7 15 11.4 14.4 15 15C17.4 15.4 19.2 15 20.6 14L21 16.2C19.2 17.4 17.2 17.8 14.8 17.4C11.2 16.8 7.2 17.4 4.2 19Z"')}
    <path d="M9.6 15.2L8.6 12L10 11.6"/><circle cx="15.8" cy="16.2" r=".6"/>${PLANK}`],
  'keep-stone': ['keep', `<ellipse ${A} cx="12" cy="15" rx="8" ry="4.6"/><ellipse cx="12" cy="15" rx="8" ry="4.6"/><ellipse cx="14.4" cy="14.2" rx="1.9" ry="1.3"/>
    <path d="M5.6 12.6C7.6 14.4 8.8 16.6 9.2 19.4"/>${PLANK}`],
  fossil: ['keep', `${ring(12, 12.4, 7)}
    <path d="M12 12.4C12 11.4 13.4 11.2 13.8 12.2C14.4 13.6 12.8 15 11.2 14.6C9.2 14 9 11.2 10.6 10C12.6 8.4 15.8 9.4 16.4 12C17 15 14.6 17.6 11.6 17.4"/>
    <path d="${radial(12, 12.4, 5.6, 7, 14)}" opacity=".7"/>${PLANK}`],
  feather: ['keep', `${both('d="M6.8 17.8C6.6 12.8 10.6 7.4 18.6 4.4C18.4 9.8 13.8 15.4 6.8 17.8Z"')}<path d="M4.4 20C8.4 15.2 13.4 9.4 18.6 4.4M12.6 12.4L15.2 12"/>${PLANK}`],
  bottle: ['keep', `${both('d="M10.2 6.8V4.6H13.8V6.8C13.8 8 17 9.2 17 12V18.8C17 19.3 16.6 19.6 16.1 19.6H7.9C7.4 19.6 7 19.3 7 18.8V12C7 9.2 10.2 8 10.2 6.8Z"')}
    <path d="M9.6 4.6H14.4M9.8 12.6H14.2V16.8H9.8ZM9.8 14.7H14.2"/>${PLANK}`],
  'drift-seed': ['keep', `${both('d="M6.2 9C9 6.4 15.4 6.6 18 9.8C20 12.4 19.4 16.4 16.4 18C14 19.2 11.8 17.8 10.6 16.2C9.6 14.8 8 14.8 6.6 14.6C4.4 14.2 4.2 10.8 6.2 9Z"')}
    <path d="M7.6 10.4C10 8.6 14.6 8.8 16.4 11.2C17.6 12.8 17.4 15 16 16"/>${PLANK}`],
  starfish: ['keep', `<path ${A} d="${star(12, 12.4, 3.2, 8.2, 5)}"/><path d="${star(12, 12.4, 3.2, 8.2, 5)}"/>${PLANK}`],
  urchin: ['keep', `${both('d="M4 19.4C4 13.2 7.6 9.6 12 9.6S20 13.2 20 19.4Z"')}
    <path d="M8 19.4C8 15.2 9.6 12.4 12 10.8M16 19.4C16 15.2 14.4 12.4 12 10.8M12 19.4V10.4" stroke-dasharray="0.1 2.2"/>${PLANK}`],
  purse: ['keep', `${both('d="M7.6 8.6H16.4V16H7.6Z"')}
    <path d="M7.6 8.6C6 7.8 5.4 5.8 6.6 4.8C7.4 4.2 8.4 4.8 8 5.6M16.4 8.6C18 7.8 18.6 5.8 17.4 4.8C16.6 4.2 15.6 4.8 16 5.6M7.6 16C6 16.8 5.4 18.8 6.8 19.4M16.4 16C18 16.8 18.6 18.8 17.2 19.4"/>${PLANK}`],
  bivalve: ['keep', `${both('d="M12 18.6L5 9.8C6.8 6.6 9.2 5.2 12 5.2S17.2 6.6 19 9.8Z"')}
    <path d="M12 18.6L8.2 6.6M12 18.6V5.4M12 18.6L15.8 6.6M12 18.6L6.2 8.4M12 18.6L17.8 8.4M10 18.6H14"/>${PLANK}`],
  coral: ['keep', `${both('d="M8.2 19.6C8.4 18 10 17.2 12 17.2S15.6 18 15.8 19.6Z"')}
    <path d="M12 17.2V13.6C12 11 9.6 10 9.6 7M12 13.6C12 11.4 14.6 10.4 14.6 7.6M9.6 9.6C8 9 7 7.6 7 5.6M14.6 9.8C16.2 9.2 17.2 7.8 17.2 6M9.6 7V4.8M14.6 7.6V5.2"/>${PLANK}`],
  cuttlebone: ['keep', `${both('d="M4 13.6C4 10.6 8 8.8 12.4 8.8C16.8 8.8 20.4 10.8 20.4 13.6S16.8 18.4 12.4 18.4C8 18.4 4 16.6 4 13.6Z"')}
    <path d="M17 10.2C15.6 11.8 15.6 15.4 17 17M14 9.2C12.4 11.4 12.4 15.8 14 18M4 13.6H2.8"/>${PLANK}`],
  artifact: ['keep', `${both('d="M7.4 17.4C7.4 15.6 8 14.6 8 11.6C8 8.8 9.8 7 12 7S16 8.8 16 11.6C16 14.6 16.6 15.6 16.6 17.4Z"')}
    <path d="M6.6 17.4H17.4M11 7C11 5.4 13 5.4 13 7"/>${dot(12, 18.8, 1)}${PLANK}`],
  sherd: ['keep', `${both('d="M4.4 9.4C8.6 7.6 15.4 7.6 19.6 9.4L18 18.6C14.6 17.2 9.4 17.2 6 18.6Z"')}
    <path d="M6.6 9.2C7 10.4 8.6 10.4 9 9M10.4 8.6C10.8 9.8 12.4 9.8 12.8 8.6M14.2 8.8C14.6 10 16.2 10 16.6 9"/><path d="M7.4 13.2H16.6" stroke-dasharray="0.1 2.3"/>${PLANK}`],

  // ---- Treats and offerings: on a flat offering stone ----
  worms: ['treats', `${STONE}<path d="M4.6 15.2C6 12.4 8.8 12.2 10 14.4S13.6 17.2 15 14.6C16 12.8 18 12.2 19.6 13.6"/><path d="M7 10.2C8 8.2 10.4 7.8 11.6 9.4S14.6 11.2 16 9.6"/>
    <path d="M8.2 12.8L8.8 14M15.2 13.6L16.2 14.4M9.6 8.6L10.4 9.6"/>${dot(19.6, 13.6, 0.8)}${dot(16, 9.6, 0.7)}`],
  'lily-leaf': ['treats', `${STONE}<path ${A2} d="M12 10.6L10.6 4.4C6.6 4.8 4.4 7 4.4 10.2C4.4 13.6 7.6 16 12 16S19.6 13.6 19.6 10.2C19.6 7 17.4 4.8 13.4 4.4Z"/>
    <path d="M12 10.6L10.6 4.4C6.6 4.8 4.4 7 4.4 10.2C4.4 13.6 7.6 16 12 16S19.6 13.6 19.6 10.2C19.6 7 17.4 4.8 13.4 4.4Z"/>
    <path d="M12 10.6L6.6 9M12 10.6L6.8 13.4M12 10.6V15M12 10.6L17.2 13.4M12 10.6L17.4 9"/>`],
  pondweed: ['treats', `${STONE}<path d="M4.6 15.4C7 13.8 9 16.4 11.4 14.8S15.6 13.4 19.4 15M5.4 11.2C7.8 9.6 9.8 12.2 12.2 10.6S16.4 9.2 19 10.8"/>
    <path ${A2} d="M8 14.6C7.4 12.8 8 11.4 9.4 10.8C9.8 12.4 9.4 13.8 8 14.6Z"/><path d="M8 14.6C7.4 12.8 8 11.4 9.4 10.8C9.8 12.4 9.4 13.8 8 14.6Z"/>
    <path ${A2} d="M15.4 13.8C16 12 15.4 10.4 14 9.8C13.6 11.4 14 13 15.4 13.8Z"/><path d="M15.4 13.8C16 12 15.4 10.4 14 9.8C13.6 11.4 14 13 15.4 13.8Z"/>
    <path d="M11.6 6.6C12.6 7.8 12.6 9 11.8 10.4"/>`],
  'leaf-pack': ['treats', `${STONE}<path ${A2} d="M12 16.4C8.6 15 5.6 11.6 5.4 7.4C9 8.4 11.4 11.6 12 16.4Z"/><path d="M12 16.4C8.6 15 5.6 11.6 5.4 7.4C9 8.4 11.4 11.6 12 16.4Z"/>
    <path ${A2} d="M12 16.4C15.4 15 18.4 11.6 18.6 7.4C15 8.4 12.6 11.6 12 16.4Z"/><path d="M12 16.4C15.4 15 18.4 11.6 18.6 7.4C15 8.4 12.6 11.6 12 16.4Z"/>
    <path ${A2} d="M12 16.4C10.4 12.6 10.6 7.8 12 4C13.4 7.8 13.6 12.6 12 16.4Z"/><path d="M12 16.4C10.4 12.6 10.6 7.8 12 4C13.4 7.8 13.6 12.6 12 16.4Z"/><path d="M8.6 12.4L15.4 14.2M8.4 14.2L15.6 12.4"/>`],
  'seed-cake': ['treats', `${STONE}<path ${A2} d="M5 10.6C5 8.6 8.2 7.2 12 7.2S19 8.6 19 10.6V13.6C19 15.6 15.8 17 12 17S5 15.6 5 13.6Z"/>
    <path d="M5 10.6C5 8.6 8.2 7.2 12 7.2S19 8.6 19 10.6V13.6C19 15.6 15.8 17 12 17S5 15.6 5 13.6Z"/><path d="M5 10.6C5 12.6 8.2 14 12 14S19 12.6 19 10.6"/>
    ${[[9, 10.2], [11.6, 9.2], [14.4, 10], [12.4, 11.6], [16, 11.2], [8.6, 12]].map(([x, y]) => dot(x, y, 0.65)).join('')}`],
  'wrack-heap': ['treats', `${STONE}<path ${A2} d="M5.4 17.6C6 14.2 9 12.2 12 12.2S18 14.2 18.6 17.6Z"/><path d="M5.4 17.6C6 14.2 9 12.2 12 12.2S18 14.2 18.6 17.6"/>
    <circle cx="8.8" cy="15.4" r="1"/><circle cx="12.4" cy="14.4" r="1"/><circle cx="15.4" cy="15.8" r="1"/>
    ${[[8.6, 8.2], [12.4, 6.2], [15.6, 8.8], [10.6, 10]].map(([x, y]) => `${dot(x, y, 0.75)}<path d="M${(x - 1.3).toFixed(1)} ${(y - 1).toFixed(1)}L${(x - 0.5).toFixed(1)} ${(y - 0.4).toFixed(1)}M${(x + 1.3).toFixed(1)} ${(y - 1).toFixed(1)}L${(x + 0.5).toFixed(1)} ${(y - 0.4).toFixed(1)}" stroke-width="1.1"/>`).join('')}`],
  // Perch stick: a bare stick stood up for dragonflies, one resting at its tip.
  'perch-stick': ['treats', `${STONE}<path d="M12 18.6V6.6M12 12.4L15.4 9.2M12 15L9.6 13"/>
    <path d="M9.4 5H15M11.6 5L10.2 3M12.8 5L14.2 3"/><circle cx="15.6" cy="5" r=".7"/>`],
  // Beetle bait: fallen leaves and bruised berries under a stick.
  'beetle-bait': ['treats', `${STONE}<path ${A2} d="M4.8 17.4C5.4 14.2 8.4 12.6 11.4 13.2C10.6 16.4 7.8 17.8 4.8 17.4Z"/><path d="M4.8 17.4C5.4 14.2 8.4 12.6 11.4 13.2C10.6 16.4 7.8 17.8 4.8 17.4ZM4.8 17.4L9.6 14.6"/>
    <circle cx="14" cy="16" r="1.8"/><circle cx="17.2" cy="16.4" r="1.6"/><path d="M3.8 11.4L20.2 9.6"/>`],
  // Spraint stone: a flat marking stone at a stream mouth, a pebble left on it.
  'spraint-stone': ['treats', `${STONE}<path ${A2} d="M5.4 17.6C5.8 14.6 8.4 13.2 12 13.2S18.2 14.6 18.6 17.6Z"/><path d="M5.4 17.6C5.8 14.6 8.4 13.2 12 13.2S18.2 14.6 18.6 17.6"/>
    ${dot(9.4, 15.6, 0.7)}${dot(11.2, 14.8, 0.6)}<ellipse cx="14.8" cy="11.6" rx="1.9" ry="1.3"/><path d="M4 9.4C5.6 8.4 7 8.4 8.6 9.4S11.6 10.4 13.2 9.4"/>`],
};
