// @ts-check
// Item icons, part 4: the underground spring's ores and what the clay furnace makes of them, and
// the dock's first parts (the spring-ore plan, Matt, October 30, 2026): deep clay, iron ore (black
// sand), copper ore (green-flecked pebbles), iron and copper, nails, twisted sticks and planks; the
// clay furnace and the old keeper's pan. Same grid and stroke as items-made.js: the earths as a heap
// on the ground, the made things from the front on the short shelf line.

import { A, A2, D, both, dot, GROUND, BASE } from './item-draw.js';

/** A square nail, head up, leaning: x, y the head, deg its lean. @param {number} x @param {number} y @param {number} deg */
const nail = (x, y, deg) => `<g transform="rotate(${deg} ${x} ${y})"><path ${A} d="M${x - 1.6} ${y}H${x + 1.6}V${y + 1.3}H${x - 1.6}Z"/>
  <path d="M${x - 1.6} ${y}H${x + 1.6}V${y + 1.3}H${x - 1.6}Z"/><path d="M${x - 0.7} ${y + 1.3}L${x} ${y + 9.6}L${x + 0.7} ${y + 1.3}"/></g>`;

/** @type {Record<string, [string, string]>} */
export const METAL = {
  // Deep clay: a dark, dense slab cut square off the spade, its cut face smooth, on the ground.
  'deep-clay': ['earth', `<path ${D} d="M4.4 19.6L5.6 11.4C8.6 10.2 15.4 10.2 18.4 11.4L19.6 19.6Z"/><path d="M4.4 19.6L5.6 11.4C8.6 10.2 15.4 10.2 18.4 11.4L19.6 19.6Z"/>
    <path d="M5.6 11.4C8.6 12.6 15.4 12.6 18.4 11.4" opacity=".6"/><path d="M8 15.4C10 16 14 16 16 15.4" opacity=".45"/>${GROUND}`],
  // Iron ore: a heap of black sand, a few heavy grains rolled off its foot.
  'iron-ore': ['earth', `<path ${D} d="M3.5 19.5C5.5 13.6 8.6 11 12 11S18.5 13.6 20.5 19.5Z"/><path d="M3.5 19.5C5.5 13.6 8.6 11 12 11S18.5 13.6 20.5 19.5Z"/>
    ${dot(4.2, 17.6, 0.7)}${dot(20.2, 17.2, 0.7)}${dot(18.6, 15.2, 0.55)}${GROUND}`],
  // Copper ore: three small pebbles, each flecked with the green the copper gives.
  'copper-ore': ['earth', `${both('d="M3.8 19.6C3.8 16.8 5.8 15.2 8.2 15.2S12.4 16.8 12.4 19.6Z"')}${both('d="M11 19.6C11 16.2 13.2 14.4 16 14.4S20.8 16.2 20.8 19.6Z"')}
    ${both('d="M8.4 14.2C8.4 11.6 10.2 10 12.4 10S16.2 11.6 16.2 14.2C14 13.6 10.4 13.6 8.4 14.2Z"')}
    <circle ${A2} cx="7" cy="17.6" r="0.9"/>${dot(7, 17.6, 0.55)}${dot(15.2, 17, 0.55)}${dot(17.6, 18.2, 0.5)}${dot(12.6, 12, 0.55)}${GROUND}`],
  // Iron: a dull bloom hammered into a rough, flat-topped lump, a hammer mark across it.
  'iron': ['made', `${both('d="M5 19.6L6.2 13.6C7.4 11.8 9.6 11 12 11S16.6 11.8 17.8 13.6L19 19.6Z"')}
    <path d="M8.4 14.4L11.2 15.8M13 13.6L15.8 15.2" opacity=".55"/>${dot(9.6, 17.6, 0.6)}${dot(14.6, 17.8, 0.6)}${BASE}`],
  // Copper: a small round button of cast copper, its rim and the cooled dimple in its face.
  'copper': ['made', `${both('d="M5 18.2C5 14.6 8.2 12 12 12S19 14.6 19 18.2C19 19.4 18 20 16.8 20H7.2C6 20 5 19.4 5 18.2Z"')}
    <path d="M8.6 15.6C10 14.8 14 14.8 15.4 15.6" opacity=".6"/>${BASE}`],
  // Nails: a handful of square nails, heads up, fanned.
  'nails': ['made', `${nail(7.4, 7.2, -16)}${nail(12, 6.2, 0)}${nail(16.6, 7.2, 16)}${BASE}`],
  // Twisted sticks: two sticks wound round each other, bound at both ends.
  'twisted-sticks': ['fuel', `<g transform="rotate(-38 12 12)"><path d="M2.6 11C5 9 7.2 15 9.6 13S14.2 9 16.6 11S19.8 13 21.4 12"/>
    <path d="M2.6 13C5 15 7.2 9 9.6 11S14.2 15 16.6 13S19.8 11 21.4 12"/>
    <rect ${A} x="3.4" y="10.2" width="2.2" height="3.6" rx=".6"/><rect x="3.4" y="10.2" width="2.2" height="3.6" rx=".6"/>
    <rect ${A} x="18.4" y="10.2" width="2.2" height="3.6" rx=".6"/><rect x="18.4" y="10.2" width="2.2" height="3.6" rx=".6"/></g>`],
  // Planks: a short plank of twisted sticks laid side by side, a nailed batten across.
  'planks': ['made', `${both('d="M4 9.6H20V17.6H4Z"')}<path d="M4 12.3H20M4 15H20" opacity=".55"/>
    <path ${A2} d="M10.6 8.4H13.4V18.8H10.6Z"/><path d="M10.6 8.4H13.4V18.8H10.6Z"/>${dot(12, 10.6, 0.6)}${dot(12, 16.6, 0.6)}${BASE}`],
  // The clay furnace: a waist-high clay chimney narrowing upward, its round-topped tapping arch at
  // the foot, a clay air pipe on one side, a ring of flat stones round it.
  'clay-furnace': ['made', `${both('d="M6.4 19.6L8.2 6.4C8.4 5.4 9.4 4.8 12 4.8S15.6 5.4 15.8 6.4L17.6 19.6Z"')}
    <path ${D} d="M10.2 19.6V17.4C10.2 16.2 11 15.4 12 15.4S13.8 16.2 13.8 17.4V19.6Z"/><path d="M10.2 19.6V17.4C10.2 16.2 11 15.4 12 15.4S13.8 16.2 13.8 17.4V19.6"/>
    <path d="M7.6 11.2C10.4 11.8 13.6 11.8 16.4 11.2M7.1 15C10.4 15.6 13.6 15.6 16.9 15" opacity=".45"/>
    <path d="M17.2 16.4H20.4V18.2H17.4"/><path d="M3.4 20.4H20.6"/>${dot(12, 6.2, 0.7)}`],
  // The old keeper's pan: a shallow round pan tipped toward you, riffles on its side, black sand in its well.
  'keepers-pan': ['made', `${both('d="M3 12.8C3 10.4 7 8.8 12 8.8S21 10.4 21 12.8C21 16.8 17 19.6 12 19.6S3 16.8 3 12.8Z"')}
    <path d="M3 12.8C3 15 7 16.6 12 16.6S21 15 21 12.8" opacity=".6"/><path d="M5.4 15.2L6.4 14.6M7.4 16.6L8.4 16M15.6 16L16.6 16.6M17.6 14.6L18.6 15.2" opacity=".7"/>
    ${dot(11, 13.6, 0.6)}${dot(12.8, 14, 0.6)}${dot(12, 12.8, 0.5)}`],
};

/** Their registry rows (item-registry.js): id, glyph, name, tier, phase. @type {[string, string, string, string, number][]} */
export const METAL_POUCH_ROWS = [
  ['deep-clay', 'deep-clay', 'Deep clay', 'T3', 3], ['iron-ore', 'iron-ore', 'Iron ore', 'T3', 3], ['copper-ore', 'copper-ore', 'Copper ore', 'T3', 3],
  ['iron', 'iron', 'Iron', 'T3', 3], ['copper', 'copper', 'Copper', 'T3', 3], ['nails', 'nails', 'Nails', 'T3', 3],
  ['twisted-sticks', 'twisted-sticks', 'Twisted sticks', 'T3', 3], ['planks', 'planks', 'Planks', 'T3', 3],
];
/** @type {[string, string, string, string, number][]} */
export const METAL_MAKE_ROWS = [['clay-furnace', 'clay-furnace', 'Clay furnace', 'T3', 3], ['keepers-pan', 'keepers-pan', "The old keeper's pan", 'T3', 3]];

