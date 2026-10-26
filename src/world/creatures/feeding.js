// @ts-check
// Feeding (S6c-2, docs 11, 23): food you offer with the Feed tool. It lands where you tap, as a few
// dark specks with a soft ring on the ground. The nearest frog within feed.reachM comes for it, once
// the camera is outside its comfort ring (a shy frog waits for you to back off), later if it ate
// recently, and flicks it up with its tongue. Each meal is recorded as a `fed` trust event
// (trust.js) for the next hourly tick, so it counts the same in saves and time away. Food nobody
// takes is gone after feed.lingerS. Live only: food on the ground is never saved.
// Numbers and words: recipes/species/frog.json `feed`.

import { hash32 } from '../../core/rng.js';
import { appetite } from './trust.js';

/**
 * @typedef {Object} Food
 * @property {number} id @property {number} x @property {number} z @property {number} y
 * @property {number} placedS  real seconds when it landed
 * @property {number | null} frog  the frog coming for it
 * @property {boolean} sent        that frog has been told to go
 * @property {{ treat: string, tid: number, reachM: number }} [treat] a treat set out (P2h, treats.js): drawn and kept
 *   there, not here; no specks, no ring, and nothing kept if no frog comes
 */

/**
 * @param {{ recipe: any, agents: import('./agents.js').FrogAgents, ground: (x: number, z: number) => number,
 *   water: (x: number, z: number) => { depth: number } }} opts recipe: recipes/species/frog.json
 */
export function createFeeding(opts) {
  const { recipe, agents } = opts;
  const F = recipe.feed, P = recipe.presence;
  /** @type {Food[]} */ let foods = [];
  let nextId = 1, now = 0;

  /** The comfort ring of a frog that knows you this well (doc 23). @param {number} trust */
  const ringOf = (trust) => Math.max(P.ringMinM, P.ringM * (1 - P.ringTrustShrink * trust));
  /** The nearest frog within reach that is free to come (not leaving, not already going for food). @param {number} x @param {number} z @param {number} reach */
  function nearest(x, z, reach) {
    let best = null, bestD = reach;
    for (const a of agents.list()) {
      if (a.mode === 'leave' || a.food || foods.some((o) => o.frog === a.id)) continue;
      const d = Math.hypot(a.x - x, a.z - z);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  return {
    /**
     * Food tossed at a ground point. Returns which message the tool card shows (feed.messages).
     * @param {number} x @param {number} z @param {{ known: boolean, dormant: boolean, eye: ArrayLike<number> }} ctx
     *   known: frogs have been found (the journal); dormant: asleep for winter
     * @param {{ treat: string, tid: number, reachM: number }} [treat] a treat a frog likes (P2h): any frog
     *   comes, found or not, from within reachM; with none coming nothing is kept here
     * @returns {'coming'|'waiting'|'none'|'water'|'asleep'|'unknown'}
     */
    offer(x, z, ctx, treat) {
      if (!ctx.known && !treat) return 'unknown';
      if (ctx.dormant) return 'asleep';
      if (opts.water(x, z).depth > 0.03) return 'water';
      const y = opts.ground(x, z);
      /** @type {Food} */ const food = { id: nextId++, x, z, y, placedS: now, frog: null, sent: false, ...(treat ? { treat: { treat: treat.treat, tid: treat.tid, reachM: treat.reachM } } : {}) };
      foods.push(food);
      const best = nearest(x, z, treat?.reachM ?? F.reachM);
      if (!best) { if (treat) foods = foods.filter((f) => f !== food); return 'none'; }
      food.frog = best.id;
      return Math.hypot(ctx.eye[0] - best.x, ctx.eye[2] - best.z) < ringOf(best.trust) ? 'waiting' : 'coming';
    },

    /**
     * One frame: send frogs that may go now, collect what was eaten, let old food go.
     * @param {number} dt real seconds @param {ArrayLike<number>} eye camera eye
     * @param {(id: number) => { trust?: number, fedAt?: number } | undefined} tickFrog the saved frog
     * @param {number} hour the game hour now
     * @returns {{ id: number, treat?: string, tid?: number }[]} meals: frogs that ate (record a `fed`
     *   trust event for each, or a `treat` one for a treat)
     */
    step(dt, eye, tickFrog, hour) {
      now += dt;
      for (const f of foods) {
        // A treat left without its frog (it swam off, or moved on) waits for the next one near.
        if (f.treat && f.frog === null && !f.sent) f.frog = nearest(f.x, f.z, f.treat.reachM)?.id ?? null;
        if (f.frog === null || f.sent) continue;
        const a = agents.list().find((g) => g.id === f.frog);
        if (!a || a.mode === 'leave') { f.frog = null; continue; }
        if (agents.wary(a.id) || Math.hypot(eye[0] - a.x, eye[2] - a.z) < ringOf(a.trust)) continue;
        const t = tickFrog(a.id);
        // A treat is eaten at once (P2h): no waiting on a full stomach.
        const wait = F.waitS + (f.treat ? 0 : F.fullWaitS * (1 - appetite(t ?? {}, hour, F.fullH)));
        f.sent = agents.goFor(a.id, { id: f.id, x: f.x, z: f.z }, wait);
        if (!f.sent) f.frog = null;
      }
      /** @type {{ id: number, treat?: string, tid?: number }[]} */ const ate = [];
      for (const m of agents.takeMeals()) {
        const food = foods.find((f) => f.id === m.food);
        foods = foods.filter((f) => f.id !== m.food);
        ate.push(food?.treat ? { id: m.id, treat: food.treat.treat, tid: food.treat.tid } : { id: m.id });
      }
      // A treat stays offered while it lies (treatLingerS, about its fade at normal speed).
      foods = foods.filter((f) => now - f.placedS < (f.treat ? F.treatLingerS ?? F.lingerS : F.lingerS) || (f.sent && agents.list().some((a) => a.food?.id === f.id)));
      return ate;
    },

    /** Soft rings where food lies, [x, z, radius, opacity] for the terrain marks (not treats). */
    rings: () => foods.filter((f) => !f.treat).map((f) => [f.x, f.z, F.ringM, F.ringOpacity * Math.max(0, 1 - (now - f.placedS) / F.lingerS)]),

    /** The specks to draw: a few small dark bits around each food, seeded by the food. */
    specks() {
      /** @type {{ x: number, y: number, z: number, yaw: number }[]} */ const out = [];
      for (const f of foods) {
        if (f.treat) continue;
        for (let i = 0; i < F.specks; i++) {
          const h = hash32(f.id, i, 0x5ec);
          const r = F.spreadM * Math.sqrt((h & 1023) / 1023), a = (((h >>> 10) & 1023) / 1023) * Math.PI * 2;
          const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
          out.push({ x, y: opts.ground(x, z) + F.speckM * 0.3, z, yaw: (((h >>> 20) & 1023) / 1023) * Math.PI * 2 });
        }
      }
      return out;
    },
  };
}
