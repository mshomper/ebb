// @ts-check
// The Hollow's Q and E moves, run from their recipe entries (H0, the move arena; doc 16, Special
// moves: Q and E; recipes/world/hollow-moves.json). A move goes through its wind-up, its active time
// and its recovery; only one plays at a time. Its cost is a wait before it is ready again (halved in
// the gentler Hollow), fuel in sips, once a floor, or seeds from the pack. What a move does to a thing
// is an effect passed through the thing's one call (foes.js take); which things it reaches is the
// geometry here (a ring, a line). Pure: the page plays the clips and draws the marks.

/** @typedef {{ x: number, z: number }} At */

/**
 * The pegs and the move playing. @param {any} MR recipes/world/hollow-moves.json
 * @param {{ gentle?: boolean }} [o]
 */
export function createMoves(MR, o = {}) {
  let gentle = !!o.gentle, seeds = MR.seeds ?? 0;
  /** Seconds left of each move's wait, and the wait it started from. @type {Record<string, { left: number, of: number }>} */
  const waits = {};
  /** Once-a-floor moves already spent. @type {Set<string>} */
  const spent = new Set();
  /** The move playing: its id, where it goes, seconds in, and whether its active part began. */
  /** @type {{ id: string, at: any, t: number, active: boolean, ended: boolean, cut: number } | null} */
  let playing = null;
  const M = (/** @type {string} */ id) => MR.moves[id];
  const total = (/** @type {any} */ m) => m.windS + m.activeS + m.recoverS;

  return {
    get gentle() { return gentle; },
    set gentle(on) { gentle = on; },
    get seeds() { return seeds; },
    /** The move playing (its id), or null. */
    get playing() { return playing ? playing.id : null; },
    /** Seconds into the move playing. */
    get playingT() { return playing ? playing.t : 0; },
    /**
     * Why a move can't go now, or null: waiting, spent (once a floor), seeds (none left), busy (another playing).
     * @param {string} id
     */
    why(id) {
      const m = M(id);
      if (!m) return 'unknown';
      if (m.once && spent.has(id)) return 'spent';
      if (m.seeds && seeds < m.seeds) return 'seeds';
      if ((waits[id]?.left ?? 0) > 0) return 'waiting';
      if (playing) return 'busy';
      return null;
    },
    /** How ready a move is, 0 just used to 1 ready (the tablet's ink). @param {string} id */
    ready(id) { const w = waits[id]; return !w || w.of <= 0 ? 1 : 1 - w.left / w.of; },
    /** Has a once-a-floor move been spent? @param {string} id */
    spent: (/** @type {string} */ id) => spent.has(id),
    /**
     * Start a move toward a place (or a thing). Its costs are paid now: the wait starts, once-a-floor
     * spends it, seeds leave the pack. The caller pays the fuel (sips). Returns whether it started.
     * @param {string} id @param {any} at
     */
    start(id, at) {
      if (this.why(id)) return false;
      const m = M(id), w = (m.waitS ?? 0) * (gentle ? MR.gentlerWaitK : 1);
      waits[id] = { left: w, of: w };
      if (m.once) spent.add(id);
      if (m.seeds) seeds -= m.seeds;
      playing = { id, at, t: 0, active: false, ended: false, cut: Infinity };
      return true;
    },
    /** Cut the move playing short: straight to its recovery (Snuff ends when you move or are hit). */
    cut() { if (playing) { const m = M(playing.id); playing.cut = Math.min(playing.t, m.windS + m.activeS); } },
    /**
     * Each frame: waits run down, and the move playing moves on. Returns what happened: its active
     * part beginning ('active'), its active part ending ('ended'), the move done ('done').
     * @param {number} dt @returns {{ type: 'active' | 'ended' | 'done', id: string, at: any }[]}
     */
    update(dt) {
      for (const w of Object.values(waits)) w.left = Math.max(0, w.left - dt);
      /** @type {{ type: 'active' | 'ended' | 'done', id: string, at: any }[]} */ const ev = [];
      if (!playing) return ev;
      const p = playing, m = M(p.id);
      p.t += dt;
      if (!p.active && p.t >= m.windS) { p.active = true; ev.push({ type: 'active', id: p.id, at: p.at }); }
      if (p.active && !p.ended && p.t >= Math.min(m.windS + m.activeS, p.cut)) { p.ended = true; ev.push({ type: 'ended', id: p.id, at: p.at }); }
      if (p.t >= Math.min(total(m), p.cut + m.recoverS)) { ev.push({ type: 'done', id: p.id, at: p.at }); playing = null; }
      return ev;
    },
    /** A new floor: once-a-floor moves come back, and the pack's seeds. */
    newFloor() { spent.clear(); seeds = MR.seeds ?? 0; for (const w of Object.values(waits)) w.left = 0; playing = null; },
    /** A move's whole time (s), for its clip. @param {string} id */
    lengthS: (/** @type {string} */ id) => total(M(id)),
  };
}

/**
 * Things within a ring. @template {{ x: number, z: number, broken?: boolean }} T
 * @param {T[]} things @param {number} x @param {number} z @param {number} r @param {(t: T) => number} [sizeOf]
 */
export const inRing = (things, x, z, r, sizeOf = () => 0) => things.filter((t) => !t.broken && Math.hypot(t.x - x, t.z - z) <= r + sizeOf(t));

/**
 * Things standing on a line from (x0, z0) to (x1, z1), within widthM / 2 of it (a crack, a beam).
 * Returns each with how far along it lies (m). @template {{ x: number, z: number, broken?: boolean }} T
 * @param {T[]} things @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 @param {number} widthM
 * @returns {{ thing: T, alongM: number }[]}
 */
export function onLine(things, x0, z0, x1, z1, widthM) {
  const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
  /** @type {{ thing: T, alongM: number }[]} */ const out = [];
  for (const t of things) {
    if (t.broken) continue;
    const px = t.x - x0, pz = t.z - z0, along = px * ux + pz * uz, side = Math.abs(px * uz - pz * ux);
    if (along >= 0 && along <= l && side <= widthM / 2) out.push({ thing: t, alongM: along });
  }
  return out;
}

/**
 * The thing a targeted move takes: the locked one, or else the live thing nearest the dot within
 * pickM of it, if any is within reachM of the walker. @template {{ x: number, z: number, id: number, broken?: boolean }} T
 * @param {T[]} things @param {number | null} locked @param {At} dot @param {At} you @param {number} reachM @param {number} pickM
 * @returns {T | null}
 */
export function pickTarget(things, locked, dot, you, reachM, pickM) {
  const live = things.filter((t) => !t.broken && Math.hypot(t.x - you.x, t.z - you.z) <= reachM);
  const l = live.find((t) => t.id === locked);
  if (l) return l;
  let best = null, bd = pickM;
  for (const t of live) { const d = Math.hypot(t.x - dot.x, t.z - dot.z); if (d <= bd) { bd = d; best = t; } }
  return best;
}
