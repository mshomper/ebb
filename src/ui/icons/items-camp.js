// @ts-check
// Item icons, part 3: the camp store and the forager's trail things (docs/future/13 section 3.12
// and P2j; doc 13 "Trails", the forager's stops), drawn with their models (tools/assets/made). Made
// things, so seen from the front on the short shelf line; the one shape that carries the meaning
// takes the family tint. Same grid and stroke as items-made.js.

import { A, A2, both, dot, BASE } from './item-draw.js';

/** A hamper body's rush rows: two lines across it. @param {number} x0 @param {number} x1 @param {number[]} ys */
const rows = (x0, x1, ys) => ys.map((y) => `<path d="M${x0} ${y}H${x1}" opacity=".55"/>`).join('');

/** @type {Record<string, [string, string]>} */
export const CAMP = {
  // The camp store: a lidded rush hamper, a rush loop on its lid.
  'camp-store': ['made', `${both('d="M5.4 10.4H18.6L17.8 18.4C17.7 19.2 17.1 19.6 16.4 19.6H7.6C6.9 19.6 6.3 19.2 6.2 18.4Z"')}
    ${rows(6, 18, [13.4, 16.4])}<rect ${A2} x="4.2" y="7.6" width="15.6" height="2.8" rx="1.2"/><rect x="4.2" y="7.6" width="15.6" height="2.8" rx="1.2"/>
    <path d="M10.4 7.6C10.4 5.2 13.6 5.2 13.6 7.6"/>${BASE}`],
  // The grown store: two hampers stacked, a lid of willow withies arched over the top.
  'camp-store-grown': ['made', `${both('d="M5.6 14H18.4L17.8 18.6C17.7 19.2 17.2 19.6 16.6 19.6H7.4C6.8 19.6 6.3 19.2 6.2 18.6Z"')}
    ${both('d="M6.2 8.4H17.8L17.3 13.2C17.2 13.6 16.9 14 16.4 14H7.6C7.1 14 6.8 13.6 6.7 13.2Z"')}${rows(6.6, 17.4, [16.8])}${rows(7, 17, [11.2])}
    <path d="M5 8.4C8 5.8 16 5.8 19 8.4H5Z"/><path d="M9 6.9V8.4M12 6.4V8.4M15 6.9V8.4" opacity=".7"/>${BASE}`],
  // The gathering knife: a short blade rising to its point, a handle bound with cord at the bolster.
  'gathering-knife': ['made', `<g transform="rotate(-38 12 13)">${both('d="M12.2 11.6H17.6C19.4 11.6 20.8 12 21.4 12.6C19.4 13.6 15.8 14.6 12.2 14.6Z"')}
    <rect ${A2} x="3.4" y="11.4" width="8.8" height="3.4" rx="1.6"/><rect x="3.4" y="11.4" width="8.8" height="3.4" rx="1.6"/><path d="M10.4 11.4V14.8M9 11.4V14.8"/></g>${BASE}`],
  // The seed scoop: a horn split along its length into a curved trough, seed in its mouth, a thong through the tip.
  'seed-scoop': ['made', `${both('d="M6.4 6C7.4 11.4 11.2 16.4 18.8 18.4L18 13.8C13 12.8 9.4 9.8 7.6 5.4Z"')}
    <path d="M8.6 8.6C10.4 12 13.4 14.6 17.6 15.8" opacity=".6"/><circle cx="6.6" cy="4.2" r="1.5"/>${dot(16.4, 16.6, 0.75)}${dot(14.4, 15.8, 0.75)}${BASE}`],
  // The tea caddy: a round tin with a slip-on lid and a pressed bead round its middle.
  'tea-caddy': ['made', `${both('d="M7.2 9.6H16.8V18.6C16.8 19.2 16.4 19.6 15.8 19.6H8.2C7.6 19.6 7.2 19.2 7.2 18.6Z"')}
    <rect ${A2} x="6.4" y="6.2" width="11.2" height="3.6" rx="1"/><rect x="6.4" y="6.2" width="11.2" height="3.6" rx="1"/><path d="M7.2 14.4H16.8M8.8 11.6V13" />${BASE}`],
  // The walking stick: a hazel thumbstick, forked at the top for the thumb.
  'walking-stick': ['made', `${both('d="M11.2 20.6L11.3 8.8L8.4 3.6L9.8 2.8L12 7L14.2 2.8L15.6 3.6L12.7 8.8L12.8 20.6Z"')}${BASE}`],
  // The pressing frame: a small frame split by a cross into four panes, a pressed flower in each, hung by a cord.
  'pressing-frame': ['made', `<path d="M6.4 8L12 3.2L17.6 8"/><rect ${A2} x="4.6" y="8" width="14.8" height="12.6" rx="0.8"/><rect x="4.6" y="8" width="14.8" height="12.6" rx="0.8"/>
    <path d="M12 8V20.6M4.6 14.3H19.4"/>${[[8.3, 11.6], [15.7, 11.6], [8.3, 17.9], [15.7, 17.9]].map(([x, y]) => `<path d="M${x} ${y + 1.4}V${y - 0.4}"/><circle ${A} cx="${x}" cy="${y - 1.2}" r="1.1"/><circle cx="${x}" cy="${y - 1.2}" r="1.1"/>`).join('')}`],
  // The nest box (docs/future/15 slice 4): an open box of sticks, rushes spilling over its rim, an egg in the hollow.
  'nest-box': ['made', `${both('d="M4.6 12.4H19.4L18.4 19.6H5.6Z"')}<path d="M5 14.8H19M5.3 17.2H18.7" opacity=".55"/>
    <path d="M4.6 12.4C6 10.4 7.6 11.6 9 10.4S12 11 13.4 10.2S16.6 11.2 19.4 12.4"/><path d="M10.4 11.4C10.4 9.4 11.2 8.2 12.2 8.2S14 9.4 14 11"/>${BASE}`],
  // The hen's perch (docs/future/15 slice 3): two forked sticks in the ground, a bar laid across their forks.
  'hen-perch': ['made', `<rect ${A2} x="3.6" y="9.4" width="16.8" height="2.4" rx="1.2"/><rect x="3.6" y="9.4" width="16.8" height="2.4" rx="1.2"/>
    <path d="M7 20.6V11.8M17 20.6V11.8M7 11.8L5.4 7.6M7 11.8L8.6 7.8M17 11.8L15.4 7.8M17 11.8L18.6 7.6"/>${BASE}`],
  // The lantern pot (B2 L1): a round-bellied clay housing pierced all over, a knob of a lid.
  'lantern-pot': ['made', `${both('d="M8.6 8.4H15.4C17.8 9.8 18.8 12.4 18.4 15.2C18 18 15.6 19.6 12 19.6S6 18 5.6 15.2C5.2 12.4 6.2 9.8 8.6 8.4Z"')}
    <path d="M9.4 8.4C9.6 7.2 10.6 6.6 12 6.6S14.4 7.2 14.6 8.4"/><circle cx="12" cy="5.2" r="1.2"/>${dot(9, 13.2, 0.8)}${dot(12, 12.6, 0.8)}${dot(15, 13.2, 0.8)}${dot(10.4, 16.2, 0.8)}${dot(13.6, 16.2, 0.8)}${BASE}`],
  // The lantern (B2 L1): the fired pot on a short stick post, a rush tie round the post.
  'post-lantern': ['made', `${both('d="M9.6 4.8H14.4C16.2 5.8 16.8 7.6 16.4 9.2C16 10.8 14.4 11.6 12 11.6S8 10.8 7.6 9.2C7.2 7.6 7.8 5.8 9.6 4.8Z"')}
    <circle cx="12" cy="3.2" r="1"/>${dot(10, 8.4, 0.7)}${dot(12, 8, 0.7)}${dot(14, 8.4, 0.7)}<path d="M12 11.6V21.2"/>
    <path ${A2} d="M10.6 14.6H13.4V16.8H10.6Z"/><path d="M10.6 14.6H13.4M10.6 16.8H13.4"/><path d="M8.4 21.2H15.6"/>`],
};

/**
 * Their registry rows (item-registry.js MAKES): id, glyph, name, tier, phase. The walking stick and
 * the pressing frame are the forager's stops 7 and 8, in pencil until Phase 4.
 * @type {[string, string, string, string, number][]}
 */
export const CAMP_ROWS = [
  ['camp-store', 'camp-store', 'Camp store', 'T2', 2], ['camp-store-grown', 'camp-store-grown', 'Camp store, grown', 'T2', 2],
  ['gathering-knife', 'gathering-knife', 'Gathering knife', 'T2', 2], ['seed-scoop', 'seed-scoop', 'Seed scoop', 'T2', 2], ['tea-caddy', 'tea-caddy', 'Tea caddy', 'T2', 2],
  ['hen-perch', 'hen-perch', "The hen's perch", 'T3', 3], ['nest-box', 'nest-box', 'Nest box', 'T3', 3],
  ['lantern-pot', 'lantern-pot', 'Lantern pot', 'T3', 3], ['post-lantern', 'post-lantern', 'Lantern on a post', 'T3', 3],
  ['walking-stick', 'walking-stick', 'Hazel walking stick', 'T4', 4], ['pressing-frame', 'pressing-frame', 'Pressing frame', 'T4', 4],
];
