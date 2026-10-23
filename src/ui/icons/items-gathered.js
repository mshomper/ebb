// @ts-check
// Item icons, part 1: what is gathered (F7; docs/future/13 sections 4 and 5). Each entry is
// [family, drawing] on the icons' 24 px grid; each family shares one cue (item-draw.js): fuel lies
// on a rising slant, stones rest on a ground line, fibres are a bundle tied at the waist, herbs are
// one stem cut on a slant, berries and nuts sit in a bowl's curve, earth is a heap, sea things lie
// above a wave line. Variants differ by silhouette, so they part at 20 px.

import { A, A2, D, K, both, dot, ring, GROUND, CUT, BOWL, WAVE, TIE, petals, hex, radial } from './item-draw.js';

const at = (/** @type {number[][]} */ pts, /** @type {(x: number, y: number) => string} */ fn) => pts.map(([x, y]) => fn(x, y)).join('');

// Two leaf pairs on one stem: water mint's, reused for its dried bunch.
const MINT = `<path d="M12 20.6V6.4"/>
  ${both('d="M12 15.8C10 17.4 6.4 17 5.6 14C7.8 12.4 10.8 13.2 12 15.8Z"')}${both('d="M12 15.8C14 17.4 17.6 17 18.4 14C16.2 12.4 13.2 13.2 12 15.8Z"')}
  ${both('d="M12 10.8C10.4 12 7.8 11.6 7.2 9.6C8.8 8.4 11 9 12 10.8Z"')}${both('d="M12 10.8C13.6 12 16.2 11.6 16.8 9.6C15.2 8.4 13 9 12 10.8Z"')}
  ${both('d="M12 2.4C13.4 2.4 14.2 3.4 14.2 4.6C14.2 6 13.2 6.6 12 6.6S9.8 6 9.8 4.6C9.8 3.4 10.6 2.4 12 2.4Z"')}`;

/** @type {Record<string, [string, string]>} */
export const GATHERED = {
  // ---- Fuel: laid on a rising slant ----
  // Sticks: two thick lengths with cut ends and a side twig.
  sticks: ['fuel', `<g transform="rotate(-38 12 12)">
    <rect ${A} x="3.5" y="7.6" width="17" height="3.4" rx="1.7"/><rect x="3.5" y="7.6" width="17" height="3.4" rx="1.7"/><path d="M18.2 7.6V11"/>
    <rect ${A} x="5" y="12.6" width="14" height="3.4" rx="1.7"/><rect x="5" y="12.6" width="14" height="3.4" rx="1.7"/><path d="M16.6 12.6V16"/>
    <path d="M9.4 16L7.4 19"/></g>`],
  // Drift twigs: thin, wavy, sea-worn lengths tapering at both ends.
  'drift-twigs': ['fuel', `<g transform="rotate(-38 12 12)">
    ${both('d="M3 8.6C6 6.8 9.4 9.4 13 8S18.6 6.8 21 8.4C18.6 9.4 16 9.6 13.2 10S6 10.4 3 8.6Z"')}
    ${both('d="M4.6 13.6C7.6 12.2 10.4 14.4 13.8 13.4S18.4 12.6 20 13.8C18 14.8 16 14.8 14 15.2S7.6 15.6 4.6 13.6Z"')}
    <path d="M7.4 18.4C9.4 17.6 11.4 19 13.6 18.2"/></g>`],
  // Reed down: a soft plume on its stalk.
  'reed-down': ['fuel', `<g transform="rotate(-40 12 12)"><path d="M2.5 12.4H9.2"/>
    ${both('d="M9 12.4C9.6 10.2 11.4 9 13.2 9.2C14 7.8 16.4 7.6 17.4 8.8C18.8 8 20.8 9 20.8 10.6C21.8 11.4 21.8 13.4 20.8 14.2C20.8 15.8 18.8 16.8 17.4 16C16.4 17.2 14 17 13.2 15.6C11.4 15.8 9.6 14.6 9 12.4Z"')}
    <path d="M11.4 12.4H19.4" opacity=".6"/></g>`],
  // King Alfred's cakes: two black knobs on an old log, rings in the bigger one.
  cakes: ['fuel', `<g transform="rotate(-30 12 12)"><rect x="2.5" y="14.6" width="19" height="5" rx="2.5"/><circle cx="19" cy="17.1" r="1"/>
    <circle ${D} cx="7" cy="11.8" r="2.8"/><circle cx="7" cy="11.8" r="2.8"/>
    <circle ${D} cx="13.4" cy="11.2" r="3.4"/><circle cx="13.4" cy="11.2" r="3.4"/><path ${K} d="M11.6 11.2A1.8 1.8 0 0 1 15.2 11.2"/></g>`],
  // Charcoal: two dark, faceted lumps and a little dust.
  charcoal: ['fuel', `
    <path ${D} d="M3.4 17.4L5 12.6L10.6 11.2L13.4 14.6L11.2 19.4L5.4 19.8Z"/><path d="M3.4 17.4L5 12.6L10.6 11.2L13.4 14.6L11.2 19.4L5.4 19.8Z"/>
    <path ${D} d="M11.6 10.4L13.2 5.4L18.6 4.2L20.8 8.2L18.4 12.4L14 12.6Z"/><path d="M11.6 10.4L13.2 5.4L18.6 4.2L20.8 8.2L18.4 12.4L14 12.6Z"/>
    <path d="M15.6 15.6L17.4 14.6M17.6 18.4L19.8 17.2" opacity=".55"/>`],
  // Hardwood: sticks from under oak, hazel or beech, a lobed oak leaf at their tip.
  hardwood: ['fuel', `<g transform="rotate(-38 12 12)">
    <rect ${A} x="2.5" y="9.4" width="15" height="3.4" rx="1.7"/><rect x="2.5" y="9.4" width="15" height="3.4" rx="1.7"/><path d="M15.2 9.4V12.8"/>
    <rect ${A} x="4.4" y="14.4" width="13" height="3.4" rx="1.7"/><rect x="4.4" y="14.4" width="13" height="3.4" rx="1.7"/><path d="M15 14.4V17.8"/></g>
    <path d="M15.6 9.4C14 8 14.6 6.4 15.8 6.6C15.4 5 17 4.4 17.8 5.4C18.2 4 20 4 20.2 5.4C21.4 5.6 21.4 7.2 20.2 7.6C21 8.8 19.8 9.8 18.6 9.2C18.4 10.4 16.8 10.6 15.6 9.4Z"/><path d="M15.6 9.4L19 6"/>`],

  // ---- Stones: resting on a ground line ----
  // Pebbles: a small heap of round stones, one banded.
  pebbles: ['stones', `
    <ellipse ${A} cx="6.8" cy="17.7" rx="4" ry="2.8"/><ellipse cx="6.8" cy="17.7" rx="4" ry="2.8"/>
    <ellipse ${A} cx="14.4" cy="17.8" rx="3.6" ry="2.7"/><ellipse cx="14.4" cy="17.8" rx="3.6" ry="2.7"/>
    <ellipse ${A} cx="19.7" cy="19" rx="1.8" ry="1.5"/><ellipse cx="19.7" cy="19" rx="1.8" ry="1.5"/>
    <ellipse ${A} cx="10.6" cy="12.8" rx="3.4" ry="2.6"/><ellipse cx="10.6" cy="12.8" rx="3.4" ry="2.6"/>
    <path d="M8.2 12.2C9.4 11.6 11.4 11.6 12.8 12.4"/>${GROUND}`],
  // Flat stones: three thin slabs stacked, a grain line in the bottom one.
  'flat-stones': ['stones', `
    ${both('d="M2.8 20.5C3 18.8 4.4 17.8 6.6 17.6H17.6C20 17.8 21.2 18.8 21.2 20.5Z"')}
    ${both('d="M5.2 16.2C5.6 14.6 7 13.8 9 13.7H16.4C18.4 13.8 19.4 14.7 19.4 16C16.4 16.7 8.6 16.8 5.2 16.2Z"')}
    ${both('d="M7.8 12.2C8.2 10.8 9.4 10.1 11 10.1H15C16.6 10.2 17.4 11 17.4 12C15 12.6 10.6 12.7 7.8 12.2Z"')}
    <path d="M7.6 19.2H13"/>${GROUND}`],

  // ---- Fibres and cord: a bundle tied once at its waist ----
  // Rushes: stiff straight stems splaying, a flower tuft on one.
  rushes: ['fibres', `<path d="M9.4 11.8L6.4 3M11.2 11.8L10.2 2.5M12.8 11.8L13.8 2.5M14.6 11.8L17.6 3M9.4 14.2L7.4 21.5M11.2 14.2L10.6 21.5M12.8 14.2L13.4 21.5M14.6 14.2L16.6 21.5"/>
    ${both('d="M16.6 5.4C18.1 4.8 19.2 5.8 18.7 7.3C17.8 7.6 16.9 7 16.6 5.4Z"')}${TIE}`],
  // Marram leaves: rolled blades curling over at their tips.
  marram: ['fibres', `<path d="M9.6 11.8C9.2 8 7.6 5.4 4.8 4.6C3.8 4.4 3.2 5 3.2 5.8M11.2 11.8C11.2 7.8 10.2 4.6 7.2 3C6.4 2.6 5.8 3 5.8 3.6M12.8 11.8C13 7.6 14.4 4.2 17.4 3C18.2 2.7 18.8 3.2 18.6 3.9M14.4 11.8C15 8.2 16.6 5.6 19.6 5C20.4 4.9 20.9 5.4 20.7 6.1"/>
    <path d="M9.6 14.2L8.8 21.5M11.2 14.2L10.9 21.5M12.8 14.2L13.1 21.5M14.4 14.2L15.2 21.5"/>${TIE}`],
  // Willow withies: long slim rods with buds.
  withies: ['fibres', `<path d="M9.6 21.5C9 16 9 8 9.8 2.5M12 21.5V2.5M14.4 21.5C15 16 15 8 14.2 2.5"/>
    <path d="M9.3 6.4L8 5.6M12 5L13.2 4M14.8 8.4L16 7.6M9.2 17.6L8 17M14.8 18.4L16 17.8M12 19L10.8 18.2"/>${TIE}`],
  // Reed leaves: broad flat blades.
  'reed-leaves': ['fibres', `${both('d="M10.4 11.8C9.6 8.2 7.4 5.2 4 3.4C6.6 6 8.6 9 9.2 11.8Z"')}${both('d="M11.4 11.8C11.2 8 11.6 5 12.8 2.4C13.6 5.6 13.2 9 12.8 11.8Z"')}
    ${both('d="M13.6 11.8C14.6 8.4 16.8 5.8 20 4.6C17.6 7 15.6 9.4 14.8 11.8Z"')}<path d="M9.6 14.2L9 21.5M12 14.2V21.5M14.4 14.2L15 21.5"/>${TIE}`],
  // Rush cord: a looped hank with its loose end.
  'rush-cord': ['fibres', `${both('d="M12 2.8C16.4 2.8 17 7.6 15.4 12.8C17 18 16.4 21.2 12 21.2S7 18 8.6 12.8C7 7.6 7.6 2.8 12 2.8Z"')}
    <path d="M12 5C14 5 14.2 8.8 13.2 11.6M12 5C10 5 9.8 8.8 10.8 11.6M13.2 14.2C14.2 17 14 19 12 19S9.8 17 10.8 14.2"/>
    <path d="M15.4 18.6C17.6 19.2 19.4 20.2 20.8 21.4"/>${TIE}`],

  // ---- Herbs and flowers: one picked stem, its foot cut on a slant ----
  // Water mint: paired round leaves, a lilac ball at the top.
  mint: ['herbs', `${MINT}${CUT}`],
  // Meadowsweet: a frothy, flat-topped spray.
  meadowsweet: ['herbs', `<path d="M12 20.6V9.4M12 10.6L8.6 7.8M12 10.6L15.4 7.8"/>
    ${at([[6.4, 7.2], [8.8, 4.8], [12, 3.8], [15.2, 4.8], [17.6, 7.2], [10.4, 7.6], [13.6, 7.6]], (x, y) => ring(x, y, 1.7))}
    ${both('d="M12 16.2C14.4 15 17 15.4 18.2 17.2C16.2 18.6 13.6 18.2 12 16.2Z"')}${both('d="M12 13.4C10.2 12.6 8.2 13 7.2 14.4C8.8 15.4 10.8 15 12 13.4Z"')}${CUT}`],
  // Nettle tops: pointed, saw-toothed leaves in pairs.
  nettle: ['herbs', `<path d="M12 20.6V3.4"/>
    ${both('d="M12 13.6C10 11.4 6.2 12.8 3.4 17.6L5.8 16.8L6.2 18L8 16.6L8.8 17.4L10.2 15.8L11 16.2L12 14.8Z"')}
    ${both('d="M12 13.6C14 11.4 17.8 12.8 20.6 17.6L18.2 16.8L17.8 18L16 16.6L15.2 17.4L13.8 15.8L13 16.2L12 14.8Z"')}
    ${both('d="M12 8.4C10.6 9.6 7.6 9.6 5.4 6L7.4 6.2L7.4 5.2L9 6.4L9.6 5.6L10.8 7L11.4 6.6L12 7.4Z"')}
    ${both('d="M12 8.4C13.4 9.6 16.4 9.6 18.6 6L16.6 6.2L16.6 5.2L15 6.4L14.4 5.6L13.2 7L12.6 6.6L12 7.4Z"')}${CUT}`],
  // Chamomile: two daisies on a forked stem, feathery leaves below.
  chamomile: ['herbs', `<path d="M12 20.6V14.6C12 12.4 10.6 11 9 10.4M12 14.6C12.4 12 13.6 9.8 15 8.6M12 17.4C10.8 16.6 9.4 16.8 8.4 17.8M12 17.4C13.2 16.6 14.6 16.8 15.6 17.8"/>
    <path d="${petals(7.4, 8.8, 1.9, 4.2, 8, 0.2)}"/>${ring(7.4, 8.8, 1.7)}<path d="${petals(16.6, 5.8, 1.7, 3.7, 8)}"/>${ring(16.6, 5.8, 1.5)}${CUT}`],
  // Gorse flowers: a spiny stem with two pea flowers.
  'gorse-flowers': ['herbs', `<path d="M12 20.6C12 15 12.6 9 14 3.6"/>
    <path d="M12.1 17.4L10.2 16.6M12.2 14.2L14.2 13.2M12.6 10.8L10.8 10M13.2 8L15.2 7.4M13.8 5.4L12 4.8"/>
    ${both('d="M10 12.4C7 12.8 5 10.4 5.8 7.8C6.4 6 8.8 5.6 10 7C11 8.4 11.2 10.8 10 12.4Z"')}<path d="M10 12.4C10.8 12.4 11.6 12 12.3 11.4"/>
    ${both('d="M14.6 18C17.6 18.6 19.8 16.4 19.2 13.6C18.6 11.8 16.2 11.4 15 12.6C14 14 13.6 16.4 14.6 18Z"')}<path d="M14.6 18C13.8 17.8 13 17.4 12.3 16.8"/>${CUT}`],
  // Willow bark: a strip curling into a scroll, its grain drawn in.
  'willow-bark': ['herbs', `${both('d="M7.4 20.6L9.4 7.2C9.8 4.4 12 3 14.2 3.8C15.8 4.4 16.2 6.6 15 7.6C14 8.4 12.4 8 12.6 6.6L16.6 20.6Z"')}
    <path d="M10.4 18L11.2 10.4M13.4 18.4L12.8 11.6"/>`],
  // Willow leaves: long narrow leaves, alternate on a twig.
  'willow-leaves': ['herbs', `<path d="M12 20.6V3.4"/>${both('d="M12 15.6C9.6 15.4 6.6 13.6 5 11.2C7.8 11.2 10.6 12.8 12 15.6Z"')}
    ${both('d="M12 11.6C14.4 11.4 17.4 9.6 19 7.2C16.2 7.2 13.4 8.8 12 11.6Z"')}${both('d="M12 7.6C10.2 7.2 8.4 5.6 7.6 3.6C9.6 3.8 11.4 5.4 12 7.6Z"')}${CUT}`],
  // Bog myrtle: a woody twig with catkins at its tips.
  myrtle: ['herbs', `<path d="M12 20.6V6.4M12 14L8 9.8M12 11L16 7.4M12 17.4L14.2 16.2M12 16L9.8 14.8"/>
    <ellipse ${A} cx="12" cy="4.2" rx="1.3" ry="2.4"/><ellipse cx="12" cy="4.2" rx="1.3" ry="2.4"/>
    <ellipse ${A} cx="7" cy="8.6" rx="1.3" ry="2.4" transform="rotate(-40 7 8.6)"/><ellipse cx="7" cy="8.6" rx="1.3" ry="2.4" transform="rotate(-40 7 8.6)"/>
    <ellipse ${A} cx="17" cy="6.2" rx="1.3" ry="2.4" transform="rotate(40 17 6.2)"/><ellipse cx="17" cy="6.2" rx="1.3" ry="2.4" transform="rotate(40 17 6.2)"/>${CUT}`],
  // Watercress: round leaflets in pairs up the stem, one at its tip.
  watercress: ['herbs', `<path d="M12 20.6V8.6M10.6 16.4H13.4M10.8 12.6H13.2"/>
    ${at([[8.8, 16.4], [15.2, 16.4], [9.2, 12.6], [14.8, 12.6]], (x, y) => ring(x, y, 1.9))}${ring(12, 6.2, 2.6)}${CUT}`],
  // Elderflowers: a flat plate of tiny flowers on spreading rays.
  elderflower: ['herbs', `<path d="M12 20.6V13M12 13L5.4 7.8M12 13L8.6 7M12 13V6.8M12 13L15.4 7M12 13L18.6 7.8M12 17.4L9 15.8M12 17.4L15 15.8"/>
    ${both('d="M3.6 7.4C3.6 4.6 7.8 3.2 12 3.2S20.4 4.6 20.4 7.4C17 8.6 7 8.6 3.6 7.4Z"')}${at([[6.2, 6.2], [8.8, 5], [11.4, 4.6], [14, 4.8], [16.6, 5.4], [18.2, 6.6], [10, 6.8], [14.6, 6.8]], (x, y) => dot(x, y, 0.65))}${CUT}`],
  // Red clover: a round head, a three-leaved leaf on a side stalk.
  clover: ['herbs', `<path d="M12 20.6V9.6M12 15.4L15.2 13.2"/>${ring(12, 6.4, 3.4)}<path d="M10.4 5.4L11.4 6.6M13.6 5.4L12.6 6.6M12 3.8V5.2M10.2 8L11.2 7.6M13.8 8L12.8 7.6" opacity=".7"/>
    <path ${A} d="${petals(16.8, 11.4, 0.7, 2.6, 3, -1.2)}"/><path d="${petals(16.8, 11.4, 0.7, 2.6, 3, -1.2)}"/>${CUT}`],
  // Self-heal: a squat, tiered purple head, a leaf pair below.
  selfheal: ['herbs', `<path d="M12 20.6V10.6"/><rect ${A} x="9.4" y="3" width="5.2" height="7.6" rx="2"/><rect x="9.4" y="3" width="5.2" height="7.6" rx="2"/>
    <path d="M9.6 5.4H14.4M9.6 7.9H14.4M14.6 4.4L16 3.8M14.6 6.8L16 6.2M9.4 6.8L8 6.2"/>
    ${both('d="M12 15.4C10 16.6 7 16 6.4 13.6C8.4 12.4 11 13 12 15.4Z"')}${both('d="M12 15.4C14 16.6 17 16 17.6 13.6C15.6 12.4 13 13 12 15.4Z"')}${CUT}`],
  // Wild thyme: a woody sprig, a round pink head on each tip, tiny leaves.
  thyme: ['herbs', `<path d="M12 20.6V9.2M12 15L8 10.8M12 13.4L16 9.6"/>${ring(12, 7.2, 2)}${ring(7.4, 9.2, 2)}${ring(16.6, 7.8, 2)}
    <path d="M12 18L10.6 17.2M12 18L13.4 17.2M10 13L9 13.4M14 11.6L15 12.2M12 11.2L13.2 10.8"/>${CUT}`],
  // Lady's bedstraw flowers: whorls of needle leaves, a frothy yellow spike on top.
  bedstraw: ['herbs', `<path d="M12 20.6V9"/><path d="${radial(12, 15.6, 0.6, 2.8, 6)}${radial(12, 11.6, 0.6, 2.4, 6, 0.5)}"/>
    ${both('d="M9.6 9C8.6 6 10 2.8 12 2.6S15.4 6 14.4 9C13 9.8 11 9.8 9.6 9Z"')}${at([[11, 5], [13, 5.6], [11.6, 7.4]], (x, y) => dot(x, y, 0.6))}${CUT}`],
  // Lady's bedstraw roots: a crown of stubs over a tangle of thin roots.
  'bedstraw-roots': ['herbs', `<path d="M11 4.9L10.2 2.6M12 4.8V2.5M13 4.9L13.8 2.6"/>
    ${both('d="M9.4 6.4C9.4 5.4 10.6 4.8 12 4.8S14.6 5.4 14.6 6.4 13.4 8 12 8 9.4 7.4 9.4 6.4Z"')}
    <path d="M10.4 7.6C9.4 10.4 7 12.4 5.6 15.6M11.4 8C11 11.4 9.4 15 9.8 20.6M12.6 8C13 11.6 14.8 14.6 14.4 20M13.6 7.6C15 10.4 17.4 12 18.6 15.6M9.6 12.6C8.4 14.4 6.6 16.6 4.6 17.6M14.8 13.6C16 15.4 17.6 17.4 19.4 18.6"/>`],
  // Yarrow: a flat-topped head of small flowers, a feathery leaf.
  yarrow: ['herbs', `<path d="M12 20.6V9.8M12 10.6L8.4 7.4M12 10.6L15.6 7.4M12 10.6V6.8"/>
    ${at([[6.6, 6.4], [9.3, 5.4], [12, 5], [14.7, 5.4], [17.4, 6.4]], (x, y) => ring(x, y, 1.4))}
    <path d="M12 16.6C9.4 16 7.4 14.4 6.4 12.4M10.8 16L10.4 14.6M9.4 15.4L8.6 14.2M8 14.4L7 13.6"/>${CUT}`],
  // Sorrel leaves: an arrow-shaped leaf, its two lobes pointing back.
  sorrel: ['herbs', `<path d="M12 20.6V14.6"/>${both('d="M12 15C9 13 8 9 9 5.6C9.4 4.4 10.6 3.4 12 3C13.4 3.4 14.6 4.4 15 5.6C16 9 15 13 12 15Z"')}
    <path d="M12 14.4V5M10.4 14.2L7.6 16.8M13.6 14.2L16.4 16.8"/>${CUT}`],
  // Cuckooflower: four-petalled flowers in a small spray.
  cuckooflower: ['herbs', `<path d="M12 20.6V8.4M12 11L8.6 9.8M12 11L15.4 9.8M12 17.4L9.6 16.4M12 17.4L14.4 16.4"/>
    <path ${A} d="${petals(12, 5.8, 0.9, 2.8, 4, 0.785)}"/><path d="${petals(12, 5.8, 0.9, 2.8, 4, 0.785)}"/>
    <path ${A} d="${petals(7.4, 9.4, 0.7, 2.1, 4, 0.785)}"/><path d="${petals(7.4, 9.4, 0.7, 2.1, 4, 0.785)}"/>
    <path ${A} d="${petals(16.6, 9.4, 0.7, 2.1, 4, 0.785)}"/><path d="${petals(16.6, 9.4, 0.7, 2.1, 4, 0.785)}"/>${CUT}`],
  // Sea carrot flowers: a domed plate with one dark floret, its bracts curling below.
  seacarrot: ['herbs', `<path d="M12 20.6V10.2M12 10.2L6 7.4M12 10.2L18 7.4M12 10.2V6.6M9.8 10.4C8.8 11.4 7.8 11.8 6.8 11.6M14.2 10.4C15.2 11.4 16.2 11.8 17.2 11.6"/>
    ${both('d="M4.4 7.4C4.6 4.8 8 3.4 12 3.4S19.4 4.8 19.6 7.4C16.4 8.6 7.6 8.6 4.4 7.4Z"')}${dot(12, 5.6, 1.1)}${CUT}`],
  // Strawberry leaves: three toothed leaflets from one stalk.
  'strawberry-leaves': ['herbs', `<path d="M12 20.6V11.6"/>
    <ellipse ${A} cx="12" cy="6.4" rx="2.6" ry="3.8"/><ellipse cx="12" cy="6.4" rx="2.6" ry="3.8"/>
    <ellipse ${A} cx="7.8" cy="10" rx="2.4" ry="3.6" transform="rotate(-58 7.8 10)"/><ellipse cx="7.8" cy="10" rx="2.4" ry="3.6" transform="rotate(-58 7.8 10)"/>
    <ellipse ${A} cx="16.2" cy="10" rx="2.4" ry="3.6" transform="rotate(58 16.2 10)"/><ellipse cx="16.2" cy="10" rx="2.4" ry="3.6" transform="rotate(58 16.2 10)"/>
    <path d="M12 10.4V4M11.2 11.4L6 9M12.8 11.4L18 9" opacity=".6"/>${CUT}`],
  // Sea beet: one broad, glossy leaf on its stalk, a shine along it.
  seabeet: ['herbs', `<path d="M12 20.6V16.6"/>${both('d="M12 17C7.6 16 5.6 12 6.4 8.2C7.2 4.8 10 3.2 12 3.2S16.8 4.8 17.6 8.2C18.4 12 16.4 16 12 17Z"')}
    <path d="M12 16.4V5.2M12 12.4L8.6 10M12 9.4L15.4 7.2"/><path d="M15.2 11.6C15.8 10.4 16 9.2 15.8 8" opacity=".6"/>${CUT}`],
  // Sea kale: two broad, round leaves with crinkled edges.
  seakale: ['herbs', `<path d="M12 20.6V16.4M12 16.4L9.4 13.4M12 16.4L15.4 11.8"/>
    <path ${A} d="${petals(8.8, 10.2, 4.2, 4.8, 10)}"/><path d="${petals(8.8, 10.2, 4.2, 4.8, 10)}"/>
    <path ${A} d="${petals(15.8, 7.6, 3.4, 3.9, 9, 0.3)}"/><path d="${petals(15.8, 7.6, 3.4, 3.9, 9, 0.3)}"/>${CUT}`],
  // Rock samphire: a fleshy stem forking into plump, finger-like leaves.
  samphire: ['herbs', `<path d="M12 20.6V11M12 12.4L8 9M12 11L16 7.4M12 11V6.4M12 16.6L9.6 15.2M12 16.6L14.4 15.2"/>
    ${[[12, 4.2, 0], [7, 7.6, -45], [17, 5.6, 45], [8.4, 14, -65], [15.6, 14, 65]].map(([x, y, r]) => `<ellipse ${A} cx="${x}" cy="${y}" rx="1.3" ry="2.6" transform="rotate(${r} ${x} ${y})"/><ellipse cx="${x}" cy="${y}" rx="1.3" ry="2.6" transform="rotate(${r} ${x} ${y})"/>`).join('')}${CUT}`],
  // Evening primrose: a wide four-petalled cup flower and a closed bud.
  primrose: ['herbs', `<path d="M12 20.6V12.2"/><path ${A} d="${petals(12, 7.2, 1.5, 4.8, 4, 0.785)}"/><path d="${petals(12, 7.2, 1.5, 4.8, 4, 0.785)}"/>${dot(12, 7.2, 1)}
    ${both('d="M12 17C13.6 16 14.4 14.2 14 12.6C12.8 13 12 14.8 12 17Z"')}${CUT}`],
  // Heather tops: a spike of small bells, fine leaves below.
  heather: ['herbs', `<path d="M12 20.6V2.8"/>
    ${at([[10.2, 4.6], [13.8, 6.4], [10.2, 8.2], [13.8, 10], [10.2, 11.8], [13.8, 13.6]], (x, y) => `<ellipse ${A} cx="${x}" cy="${y}" rx="1.5" ry="1.7"/><ellipse cx="${x}" cy="${y}" rx="1.5" ry="1.7"/>`)}
    <path d="M12 17.2L9.8 16.2M12 17.2L14.2 16.2M12 19.2L10.2 18.4M12 19.2L13.8 18.4"/>${CUT}`],
  // Woad leaves: a rosette of three broad leaves.
  woad: ['herbs', `${both('d="M11.4 20.4C7.2 20.6 3.6 17.8 3.2 13.2C7.4 12.8 10.8 15.6 11.4 20.4Z"')}${both('d="M12.6 20.4C16.8 20.6 20.4 17.8 20.8 13.2C16.6 12.8 13.2 15.6 12.6 20.4Z"')}
    ${both('d="M12 20.6C8 16.4 7.8 8.4 12 2.8C16.2 8.4 16 16.4 12 20.6Z"')}<path d="M12 18.4V6.4"/>${CUT}`],
  // Lichen twigs: a fallen twig with grey-green tufts on it.
  'lichen-twigs': ['herbs', `<path d="M4.4 20.4L19.6 4.4M9.6 15L8.4 10.6M13.6 10.8L18.6 11.6"/>
    ${both('d="M5.6 15.6C5.4 14 7.2 13.4 8 14.4C9.2 13.8 10.4 15 9.6 16.2C10.2 17.4 8.8 18.4 7.8 17.6C6.8 18.4 5.2 17.4 5.6 15.6Z"')}
    ${both('d="M12.8 9.2C12.6 7.6 14.4 7 15.2 8C16.4 7.4 17.6 8.6 16.8 9.8C17.4 11 16 12 15 11.2C14 12 12.4 11 12.8 9.2Z"')}
    ${both('d="M7.4 10.4C7.2 9.2 8.6 8.8 9.2 9.6C10.2 9.2 11 10.2 10.4 11C10.6 12 9.4 12.6 8.8 12C8 12.6 7 11.8 7.4 10.4Z"')}`],

  // ---- Berries and nuts: held in a bowl's curve ----
  // Rose hips: two oval hips, crowned with their sepals.
  hips: ['berries', `<ellipse ${A} cx="8.6" cy="12.4" rx="3.2" ry="4.4" transform="rotate(-28 8.6 12.4)"/><ellipse cx="8.6" cy="12.4" rx="3.2" ry="4.4" transform="rotate(-28 8.6 12.4)"/>
    <ellipse ${A} cx="15.4" cy="12.2" rx="3.2" ry="4.4" transform="rotate(28 15.4 12.2)"/><ellipse cx="15.4" cy="12.2" rx="3.2" ry="4.4" transform="rotate(28 15.4 12.2)"/>
    <path d="M6.6 8.6L4.8 7.4M6.6 8.6L6.4 6.4M6.6 8.6L8.4 7.4M17.4 8.4L19.2 7.2M17.4 8.4L17.6 6.2M17.4 8.4L15.6 7.2"/>${BOWL}`],
  // Elderberries: a spray of tiny dark berries on branching stalks.
  elderberries: ['berries', `<path ${A} d="M3.8 13.6C3.8 11.2 7.8 10.2 12 10.2S20.2 11.2 20.2 13.6C20.2 15.6 16.2 16.8 12 16.8S3.8 15.6 3.8 13.6Z"/>
    <path d="M12 3V6.6M12 6.6L7.2 10.4M12 6.6L16.8 10.4M12 6.6V10.6M7.2 10.4L5.6 12.4M7.2 10.4L8.6 12.6M16.8 10.4L15.4 12.6M16.8 10.4L18.4 12.4"/>
    ${at([[5.2, 13.4], [7.2, 14.6], [9.2, 13.6], [11, 12.2], [13, 12.2], [14.8, 13.6], [16.8, 14.6], [18.8, 13.4], [12, 14.6], [10, 15.6], [14, 15.6]], (x, y) => dot(x, y, 1.15))}${BOWL}`],
  // Haws: small round berries, each with its dark eye, on short stalks.
  haws: ['berries', `<path d="M12 3.6L8.6 10.2M12 3.6L12.2 8.8M12 3.6L15.6 10.4"/>
    ${at([[8.2, 12.4], [12.2, 11], [16, 12.6], [10.2, 15.2], [14.2, 15.4]], (x, y) => ring(x, y, 2.1) + dot(x, y - 1.2, 0.5))}${BOWL}`],
  // Blackberries: a berry of packed drupelets under its calyx.
  blackberries: ['berries', `<path d="M12 6.6V3.2M10 7.2L8.4 5.6M14 7.2L15.6 5.6"/>
    ${at([[12, 11.4], [8.8, 11.4], [15.2, 11.4], [10.4, 8.6], [13.6, 8.6], [10.4, 14.2], [13.6, 14.2]], (x, y) => ring(x, y, 1.75))}${BOWL}`],
  // Wild strawberries: two small berries, seeded, under their green stars.
  strawberries: ['berries', `${both('d="M8.4 17C6.2 15.4 5 12.6 5.4 10.6C5.8 9 7.2 8.6 8.4 9.2C9.6 8.6 11 9 11.4 10.6C11.8 12.6 10.6 15.4 8.4 17Z"')}
    <path d="M6.6 9.2L5.6 7.6M8.4 9L8.4 7M10.2 9.2L11.2 7.6"/>
    <g transform="translate(15.4 2.6) scale(.82) translate(-8.4 0)">${both('d="M8.4 17C6.2 15.4 5 12.6 5.4 10.6C5.8 9 7.2 8.6 8.4 9.2C9.6 8.6 11 9 11.4 10.6C11.8 12.6 10.6 15.4 8.4 17Z"')}<path d="M6.6 9.2L5.6 7.6M8.4 9L8.4 7M10.2 9.2L11.2 7.6"/></g>
    ${dot(7.4, 11.8, 0.5)}${dot(9.4, 12.4, 0.5)}${dot(8.2, 14.4, 0.5)}${BOWL}`],
  // Juniper berries: round berries with a three-pointed scar, a needled sprig.
  juniper: ['berries', `<path d="M3.6 6.6L20.4 3.8M6.6 6.1L6 4.6M9.6 5.6L9.2 4M12.6 5.1L12.4 3.6M15.6 4.6L15.6 3.2M7.4 6L8 7.4M11 5.4L11.6 6.8M14.6 4.8L15.2 6.2"/>
    ${at([[8.2, 13.2], [15.8, 13.2], [12, 10.6]], (x, y) => ring(x, y, 2.6) + `<path d="${radial(x, y, 0, 1, 3, -1.57)}"/>`)}${BOWL}`],
  // Acorns: two acorns in their scaly cups.
  acorns: ['berries', `<path d="M8.2 5.6V3.6"/>${both('d="M5.4 9.6C5.2 12.8 6.4 15.8 8.2 16.6C10 15.8 11.2 12.8 11 9.6Z"')}
    ${both('d="M4.8 9.6C4.8 7 6.4 5.6 8.2 5.6S11.6 7 11.6 9.6Z"')}<path d="M6 7.8H10.4"/>
    <g transform="rotate(24 15.8 11)"><path d="M15.8 5.6V3.6"/>${both('d="M13 9.6C12.8 12.8 14 15.8 15.8 16.6C17.6 15.8 18.8 12.8 18.6 9.6Z"')}${both('d="M12.4 9.6C12.4 7 14 5.6 15.8 5.6S19.2 7 19.2 9.6Z"')}<path d="M13.6 7.8H18"/></g>${BOWL}`],
  // Hazelnuts: a nut in its frilled husk.
  hazelnuts: ['berries', `${both('d="M12 3.6C15.2 5 16.8 8.2 16.2 11.4C15.6 14 13.8 15.2 12 15.2S8.4 14 7.8 11.4C7.2 8.2 8.8 5 12 3.6Z"')}
    <path d="M6.4 11.6L5 13.4L7.2 13.8L6.4 16L8.6 15.4L9 17.4L10.6 16L12 17.8L13.4 16L15 17.4L15.4 15.4L17.6 16L16.8 13.8L19 13.4L17.6 11.6"/>${BOWL}`],
  // Chanterelle: a funnel cap with ridged gills down its stem.
  chanterelle: ['berries', `${both('d="M4.4 7.4C7.6 5.4 16.4 5.4 19.6 7.4C19.8 8.4 18.6 8.6 17.6 9.2C15.6 10.2 14 11.4 13.4 13.2L13 16.8H11L10.6 13.2C10 11.4 8.4 10.2 6.4 9.2C5.4 8.6 4.2 8.4 4.4 7.4Z"')}
    <path d="M8.4 9.4L10.6 12.4M12 9.6V12.8M15.6 9.4L13.4 12.4"/>${BOWL}`],
  // Old comb: a broken piece of comb, its cells drawn in.
  'old-comb': ['berries', `${both('d="M4.8 9L9 5.6L15.6 5.8L19.4 9.6L18.6 15.4L12.4 17L6.2 15Z"')}
    <path d="${hex(9.6, 9.6, 2.1)}${hex(13.6, 9.6, 2.1)}${hex(11.6, 13.1, 2.1)}${hex(15.6, 13.1, 2.1)}${hex(7.6, 13.1, 2.1)}"/>${BOWL}`],

  // ---- Earth: a heap on the ground ----
  // Sand: a heap with grains trickling down onto it.
  sand: ['earth', `${both('d="M3.5 19.5C5.5 14 8.6 11.5 12 11.5S18.5 14 20.5 19.5Z"')}<path d="M2.5 19.5H21.5"/>
    ${at([[8, 16.8], [10.6, 14.6], [13.8, 15.4], [15.8, 17.6], [11.6, 17.8], [12.2, 8.4], [13.2, 5.8], [11.4, 3.6]], (x, y) => dot(x, y))}`],
  // Clay: a smooth lump, a thumbprint pressed in it.
  clay: ['earth', `${both('d="M4 19.5C3.6 15.2 5.6 11.8 9.6 11.2C13.2 10.6 16.6 11 18.8 12.8C20.6 14.2 20.8 17 20.2 19.5Z"')}<path d="M2.5 19.5H21.5"/>
    <path d="M8.2 15.4C8.4 14 11.4 13.6 12.2 15C12.6 16 11.6 16.8 10.2 16.8C9 16.8 8.2 16.2 8.2 15.4Z"/><path d="M14.4 13C15.8 13 17 13.6 17.8 14.6"/>`],
  // Topsoil: a heap with clods and a sprout.
  topsoil: ['earth', `${both('d="M3.5 19.5C5.5 14 8.6 11.5 12 11.5S18.5 14 20.5 19.5Z"')}<path d="M2.5 19.5H21.5"/>
    ${dot(8.6, 16.4, 1)}${dot(12.8, 14.6, 1)}${dot(15.8, 17, 0.9)}<circle cx="11" cy="17.8" r="1.1"/>
    <path d="M12 11.5V8.4M12 9.4C11 8.2 9.8 7.8 8.6 8.2M12 9C13 7.6 14.4 7.2 15.6 7.6"/>`],
  // Wood ash: a soft low heap, flecks drifting up from it.
  ash: ['earth', `${both('d="M3.5 19.5C6 16 9 15 12 15S18 16 20.5 19.5Z"')}<path d="M2.5 19.5H21.5"/>
    ${at([[9.6, 11.6], [13.6, 9.6], [11.4, 7.2], [15.4, 12.4], [8.4, 8.4], [14.4, 5.6]], (x, y) => dot(x, y))}
    <path d="M12 13.6C11 12.2 12.4 11 11.6 9.6" opacity=".7"/>`],
  // Fallen leaves: three leaves in a heap.
  leaves: ['earth', `${both('d="M3.4 18.8C4.8 14.8 8.8 13.2 12.4 14.2C11.2 17.8 7.4 19.8 3.4 18.8Z"')}<path d="M3.4 18.8L10.2 15.6"/>
    ${both('d="M10.4 19.4C11.4 15.2 15.6 12.6 20 13.4C19 17.4 14.8 19.8 10.4 19.4Z"')}<path d="M10.4 19.4L17.8 14.8"/>
    ${both('d="M7.6 13.4C7.6 9.8 10.4 7.2 14 6.8C14.2 10.4 11.4 13.2 7.6 13.4Z"')}<path d="M7.6 13.4L12.6 8.4"/><path d="M2.5 20.5H21.5"/>`],

  // ---- Sea: above a wave line ----
  // Cast kelp: a long, wavy strap from its holdfast.
  kelp: ['sea', `<path d="M3.2 16.6C4.2 15.4 5.2 14.4 6.4 13.2M3.2 16.6L2.6 18M3.2 16.6L4.6 17.6"/>
    ${both('d="M6.2 11.4C8.4 9 10.6 12 13 10.2S17.4 7.8 21 8.8L20.6 12C17.8 11.4 15.8 13.4 13.4 14S8.6 13.4 6.6 15Z"')}<path d="M8.2 12.8C10.4 11.6 12 13 14 12" opacity=".6"/>${WAVE}`],
  // Wrack: a frond forking twice, paired bladders on it.
  wrack: ['sea', `<path d="M12 17.8V13.6C12 11 9.6 9.6 8.2 6.8M12 13.6C12 11 14.4 9.6 15.8 6.8M8.2 6.8L6.8 3.6M8.2 6.8L9.8 3.8M15.8 6.8L14.2 3.8M15.8 6.8L17.2 3.6"/>
    ${ring(9.6, 9.8, 1.4)}${ring(14.4, 9.8, 1.4)}${ring(12, 15.2, 1.3)}${WAVE}`],

  // ---- Seeds: the fallback when a plant has no chip or part of its own ----
  // A dry seed head on its stem, seeds dropping from it.
  seedhead: ['seeds', `<path d="M12 20.6V10"/>${both('d="M12 10C9.6 10 8.4 8 8.6 6.2C8.8 4.4 10.2 3.4 12 3.4S15.2 4.4 15.4 6.2C15.6 8 14.4 10 12 10Z"')}
    <path d="M10.4 6.2H13.6M11 8.2H13" opacity=".6"/><path ${A2} d="M17 12.6C17.8 13.6 17.8 14.8 17 15.4C16.2 14.8 16.2 13.6 17 12.6Z"/><path d="M17 12.6C17.8 13.6 17.8 14.8 17 15.4C16.2 14.8 16.2 13.6 17 12.6ZM18.8 17C19.6 18 19.6 19.2 18.8 19.8C18 19.2 18 18 18.8 17Z"/>`],
};
