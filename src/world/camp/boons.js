// @ts-check
// The tea's boon (docs/future/13 section 7; P2e): one at a time, a new cup replaces it. It rides in
// the save's camp section as `boon` { id, leftH, h } (no format bump) and counts down only in game
// hours played on the island: never in time away, never through a night's rest. Every system reads
// its lift from the store slice `boonLift` (multipliers, 1 or 0 without a tea), so none reaches into
// this module: walk speed, trust gain, the comfort ring, find and gather-spot sight, dig time, make
// time, the fire's burn, the extra handful's chance and the one reveal. Boons lift the walker and the
// walker's friendships, never growth or the land, so catch-up and saves stay exact.
//
// Pure rules here; the live part (createBoons) ticks it, publishes `boon` (the HUD's words) and
// `boonLift`, and wakes Deep rest into its day.

import { get, update } from '../../core/store.js';
import { on, emit } from '../../core/events.js';

/** @typedef {{ id: string, leftH: number, h: number, revealed?: boolean }} Boon */
/**
 * @typedef {{ walk: number, trust: number, comfort: number, sight: number, dig: number, make: number,
 *   burn: number, handful: number, reveal: boolean }} Lift
 */

/** No tea: every multiplier 1, no extra handful, no reveal. @type {Lift} */
export const NO_LIFT = Object.freeze({ walk: 1, trust: 1, comfort: 1, sight: 1, dig: 1, make: 1, burn: 1, handful: 0, reveal: false });

/** A saved boon made safe, or null. @param {any} b @param {Record<string, any>} [B] cook.json boons, to drop a key it no longer has */
export function cleanBoon(b, B) {
  if (!b || typeof b !== 'object' || typeof b.id !== 'string') return null;
  if (!(Number.isFinite(b.leftH) && b.leftH > 0 && Number.isFinite(b.h) && b.h > 0)) return null;
  if (B && !B[b.id]) return null;
  return { id: b.id, leftH: Math.min(b.leftH, b.h), h: b.h, ...(b.revealed ? { revealed: true } : {}) };
}

/**
 * A cup drunk: its boon, full, in place of whatever was working (one tea at a time).
 * @param {string} id @param {Record<string, any>} B cook.json boons @returns {Boon | null}
 */
export function drink(id, B) {
  const r = B[id];
  return r ? { id, leftH: r.h, h: r.h } : null;
}

/**
 * Game hours played on the island: the boon that is left, or null once it runs out.
 * @param {Boon | null} b @param {number} dh @returns {Boon | null}
 */
export function tick(b, dh) {
  if (!b || !(dh > 0)) return b;
  const leftH = b.leftH - dh;
  return leftH > 1e-9 ? { ...b, leftH } : null;
}

/** How much is left, 0..1. @param {Boon | null} b */
export const shareOf = (b) => (b ? Math.max(0, Math.min(1, b.leftH / b.h)) : 0);

/**
 * The multipliers a boon gives now. A reveal is spent once (its record's `revealed`).
 * @param {Boon | null} b @param {Record<string, any>} B cook.json boons @returns {Lift}
 */
export function liftOf(b, B) {
  const r = b ? B[b.id] : null;
  if (!r) return NO_LIFT;
  /** @param {string} k */
  const n = (k) => (Number.isFinite(r[k]) ? r[k] : /** @type {any} */ (NO_LIFT)[k]);
  return { walk: n('walk'), trust: n('trust'), comfort: n('comfort'), sight: n('sight'), dig: n('dig'), make: n('make'), burn: n('burn'),
    handful: n('handful'), reveal: !!r.reveal && !b?.revealed };
}

/**
 * Waking from a night's rest: Deep rest (a boon with rest) becomes the boon whose `after` names
 * it, full; any other boon is as it was. @param {Boon | null} b @param {Record<string, any>} B
 * @returns {Boon | null}
 */
export function wake(b, B) {
  if (!b || !B[b.id]?.rest) return b;
  const key = Object.keys(B).find((k) => B[k].after === b.id);
  return key ? drink(key, B) : null;
}

/** The HUD's word for what is left (cook.json teas.left, words.teaLeft). @param {number} share @param {any} C cook.json */
export function leftWord(share, C) {
  const L = /** @type {[number, string][]} */ (C.teas?.left ?? []);
  const hit = L.find(([s]) => share > s) ?? L.at(-1);
  return hit ? C.words?.teaLeft?.[hit[1]] ?? '' : '';
}

/**
 * A boon's herbs as pack kinds, for its HUD glyphs (a waking blend shows its rest herbs); a boon that
 * is not a tea (the walker's meal) names its own (boons.<id>.shows). @param {Boon} b @param {any} C
 */
export function herbsOf(b, C) {
  if (C.boons?.[b.id]?.shows) return C.boons[b.id].shows;
  return b.id.split('+').map((h) => C.teas?.herbs?.[h]).filter(Boolean);
}

/**
 * The live boon: counts down by the clock's game hours while you play (a jump of more than
 * maxStepH in one frame is a rest or a catch-up and is not counted), publishes `boon` and
 * `boonLift`, and wakes Deep rest when the night's rest ends (camp:rested).
 * @param {{ cook: any, change: (fn: (c: any) => any) => void, hourNow: () => number, maxStepH?: number, flushS?: number }} k
 *   flushS: real seconds between writes of the running boon into the camp
 */
export function createBoons(k) {
  const C = k.cook, B = C.boons ?? {};
  const maxStepH = k.maxStepH ?? 0.5, flushS = k.flushS ?? 5;
  let lastHour = k.hourNow(), key = '', flushT = 0;
  // The boon runs here and is written into the camp now and then (and at once on a change), so the
  // camp's subscribers are not stirred each frame. A camp whose boon is not the one last written (a
  // save loaded, a test link) is taken up afresh.
  // Other camp changes copy the record, so it is compared by what it says, not by identity.
  const saved = () => JSON.stringify(get('camp')?.boon ?? null);
  /** @type {Boon | null} */ let live = cleanBoon(get('camp')?.boon, B);
  let written = saved();
  const now = () => {
    const s = saved();
    if (s !== written) { live = cleanBoon(get('camp')?.boon, B); written = s; }
    return live;
  };
  const flush = () => { flushT = 0; k.change((c) => ({ ...c, boon: live })); written = saved(); };

  function publish() {
    const b = now();
    const lift = liftOf(b, B);
    const share = shareOf(b), word = b ? leftWord(share, C) : '';
    // The HUD's words change rarely; its ring each hundredth.
    const next = b ? `${b.id}|${Math.round(share * 100)}|${word}|${lift.reveal}` : '';
    if (next === key) return;
    key = next;
    update('boonLift', () => lift);
    update('boon', () => (b ? { id: b.id, name: C.words?.boonNames?.[b.id] ?? b.id, line: C.words?.boonLines?.[b.id] ?? '', herbs: herbsOf(b, C), share, word } : null));
  }

  /** @param {(b: Boon | null) => Boon | null} fn */
  const set = (fn) => { live = fn(now()); flush(); publish(); };

  const offs = [
    on('camp:rested', () => {
      lastHour = k.hourNow();
      const rested = !!(now() && B[/** @type {Boon} */ (now()).id]?.rest);
      set((b) => wake(b, B));
      if (rested && C.words?.woke) emit('island:notice', { text: C.words.woke, showS: 7 });
    }),
  ];
  publish();

  return {
    /** A cup drunk: its boon replaces the one working. @param {string} id */
    drink(id) { set(() => drink(id, B)); },
    /** The reveal spent (a hidden creature gave itself away). */
    spendReveal() { set((b) => (b ? { ...b, revealed: true } : b)); },
    /** The boon now (tests). */
    now,
    /** Each frame: the game hours played come off it. @param {number} [dt] real seconds */
    update(dt = 0) {
      const h = k.hourNow(), dh = h - lastHour;
      lastHour = h;
      const b = now();
      if (b && dh > 0 && dh <= maxStepH) {
        live = tick(b, dh);
        // Run out: written at once, so a save has no boon; else now and then.
        if (!live || (flushT += dt) >= flushS) flush();
      }
      publish();
    },
    /** Write the running boon into the camp now (before a save). */
    flush,
    dispose() { for (const off of offs) off(); },
  };
}

/** What a system reads: the lift now, from the store (1s without a tea). @returns {Lift} */
export const liftNow = () => get('boonLift') ?? NO_LIFT;
