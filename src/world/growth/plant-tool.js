// @ts-check
// The Plant tool (docs 10, 13): a tap plants a seed of the chosen species where the ground suits it,
// or says why not; rings on the ground show where. Each seed gets a ring that blooms and fades, and
// while the tool is open the player's plantings carry a soft ring until they are mature. The rings
// are UI only: not saved and not part of the simulation (recipes/world/growth.json marks).

import { emitDeferred } from '../../core/events.js';
import { get as getStore, update as updateStore } from '../../core/store.js';
import { STAGE } from './coarse.js';
import { calm } from '../../ui/motion.js';

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
    ground: 'Reeds need soil or mud, not sand or rock',
    steep: 'Too steep for reeds; they like flat, wet ground',
  },
  pondweed: {
    shallow: 'Pondweed needs water deeper than your knee',
    deep: 'Too deep for pondweed',
    flow: 'Pondweed needs still water, not a stream',
    salt: 'Too salty for pondweed',
    ground: 'Pondweed needs a soft floor, not sand or rock',
  },
  lilies: {
    shallow: 'Water lilies need a pond 0.3 to 1.5 m deep',
    deep: 'Too deep for water lilies',
    flow: 'Water lilies need still water, not a stream',
    salt: 'Too salty for water lilies',
    ground: 'Water lilies need a soft soil floor, not sand or rock',
  },
  iris: {
    dry: 'Iris needs wetter ground, close to the water',
    deep: 'Too deep for iris; plant it on the bank',
    salt: 'Too salty for iris',
    ground: 'Iris needs soil, not sand or rock',
    steep: 'Too steep for iris; try a gentler bank',
  },
  rushes: {
    dry: 'Rushes need soaked ground or shallow water',
    deep: 'Too deep for rushes; plant them in the shallows',
    flow: 'Rushes need still water, not a stream',
    salt: 'Too salty for rushes',
    ground: 'Rushes need soil or mud, not sand or rock',
    steep: 'Too steep for rushes; they like flat, soaked ground',
    crowded: 'Rushes grow here already',
  },
  thrift: {
    fresh: 'Sea thrift needs salty ground near the sea',
    wet: 'Too wet for sea thrift',
    deep: 'Too wet for sea thrift',
    ground: 'Sea thrift likes sand or rock, not soil',
    low: 'Too low for sea thrift; the tide covers it here',
    high: 'Too high for sea thrift; plant it nearer the sea',
  },
  marigold: {
    dry: "Marsh marigold needs soaked ground, right at the water's edge",
    deep: 'Too deep for marsh marigold; plant it at the very edge',
    salt: 'Too salty for marsh marigold',
    ground: 'Marsh marigold will not take on bare rock',
    steep: 'Too steep for marsh marigold; it likes flat, soaked ground',
  },
  campion: {
    ground: 'Sea campion needs rock to grow on',
    high: 'Sea campion needs rock close by the sea',
    low: 'Too low for sea campion; it grows higher up the shore than thrift',
    fresh: 'Sea campion needs salty ground near the sea',
    wet: 'Too wet for sea campion',
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
    ground: '{name}: it needs other ground than this',
    steep: '{name}: the ground is too steep here',
    flat: '{name}: it needs a slope',
    low: '{name}: too low on the shore; the sea covers it here',
    high: '{name}: too far from the sea here',
    crowded: 'A plant like this grows here already',
    full: 'The island is full of plants',
    outside: 'Plant on the island',
    unknown: 'Wait a moment for the island to settle',
    unseen: '{name} has not come to the island yet',
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
      const name = flora[sp]?.name ?? sp;
      // Only a plant the journal has seen on the island (volunteers.js), one given as a gift's seed
      // (world/expansion.js), or any with ?sandbox.
      const u = getStore('unlocks');
      if (!u?.allPlants && !u?.seeds?.[sp] && !getStore('journal')?.species?.[sp]?.ever) {
        updateStore('plantUi', () => ({ message: say(sp, name, 'unseen'), refused: true, at: performance.now() }));
        return false;
      }
      const r = growth.plant(sp, p[0], p[2]);
      updateStore('plantUi', () => ({ message: say(sp, name, r.ok ? 'ok' : r.reason ?? 'unknown'), refused: !r.ok, at: performance.now() }));
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
     * @param {number[][]} [extra] more rings [x, z, radius, opacity] first (the reveal's, src/ui/reveal.js)
     */
    marks(now, open, sel = null, extra = []) {
      marks.fill(0);
      let n = 0;
      for (const m of extra) if (n < SLOTS) marks.set(m, n++ * 4);
      if (sel && Number.isFinite(sel.wx)) {
        const k = Math.min(1, (now - sel.at) / (recipe.selectBloomS * 1000));
        const bloom = 1 - (1 - k) * (1 - k);
        // Calm motion (Settings, src/ui/motion.js): the ring holds still at its middle size.
        const breath = calm() ? 0.5 : 0.5 + 0.5 * Math.sin(((now - sel.at) / 1000) * Math.PI * 2 / recipe.selectPulseS);
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
