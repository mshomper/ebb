// @ts-check
// The movement arena's Hollow course (H0, October 27, 2026; doc 16): a chamber of rock about 18 m
// across, dim, with the walker's lantern as the light that matters. A ring of pillars, a short
// bending passage out of its south side, and a shallow pool edge on its west. Under the Hollow camera
// (recipes/world/hollow.json camera), with the three stand-ins (tools/arena/actors.js). World meters,
// Y up; the water lies at 0.

/** The floor round everything (m). */
const BASE = 0.3;
/** The chamber's wall: a ring of this radius (m), its segments this thick and tall. */
const RING = { r: 9.3, thickM: 0.6, heightM: 3.2, segments: 28 };
const ROCK = [0.42, 0.4, 0.37], PILLAR = [0.48, 0.46, 0.42];
/** The pool's edge: from x = edge the floor goes down to the shallows, then deeper toward the wall. */
const POOL = { edge: -5.8, shallowX: -7.2, shallowY: -0.12, deepY: -0.5, rimM: 0.5 };

/** The chamber's floor: flat, with the pool dug below the water on the west. @param {number} x @param {number} _z */
function hollowGround(x, _z) {
  if (x > POOL.edge) return BASE;
  const into = POOL.edge - x;
  const shallow = BASE + (POOL.shallowY - BASE) * Math.min(1, into / POOL.rimM);
  if (x > POOL.shallowX) return shallow;
  return POOL.shallowY + (POOL.deepY - POOL.shallowY) * Math.min(1, (POOL.shallowX - x) / POOL.rimM);
}

/** A wall by its corners (x0, z0)-(x1, z1). @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 @param {string} id */
const box = (x0, z0, x1, z1, id) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: Math.abs(x1 - x0) / 2, hd: Math.abs(z1 - z0) / 2, yaw: 0, id, heightM: RING.heightM, color: ROCK });

/** @type {import('./course.js').CourseSolid[]} */
const hollowSolids = [
  // The wall ring, open to the south (+z) where the passage leaves.
  ...Array.from({ length: RING.segments }, (_, i) => i).filter((i) => i !== 0).map((i) => {
    const a = (i / RING.segments) * 2 * Math.PI, half = Math.PI * RING.r / RING.segments + 0.05;
    return { x: Math.sin(a) * (RING.r + RING.thickM / 2), z: Math.cos(a) * (RING.r + RING.thickM / 2), hw: half, hd: RING.thickM / 2, yaw: a, id: `wall-${i}`, heightM: RING.heightM, color: ROCK };
  }),
  // A ring of six pillars.
  ...[30, 90, 150, 210, 270, 330].map((d, i) => {
    const a = (d * Math.PI) / 180;
    return { x: Math.sin(a) * 5, z: Math.cos(a) * 5, r: 0.55, id: `pillar-${i}`, heightM: RING.heightM, color: PILLAR };
  }),
  // The short bending passage: south out of the chamber, then east to a nook.
  box(-1.3, 9.3, -1.0, 15.3, 'passage-w'),
  box(1.0, 9.6, 1.3, 13.0, 'passage-e'),
  box(-1.3, 15.0, 7.3, 15.3, 'passage-s'),
  box(1.0, 12.7, 7.3, 13.0, 'passage-n'),
  box(7.0, 12.7, 7.3, 15.3, 'passage-end'),
];

export const HOLLOW_COURSE = {
  title: 'Hollow chamber',
  sizeM: 36,
  waterY: 0,
  start: { x: 0, z: 6.5, yaw: Math.PI },
  ground: hollowGround,
  solids: hollowSolids,
  /** The camera entry (move-arena.js CAMERAS) and the walk's feel (walker.json steer.profiles). */
  camera: 'hollow',
  feel: 'hollow',
  /** Dim: the lantern is the light that matters (recipes/world/hollow.json lantern). */
  dark: true,
  actors: [{ kind: 'lunger', x: 1, z: -6.5 }, { kind: 'watcher', x: -4.5, z: -6.5 }, { kind: 'motes', x: 6, z: -3 }],
  /** Where the spawn panel puts new stand-ins, in turn (clear of the pillars). */
  spawns: [[1, -6.5], [-4.5, -6.5], [6, -3], [-6.5, 3], [0, -8], [6.5, 3.5], [-3.5, -1.5], [3, 0.5]],
  labels: [
    ['Start', 0, 6.5], ['Ring of six pillars', 0, 0], ['Bending passage (south, then east)', 3, 14], ['Shallow pool edge (west)', -7, 0],
    ['Silt crawler: strikes at movement', 1, -6.5], ['Watcher: goes toward light', -4.5, -6.5], ['Mote cluster: shies from light', 6, -3],
  ],
};
