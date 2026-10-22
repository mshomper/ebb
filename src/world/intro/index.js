// @ts-check
// The evening director (docs/future/13 section 2.3): a small beat machine for the first evening.
// It runs the beats in recipes/world/intro.json in order, checks one condition per beat (checks.js),
// posts that beat's hint line (`intro:hint`, shown in the island-notes corner), and sets a flag in
// journal.flags when each beat is done, so a reload resumes on the first beat without its flag. It
// never moves the world itself except on Skip; what it does in the world goes through `effects`
// (adapter.js), and what it reads through the context, so the tests can run it with stand-ins.
//
// Islands made before the evening (no `intro:begun`, no `intro:done`) never run it: they get
// `intro:done` and `intro:older`, one notice about the camp ground, and the tent patch glows the
// first time the walker is down within `older.glowWithinM` of the pad.

import { CHECKS, CHECK_EVENTS } from './checks.js';

/**
 * What the director does in the world (adapter.js).
 * @typedef {Object} IntroEffects
 * @property {(name: string) => void} act  play a walker act; it reports `walk:act-done { name }`
 * @property {(id: string) => void} openPage  open the journal on a keeper page
 * @property {() => void} skipCamp  leave the camp ready (tent up, ring laid cold) and the walker at the flap
 * @property {(text: string) => void} notice  one island notice (older islands)
 * @property {(slot: string) => void} glow  a camp slot glows (older islands' tent patch)
 */

/**
 * @typedef {Object} IntroOptions
 * @property {any} R  recipes/world/intro.json
 * @property {'full' | 'short'} [mode]  short: the sister island's evening, with no hint lines
 * @property {(name: string, fn: (p: any) => void) => () => void} on
 * @property {(name: string, payload?: any) => void} emit
 * @property {() => string[]} flags  journal.flags now
 * @property {(flag: string) => void} setFlag
 * @property {import('./checks.js').IntroContext & { pad: () => { x: number, z: number } | null }} ctx
 * @property {IntroEffects} effects
 */

/** @param {IntroOptions} o */
export function createIntro(o) {
  const { R, ctx, effects } = o;
  const P = R.flagPrefix ?? 'intro:';
  const short = o.mode === 'short';
  const beats = /** @type {any[]} */ (short ? R.beats.filter((/** @type {any} */ b) => R.short.includes(b.id)) : R.beats);
  const has = (/** @type {string} */ f) => o.flags().includes(f);
  const set = (/** @type {string} */ f) => { if (!has(f)) o.setFlag(f); };

  let idx = -1;              // the beat running, or -1 (not started, or done)
  let started = false;       // its start check has passed
  let acting = /** @type {string | null} */ (null);  // its then.act is playing
  let step = 0;              // which of its hint lines shows
  let tucked = false;        // the line was tapped away (the beat still waits)
  let later = /** @type {string | null} */ (null);   // a line shown while the next beat waits to start
  let older = false;
  /** @type {import('./checks.js').BeatMemory} */ let mem = { seen: {}, still: 0, sawOpen: false };
  let shown = /** @type {string | null} */ (null);

  const beat = () => (idx >= 0 ? beats[idx] : null);

  /** Post the line that should show now (or none), once per change. */
  function post() {
    const b = beat();
    let id = null, text = null, skip = null;
    if (b && !short && !tucked) {
      if (!started && later) { id = `${b.id}:later`; text = later; }
      else if (started && b.hint?.length) { id = b.id; text = b.hint[Math.min(step, b.hint.length - 1)]; }
      if (started && idx === 0 && b.skip && !has(`${P}done`)) skip = b.skip;
    }
    const key = `${id}|${text}|${skip}`;
    if (key === shown) return;
    shown = key;
    o.emit('intro:hint', { id, text, skip });
  }

  /** Begin beat i (its start check may still wait). @param {number} i */
  function begin(i) {
    idx = i;
    started = false; acting = null; step = 0; tucked = false;
    mem = { seen: {}, still: 0, sawOpen: false };
    tryStart();
    post();
  }

  function tryStart() {
    const b = beat();
    if (!b || started) return;
    const st = b.start?.check;
    if (st && !CHECKS[st](ctx, b.start, mem, 0)) return;
    started = true;
    later = null; tucked = false;
    o.emit('intro:beat-started', { id: b.id });
    if (b.onStart?.page) { set(`keeper:${b.onStart.page}`); effects.openPage(b.onStart.page); }
  }

  function finish() {
    const b = beat();
    if (!b) return;
    set(`${P}${b.id}`);
    o.emit('intro:beat-done', { id: b.id });
    const next = beats.findIndex((/** @type {any} */ x, /** @type {number} */ j) => j > idx && !has(`${P}${x.id}`));
    if (next < 0) { done(); return; }
    later = b.later && ctx.sunsetInH() > (b.laterIfBeforeSunsetH ?? 2) ? b.later : null;
    begin(next);
  }

  function done() {
    idx = -1;
    set(`${P}done`);
    o.emit('intro:done');
    post();
  }

  /** Check the running beat. @param {number} dt */
  function check(dt) {
    const b = beat();
    if (!b) return;
    if (!started) { tryStart(); if (started) post(); return; }
    if (acting || !b.done.check) return;
    if (!CHECKS[b.done.check](ctx, b.done, mem, dt)) return;
    if (b.then?.act) { acting = b.then.act; effects.act(acting); return; }
    finish();
  }

  // Every event any beat listens to, subscribed once; each handler acts only for the beat running.
  const names = new Set(['walk:act-done']);
  for (const b of beats) {
    if (b.done.event) names.add(b.done.event);
    for (const n of /** @type {Record<string, string[]>} */ (CHECK_EVENTS)[b.done.check] ?? []) names.add(n);
    for (const n of b.hintNext ?? []) names.add(n);
    if (b.cue) names.add(b.cue.on);
  }
  const offs = [...names].map((name) => o.on(name, (/** @type {any} */ p) => {
    const b = beat();
    if (!b) return;
    (mem.seen[name] ??= []).push(p ?? {});
    if (b.cue?.on === name && started) o.emit(b.cue.emit, {});
    // The next hint line comes with its own event, in order.
    if (started && b.hintNext?.[step] === name) { step++; tucked = false; post(); }
    if (name === 'walk:act-done' && acting && p?.name === acting) { acting = null; finish(); return; }
    if (started && !acting && b.done.event === name) { finish(); return; }
    check(0);
  }));

  return {
    /**
     * Start the director for this island. fresh: a new island (no save came back); otherwise a save
     * that never began the evening is an older island.
     * @param {{ fresh: boolean }} s
     */
    start(s) {
      if (s.fresh) set(`${P}begun`);
      else if (!has(`${P}begun`) && !has(`${P}done`)) { set(`${P}done`); set(`${P}older`); }
      older = has(`${P}older`);
      if (older && !has(`${P}noticed`)) { set(`${P}noticed`); effects.notice(R.older.notice); }
      if (has(`${P}done`)) { idx = -1; post(); return; }
      const first = beats.findIndex((/** @type {any} */ b) => !has(`${P}${b.id}`));
      if (first < 0) { done(); return; }
      begin(first);
    },
    /** Each frame. @param {number} dt seconds */
    update(dt) {
      check(dt);
      if (older && !has(`${P}glowed`)) {
        const w = ctx.walker(), pad = ctx.pad();
        if (pad && w.below && Math.hypot(w.x - pad.x, w.z - pad.z) <= (R.older.glowWithinM ?? 12)) { set(`${P}glowed`); effects.glow('tent'); }
      }
    },
    /** Skip the first evening (beat 0 only): the camp is left ready and every flag is set. */
    skip() {
      if (idx !== 0 || has(`${P}done`)) return false;
      effects.skipCamp();
      for (const b of R.beats) set(`${P}${b.id}`);
      set('keeper:first');
      set(`${P}skipped`);
      o.emit('intro:skipped');
      done();
      return true;
    },
    /** A tap on the hint line tucks it away; the beat still waits, silently. */
    tuck() { tucked = true; post(); },
    /** The beat running and its line, for the lab and the tests. */
    get current() {
      const b = beat();
      return b ? { id: b.id, started, acting, step, line: shown } : null;
    },
    dispose() { for (const off of offs) off(); },
  };
}
