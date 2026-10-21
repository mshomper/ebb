// @ts-check
// The walker's footprints (doc 23, W6): each step that lands on sand, or on bare earth and mud,
// leaves a print the shape of the boot's sole. Prints fade over a game day and are gone once the
// tide covers them: the island forgets you between tides. Never saved. Pure: the ground and the
// water are asked through functions. Numbers: recipes/world/figure.json footprints.

/**
 * @typedef {{ x: number, z: number, y: number, yaw: number, side: number, bornH: number, dark: number }} Print
 *   side: 1 left foot, -1 right; bornH: game hour it was made; dark: how much it darkens the ground at first
 */

/**
 * @param {any} F recipes/world/figure.json footprints
 * @param {{ ground: (x: number, z: number) => number, material: (x: number, z: number) => { grass: number, sand: number, rock: number, soil: number },
 *   depth: (x: number, z: number) => number }} env
 */
export function createFootprints(F, env) {
  /** @type {Print[]} */ let prints = [];
  return {
    /**
     * A step landed here: leave a print if the ground takes one. Returns the print or null.
     * @param {{ x: number, z: number, yaw: number, side: number }} step @param {number} hour game hours
     */
    step(step, hour) {
      if (env.depth(step.x, step.z) > F.dryM) return null;
      const m = env.material(step.x, step.z);
      const kind = m.sand >= F.minWeight && m.sand >= m.soil ? 'sand' : m.soil >= F.minWeight ? 'soil' : null;
      if (!kind || m.grass > m.sand + m.soil || m.rock > m.sand + m.soil) return null;
      const p = { x: step.x, z: step.z, y: env.ground(step.x, step.z), yaw: step.yaw, side: step.side, bornH: hour, dark: F.darkness[kind] };
      prints.push(p);
      if (prints.length > F.max) prints = prints.slice(prints.length - F.max);
      return p;
    },
    /**
     * Age the prints: fade them, and wash away any the tide has covered.
     * @param {number} hour game hours @param {number} tide the sea's level now (m)
     */
    update(hour, tide) {
      prints = prints.filter((p) => hour - p.bornH < F.fadeH && p.y > tide);
      return prints;
    },
    /** How dark a print is now, 0..1. @param {Print} p @param {number} hour */
    strength(p, hour) {
      const age = Math.max(0, (hour - p.bornH) / F.fadeH);
      return p.dark * (1 - age) * (1 - age);
    },
    get prints() { return prints; },
    clear() { prints = []; },
  };
}
