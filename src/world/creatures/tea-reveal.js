// @ts-check
// A long, slow look (P2e, the gorse and chamomile blend): while its boon lasts, a creature you have
// not found yet gives itself away once, when you are on foot and one is within reach: a frog calls
// from where it sits, a school stirs a ripple on the water. Then the reveal is spent (boons.js). It
// only points: nothing about the creature changes, so the world and the save are as they were.
// Emits creature:reveal { species, x, y, z } (the audio plays a frog's call from there).

import { get } from '../../core/store.js';
import { emit } from '../../core/events.js';

/**
 * @param {{ frogs: () => { x: number, y?: number, z: number }[], schools: { id: string, reveal: { spots: () => { x: number, z: number }[] } }[],
 *   ripples?: { addImpulse: (x: number, z: number, strength: number, radiusM: number) => void } | null, you: () => number[] | null,
 *   spend: () => void, reachM?: number, ripple?: { strength: number, radiusM: number } }} o
 *   you: the walker's feet, or null while above; spend: the boon's reveal spent
 */
export function createTeaReveal(o) {
  const reachM = o.reachM ?? 40, R = o.ripple ?? { strength: 0.6, radiusM: 0.9 };
  let t = 0;
  /** Found in the journal already? @param {string} id */
  const found = (id) => !!get('journal')?.species?.[id]?.ever;

  /** The nearest unfound creature within reach of p, or null. @param {number[]} p */
  function nearest(p) {
    /** @type {{ species: string, x: number, y: number, z: number, d: number } | null} */ let best = null;
    const take = (/** @type {string} */ species, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
      const d = Math.hypot(x - p[0], z - p[2]);
      if (d <= reachM && (!best || d < best.d)) best = { species, x, y, z, d };
    };
    if (!found('frogs')) for (const f of o.frogs()) take('frogs', f.x, f.y ?? p[1], f.z);
    for (const s of o.schools) if (!found(s.id)) for (const c of s.reveal.spots()) take(s.id, c.x, p[1], c.z);
    return best;
  }

  return {
    /** Now and then, while the boon offers a reveal. @param {number} dt real seconds */
    update(dt) {
      if ((t -= dt) > 0) return;
      t = 1;
      if (!get('boonLift')?.reveal) return;
      const p = o.you();
      if (!p) return;
      const c = nearest(p);
      if (!c) return;
      if (c.species !== 'frogs') o.ripples?.addImpulse(c.x, c.z, R.strength, R.radiusM);
      emit('creature:reveal', { species: c.species, x: c.x, y: c.y, z: c.z });
      o.spend();
    },
  };
}
