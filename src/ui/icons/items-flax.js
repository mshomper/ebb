// @ts-check
// Item icons, part 5: flax and linen (F1, Matt, October 30, 2026): the flax stems pulled on the
// meadow islet, the fibre lifted out of the pond after steeping, and the cloth woven from it at the
// workbench. Same grid and stroke as items-made.js: fibres as a bundle tied at its waist, the cloth
// a made thing folded on the short shelf line.

import { A, A2, both, TIE, BASE } from './item-draw.js';

/** @type {Record<string, [string, string]>} */
export const FLAX = {
  // Flax stems: a bundle of straight straw stems tied once, roots at the foot, two seed bolls at the top.
  'flax-stems': ['fibres', `<path d="M9.4 21.2L10.4 3.6M12 21.2V3.2M14.6 21.2L13.6 3.6M7.6 20.8L9.6 4.6M16.4 20.8L14.4 4.6"/>
    <path d="M8.6 21.2L7.4 22.2M12 21.2V22.4M15.4 21.2L16.6 22.2"/>
    <circle ${A2} cx="10" cy="3.2" r="1.4"/><circle cx="10" cy="3.2" r="1.4"/><circle ${A2} cx="14" cy="3.2" r="1.4"/><circle cx="14" cy="3.2" r="1.4"/>${TIE}`],
  // Flax fibre: a soft hank of long fibre, looped over and twisted at its top, the ends loose below.
  'flax-fibre': ['fibres', `${both('d="M9.4 4.4C7.6 8 7.2 14 8.4 20.4H15.6C16.8 14 16.4 8 14.6 4.4Z"')}
    <path d="M10.6 6.4C10 10 10 15 10.6 20.4M13.4 6.4C14 10 14 15 13.4 20.4M12 5.6V20.4" opacity=".55"/>
    <path d="M9.4 4.4C10.2 2.8 13.8 2.8 14.6 4.4"/><path d="M8.4 20.4L7.6 21.6M15.6 20.4L16.4 21.6"/>`],
  // Linen cloth: a folded length of woven cloth on the shelf line, the weave showing on its face.
  'cloth': ['made', `${both('d="M4.6 12.4H19.4V19.6H4.6Z"')}${both('d="M5.6 8H18.4L19.4 12.4H4.6Z"')}
    <path d="M7.4 14.6H16.6M7.4 17H16.6M8.4 12.4V19.6M12 12.4V19.6M15.6 12.4V19.6" opacity=".45"/>
    <path ${A} d="M5.6 8C5 6.6 5.8 5.6 7 6H17C18.2 5.6 19 6.6 18.4 8"/><path d="M5.6 8C5 6.6 5.8 5.6 7 6H17C18.2 5.6 19 6.6 18.4 8"/>${BASE}`],
};

/** Their registry rows (item-registry.js): id, glyph, name, tier, phase. @type {[string, string, string, string, number][]} */
export const FLAX_POUCH_ROWS = [['flax-fibre', 'flax-fibre', 'Flax fibre', 'T3', 3], ['cloth', 'cloth', 'Linen cloth', 'T3', 3]];
/** @type {[string, string, string, string, number][]} */
export const FLAX_PART_ROWS = [['flax.stems', 'flax-stems', 'Flax stems', 'T3', 3]];
