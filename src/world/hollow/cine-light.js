// @ts-check
// The lantern takes part in the Hollow's moves (the moves' cinematic pass, November 3, 2026; doc 16,
// How the moves look): its light dims while a move gathers power, swells for a moment as the move
// leaves, then comes back (with a sputter after the big ones), and stays a touch lower while
// something carried out of it is still out (Moth lure's moths). Shares of the lantern's own strength
// and reach, so the light stays physical: the flashes, shadows and afterglows themselves are effect
// lights in move-fx.js. Real time. Numbers in recipes/world/hollow-cine.json light. Pure.

const smooth = (/** @type {number} */ t) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };

/** @param {{ sputterHz: number, sputterShare: number }} L recipes/world/hollow-cine.json light */
export function createCineLight(L) {
  /** The gather under way: where it eases to and how fast; null once released. */
  /** @type {{ gain: number, reach: number, inS: number, t: number } | null} */
  let gather = null;
  /** After the release: the swell, the time back, how far in, a sputter's share. */
  /** @type {{ swell: number, backS: number, t: number, sputter: number, from: { gain: number, reach: number } } | null} */
  let back = null;
  /** Holds while something is out (by key): a gain and reach share each. @type {Map<string, { gain: number, reach: number }>} */
  const holds = new Map();
  let gain = 1, reach = 1, clock = 0;
  return {
    /** Dim toward gain and reach (shares) over inS. @param {number} g @param {number} r @param {number} inS */
    gather(g, r, inS) { gather = { gain: g, reach: r, inS: Math.max(1e-3, inS), t: 0 }; back = null; },
    /**
     * The move leaves: a swell to swell times full, then back to full over backS, sputtering by
     * sputter (0 none) on the way. @param {number} swell @param {number} backS @param {number} [sputter]
     */
    release(swell, backS, sputter = 0) { back = { swell, backS: Math.max(1e-3, backS), t: 0, sputter, from: { gain, reach } }; gather = null; },
    /** Stay at a share while something is out. @param {string} key @param {number} g @param {number} r */
    hold(key, g, r) { holds.set(key, { gain: g, reach: r }); },
    /** @param {string} key */
    letGo(key) { holds.delete(key); },
    /** Cancelled before it left (a roll out of the wind-up): back to full quickly. */
    cancel() { if (gather) this.release(1, 0.25, 0); },
    /** @param {number} dt real seconds @returns {{ gain: number, reach: number }} */
    update(dt) {
      clock += dt;
      let g = 1, r = 1;
      if (gather) {
        gather.t += dt;
        const k = smooth(gather.t / gather.inS);
        g = 1 + (gather.gain - 1) * k; r = 1 + (gather.reach - 1) * k;
      } else if (back) {
        back.t += dt;
        const u = back.t / back.backS;
        // The swell lands at once and fades into the climb back from the gathered level.
        const swell = (back.swell - 1) * Math.max(0, 1 - u * 4);
        const k = smooth(u), sp = back.sputter * (1 - k) * (0.5 + 0.5 * Math.sin(clock * L.sputterHz * 2 * Math.PI)) * L.sputterShare;
        g = back.from.gain + (1 - back.from.gain) * k + swell - sp;
        r = back.from.reach + (1 - back.from.reach) * Math.min(1, k * 1.5);
        if (u >= 1) back = null;
      }
      for (const h of holds.values()) { g *= h.gain; r *= h.reach; }
      gain = Math.max(0, g); reach = Math.max(0.05, r);
      return { gain, reach };
    },
    get gain() { return gain; },
    get reach() { return reach; },
    clear() { gather = null; back = null; holds.clear(); gain = reach = 1; },
  };
}
