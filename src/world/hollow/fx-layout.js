// @ts-check
// The shapes of the Q and E move effects handed to the GPU (doc 16, Special moves: Q and E; the move
// effects, October 27, 2026). The effect engine (move-fx.js) fills these flat arrays each frame; the
// draw (tools/arena/fx-pass.js) and the stage's lights read them. Pure: numbers only.
//
// Four building blocks, shared by every move:
//   lights  real point lights that fall on the floor, the walls, the walker and the Hollow's things
//   sparks  small glowing points facing the eye, drawn additive (embers, chips, seeds, spores, dust)
//   threads glowing strands between two points, drawn additive (the wick's threads, a flame's arc)
//   moths   small winged moths, flapping in the vertex shader, giving off a faint light of their own
// The floor marks (rings, cracks, scorch) are drawn with the arena's flat shapes, not here.

/** How many effect lights at once (the lantern is separate). */
export const MAX_FX_LIGHTS = 8;
/** One light: x, y, z, reach (m); r, g, b (linear light, the lantern's strength is about 1.4), unused. */
export const LIGHT_FLOATS = 8;

/** Most sparks at once. */
export const MAX_SPARKS = 1536;
/**
 * One spark: x, y, z, size (m, the disc's radius); r, g, b (linear light, drawn additive), alpha;
 * vx, vy, vz (m/s, for stretching along its motion), stretch (s of motion the streak shows; 0 round).
 */
export const SPARK_FLOATS = 12;

/** Most threads at once. */
export const MAX_THREADS = 256;
/** One thread: ax, ay, az, width (m); bx, by, bz, alpha; r, g, b (linear light), unused. */
export const THREAD_FLOATS = 12;

/** Most moths at once. */
export const MAX_MOTHS = 48;
/**
 * One moth: x, y, z, yaw (rad, +z turned by yaw is its heading); flap phase (rad), size (m, its
 * wingspan), glow (0..1, its own light on its wings), bank (rad, a lean into its turns).
 */
export const MOTH_FLOATS = 8;
