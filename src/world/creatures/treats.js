// @ts-check
// Treats (P2h, docs/future/13 section 8): a pouch thing a species likes, set out from its pouch card.
// The walker kneels and puts it down just in front (as Feed does) and the nearest creature that likes
// it comes and eats it at once, by the Feed pattern: a frog hops over and snaps up wrack or kelp on
// the bank (feeding.js), the minnows swirl up to a leaf pack sunk in their pool (schools.js). Eating
// it records a `treat` trust event for the hourly tick (trust.js, swarms.js), worth treatFeeds meals
// once a game day, and `treat:taken` takes it off the ground here.
//
// A treat nobody comes for lies where it was set, saved with the island in the gather section
// (`gather.treats`), pales over its last paleH game hours and is gone fadeH game hours after it was
// set: back into the ground. Whether one lies is worked out from the hour alone, so a reload and a
// catch-up agree and nothing needs to tick. Which species likes what: each species recipe's `treat`
// block (id, kinds, reachM); numbers and words: recipes/world/treats.json.

import { on, emitDeferred } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { cleanTreats, lyingAt, paleOf, likersOf, isTreatKind, TREATS_MAX } from './treat-rules.js';

/** @typedef {import('./treat-rules.js').LyingTreat} LyingTreat */

/** Two places, as the saved list keeps them. @param {number} v */
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {{ recipe: any, species: { key: string, rec: any, live: { treat: (x: number, z: number, t: { treat: string, tid: number, reachM: number }) => string } | null }[],
 *   pack: { take: (kind: string, n: number) => number }, walk: { feedPoint: () => number[] | null },
 *   hour: () => number }} o
 *   recipe: recipes/world/treats.json; species: every species with a treat block, its live module (the
 *   frogs' creatures, a school's schools) or null when it is not on the island; hour: game hours now
 */
export function createTreats(o) {
  const R = o.recipe, W = R.words ?? {};
  /** @returns {LyingTreat[]} */
  const saved = () => cleanTreats(get('gather')?.treats);
  /** @param {LyingTreat[]} list */
  const keep = (list) => update('gather', (g) => ({ ...(g ?? { version: 1, events: [] }), treats: list }));

  // Eaten (frogs or a school): off the ground.
  const off = on('treat:taken', (/** @type {{ tid?: number }} */ p) => {
    const list = saved();
    if (p?.tid !== undefined && list.some((t) => t[4] === p.tid)) { keep(list.filter((t) => t[4] !== p.tid)); emitDeferred('treat:changed', {}); }
  });

  return {
    /** Is this pouch kind something a creature might take? @param {string} kind */
    isTreat: (kind) => isTreatKind(kind, o.species),

    /**
     * Set out on a pouch's card, below: a handful from the pack, put down in front of you, and the
     * nearest creature that likes it is sent for it. Returns the line to show, or '' if nothing was
     * set out (no handful, or above).
     * @param {string} kind
     */
    setOut(kind) {
      const p = o.walk.feedPoint();
      if (!p || o.pack.take(kind, 1) < 1) return '';
      const hour = o.hour();
      const list = lyingAt(saved(), hour, R);
      const tid = list.reduce((m, t) => Math.max(m, t[4]), 0) + 1;
      keep([...list, /** @type {LyingTreat} */ ([kind, r2(p[0]), r2(p[2]), r2(hour), tid])].slice(-TREATS_MAX));
      emitDeferred('treat:placed', { kind, x: p[0], z: p[2], tid });
      emitDeferred('treat:changed', {});
      // The nearest that likes it, species by species: the first that comes has it.
      let waits = '';
      for (const { key, T } of likersOf(kind, o.species)) {
        const live = o.species.find((s) => s.key === key)?.live;
        const r = live?.treat(p[0], p[2], { treat: T.id, tid, reachM: T.reachM }) ?? 'none';
        if (r === 'coming') return W.coming?.[key] ?? W.none ?? '';
        if (r === 'waiting') waits = W.waiting?.[key] ?? '';
      }
      return waits || (W.none ?? '');
    },

    /** The treats lying now, for the drawing: kind, where, and how pale (0..1). */
    lying() {
      const h = o.hour();
      return lyingAt(saved(), h, R).map((t) => ({ kind: t[0], x: t[1], z: t[2], pale: paleOf(t, h, R), tid: t[4] }));
    },

    dispose() { off(); },
  };
}

/** @typedef {ReturnType<typeof createTreats>} Treats */
