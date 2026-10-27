// @ts-check
// Planting from below, live (P2g; recipes/world/sowing.json p2gNote). What the pack holds to plant,
// sown and set through the growth system's own planting path (growth.plant through the plant tool),
// so live play and catch-up see the same island: saved seed tossed like the tin's (G1); a seed ball
// landing as a small cluster on ground a little poorer than a seed needs (G5); a lifted clump set in
// at the size it was (G2); a willow withy pushed in to root as a young willow under willow's own
// ground rule and island cap (G3); kelp, wrack or ash laid in the hole first for a stronger start (G4).
// And lifting: the plant card's Lift with the shovel takes a plant up whole into a clump (G2).
// Every check is the ring's: inked where it would take, faint and crossed with the reason where not.

import { get, update } from '../../core/store.js';
import { emitDeferred } from '../../core/events.js';
import { onAction } from '../../input/actions.js';
import { registerCardAction } from '../../ui/card-actions.js';
import { ballSpots } from './model.js';

/**
 * @param {{ recipe: any, plantTool: any, growth: any, pack: any, flora: Record<string, any>, hasShovel: () => boolean, plants: () => any[],
 *   walk: any, ground: (x: number, z: number) => number, worldChanged: () => void }} o
 *   recipe: recipes/world/sowing.json; growth: src/world/growth (lift); pack: the live pack; plants:
 *   the island's plants now (world.state.growth.plants); worldChanged: the world state moved on
 */
export function createPlanting(o) {
  const R = o.recipe, W = R.words;
  const say = (/** @type {string} */ text, showS = 5) => { if (text) emitDeferred('island:notice', { text, showS }); };
  const spacing = (/** @type {string} */ sp) => o.flora[sp]?.spread?.minSpacingM ?? 0.5;

  /** A Lift on its way: the plant, where it is, when its act ends (0 while walking). @type {{ id: number, x: number, z: number, until: number, at: number } | null} */
  let liftTo = null;

  // The plant card's Lift (G2): a plant on the lift list, when you are below.
  /** The plant a card is about (nearest of its species to its middle). @param {any} c */
  const plantOf = (c) => {
    let best = null, bd = 0.25;
    for (const p of o.plants()) { if (p.sp !== c?.sp) continue; const d = Math.hypot(p.x - c.wx, p.z - c.wz); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  registerCardAction({ id: 'liftclump', icon: 'dig', order: 30, label: W.lift ?? 'Lift with the shovel',
    when: (c) => !!c?.sp && !c.camp && !!o.walk.below && R.lift.species.includes(c.sp) && o.hasShovel() && !!plantOf(c),
    action: (c) => ({ type: 'planting.lift', id: /** @type {any} */ (plantOf(c)).id }) });
  onAction((/** @type {any} */ a) => { if (a.type === 'planting.lift') api.startLift(a.id); });

  /** A ball's seed spots round a point. @param {string} sp @param {number[]} p */
  const cluster = (sp, p) => ballSpots(p[0], p[2], R.ball.seeds, spacing(sp) * R.ball.spreadShare).map(([x, z]) => [x, p[1], z]);

  /** The first of kelp, wrack or ash the pack holds (G4), or null. */
  const startKind = () => (R.goodStart?.kinds ?? []).find((/** @type {string} */ k) => o.pack.has(k)) ?? null;

  /**
   * How a held thing goes in: a clump at its size, a cutting young and capped (the size read from the
   * clump to be taken is only known as it is taken; the ring reads it as a young plant).
   * @param {any} item @param {{ size: number, best: number } | null} [clump]
   * @returns {import('../growth/starters.js').PlantOpts}
   */
  function optsOf(item, clump = null) {
    if (item.kind === 'ball') return { minSuit: R.ball.minSuit };
    if (item.kind === 'cutting') return { size: R.cutting.size, capped: true };
    if (item.kind === 'clump') {
      const young = o.flora[item.species]?.growth?.stages?.youngSize ?? 0.2;
      return clump ? { size: clump.size, best: clump.best } : { size: young };
    }
    return {};
  }

  const api = {
    /**
     * Would the held thing take at a ground point? A ball: if any of its seeds would; the words of
     * the middle's when none. @param {any} item @param {number[]} p @returns {{ ok: boolean, message: string }}
     */
    check(item, p) {
      if (item.kind !== 'ball') return o.plantTool.check(item.species, p, optsOf(item));
      const all = [p, ...cluster(item.species, p)].map((q) => o.plantTool.check(item.species, q, optsOf(item)));
      return all.slice(1).some((c) => c.ok) ? { ok: true, message: '' } : all[0];
    },

    /**
     * Sow saved seed or a seed ball where it lands (the flick has played): the handful leaves the
     * pack, and the seed (or the ball's seeds) go in. @param {any} item @param {number[]} p
     * @returns {boolean} whether anything went in
     */
    sow(item, p) {
      if (o.pack.take(item.from, 1) < 1) return false;
      if (item.kind !== 'ball') return o.plantTool.tap(item.species, p, { given: true });
      let any = false;
      for (const q of cluster(item.species, p)) any = o.plantTool.tap(item.species, q, { given: true, plant: optsOf(item) }) || any;
      return any;
    },

    /**
     * Set a clump in, or push a withy in (the walker is there and has knelt): it leaves the pack and
     * goes in through the growth system, bigger by the good start if kelp, wrack or ash lies in the
     * hole first. @param {any} item @param {number[]} p @returns {boolean}
     */
    set(item, p) {
      if (!this.check(item, p).ok) { say(W.setGone); return false; }
      let clump = null;
      if (item.kind === 'clump') { clump = o.pack.takeClump(item.species) ?? { size: optsOf(item).size ?? 0.2, best: 0 }; }
      else if (o.pack.take(item.from, 1) < 1) return false;
      const plant = optsOf(item, clump);
      const sk = startKind();
      if (sk && o.pack.take(sk, 1) > 0) {
        plant.size = Math.min(1, (plant.size ?? 0) + R.goodStart.bonus);
        // The first time, one line.
        if (!get('unlocks')?.earned?.goodStart) {
          update('unlocks', (u) => ({ ...u, earned: { ...(u?.earned ?? {}), goodStart: true } }));
          say(W.goodStart.replace('{kind}', o.pack.nameOf(sk).toLowerCase()), 7);
        }
      }
      const ok = o.plantTool.tap(item.species, p, { given: true, plant });
      if (ok) say(item.kind === 'cutting' ? W.rooted : W.set, 4);
      return ok;
    },

    /**
     * Can the plant on a card be lifted whole now? why: 'shovel', 'big', 'full' or null.
     * @param {any} plant a growth plant @returns {{ ok: boolean, why: string | null }}
     */
    liftable(plant) {
      const L = R.lift;
      if (!plant || !L.species.includes(plant.sp)) return { ok: false, why: null };
      if (!o.hasShovel()) return { ok: false, why: 'shovel' };
      if (plant.size > (L.maxSize?.[plant.sp] ?? 1)) return { ok: false, why: 'big' };
      if (!o.pack.roomForClump(plant.sp)) return { ok: false, why: 'full' };
      return { ok: true, why: null };
    },

    /**
     * Lift on a plant's card: walk into reach, then the liftClump act (the shovel in, a lean back,
     * the clump up on the blade), and as it ends the plant comes up whole (update()).
     * @param {number} id
     */
    startLift(id) {
      const p = o.plants().find((q) => q.id === id);
      if (!p || liftTo || !o.walk.below) return;
      const why = this.liftable(p).why;
      if (why) { say(W[{ shovel: 'liftNoShovel', big: 'liftTooBig', full: 'liftFull' }[why] ?? ''] ?? '', 5); return; }
      update('identify', () => null);
      if (o.walk.distTo(p.x, p.z) > R.lift.reachM && !o.walk.tap(-1e4, -1e4, [p.x, o.ground(p.x, p.z), p.z], R.lift.reachM)) return;
      liftTo = { id, x: p.x, z: p.z, until: 0, at: performance.now() };
    },

    /** Each frame: a Lift on its way (walking, then the act, then the plant comes up). @param {number} now */
    update(now) {
      if (!liftTo) return;
      if (!o.walk.below) { liftTo = null; return; }
      if (!liftTo.until) {
        if (o.walk.busy()) { if (now - liftTo.at > 8000) liftTo = null; return; }
        if (o.walk.distTo(liftTo.x, liftTo.z) > R.lift.reachM + 0.6) { liftTo = null; return; }
        o.walk.faceToward(liftTo.x, liftTo.z);
        if (!o.walk.act('liftClump')) { liftTo = null; return; }
        liftTo.until = now;
        return;
      }
      // The plant comes up as the act ends.
      if (o.walk.acting === 'liftClump') return;
      const id = liftTo.id;
      liftTo = null;
      if (this.lift(id)) o.worldChanged();
    },

    /** Is a Lift on its way (the shovel in the hands while it plays)? */
    lifting: () => !!liftTo?.until,

    /**
     * Lift a plant whole (the liftClump act has played): it leaves the island and its clump fills a
     * pouch, its size kept. @param {number} id @returns {boolean}
     */
    lift(id) {
      const p = o.plants().find((q) => q.id === id);
      if (!p || !this.liftable(p).ok) return false;
      const out = o.growth.lift(id);
      if (!out) return false;
      o.pack.addClump(out.sp, out.size, out.best);
      emitDeferred('plant:lifted', { id, sp: out.sp, x: out.x, z: out.z });
      say(W.lifted, 6);
      return true;
    },
  };
  return api;
}
