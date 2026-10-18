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

/**
 * What the tool says after a tap: by species and the need the ground misses most (coarse.js
 * suitability), then by outcome for every species. @type {Record<string, Record<string, string>>}
 */
const SAYS = {
  reeds: {
    dry: 'Reeds need wetter ground',
    deep: 'Too deep for reeds',
    salt: 'Too salty for reeds',
  },
  lilies: {
    shallow: 'Water lilies need a pond 0.3 to 1.5 m deep',
    deep: 'Too deep for water lilies',
    flow: 'Water lilies need still water, not a stream',
    salt: 'Too salty for water lilies',
  },
  iris: {
    dry: 'Iris needs wetter ground, close to the water',
    deep: 'Too deep for iris; plant it on the bank',
    salt: 'Too salty for iris',
  },
  thrift: {
    fresh: 'Sea thrift needs salty ground near the sea',
    wet: 'Too wet for sea thrift',
    deep: 'Too wet for sea thrift',
  },
  any: {
    ok: '{name} planted',
    dry: '{name}: the ground is too dry here',
    wet: '{name}: the ground is too wet here',
    shallow: '{name}: the water is too shallow here',
    deep: '{name}: the water is too deep here',
    flow: '{name}: the water moves too much here',
    fresh: '{name}: not salty enough here',
    salt: '{name}: too salty here',
    crowded: 'A plant like this grows here already',
    full: 'The island is full of plants',
    outside: 'Plant on the island',
    unknown: 'Wait a moment for the island to settle',
  },
};

/** @param {string} sp @param {string} name @param {string} outcome */
function say(sp, name, outcome) {
  const s = SAYS[sp]?.[outcome] ?? SAYS.any[outcome] ?? SAYS.any.unknown;
  return s.replace('{name}', name);
}

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
      updateStore('plantUi', () => ({ message: say(sp, name, r.ok ? 'ok' : r.reason ?? 'unknown'), at: performance.now() }));
      if (!r.ok) {
        // The journal learns what the species needs from a refusal (src/world/journal).
        if (r.reason && r.reason !== 'unknown') emitDeferred('plant:refused', { species: sp, reason: r.reason });
        return false;
      }
      taps.push({ x: p[0], z: p[2], at: performance.now() });
      if (r.id !== undefined) mine = [r.id, ...mine].slice(0, SLOTS - 1);
      emitDeferred('growth:planted', { species: sp, x: p[0], z: p[2] });
      return true;
    },

    /**
     * The rings to draw now, for the terrain pass's setMarks.
     * @param {number} now performance.now ms @param {boolean} open whether the Plant tool is open
     * @param {{ wx: number, wz: number, r: number, at: number } | null} [sel] a living thing the player
     *   tapped (store slice `identify`): it gets a ring that blooms in, then breathes gently
     */
    marks(now, open, sel = null) {
      marks.fill(0);
      let n = 0;
      if (sel && Number.isFinite(sel.wx)) {
        const k = Math.min(1, (now - sel.at) / (recipe.selectBloomS * 1000));
        const bloom = 1 - (1 - k) * (1 - k);
        const breath = 0.5 + 0.5 * Math.sin(((now - sel.at) / 1000) * Math.PI * 2 / recipe.selectPulseS);
        const r = sel.r * (0.6 + 0.4 * bloom) * (1 + recipe.selectPulse * breath);
        marks.set([sel.wx, sel.wz, r, bloom * (recipe.selectOpacity[0] + (recipe.selectOpacity[1] - recipe.selectOpacity[0]) * breath)], n++ * 4);
      }
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
