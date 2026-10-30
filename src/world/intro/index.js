// @ts-check
// The evening director (docs/future/13 section 2.3): a small beat machine for the first evening.
// It runs the beats in recipes/world/intro.json in order, checks one condition per beat (checks.js),
// posts that beat's hint line (`intro:hint`, shown in the island-notes corner), and sets a flag in
// journal.flags when each beat is done, so a reload resumes on the first beat without its flag. It
// never moves the world itself except on Skip; what it does in the world goes through `effects`
// (adapter.js), and what it reads through the context, so the tests can run it with stand-ins.
//
// The day's beats (shape, plant, store: Matt, October 25, 2026) never hold the night back: once the
// sun sets they are set aside and dusk begins. The evening ends at the first rest, or at the first
// dawn for a player who never rested; then whatever of the morning list is still undone runs again,
// from where it stopped, with one opening line, and waits as long as it needs.
//
// Islands made before the evening (no `intro:begun`, no `intro:done`) never run it: they get
// `intro:done` and `intro:older`, one notice about the camp ground, and the tent patch glows the
// first time the walker is down within `older.glowWithinM` of the pad.

import { CHECKS, CHECK_EVENTS } from './checks.js';

/**
 * What the director does in the world (adapter.js).
 * @typedef {Object} IntroEffects
 * @property {(name: string) => void} act  play a walker act; it reports `walk:act-done { name }`
 * @property {(id: string) => void} openPage  open the Keeper book on a keeper page
 * @property {() => void} skipCamp  leave the camp ready (tent up, ring laid cold) and the walker at the flap
 * @property {(text: string) => void} notice  one island notice (older islands)
 * @property {(slot: string) => void} glow  a camp slot glows (older islands' tent patch)
 * @property {(flow: number) => void} [flow]  set time's flow (a beat's onStart.flow: dusk at its own pace)
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

/** How many payloads of one event the director keeps for parts done early. */
const EVER_CAP = 64;

/** @param {IntroOptions} o */
export function createIntro(o) {
  const { R, ctx, effects } = o;
  const P = R.flagPrefix ?? 'intro:';
  const M = R.morning ?? {};
  const short = o.mode === 'short';
  const beats = /** @type {any[]} */ (short ? R.beats.filter((/** @type {any} */ b) => R.short.includes(b.id)) : R.beats);
  const has = (/** @type {string} */ f) => o.flags().includes(f);
  const set = (/** @type {string} */ f) => { if (!has(f)) o.setFlag(f); };
  const evening = () => !has(`${P}done`);
  /** Night has come on the first evening: the sun has set, or it is past midnight. */
  const nightCame = () => ctx.sunsetInH() <= 0 || ctx.day() > 0;

  let idx = -1;              // the beat running, or -1 (not started, or done)
  let started = false;       // its start check has passed
  let acting = /** @type {string | null} */ (null);  // its then.act is playing
  let step = 0;              // which of its hint lines shows
  let tucked = false;        // the line was tapped away (the beat still waits)
  let later = /** @type {string | null} */ (null);   // a line shown while the next beat waits to start
  let opening = /** @type {string | null} */ (null); // the first morning's opening line
  let openS = 0;             // how long it has shown
  let older = false;
  /** Every payload of the events the director listens to, this visit (parts done early). @type {Record<string, any[]>} */
  const ever = {};
  const fresh = () => ({ seen: {}, ever, still: 0, sawOpen: false });
  /** @type {import('./checks.js').BeatMemory} */ let mem = fresh();
  let memPart = -1;
  let shown = /** @type {string | null} */ (null);

  const beat = () => (idx >= 0 ? beats[idx] : null);

  /** A beat with parts: the first part not yet done (by its flag), or -1. @param {any} b */
  const partAt = (b) => (b?.parts ? b.parts.findIndex((/** @type {any} */ _p, /** @type {number} */ i) => !has(`${P}${b.id}.${i}`)) : -1);
  /** A part's done check, or its orCheck. @param {any} d @param {number} dt */
  const partDone = (d, dt) => !!CHECKS[d.check]?.(ctx, d, mem, dt) || (!!d.orCheck && !!CHECKS[d.orCheck]?.(ctx, d, mem, dt));
  /** A part's extra line is due: n refused sowings of its species since the part began. @param {any} p */
  const moreOn = (p) => !!p?.more && (mem.seen['sow:landed'] ?? []).filter((s) => !s.ok && s.species === p.more.refused).length >= (p.more.n ?? 3);

  /**
   * The next beat after `after` to run: during the evening, the next without its flag (once night has
   * come, past the day's beats); after it, the next of the morning list still undone.
   * @param {number} after
   */
  function nextIdx(after) {
    const morning = !evening();
    return beats.findIndex((/** @type {any} */ x, /** @type {number} */ j) => j > after && !has(`${P}${x.id}`)
      && (morning ? (M.beats ?? []).includes(x.id) : !(x.day && nightCame())));
  }

  /**
   * A beat with steps (gathering a handful of twigs, then two of pebbles) says what is still needed:
   * the first step whose handfuls the pack does not hold yet gives the line. -1 with no steps.
   * @param {any} b
   */
  const stepAt = (b) => (b.steps ? b.steps.findIndex((/** @type {any} */ s) => !CHECKS.packHolds(ctx, s, mem, 0)) : -1);
  let lastStep = '';
  const openOn = () => !!opening && openS < (M.showS ?? 10);

  /** Post the line that should show now (or none), once per change. */
  function post() {
    const b = beat();
    let id = null, text = null, skip = null;
    // A new step's (or part's) line comes back even if the one before was tucked away.
    const si = b && started ? stepAt(b) : -1, pi = b && started ? partAt(b) : -1;
    if (`${si}.${pi}` !== lastStep) { lastStep = `${si}.${pi}`; tucked = false; }
    if (b && !short && !tucked) {
      if (!started && later) { id = `${b.id}:later`; text = later; }
      else if (started && openOn()) { id = `${b.id}:morning`; text = opening; }
      else if (started && pi >= 0) {
        const p = b.parts[pi];
        id = `${b.id}.${pi}`; text = p.hint;
        if (moreOn(p)) { id += ':more'; text = `${p.hint} ${p.more.hint}`; }
      }
      else if (started && si >= 0) { id = `${b.id}:${si}`; text = b.steps[si].hint; }
      else if (started && b.hint?.length) { id = b.id; text = b.hint[Math.min(step, b.hint.length - 1)]; }
      if (started && idx === 0 && b.skip && evening()) skip = b.skip;
    }
    const key = `${id}|${text}|${skip}`;
    if (key === shown) return;
    shown = key;
    o.emit('intro:hint', { id, text, skip });
  }

  /** Begin beat i (its start check may still wait). @param {number} i @param {string | null} [open] the morning's opening line */
  function begin(i, open = null) {
    idx = i;
    started = false; acting = null; step = 0; tucked = false;
    opening = open; openS = 0;
    mem = fresh(); memPart = -1;
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
    if (b.onStart?.flow) effects.flow?.(b.onStart.flow);
    // Done early (the fire lit before dusk asked): its lines move on, and its cue sounds now.
    let early = false;
    while (step < (b.hintNextIf?.length ?? 0) && CHECKS[b.hintNextIf[step]]?.(ctx, b, mem, 0)) { step++; early = true; }
    if (early && b.cue) o.emit(b.cue.emit, {});
  }

  function finish() {
    const b = beat();
    if (!b) return;
    set(`${P}${b.id}`);
    o.emit('intro:beat-done', { id: b.id });
    const next = nextIdx(idx);
    // The first morning's list: on to the next still undone, and quiet after the last.
    if (!evening()) { if (next < 0) { idx = -1; post(); } else begin(next); return; }
    if (next < 0) { done(true); return; }
    later = b.later && ctx.sunsetInH() > (b.laterIfBeforeSunsetH ?? 2) ? b.later : null;
    begin(next);
  }

  /**
   * The evening is over. morning: it ended at the first rest or dawn, so what is still undone of the
   * morning list runs now (not on Skip). @param {boolean} [morning] @param {string | null} [open]
   */
  function done(morning = false, open = null) {
    idx = -1;
    set(`${P}done`);
    o.emit('intro:done');
    const next = morning && !short ? nextIdx(-1) : -1;
    if (next >= 0) {
      set(`${P}morning`);
      begin(next, open ?? M.open?.[beats[next].id] ?? null);
      return;
    }
    if (open) effects.notice(open);
    post();
  }

  /**
   * The first dawn came and the player never rested (section 6): the evening ends anyway. The spring
   * and the first page are left as Skip leaves them, dusk and rest drop, and the morning list opens
   * with the stayed-up line (tent or no tent). The wake page and the title are the adapter's.
   */
  function stayedUp() {
    const tent = ctx.campHas('tent');
    for (const id of M.dropped ?? []) set(`${P}${id}`);
    set('keeper:first');
    set(`${P}stayed-up`);
    o.emit('intro:stayed-up', { tent });
    done(true, M.stayedUp?.[tent ? 'tent' : 'noTent'] ?? null);
  }

  /** Check the running beat. @param {number} dt */
  function check(dt) {
    const b = beat();
    if (!b) return;
    // Night never waits for the day's beats: this one is set aside, and dusk comes on time.
    if (!short && evening() && b.day && nightCame()) {
      const next = nextIdx(idx);
      if (next < 0) done(true); else begin(next);
      return;
    }
    if (!started) { tryStart(); if (started) post(); return; }
    if (b.parts) {
      for (let i = partAt(b); i >= 0; i = partAt(b)) {
        if (i !== memPart) { memPart = i; mem = fresh(); }
        if (!partDone(b.parts[i].done, dt)) break;
        set(`${P}${b.id}.${i}`);
        o.emit('intro:part-done', { id: b.id, part: i });
      }
      if (partAt(b) < 0) finish();
      return;
    }
    // A beat done by an event can also be done already (the tent pitched before its beat came).
    if (!acting && b.done.event && b.done.orCheck && CHECKS[b.done.orCheck]?.(ctx, b.done, mem, dt)) { finish(); return; }
    if (acting || !b.done.check) return;
    if (!CHECKS[b.done.check](ctx, b.done, mem, dt)) return;
    if (b.then?.act) { acting = b.then.act; effects.act(acting); return; }
    finish();
  }

  // Every event any beat listens to, subscribed once; each handler acts only for the beat running.
  const names = new Set(['walk:act-done']);
  const listen = (/** @type {string | undefined} */ check) => { for (const n of /** @type {Record<string, string[]>} */ (CHECK_EVENTS)[check ?? ''] ?? []) names.add(n); };
  for (const b of beats) {
    if (b.done?.event) names.add(b.done.event);
    if (b.alsoDoneBy) names.add(b.alsoDoneBy);
    listen(b.done?.check);
    for (const p of b.parts ?? []) { listen(p.done.check); listen(p.done.orCheck); if (p.more) names.add('sow:landed'); }
    for (const n of b.hintNext ?? []) names.add(n);
    if (b.cue) names.add(b.cue.on);
  }
  const offs = [...names].map((name) => o.on(name, (/** @type {any} */ p) => {
    const list = (ever[name] ??= []);
    list.push(p ?? {});
    if (list.length > EVER_CAP) list.shift();
    const b = beat();
    if (!b) return;
    (mem.seen[name] ??= []).push(p ?? {});
    if (b.cue?.on === name && started) o.emit(b.cue.emit, {});
    // The next hint line comes with its own event, in order.
    if (started && b.hintNext?.[step] === name) { step++; tucked = false; post(); }
    if (name === 'walk:act-done' && acting && p?.name === acting) { acting = null; finish(); return; }
    if (started && !acting && b.done?.event === name) { finish(); return; }
    // An event that also ends this beat (resting in the tent at dusk, before sitting by the fire):
    // the beat is done, and so is the next if that event is what it waits for (rest), so a player who
    // rests early is never left on a beat they can no longer finish.
    if (started && !acting && b.alsoDoneBy === name) {
      finish();
      if (beat()?.done?.event === name) finish();
      return;
    }
    check(0);
    post();
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
      if (!evening()) {
        // The first morning's list, picked up where it stopped.
        const next = has(`${P}morning`) && !short ? nextIdx(-1) : -1;
        if (next >= 0) begin(next); else { idx = -1; post(); }
        return;
      }
      const first = nextIdx(-1);
      if (first < 0) { done(true); return; }
      begin(first);
    },
    /** Each frame. @param {number} dt seconds */
    update(dt) {
      // The first dawn ends the evening, slept or not.
      if (!short && evening() && has(`${P}begun`) && ctx.day() > 0 && ctx.sunUp()) stayedUp();
      check(dt);
      // The opening line's time runs only while it shows.
      if (beat() && started && !tucked && openOn()) openS += dt;
      // A step's line follows what the pack holds now.
      post();
      if (older && !has(`${P}glowed`)) {
        const w = ctx.walker(), pad = ctx.pad();
        if (pad && w.below && Math.hypot(w.x - pad.x, w.z - pad.z) <= (R.older.glowWithinM ?? 12)) { set(`${P}glowed`); effects.glow('tent'); }
      }
    },
    /** Skip the first evening (beat 0 only): the camp is left ready and every flag is set. */
    skip() {
      if (idx !== 0 || !evening()) return false;
      effects.skipCamp();
      for (const b of R.beats) set(`${P}${b.id}`);
      set('keeper:first');
      set(`${P}skipped`);
      o.emit('intro:skipped');
      done();
      return true;
    },
    /** A tap on the hint line tucks it away; the beat still waits, silently. */
    tuck() {
      // Tapping the morning's opening line away lets the beat's own line show; any other line tucks the beat.
      if (shown?.startsWith(`${beat()?.id}:morning|`)) openS = Infinity;
      else tucked = true;
      post();
    },
    /** The beat running and its line, for the lab and the tests. */
    get current() {
      const b = beat();
      return b ? { id: b.id, started, acting, step, part: partAt(b), line: shown } : null;
    },
    dispose() { for (const off of offs) off(); },
  };
}
