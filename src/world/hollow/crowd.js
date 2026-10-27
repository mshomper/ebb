// @ts-check
// The Hollow's crowd (H2, Matt, October 27, 2026): things that come for the walker keep out of each
// other's bodies and take turns. Two rules, one fixed way each, no learning:
//   attack slots: at most attackSlots things (gentleSlots in the gentler Hollow) may close in and wind
//     up at once. A thing takes a slot when it is coming for you (a crawler from noticing you on; a
//     watcher or motes only once ready to strike) and lets it go when it recovers, gives up or breaks.
//     Turns go round in a queue: those coming together line up nearest first (then by id), and one
//     that has had its turn goes to the back, so every one gets a turn and none is starved. The rest
//     wait on a ring round the walker, ringM out (each a seeded share of ringSpreadM further), spread
//     at least spreadDeg apart, facing you, in plain sight.
//   bodies: after the steps each frame, any two things closer than their bodies (foes[kind].bodyM;
//     a mote cluster is one body) are pushed apart along the line between them, push of the overlap a
//     frame. A thing winding up, striking, stuck after it, stunned or knocked back holds its ground;
//     the other takes the whole push; if both hold (two lunges ending together), they share it. Pushes go through the open ground
//     (nudge checks it), so nothing is pushed into rock. Floating things (the watcher) only space
//     against other floating things. The walker is a body too (walkerBodyM) that never moves for them:
//     a thing inside it is pushed out unless it holds its ground. (A lunge stops at the walker's body
//     in foes.js.)
// Every pass runs in id order, so the same seed and the same moves give the same crowd. Pure: the
// caller gives the things and the walker. Numbers: recipes/world/hollow.json crowd and foes.*.bodyM.

import { hash32 } from '../../core/rng.js';

const DEG = Math.PI / 180;
const wrap = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * One thing as the crowd reads it (foes.js gives these).
 * @typedef {{ id: number, kind: string, x: number, z: number, step: string, stunS: number, knocked: boolean, broken: boolean,
 *   K: any, wantsSlot: boolean, nudge: (dx: number, dz: number, w?: { open: (x: number, z: number) => boolean }) => void }} CrowdFoe
 *   wantsSlot: coming for you (a crawler from noticing you on; a watcher or motes only once ready to strike)
 */

/** Steps that hold their ground. */
const HOLDING = new Set(['wind', 'strike', 'recover']);

/**
 * The walker's solid bodies this frame (Matt, October 27, 2026): a crawler holding its ground (rearing,
 * lunging, stuck after it, stunned: Wick snare, Anchor's reel) is solid, so the walker slides round it
 * (walker.js roundBodies), a roll too; every other state and kind stays walk-through. r is its body
 * and the walker's together. @param {CrowdFoe[]} foes @param {any} C recipes/world/hollow.json crowd
 */
export function walkerBodies(foes, C) {
  return foes.filter((f) => !f.broken && f.kind === 'lunger' && (HOLDING.has(f.step) || f.stunS > 0))
    .map((f) => ({ x: f.x, z: f.z, r: (f.K.bodyM ?? 0.3) + C.walkerBodyM }));
}

/** @param {any} C recipes/world/hollow.json crowd (read live) @param {number} seed */
export function createCrowd(C, seed) {
  /** Who holds a slot. @type {Set<number>} */ const slots = new Set();
  /** Each waiting thing's angle round the walker (radians, kept frame to frame so they settle). @type {Map<number, number>} */
  const angles = new Map();
  /** Where each waiting thing should stand. @type {Map<number, [number, number]>} */ const waits = new Map();
  /** The queue for slots: each waiting thing's ticket (lower goes first). @type {Map<number, number>} */ const queue = new Map();
  let ticket = 0;

  /** Does a thing hold ground this frame? @param {CrowdFoe} f */
  const holds = (f) => HOLDING.has(f.step) || f.stunS > 0 || f.knocked;
  /** Its body's radius (m). @param {CrowdFoe} f */
  const body = (f) => f.K.bodyM ?? 0.3;

  /**
   * Before the steps: who holds a slot, and where everyone else waits.
   * @param {CrowdFoe[]} foes @param {{ x: number, z: number }} you @param {boolean} [gentle] the gentler Hollow
   */
  function assign(foes, you, gentle = false) {
    const live = foes.filter((f) => !f.broken).sort((a, b) => a.id - b.id);
    const ids = new Set(live.map((f) => f.id));
    const far = (/** @type {CrowdFoe} */ f) => Math.hypot(f.x - you.x, f.z - you.z);
    // A turn ends on recover, giving up or breaking: the slot frees and its place in the queue goes.
    for (const id of [...slots]) {
      const f = live.find((g) => g.id === id);
      if (!f || !ids.has(id) || !f.wantsSlot) { slots.delete(id); queue.delete(id); }
    }
    for (const id of [...queue.keys()]) { const f = live.find((g) => g.id === id); if (!f || !f.wantsSlot) queue.delete(id); }
    // Joining the queue: at the back, those joining together nearest first (then by id).
    for (const f of live.filter((g) => g.wantsSlot && !queue.has(g.id)).sort((a, b) => far(a) - far(b) || a.id - b.id)) queue.set(f.id, ticket++);
    const n = gentle ? C.gentleSlots : C.attackSlots;
    const want = live.filter((f) => f.wantsSlot && !slots.has(f.id))
      .sort((a, b) => /** @type {number} */ (queue.get(a.id)) - /** @type {number} */ (queue.get(b.id)));
    for (const f of want) { if (slots.size >= n) break; slots.add(f.id); }
    // The waiting ring: each keeps its angle, nudged apart from its neighbours (and from those coming in).
    const waiting = live.filter((f) => f.wantsSlot && !slots.has(f.id));
    for (const id of [...angles.keys()]) if (!waiting.some((f) => f.id === id)) angles.delete(id);
    for (const f of waiting) if (!angles.has(f.id)) angles.set(f.id, Math.atan2(f.x - you.x, f.z - you.z));
    const fixed = live.filter((f) => slots.has(f.id)).map((f) => Math.atan2(f.x - you.x, f.z - you.z));
    const sep = C.spreadDeg * DEG;
    for (let pass = 0; pass < 6; pass++) {
      for (const f of waiting) {
        let a = /** @type {number} */ (angles.get(f.id)), push = 0;
        for (const g of waiting) if (g.id !== f.id) { const d = wrap(a - /** @type {number} */ (angles.get(g.id))); if (Math.abs(d) < sep) push += (d >= 0 ? 1 : -1) * (sep - Math.abs(d)) * 0.5; }
        for (const b of fixed) { const d = wrap(a - b); if (Math.abs(d) < sep) push += (d >= 0 ? 1 : -1) * (sep - Math.abs(d)); }
        angles.set(f.id, wrap(a + push));
      }
    }
    waits.clear();
    for (const f of waiting) {
      const a = /** @type {number} */ (angles.get(f.id)), r = C.ringM + C.ringSpreadM * ((hash32(seed, f.id) >>> 8) / 16777216);
      waits.set(f.id, [you.x + Math.sin(a) * r, you.z + Math.cos(a) * r]);
    }
  }

  /**
   * After the steps: push overlapping bodies apart, and out of the walker. @param {CrowdFoe[]} foes @param {{ open: (x: number, z: number) => boolean }} w
   * @param {number} dt @param {{ x: number, z: number }} [you] the walker, solid (walkerBodyM) to things on the floor
   */
  function spread(foes, w, dt, you) {
    const live = foes.filter((f) => !f.broken).sort((a, b) => a.id - b.id);
    // A share of the overlap a frame, the same at any frame rate.
    const k = 1 - Math.exp(-dt * C.pushPerS);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (!!a.K.floats !== !!b.K.floats) continue;
        let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        const over = body(a) + body(b) - d;
        if (over <= 0) continue;
        // Right on top of each other: apart along a fixed seeded way.
        if (d < 1e-6) { const t = ((hash32(seed, a.id, b.id) >>> 8) / 16777216) * Math.PI * 2; dx = Math.sin(t); dz = Math.cos(t); d = 1; }
        // One holding its ground: the other takes the whole push; both or neither: half each.
        const ha = holds(a), hb = holds(b);
        const sa = ha === hb ? 0.5 : ha ? 0 : 1, m = over * k;
        a.nudge(-dx / d * m * sa, -dz / d * m * sa, w);
        b.nudge(dx / d * m * (1 - sa), dz / d * m * (1 - sa), w);
      }
      // The walker never moves for them: a thing inside its body takes the whole push out, unless it
      // holds its ground (the walker may still walk into one; Matt's call that you walk through things).
      if (you) for (const f of live) {
        if (f.K.floats || holds(f)) continue;
        let dx = f.x - you.x, dz = f.z - you.z, d = Math.hypot(dx, dz);
        const over = C.walkerBodyM + body(f) - d;
        if (over <= 0) continue;
        if (d < 1e-6) { const t = ((hash32(seed, f.id) >>> 8) / 16777216) * Math.PI * 2; dx = Math.sin(t); dz = Math.cos(t); d = 1; }
        f.nudge(dx / d * over * k, dz / d * over * k, w);
      }
    }
  }

  return {
    assign, spread,
    /** May this thing close in and wind up? @param {number} id */
    may: (id) => slots.has(id),
    /** Where it waits, or null if it holds a slot (or is not coming). @param {number} id */
    waitAt: (id) => waits.get(id) ?? null,
    /** How fast a waiting thing drifts to its place, a share of its closing pace. */
    get driftShare() { return C.driftShare; },
    /** Who holds the slots now. */
    get holders() { return [...slots].sort((a, b) => a - b); },
  };
}

/** @typedef {ReturnType<typeof createCrowd>} Crowd */
