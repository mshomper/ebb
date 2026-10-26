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
 * @property {(rect: { x0: number, z0: number, x1: number, z1: number } | null, at?: { x: number, z: number }) => boolean} offPad
 *   a stroke's rect (terrain:stroke-ended's, world m), or a pour's point, reaches ground outside the camp pad
 * @property {() => { x: number, z: number } | null} ring  the fire ring's slot
 * @property {() => boolean} fireLit
 * @property {(part: 'tent' | 'ring') => boolean} campHas  the tent pitched, the ring laid (E3's camp)
 * @property {() => number} sunsetInH  game hours until the sun next sets (0 or less once it has set today)
 * @property {() => number} day  whole game days since the island's first (0 on the first evening, 1 after its midnight)
 * @property {() => boolean} sunUp  the sun is above the horizon
 * @property {(kind: string) => string | null} storeOf  the camp store a pack kind is kept in (sticks, stones, clay), or null
 * @property {(store: string) => number} storeHolds  handfuls on a store's pile now
 */

/**
 * A beat's memory. @typedef {Object} BeatMemory
 * @property {Record<string, any[]>} seen  payloads of the events the beat listens to, since it (or its part) started
 * @property {Record<string, any[]>} ever  the same, since the director started this visit (a part done early)
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

  /** You are up above the island. */
  above: (ctx) => !ctx.walker().below,

  /** You are down on foot. */
  below: (ctx) => ctx.walker().below,

  /** A brush stroke of this mode (raise, lower, smooth, paint) ended off the pad, this visit. */
  stroked: (ctx, a, mem) => (mem.ever['terrain:stroke-ended'] ?? []).some((p) => p?.mode === a.mode && ctx.offPad(p.rect ?? null)),

  /** A Water stroke of this mode (pour, drain) ended off the pad, this visit. */
  poured: (ctx, a, mem) => (mem.ever['water:pour-ended'] ?? []).some((p) => (p?.mode ?? 'pour') === a.mode && ctx.offPad(null, p)),

  /** n seeds of a species took, this visit (`sow:landed` with ok). */
  sown: (_c, a, mem) => (mem.ever['sow:landed'] ?? []).filter((p) => p?.ok && p.species === a.species).length >= (a.n ?? 1),

  /** n handfuls set down at a store (sticks: the wood store, stones: the stone pile), this visit, or it holds them. */
  setDownAt: (ctx, a, mem) => {
    const n = a.n ?? 1;
    const put = (mem.ever['pack:set-down'] ?? []).reduce((s, p) => s + (ctx.storeOf(p?.kind) === a.store ? p.handfuls ?? 1 : 0), 0);
    return put >= n || ctx.storeHolds(a.store) >= n;
  },

  /** The sun has set today, or the night is past midnight. */
  afterSunset: (ctx) => ctx.sunsetInH() <= 0 || ctx.day() > 0,

  /** The fire burns (lit before its beat asked, the beat goes straight on to its next line). */
  fireLit: (ctx) => ctx.fireLit(),

  /** The tent stands (pitched before its beat came, the beat is done as soon as it starts). */
  tentPitched: (ctx) => ctx.campHas('tent'),

  /** The ring is laid (the same, laid early). */
  ringLaid: (ctx) => ctx.campHas('ring'),

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
  above: ['walk:went-up'],
  below: ['walk:went-down'],
  stroked: ['terrain:stroke-ended'],
  poured: ['water:pour-ended'],
  sown: ['sow:landed'],
  setDownAt: ['pack:set-down'],
};
