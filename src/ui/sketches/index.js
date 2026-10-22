// @ts-check
// The journal's field sketches (J1.6): one drawing per page, drawn by the journal pen in the stage
// the page has reached (0 pencil, 1 ink, 2 washed) with only the labels it has learned. The page
// words (src/world/journal/describe.js, ground.js) say which stage and labels; this draws them.

import { makePen } from './pen.js';
import { grass, rushes, reeds, lilies, iris, thrift, marigold, campion, willow, gorse, pondweed } from './living.js';
import { anemone, periwinkle, lugworm, hermitcrab, ediblecrab, shells, barnacles, pondskaters, mussels, sanddollars, moonjelly } from './finds.js';
import { soil, sand, rock, moss, fresh, shore } from './ground.js';
import { damselfly, frogspawn, toad, turtle, slowworm, lizard, frog, minnows, dragonfly, midges } from './animals.js';
import { fungi, webs } from './autumn.js';

/** @type {Record<string, (p: import('./pen.js').Pen, scale?: string) => string>} */
const DRAW = { grass, rushes, reeds, lilies, iris, thrift, marigold, campion, willow, gorse, pondweed, anemone, periwinkle, lugworm, hermitcrab, ediblecrab, shells, barnacles, pondskaters, mussels, sanddollars, moonjelly, soil, sand, rock, moss, fresh, shore,
  damselflies: damselfly, fungi, webs, frogspawn, toads: toad, turtles: turtle, slowworms: slowworm, lizards: lizard,
  frogs: frog, minnows, dragonflies: dragonfly, midges };

/** Is there a drawing for this page? @param {string} id */
export const hasSketch = (id) => id in DRAW;

/**
 * Add a drawing for a page made at run time (a living catch from the nets, traced from the animal
 * itself: catch.js). @param {string} id @param {(p: import('./pen.js').Pen, scale?: string) => string} draw
 */
export function registerSketch(id, draw) { DRAW[id] = draw; }

/**
 * The drawing for a page, as SVG markup.
 * @param {string} id @param {{ stage: 0|1|2, labels: Record<string, string[]>, scale?: string }} sketch
 */
export function drawSketch(id, sketch) {
  const draw = DRAW[id];
  return draw ? draw(makePen(sketch.stage, sketch.labels), sketch.scale) : '';
}
