// @ts-check
// Planting (docs 10, 13): a seed of a species goes in where the ground suits it, or the words say
// why not. Since D1a (Matt, October 24, 2026) all planting is the walker's: the Plant tool has left
// the view from above, and the seed tin and the gift spot on foot (src/world/sowing) sow through
// check() and tap() here. Each seed gets a ring that blooms and fades, and while a seed is in hand
// the player's plantings carry a soft ring until they are mature. The rings are UI only: not saved
// and not part of the simulation (recipes/world/growth.json marks).

import { emitDeferred } from '../../core/events.js';
import { get as getStore, update as updateStore } from '../../core/store.js';
import { STAGE } from './coarse.js';
import { calm } from '../../ui/motion.js';
import { onPad } from '../camp/layout.js';

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
  willow: {
    dry: 'Grey willow needs a damp bank, close to fresh water',
    deep: 'Too deep for grey willow; plant it on the bank, not in the water',
    salt: 'Too salty for grey willow; it keeps to fresh water',
    ground: 'Grey willow needs soil, not sand or rock',
    steep: 'Too steep for grey willow; try a gentler bank',
    crowded: 'Too close to another willow; give it room to spread',
    full: 'The island has all the willows it can hold',
  },
  gorse: {
    wet: 'Too wet for gorse; it wants dry ground that drains fast',
    deep: 'Gorse will not stand in water; plant it on dry ground',
    salt: 'Too salty for gorse; try a little further up from the tide',
    ground: 'Gorse will not take on bare rock; try soil or sand',
    steep: 'Too steep even for gorse',
    crowded: 'Too close to another gorse bush; give it room',
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
export function say(sp, name, outcome) {
  const s = SAYS[sp]?.[outcome] ?? SAYS.any[outcome] ?? SAYS.any.unknown;
  return s.replace('{name}', name);
}

/**
 * @param {{ growth: import('./index.js').Growth, world: { state: any }, flora: Record<string, any>, recipe: any,
 *   campWords?: Record<string, string> | null }} opts
 *   recipe: recipes/world/growth.json marks; campWords: recipes/world/camp.json words (`clear`, the
 *   refusal on the camp pad)
 */
export function createPlantTool(opts) {
  const { growth, world, flora, recipe } = opts;
  const marks = new Float32Array(SLOTS * 4);
  /** Recent taps: where and when (performance.now ms). @type {{ x: number, z: number, at: number }[]} */
  let taps = [];
  /** The player's plantings, newest first, until they are mature or gone. @type {number[]} */
  let mine = [];

  /** The words for an outcome: the camp's own on the pad. @param {string} sp @param {string} outcome */
  const words = (sp, outcome) => (outcome === 'camp' ? opts.campWords?.clear ?? say(sp, flora[sp]?.name ?? sp, 'unknown') : say(sp, flora[sp]?.name ?? sp, outcome));

  return {
    /**
     * Would a seed take at a ground point? Nothing changes (the sowing ring on foot, D1a: inked where
     * it would grow, faint and crossed with these words where not).
     * @param {string} sp @param {ArrayLike<number>} p world point (x, y, z)
     * @param {import('./starters.js').PlantOpts} [po] how it goes in (P2g: a seed ball, a clump, a cutting)
     * @returns {{ ok: boolean, reason: string, message: string }}
     */
    check(sp, p, po = {}) {
      // The camp ground stays clear (CP-16): the pad is refused before the ground is read. Cells
      // just past its edge are refused by the habitat's clear mask with the same words.
      const r = onPad(getStore('campPad') ?? null, p[0], p[2]) ? { ok: false, reason: 'camp' } : growth.check(sp, p[0], p[2], po);
      const reason = r.ok ? 'ok' : r.reason ?? 'unknown';
      return { ok: r.ok, reason, message: words(sp, reason) };
    },

    /**
     * Plant a seed at a ground point. @param {string} sp @param {ArrayLike<number>} p  world point (x, y, z)
     * @param {{ given?: boolean, plant?: import('./starters.js').PlantOpts }} [o] given: the seed is in hand already (the seed tin or a gift,
     *   src/world/sowing), so it needs no sighting first; plant: how it goes in (P2g)
     * @returns {boolean} whether a seed went in (the world state changed)
     */
    tap(sp, p, o = {}) {
      const name = flora[sp]?.name ?? sp;
      // Only a plant the journal has seen on the island (volunteers.js), one given as a gift's seed
      // (world/expansion.js), or any with ?sandbox.
      const u = getStore('unlocks');
      if (!o.given && !u?.allPlants && !u?.seeds?.[sp] && !getStore('journal')?.species?.[sp]?.ever) {
        updateStore('plantUi', () => ({ message: say(sp, name, 'unseen'), refused: true, at: performance.now() }));
        return false;
      }
      const r = onPad(getStore('campPad') ?? null, p[0], p[2]) ? { ok: false, reason: 'camp', id: undefined } : growth.plant(sp, p[0], p[2], o.plant ?? {});
      const message = words(sp, r.ok ? 'ok' : r.reason ?? 'unknown');
      updateStore('plantUi', () => ({ message, refused: !r.ok, at: performance.now() }));
      if (!r.ok) {
        // The journal learns what the species needs from a refusal (src/world/journal); the camp
        // pad says nothing about the species.
        if (r.reason && r.reason !== 'unknown' && r.reason !== 'camp') emitDeferred('plant:refused', { species: sp, reason: r.reason });
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
     * @param {{ wx: number, wz: number, r: number, at: number } | null} [sel] a thing Show me points to
     *   (a pinned `identify` card): it gets a ring that blooms in, then breathes gently. Any other
     *   chosen thing is lifted in its own shader instead (F5, src/render/lift.js)
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
