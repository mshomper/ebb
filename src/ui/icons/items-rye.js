// @ts-check
// Item icons, part 6: the rye and the sickle (F20, Matt, November 1, 2026): the straw taken up from
// the stooks, the old sickle blade from the pot under the marker stone, and the sickle made from it.
// Same grid and stroke as items-made.js: straw as a bundle tied at its waist, the blade and the
// sickle as made things on the short shelf line.

import { A, both, TIE, BASE } from './item-draw.js';

/** @type {Record<string, [string, string]>} */
export const RYE = {
  // Rye straw: a long bundle of straight hollow stalks tied once, the cut ends square at both ends.
  'rye-straw': ['fibres', `<path d="M8.4 21.2L9.8 2.8M10.6 21.4L11.4 2.6M13.4 21.4L12.6 2.6M15.6 21.2L14.2 2.8M12 21.6V2.4"/>
    <path d="M8 21.2H16M9.4 2.6H14.6"/>${TIE}`],
  // The sickle blade: a curved iron blade on its own, the tang bare where a handle should go.
  'sickle-blade': ['made', `${both('d="M8.8 16.4C4.8 13.4 5 7.4 9.2 4.8C13.4 2.4 18.8 4.8 19.2 9.6C17.4 7 13.6 6.2 11.2 8C8.8 9.8 9 13.4 11 15.4Z"')}
    <path d="M9.8 16L8.2 18.6" stroke-dasharray="1 1.6"/>${BASE}`],
  // The sickle: the blade bound to a stick handle with cord.
  'sickle-tool': ['made', `${both('d="M9.6 14.6C5.6 11.8 5.6 6.2 9.6 3.8C13.6 1.4 18.8 3.6 19.2 8.2C17.4 5.8 13.8 5 11.4 6.8C9.2 8.6 9.4 12 11.4 13.8Z"')}
    <path d="M10.6 14.2L6 19.8"/><path ${A} d="M8.2 16.6L9.6 17.8L8.8 18.8L7.4 17.6Z"/><path d="M8.2 16.6L9.6 17.8M7.4 17.6L8.8 18.8"/>${BASE}`],
};

/** Their registry rows (item-registry.js): id, glyph, name, tier, phase. @type {[string, string, string, string, number][]} */
export const RYE_POUCH_ROWS = [['rye-straw', 'rye-straw', 'Rye straw', 'T3', 3], ['sickle-blade', 'sickle-blade', 'Sickle blade', 'T3', 3]];
/** @type {[string, string, string, string, number][]} */
export const RYE_MAKE_ROWS = [['sickle', 'sickle-tool', 'Sickle', 'T3', 3]];
