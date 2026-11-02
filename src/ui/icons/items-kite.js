// @ts-check
// Item icons, part 6: the kite (docs/future/20, 'The kite'): the torn kite washed in on the islet's
// strand, carried in a pouch to the workbench, and the mended kite made there. Same grid and stroke
// as items-made.js, on the made family's short shelf line.

import { A, A2, both, BASE } from './item-draw.js';

/** @type {Record<string, [string, string]>} */
export const KITE = {
  // The mended kite: a diamond of cloth on crossed sticks, a short bow tail, standing on the shelf line.
  'kite': ['made', `${both('d="M12 2.6L17.4 8.2L12 16.4L6.6 8.2Z"')}<path d="M12 2.6V16.4M6.6 8.2H17.4"/>
    <path d="M12 16.4C11.2 17.6 12.8 18.2 12 19.4"/><path d="M10.6 17.6L11.6 18M12.4 18.8L13.4 19.2"/>${BASE}`],
  // The torn kite: the same frame with a corner of its cloth gone, the line in a loose tangle beside it.
  'torn-kite': ['made', `${both('d="M12 2.6L17.4 8.2L12 9.8L9.4 15.2L6.6 8.2Z"')}<path ${A2} d="M12 9.8L17.4 8.2L12 16.4Z"/>
    <path d="M12 2.6V16.4M6.6 8.2H17.4"/><path d="M15.6 13.6C18.6 12.2 20.6 15 18.4 16.4C16.4 17.6 15.8 14.8 18.2 14.4"/>${BASE}`],
};

/** Their registry rows (item-registry.js): id, glyph, name, tier, phase. @type {[string, string, string, string, number][]} */
export const KITE_POUCH_ROWS = [['torn-kite', 'torn-kite', 'A torn kite', 'T3', 3]];
/** @type {[string, string, string, string, number][]} */
export const KITE_MAKE_ROWS = [['kite', 'kite', 'Kite', 'T3', 3]];
