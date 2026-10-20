// @ts-check
// Quiet watching (S6c, doc 23): a stretch of a still camera near a frog earns it a little trust.
// Per frog, a stretch runs while a presence source is slower than watch.stillMps within watch.reachM
// of it; it closes when the source moves on or away, or when it reaches watch.capS. A closed
// stretch of at least watch.minS is handed back as minutes, for the app to record as a trust event
// (trust.js) that the next hourly tick applies. Live only; an open stretch is never saved.

/**
 * @param {{ reachM: number, minS: number, capS: number, stillMps: number }} W recipes/species/frog.json presence.watch
 */
export function createWatching(W) {
  /** Seconds of the open stretch per frog. @type {Map<number, number>} */
  const open = new Map();

  return {
    /**
     * One frame. Returns the stretches that closed long enough to count.
     * @param {{ id: number, x: number, y: number, z: number, mode: string }[]} frogs
     * @param {import('./presence.js').PresenceSource[]} sources @param {number} dt seconds
     * @returns {{ id: number, minutes: number }[]}
     */
    step(frogs, sources, dt) {
      /** @type {{ id: number, minutes: number }[]} */ const done = [];
      const close = (/** @type {number} */ id) => {
        const s = open.get(id) ?? 0;
        open.delete(id);
        if (s >= W.minS) done.push({ id, minutes: Math.round((Math.min(s, W.capS) / 60) * 100) / 100 });
      };
      const here = new Set();
      for (const f of frogs) {
        if (f.mode === 'leave') continue;
        here.add(f.id);
        const quiet = sources.some((s) => s.speed < W.stillMps
          && Math.hypot(s.pos[0] - f.x, s.pos[1] - f.y, s.pos[2] - f.z) <= W.reachM);
        if (!quiet) { if (open.has(f.id)) close(f.id); continue; }
        const s = (open.get(f.id) ?? 0) + dt;
        open.set(f.id, s);
        if (s >= W.capS) close(f.id);
      }
      for (const id of [...open.keys()]) if (!here.has(id)) close(id);
      return done;
    },
    /** Seconds of the open stretch at a frog (tools). @param {number} id */
    openS: (id) => open.get(id) ?? 0,
  };
}
