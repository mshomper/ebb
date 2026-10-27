// @ts-check
// The movement arena's courses (doc 23; WASD, October 26, 2026): a compact test ground, as data, with
// one of each thing movement meets. A course is { sizeM, waterY, start, ground(x, z), solids, actors,
// labels }: the ground's height, the water's level, the solid things (src/world/walk/solids.js), the
// stand-ins that move (actors.js) and where each feature is, for the legend. The island course was
// built first; the Hollow's chamber (course-hollow.js, H0) is a second entry, under the Hollow camera.
// World meters, Y up.

import { HOLLOW_COURSE } from './course-hollow.js';

const T15 = Math.tan((15 * Math.PI) / 180);
/** Ease between two heights across a short rim (m), so a pool or a ramp has edges, not walls. */
const rim = (/** @type {number} */ d, /** @type {number} */ w) => Math.min(1, Math.max(0, d / w));

/** The floor round everything (m): the water lies at 0, so pools are dug below it. */
const BASE = 0.3;
/** The mesa: a plateau with sheer sides, reached up a gentle ramp or a steep one. */
const MESA = { x0: -13, x1: -4, z0: -14, z1: -10, top: BASE + T15 * 7 };

/**
 * The island course's ground. Areas (x, z ranges):
 *   the start, flat, round (0, 6), facing -z;
 *   a gentle ramp (15 degrees) at x -13..-9 from z -3 up to the mesa at z -10;
 *   a steep ramp (45 degrees, past the 35-degree limit) at x -8..-4 up to the mesa;
 *   the mesa (2.2 m up) with sheer sides: its east edge (x -4) is the cliff edge;
 *   steps at x -2..2 going -z: three of 0.2 m, one of 0.4 m (just under the 0.45 m step), one of 0.6 m (past it);
 *   three pools at x 5..12: ankle deep (0.1 m), wading (0.3 m, slower), and too deep (0.7 m).
 * @param {number} x @param {number} z
 */
function islandGround(x, z) {
  let h = BASE;
  // The mesa and its ramps.
  if (x >= MESA.x0 && x <= MESA.x1 && z >= MESA.z0 && z <= MESA.z1) h = MESA.top;
  if (x >= -13 && x <= -9 && z < -3 && z > MESA.z1) h = Math.max(h, BASE + T15 * (-3 - z));
  if (x >= -8 && x <= -4 && z < MESA.z1 + (MESA.top - BASE) && z > MESA.z1) h = Math.max(h, BASE + (MESA.z1 + (MESA.top - BASE) - z));
  // Steps.
  if (x >= -2 && x <= 2) {
    const rises = [[-3, 0.2], [-4, 0.2], [-5, 0.2], [-6, 0.4], [-7.5, 0.6]];
    let top = BASE;
    for (const [at, r] of rises) if (z < at) top += r;
    if (z > -10) h = Math.max(h, top);
  }
  // Pools: a floor below the water, with a half-metre rim.
  for (const [z0, z1, floor] of [[-3, 0, -0.1], [-7, -4, -0.3], [-12, -8, -0.7]]) {
    if (x < 4.5 || x > 12.5 || z < z0 - 0.5 || z > z1 + 0.5) continue;
    const d = Math.min(x - 4.5, 12.5 - x, z - (z0 - 0.5), (z1 + 0.5) - z);
    h = Math.min(h, BASE + (floor - BASE) * rim(d, 0.5));
  }
  return h;
}

/** A wall or block: a rectangle by its corners (x0, z0)-(x1, z1). @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 @param {string} id */
const box = (x0, z0, x1, z1, id) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: Math.abs(x1 - x0) / 2, hd: Math.abs(z1 - z0) / 2, yaw: 0, id });

/**
 * @typedef {{ x: number, z: number, r?: number, hw?: number, hd?: number, yaw?: number, id: string, heightM: number, color: number[] }} CourseSolid
 */

/** @type {CourseSolid[]} */
const islandSolids = [
  // A long wall to slide along.
  { ...box(-13, 2.85, -3, 3.15, 'wall'), heightM: 1.4, color: [0.55, 0.5, 0.44] },
  // A narrow passage: two walls a metre apart.
  { ...box(6.35, 5, 6.65, 11, 'passage-w'), heightM: 1.4, color: [0.55, 0.5, 0.44] },
  { ...box(7.65, 5, 7.95, 11, 'passage-e'), heightM: 1.4, color: [0.55, 0.5, 0.44] },
  // Pillars, two metres apart.
  ...[-12, -10, -8, -6].flatMap((x, i) => [7, 9.5, 12].map((z, j) => ({ ...box(x - 0.25, z - 0.25, x + 0.25, z + 0.25, `pillar-${i}-${j}`), heightM: 1.8, color: [0.62, 0.6, 0.56] }))),
  // Camp-sized things: a workbench, a log, a stone (as the game's solids).
  { x: 2.5, z: 10, hw: 0.6, hd: 0.3, yaw: 0.3, id: 'workbench', heightM: 0.8, color: [0.45, 0.33, 0.22] },
  { x: -1, z: 11, hw: 0.75, hd: 0.15, yaw: -0.6, id: 'log', heightM: 0.3, color: [0.4, 0.3, 0.22] },
  { x: 0.5, z: 13, r: 0.35, id: 'stone', heightM: 0.35, color: [0.55, 0.55, 0.52] },
];

export const COURSES = {
  island: {
    title: 'Island',
    sizeM: 30,
    waterY: 0,
    start: { x: 0, z: 6, yaw: Math.PI },
    ground: islandGround,
    solids: islandSolids,
    /** The stand-ins that move (actors.js): kind and where. */
    actors: [{ kind: 'frog', x: 10, z: 9 }],
    labels: [
      ['Start', 0, 6], ['Gentle slope', -11, -5], ['Steep slope', -6, -9], ['Mesa and cliff edge', -7, -12],
      ['Steps 0.2, 0.4, 0.6 m', 0, -6], ['Ankle deep', 8.5, -1.5], ['Wading', 8.5, -5.5], ['Too deep', 8.5, -10],
      ['Wall', -8, 3], ['Narrow passage', 7.15, 8], ['Pillars', -9, 9.5], ['Workbench, log, stone', 1, 11], ['Frog', 10, 9],
    ],
  },
  hollow: HOLLOW_COURSE,
};

/**
 * A course. camera: the CAMERAS entry it uses (follow unless given); feel: the walk's feel to start
 * in; dark: dim, lit by the lantern; spawns: where the spawn panel puts stand-ins, in turn.
 * @typedef {typeof COURSES.island & { camera?: string, feel?: string, dark?: boolean, spawns?: number[][] }} Course
 */
