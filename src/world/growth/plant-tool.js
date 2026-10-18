// @ts-check
// The Plant tool (docs 10, 13): a tap plants a seed of the chosen species where the ground suits it,
// or says why not; rings on the ground show where. Each seed gets a ring that blooms and fades, and
// while the tool is open the player's plantings carry a soft ring until they are mature. The rings
// are UI only: not saved and not part of the simulation (recipes/world/growth.json marks).

import { emitDeferred } from '../../core/events.js';
import { update as updateStore } from '../../core/store.js';
import { STAGE } from './coarse.js';

/** Ring slots the terrain shader holds (terrain-draw.wgsl marks). */
const SLOTS = 16;

/** What the tool says after a tap, by outcome. @type {Record<string, (name: string) => string>} */
const SAYS = {
  ok: (n) => `${n} planted`,
  moisture: (n) => `${n} need wetter ground`,
  depth: (n) => `Too deep for ${n.toLowerCase()}`,
  salt: (n) => `Too salty for ${n.toLowerCase()}`,
  crowded: () => 'A clump grows here already',
  full: () => 'The island is full of plants',
  outside: () => 'Plant on the island',
  unknown: () => 'Wait a moment for the island to settle',
};

/**
 * @param {{ growth: import('./index.js').Growth, world: { state: any }, flora: Record<string, any>, recipe: any }} opts
 *   recipe: recipes/world/growth.json marks
 */
export function createPlantTool(opts) {
  const { growth, world, flora, recipe } = opts;
  const marks = new Float32Array(SLOTS * 4);
  /** Recent taps: where and when (performance.now ms). @type {{ x: number, z: number, at: number }[]} */
  let taps = [];
  /** The player's plantings, newest first, until they are mature or gone. @type {number[]} */
  let mine = [];

  return {
    /**
     * Plant a seed at a ground point. @param {string} sp @param {ArrayLike<number>} p  world point (x, y, z)
     * @returns {boolean} whether a seed went in (the world state changed)
     */
    tap(sp, p) {
      const r = growth.plant(sp, p[0], p[2]);
      const name = flora[sp]?.name ?? sp;
      updateStore('plantUi', () => ({ message: (SAYS[r.ok ? 'ok' : r.reason ?? 'unknown'] ?? SAYS.unknown)(name), at: performance.now() }));
      if (!r.ok) return false;
      taps.push({ x: p[0], z: p[2], at: performance.now() });
      if (r.id !== undefined) mine = [r.id, ...mine].slice(0, SLOTS - 1);
      emitDeferred('growth:planted', { species: sp, x: p[0], z: p[2] });
      return true;
    },

    /**
     * The rings to draw now, for the terrain pass's setMarks.
     * @param {number} now performance.now ms @param {boolean} open whether the Plant tool is open
     */
    marks(now, open) {
      marks.fill(0);
      let n = 0;
      const life = recipe.tapS * 1000;
      taps = taps.filter((t) => now - t.at < life);
      for (const t of taps) {
        if (n >= SLOTS) break;
        const k = (now - t.at) / life;
        const grow = 1 - (1 - k) * (1 - k);
        marks.set([t.x, t.z, recipe.tapRadiusM[0] + (recipe.tapRadiusM[1] - recipe.tapRadiusM[0]) * grow, 1 - k], n++ * 4);
      }
      if (mine.length) {
        const plants = world.state?.growth?.plants ?? [];
        const byId = new Map();
        for (const p of plants) if (mine.includes(p.id)) byId.set(p.id, p);
        mine = mine.filter((id) => byId.has(id) && byId.get(id).stage < STAGE.mature);
        if (open) {
          for (const id of mine) {
            if (n >= SLOTS) break;
            const p = byId.get(id);
            marks.set([p.x, p.z, recipe.youngRadiusM, recipe.youngOpacity], n++ * 4);
          }
        }
      }
      return marks;
    },
  };
}
