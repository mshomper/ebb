// @ts-check
// The first evening's done-checks (docs/future/13 section 2.3): one small pure function each, named
// in recipes/world/intro.json. Each reads the world through the director's context and the beat's
// memory (the events seen since the beat started, and anything the check keeps between frames), and
// says whether the beat is done. None of them changes anything.

/**
 * What the checks can read (index.js builds it from the live game; tests build it by hand).
 * @typedef {Object} IntroContext
 * @property {() => { x: number, z: number, posture: string, below: boolean }} walker
 * @property {(x: number, z: number) => boolean} onLand  dry ground you can stand on
 * @property {() => { x: number, z: number } | null} spring  the first spring's pool
 * @property {() => boolean} journalOpen
 * @property {(need: Record<string, number>) => boolean} packHolds  handfuls by group or kind (E2)
 * @property {(rect: { minX: number, minZ: number, maxX: number, maxZ: number } | null, at?: { x: number, z: number }) => boolean} offPad
 *   a stroke's rect, or a pour's point, reaches ground outside the camp pad
 * @property {() => { x: number, z: number } | null} ring  the fire ring's slot
 * @property {() => boolean} fireLit
 * @property {() => number} sunsetInH  game hours until the sun next sets (0 or less once it has set today)
 */

/**
 * A beat's memory. @typedef {Object} BeatMemory
 * @property {Record<string, any[]>} seen  payloads of the events the beat listens to, since it started
 * @property {number} still  seconds the walker has sat still by the fire
 * @property {boolean} sawOpen  the journal was seen open during this beat
 */

/** @param {{ x: number, z: number }} a @param {{ x: number, z: number }} b */
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** @type {Record<string, (ctx: IntroContext, args: any, mem: BeatMemory, dt: number) => boolean>} */
export const CHECKS = {
  /** A walk ended on land (`walk:arrived`). */
  arrivedOnLand: (ctx, _a, mem) => (mem.seen['walk:arrived'] ?? []).some((p) => ctx.onLand(p.x, p.z)),

  /** The walker kneels within reach of the spring's pool. */
  kneltAtSpring: (ctx, a, _m) => {
    const w = ctx.walker(), s = ctx.spring();
    return !!s && w.below && w.posture === 'kneel' && dist(w, s) <= (a.reachM ?? 1.5);
  },

  /** The journal was opened on the page and has been closed again. */
  journalClosed: (ctx, _a, mem) => {
    if (ctx.journalOpen()) { mem.sawOpen = true; return false; }
    return mem.sawOpen;
  },

  /** The pack holds what the ring needs. */
  packHolds: (ctx, a) => ctx.packHolds(a.need ?? {}),

  /** A Sculpt stroke or a Water pour ended that reached ground off the pad. */
  shapedOffPad: (ctx, _a, mem) =>
    (mem.seen['terrain:stroke-ended'] ?? []).some((p) => ctx.offPad(p?.rect ?? null))
    || (mem.seen['water:pour-ended'] ?? []).some((p) => ctx.offPad(null, p)),

  /** The sun has set today. */
  afterSunset: (ctx) => ctx.sunsetInH() <= 0,

  /** The fire is lit and the walker has sat within reach of it for stillS seconds (sitting needs nothing else). */
  satByFire: (ctx, a, mem, dt) => {
    const w = ctx.walker(), r = ctx.ring();
    const by = !!r && ctx.fireLit() && w.below && w.posture === 'sit' && dist(w, r) <= (a.reachM ?? 1.5);
    mem.still = by ? mem.still + dt : 0;
    return mem.still >= (a.stillS ?? 20);
  },
};

/** The events a check needs to see, so the director listens for them while its beat runs. */
export const CHECK_EVENTS = {
  arrivedOnLand: ['walk:arrived'],
  packHolds: ['pack:changed'],
  shapedOffPad: ['terrain:stroke-ended', 'water:pour-ended'],
};
