// @ts-check
// Lift, on foot (docs/future/11 L3a): kneel beside a kept log or a loose stone and choose Lift on its
// card. You kneel facing it, it rolls back away from you (a stone tips), holds a while, and settles
// back gently; what lives underneath shows while it is up (src/world/finds/under-log-live.js). Lifted
// again the same game day, it rests and nothing is there ("Let it rest a while"). From above there is
// no Lift: the card says to go down. What is found is a seeded roll (src/world/finds/under-log.js);
// which pieces have rested today is kept in memory only (a reload forgets it, and the same day's roll
// finds the same thing anyway). Emits piece:lifted { id, kind, from, holdS, found, rested } for the
// pieces (the roll) and the journal (the card, the pages).

import { emitDeferred } from '../../core/events.js';
import { hourIndex } from '../../core/clock.js';
import { subSeed } from '../../core/rng.js';
import { groundUnder, keptAge, rollUnder, underToWorld } from '../finds/under-log.js';

/**
 * @param {{ pieces: any, walk: any, world: { state: any, env: any }, recipe: any, seed: number, ageRecipe?: any }} o
 *   pieces: src/world/pieces; walk: src/world/walk; recipe: recipes/species/under-log.json; seed: the world seed;
 *   ageRecipe: pieces.json driftwood.age (L2's ageing, which a log's age share follows)
 */
export function createLift(o) {
  const { pieces, walk, world, recipe: R } = o;
  const seed = subSeed(o.seed, 'under-log');
  /** Each piece's last lift: the game day. @type {Map<string, number>} */ const rested = new Map();
  /**
   * What each lift under way found, for the live finds to draw (under-log-live.js): the piece as it
   * lay, where you knelt, each find's start spot in the world, and when (real ms) it was lifted.
   * @type {Map<string, { piece: any, from: number[], found: any[], t0: number }>}
   */
  const active = new Map();

  /**
   * How far you are from a piece: from your feet to a log's middle line (or a stone's middle), less
   * its half thickness. @param {any} p @param {number[]} me [x, z]
   */
  function gap(p, me) {
    let px = p.x, pz = p.z;
    if (p.kind === 'log') {
      const len = p.length ?? 1, ax = Math.sin(p.yaw), az = Math.cos(p.yaw);
      const t = Math.max(-len / 2, Math.min(len / 2, (me[0] - p.x) * ax + (me[1] - p.z) * az));
      px = p.x + ax * t; pz = p.z + az * t;
    }
    return Math.max(0, Math.hypot(me[0] - px, me[1] - pz) - p.size * 0.5);
  }

  /** You on foot, as [x, z], or null while you are above. */
  const me = () => { const s = walk.below ? walk.spot() : null; return s ? [s.x, s.z] : null; };

  return {
    /**
     * Can a piece be lifted from here: 'lift' on foot within reach, 'closer' on foot further away,
     * 'above' while you are above. @param {any} p a piece (pieces.pieceAt)
     * @returns {'lift' | 'closer' | 'above'}
     */
    reach(p) {
      const m = me();
      if (!m) return 'above';
      return gap(p, m) <= R.lift.reachM ? 'lift' : 'closer';
    },

    /**
     * Lift a piece (the card's Lift): you kneel facing it, it rolls back, and what is under it is rolled
     * for today. Nothing happens from above, out of reach, or while it is already up.
     * @param {string} id @returns {boolean} whether it was lifted
     */
    lift(id) {
      const p = pieces.piece(id);
      const m = me();
      // A pile at camp is taken up, never lifted.
      if (!p || p.kind === 'pile' || !m || gap(p, m) > R.lift.reachM || pieces.liftNow(id)) return false;
      const hour = hourIndex(), day = Math.floor(hour / 24);
      const rest = rested.get(id) === day;
      rested.set(id, day);
      walk.kneelToward(p.x, p.z, R.lift.holdS + 2, 'lift');
      const st = world.state;
      const hab = world.env.habitat?.();
      // A strand log is not kept: nothing lives under it yet. Nor under anything lifted earlier today.
      let found = /** @type {any[]} */ ([]);
      if (!rest && hab && !p.strand) {
        const hours = (hour % 24 + 24) % 24;
        const ground = groundUnder({ hab, plants: st?.growth?.plants ?? [], x: p.x, z: p.z, G: R.ground });
        // A stone does not age; a log by L2's ageing (log-age.js).
        found = rollUnder(seed, p, { day, ...keptAge(p.placedHour ?? hour, hour, p.kind === 'log' ? o.ageRecipe ?? null : null), ground,
          season: st?.seasons?.index ?? 0, phase: st?.seasons?.phase ?? 0, hourOfDay: hours }, R).found;
      }
      active.set(id, { piece: p, from: m, found: found.map((f) => ({ ...f, at: underToWorld(p, f.u, f.v) })), t0: performance.now() });
      /** @type {Record<string, number>} */ const counts = {};
      for (const f of found) counts[f.sp] = (counts[f.sp] ?? 0) + 1;
      emitDeferred('piece:lifted', { id, kind: p.kind, from: m, holdS: R.lift.holdS, found: counts, rested: rest, strand: !!p.strand });
      return true;
    },

    /**
     * The lifts under way and what each found (under-log-live.js draws them while the piece is up).
     * Lifts that are over are dropped. @returns {{ id: string, piece: any, from: number[], found: any[], now: { e: number, up: number, doneS: number, dir: number[] } }[]}
     */
    active() {
      const out = [];
      for (const [id, a] of active) {
        const now = pieces.liftNow(id);
        // The roll starts when piece:lifted arrives (deferred); a lift with no roll after that is over.
        if (!now) { if (performance.now() - a.t0 > 1000) active.delete(id); continue; }
        out.push({ id, ...a, now });
      }
      return out;
    },
  };
}

/** @typedef {ReturnType<typeof createLift>} Lift */
