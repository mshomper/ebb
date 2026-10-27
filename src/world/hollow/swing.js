// @ts-check
// The staff's swing (doc 16, What the keys do: left click swings; H0, October 27, 2026): each hit of a
// swing clip sweeps an arc on the floor in front of the walker, reachM out and arcDeg wide, and lands
// on whatever stands in it. Where the hits fall in a clip is a recipe value (recipes/world/hollow.json
// swing.clips: shares of the clip's length). Pure.

/**
 * The things a hit lands on: within reachM (plus each one's own size) and within arcDeg / 2 of the
 * walker's facing. @template {{ x: number, z: number, broken?: boolean }} T
 * @param {number} x @param {number} z @param {number} yaw the walker @param {T[]} things
 * @param {number} reachM @param {number} arcDeg @param {(t: T) => number} [sizeOf] each thing's own radius (m)
 * @returns {T[]}
 */
export function arcHits(x, z, yaw, things, reachM, arcDeg, sizeOf = () => 0.3) {
  const half = (arcDeg / 2) * Math.PI / 180;
  return things.filter((t) => {
    if (t.broken) return false;
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz);
    if (d > reachM + sizeOf(t)) return false;
    if (d < 0.3) return true;
    const a = Math.atan2(dx, dz) - yaw;
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= half + Math.atan2(sizeOf(t), d);
  });
}

/**
 * The swing chain (Matt, October 27, 2026): one swing a click, chaining to the second and third. A
 * combo clip is cut into single swings round its strikes (chain.segments, chain.hits, seconds of the
 * clip), each played S.speed times faster. A click during a swing queues the next, which starts
 * chainAfterHitS after this one's hit; a click within chainWindowS of a swing ending chains too; any
 * other click starts again from the first. Pure: the caller plays the clip spans and lands the hits.
 * @param {{ speed: number, chainAfterHitS: number, chainWindowS: number }} S recipes/world/hollow.json swing
 */
export function createSwingChain(S) {
  /** The swing playing: its chain, which swing of it, seconds in, its length, when its hit lands. */
  /** queued: clicks waiting for the swings after this one. */
  /** @type {{ chain: { segments: number[][], hits: number[] }, seg: number, t: number, lenS: number, hitAt: number, landed: boolean, queued: number } | null} */
  let cur = null;
  /** The swing that last ended, and how long ago (for the chain window). */
  let last = { chain: /** @type {any} */ (null), seg: -1, ago: Infinity };
  /** @param {{ segments: number[][], hits: number[] }} chain @param {number} seg */
  const begin = (chain, seg, queued = 0) => {
    const [a, b] = chain.segments[seg];
    cur = { chain, seg, t: 0, lenS: (b - a) / S.speed, hitAt: (chain.hits[seg] - a) / S.speed, landed: false, queued };
    return { type: /** @type {'start'} */ ('start'), seg, span: [a, b], lenS: cur.lenS };
  };
  return {
    /** A swing is playing. */
    get swinging() { return !!cur; },
    /** Which swing of the chain is playing (0, 1, 2), or -1. */
    get seg() { return cur ? cur.seg : -1; },
    /**
     * A click. Returns the swing to start now (its span of the clip and its length), or null (queued,
     * or nothing). @param {{ segments: number[][], hits: number[] }} chain
     */
    press(chain) {
      if (cur) { cur.queued = Math.min(cur.queued + 1, cur.chain.segments.length - 1 - cur.seg); return null; }
      const next = last.chain === chain && last.ago <= S.chainWindowS && last.seg + 1 < chain.segments.length ? last.seg + 1 : 0;
      return begin(chain, next);
    },
    /** Stop at once (a hit taken). */
    stop() { if (cur) last = { chain: cur.chain, seg: -1, ago: Infinity }; cur = null; },
    /**
     * Each frame: hit when the strike comes; the next swing when queued (after the hit) or the end.
     * @param {number} dt @returns {({ type: 'hit', seg: number } | { type: 'start', seg: number, span: number[], lenS: number } | { type: 'end', seg: number })[]}
     */
    update(dt) {
      /** @type {any[]} */ const ev = [];
      last.ago += dt;
      if (!cur) return ev;
      cur.t += dt;
      if (!cur.landed && cur.t >= cur.hitAt) { cur.landed = true; ev.push({ type: 'hit', seg: cur.seg }); }
      if (cur.queued > 0 && cur.landed && cur.t >= cur.hitAt + S.chainAfterHitS) ev.push(begin(cur.chain, cur.seg + 1, cur.queued - 1));
      else if (cur.t >= cur.lenS) { ev.push({ type: 'end', seg: cur.seg }); last = { chain: cur.chain, seg: cur.seg, ago: 0 }; cur = null; }
      return ev;
    },
  };
}

/**
 * The hits due between two moments of a swing, as indices into its hits list (shares of its length).
 * @param {number[]} hits shares 0..1 @param {number} lenS the clip's length @param {number} t0 @param {number} t1 seconds into it
 */
export function hitsDue(hits, lenS, t0, t1) {
  /** @type {number[]} */ const out = [];
  hits.forEach((h, i) => { const at = h * lenS; if (at > t0 && at <= t1) out.push(i); });
  return out;
}
