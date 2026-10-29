// @ts-check
// Planting on foot, live (D1a; Matt, October 24, 2026; recipes/world/sowing.json). Pick a seed in
// the seed tin, a gift on the gift spot, or the net, on the walker's bar: it is in hand (store slice
// `hand`), and a pencil ring follows the pointer, inked where it would take, faint and crossed with
// the reason where not. A click anywhere in view sows: the walker stays where it stands, turns to
// the spot and flicks the seed (the `sow` gesture), which flies on a dotted line and lands with a
// puff of soil or a splash. A gift is placed the same way (pondweed, or a reed raft that is simply
// there on the pond). The net is different: a click walks you to the spot, and you kneel and set it.
// A click on a spot that will not do changes nothing. Esc, Go up or the item again puts it away.
//
// The planting is the world's (growth.plant through the plant tool), so live play and catch-up see
// the same island; the ring, the line and the puff are UI only, never saved.

import { emitDeferred } from '../../core/events.js';
import { get, update } from '../../core/store.js';
import { tinItems, giftItems, notePlaced, tossPlan, landing, samePick } from './model.js';
import { stoneWaiting } from '../camp/gifts.js';

/**
 * @typedef {{ x: number, y: number, z: number, r: number, ok: boolean, message: string, flashAt: number }} Ring
 * @typedef {{ from: number[], to: number[], plan: ReturnType<typeof tossPlan>, at: number, land: ReturnType<typeof landing> }} Toss
 */

/**
 * @param {{ recipe: any, plantTool: any, pieces: any, nets: any, walk: any, ground: (x: number, z: number) => number,
 *   depth: (x: number, z: number) => number, worldChanged: () => void, planting: ReturnType<typeof import('./planting.js').createPlanting> }} o
 *   recipe: recipes/world/sowing.json; plantTool: src/world/growth/plant-tool.js; depth: water over a
 *   spot now (m); worldChanged: the world state moved on (a seed went in); planting: what the pack
 *   holds to plant, sown and set (P2g, planting.js)
 */
export function createSowing(o) {
  const R = o.recipe;
  /** @type {Ring | null} */ let ring = null;
  /** @type {Toss[]} */ let tosses = [];
  /** The last point under the pointer, and when the ring was last read. @type {number[] | null} */ let pointer = null;
  let readAt = -1e9;
  /** A net you are walking out to set. @type {number[] | null} */ let netTo = null;
  /** A clump or a withy you are walking over to set in (P2g). @type {{ item: any, p: number[] } | null} */ let setTo = null;

  /** What the tin, the gift spot and the net hold now: the tin with what the pack holds to plant (P2g). */
  function items() {
    const u = get('unlocks');
    return { tin: tinItems(R, get('packView')?.pouches ?? []), gifts: giftItems(R, u, stoneWaiting(get('camp'), R)), net: !!u?.nets?.general && !!o.nets.nets().length };
  }
  /** The item in hand as it is now, or null (a gift with none left is gone from the hand). */
  function held() {
    const h = get('hand');
    if (!h) return null;
    const it = items();
    if (h.kind === 'net') return it.net ? { kind: 'net', id: 'net' } : null;
    return [...it.tin, ...it.gifts].find((i) => samePick(i, h)) ?? null;
  }
  const say = (/** @type {string} */ text, showS = R.words.noticeS ?? 5) => { if (text) emitDeferred('island:notice', { text, showS }); };

  /** Would the item in hand take at a ground point? @param {any} item @param {number[]} p */
  function check(item, p) {
    if (item.kind === 'net') return o.nets.check(p);
    if (item.kind === 'gift' && item.place === 'raft') return o.pieces.raftCheck(p);
    // What the pack holds (P2g): saved seed, a seed ball, a clump, a withy.
    if (item.from) return o.planting.check(item, p);
    return o.plantTool.check(item.species, p);
  }

  /** The ring at a point, read now. @param {any} item @param {number[]} p */
  function ringAt(item, p) {
    const c = check(item, p);
    const d = o.depth(p[0], p[2]);
    return { x: p[0], y: p[1] + Math.max(0, d), z: p[2], r: R.ring.radiusM, ok: !!c.ok, message: c.ok ? '' : c.message ?? '', flashAt: ring?.flashAt ?? -1e9 };
  }

  /** The seed leaves the hand toward p (UI only). @param {number[]} p */
  function toss(p) {
    const me = o.walk.spot();
    if (!me) return;
    const from = [me.x, o.ground(me.x, me.z) + R.toss.handM, me.z];
    const d = o.depth(p[0], p[2]);
    const to = [p[0], p[1] + Math.max(0, d), p[2]];
    const plan = tossPlan(from, to, R.toss);
    tosses.push({ from, to, plan, at: performance.now() + R.flickS * 1000, land: landing(d, plan.near, R.splash) });
  }

  /** The first sowing ever: a line that plants spread on their own (kept in the saved unlocks). */
  function firstSow() {
    if (get('unlocks')?.earned?.firstSown) return;
    update('unlocks', (u) => ({ ...u, earned: { ...(u?.earned ?? {}), firstSown: true } }));
    say(R.words.firstSow, R.words.firstSowS ?? 10);
  }

  const api = {
    items,
    held,

    /**
     * Pick an item (the tin's seed, a gift, the net), or put it away if it is already in hand.
     * @param {{ kind: 'seed' | 'ball' | 'clump' | 'cutting' | 'gift' | 'net', id: string }} pick
     */
    pick(pick) {
      if (samePick(get('hand'), pick)) { api.putAway(); return; }
      update('hand', () => ({ kind: pick.kind, id: pick.id }));
      readAt = -1e9;
    },

    /** Put whatever is in hand away. */
    putAway() {
      if (get('hand')) update('hand', () => null);
      ring = null;
    },

    /** The ground point under the pointer, or null (off the island, or the pointer left). @param {number[] | null} p */
    setPointer(p) {
      pointer = p;
      if (!p) ring = null;
    },

    /**
     * A click while something is in hand: sow, place, or walk out to set the net; on a spot that
     * will not do, only the reason. False when nothing is in hand (the click walks as usual).
     * @param {number} sx @param {number} sy CSS pixels @param {number[]} p the ground point
     */
    click(sx, sy, p) {
      const item = /** @type {any} */ (held());
      if (!item) { if (get('hand')) api.putAway(); return false; }
      ring = ringAt(item, p);
      // Where a seed lands, and whether it took (the first evening's planting beat, src/world/intro).
      const landed = (/** @type {boolean} */ ok) => { if (item.species) emitDeferred('sow:landed', { species: item.species, x: p[0], z: p[2], ok }); };
      if (!ring.ok) { ring.flashAt = performance.now(); landed(false); return true; }
      if (item.kind === 'net') {
        // The walker walks out to the spot, then kneels and sets it (update()).
        if (o.walk.tap(sx, sy, p, R.net.reachM)) { netTo = p; say(R.words.netWalk, 3); }
        api.putAway();
        return true;
      }
      // A clump or a withy (P2g): walk there, then kneel and set it in (update()).
      if (item.kind === 'clump' || item.kind === 'cutting') {
        if (o.walk.distTo(p[0], p[2]) <= R.set.reachM || o.walk.tap(sx, sy, p, R.set.reachM)) { setTo = { item, p }; say(R.words.setWalk, 3); }
        api.putAway();
        return true;
      }
      o.walk.gesture('sow', { x: p[0], z: p[2] });
      if (item.kind === 'gift' && item.place === 'raft') {
        const r = o.pieces.raftAdd(p);
        if (!r.ok) { ring.ok = false; ring.message = r.message; ring.flashAt = performance.now(); return true; }
        say(R.words.placed?.raft ?? '', 4);
      } else if (!(item.from ? o.planting.sow(item, p) : o.plantTool.tap(item.species, p, { given: true }))) { landed(false); return true; }
      else { o.worldChanged(); landed(true); }
      toss(p);
      if (item.kind === 'gift') update('unlocks', (u) => ({ ...u, earned: notePlaced(u?.earned, item.id) }));
      else firstSow();
      readAt = -1e9;
      if (!held()) api.putAway();
      return true;
    },

    /**
     * Each frame: the ring sits under the pointer (moved every frame; whether it will grow there is
     * read at most ring.checkHz a second), and a net walk ends in setting it. @param {number} now
     */
    update(now) {
      const item = held();
      if (!item && get('hand')) api.putAway();
      if (item && pointer) {
        if (!ring || now - readAt >= 1000 / R.ring.checkHz) { readAt = now; ring = ringAt(item, pointer); }
        else ring = { ...ring, x: pointer[0], y: pointer[1] + Math.max(0, o.depth(pointer[0], pointer[2])), z: pointer[2] };
      } else ring = null;
      tosses = tosses.filter((t) => now < t.at + (t.plan.s + Math.max(R.toss.fadeS, R.splash.s + R.splash.gapS * 3, R.puff.s)) * 1000);
      o.planting.update(now);
      // At the spot for a clump or a withy (P2g): kneel and set it in, or push it in.
      if (setTo && !o.walk.busy()) {
        const { item: it, p } = setTo;
        setTo = null;
        if (o.walk.distTo(p[0], p[2]) > R.set.reachM + 0.6) return;
        const cut = it.kind === 'cutting';
        o.walk.kneelToward(p[0], p[2], cut ? R.set.pushS : R.set.setS, cut ? 'pushIn' : 'setClump');
        if (o.planting.set(it, p)) o.worldChanged();
      }
      if (netTo && !o.walk.busy()) {
        const p = netTo;
        netTo = null;
        // Interrupted on the way (Go up, another click): no net.
        if (o.walk.distTo(p[0], p[2]) > R.net.reachM + 0.6) return;
        const c = o.nets.check(p);
        if (!c.ok) { say(c.message || R.words.netGone); return; }
        o.walk.kneelToward(p[0], p[2], R.net.standS, 'netSet');
        const r = o.nets.tap(p);
        if (r?.message) say(r.message);
      }
    },

    /** A walk elsewhere (a click with nothing in hand, Go up): forget the net walk. */
    cancelWalk() { netTo = null; setTo = null; },

    /** What the overlay draws now (src/ui/sow-overlay.js). */
    visuals: () => ({ ring, tosses }),
  };
  return api;
}

/** @typedef {ReturnType<typeof createSowing>} Sowing */
