// @ts-check
// Plays a performance (from realize.js) on the instruments, scheduled a little ahead on the audio
// clock so timing never wobbles with the frame rate (doc 24, "Algorithms": a 150 ms window, a
// 25 ms timer). A performance can be stopped at once (mute, hidden tab) with a short fade, or
// finished gracefully: it plays to the end of the section it is in, then the coda if one was
// given, then lets the last notes ring and lifts the pedal (doc 24: nothing is cut mid-phrase).

/**
 * @typedef {Object} PlayOptions
 * @property {any} [coda]             a performance of the coda alone, used by finish()
 * @property {(bar: any) => void} [onBar]
 * @property {(tSeconds: number) => void} [onTime]  about 30 times a second while playing
 * @property {() => void} [onEnd]
 * @property {number} [lookAheadS]
 * @property {number} [timerMs]
 */

/**
 * @param {BaseAudioContext} ctx
 * @param {Record<string, {noteOn: Function, noteOff: Function, pedal: Function, stopAll: Function}>} instruments
 */
export function createPerformer(ctx, instruments) {
  /** @type {any} */
  let run = null;

  /** Turn a performance into one time-ordered event list. @param {any} perf @param {number} offset */
  function eventsOf(perf, offset) {
    /** @type {{t: number, kind: number, n?: any, p?: any}[]} */
    const ev = [];
    for (const n of perf.notes) { ev.push({ t: offset + n.t, kind: 2, n }); ev.push({ t: offset + n.t + n.dur, kind: 1, n }); }
    for (const p of perf.pedal) ev.push({ t: offset + p.t, kind: p.down ? 3 : 0, p });
    // At one instant: pedal lifts, then releases, then new notes, then pedal presses.
    return ev.sort((a, b) => a.t - b.t || a.kind - b.kind);
  }

  function tick() {
    if (!run) return;
    const now = ctx.currentTime;
    const horizon = now + run.lookAhead;
    while (run.i < run.ev.length && run.t0 + run.ev[run.i].t <= horizon) {
      const e = run.ev[run.i++];
      if (run.cutAt !== null && e.t > run.cutAt && e.kind !== 1 && e.kind !== 0) continue;
      const at = Math.max(now, run.t0 + e.t);
      if (e.kind === 2) instruments[e.n.instrument]?.noteOn(e.n.midi, e.n.vel, at);
      else if (e.kind === 1) instruments[e.n.instrument]?.noteOff(e.n.midi, at);
      else instruments[e.p.instrument]?.pedal(e.kind === 3, at);
    }
    const pos = now - run.t0;
    run.opts.onTime?.(pos);
    while (run.bar < run.perf.bars.length && run.perf.bars[run.bar].t <= pos) run.opts.onBar?.(run.perf.bars[run.bar++]);
    if (run.i >= run.ev.length && pos > run.endT + 0.3) {
      const r = run;
      clearInterval(r.timer);
      run = null;
      r.opts.onEnd?.();
    }
  }

  return {
    /**
     * Start a performance, at an audio time (default: just ahead of now).
     * @param {any} perf @param {PlayOptions} [opts] @param {number} [at]
     */
    play(perf, opts = {}, at) {
      this.stop(0.2);
      const t0 = at ?? ctx.currentTime + 0.15;
      const ev = eventsOf(perf, 0);
      run = { perf, opts, ev, i: 0, t0, bar: 0, cutAt: null, endT: perf.durationS, lookAhead: opts.lookAheadS ?? 0.15, timer: setInterval(tick, opts.timerMs ?? 25) };
      tick();
      return { t0 };
    },
    /**
     * Finish gracefully: no new notes after the current section ends; then the coda, if given.
     * @returns {number} seconds until the music has finished
     */
    finish() {
      if (!run) return 0;
      const pos = ctx.currentTime - run.t0;
      const next = run.perf.sections.find((/** @type {any} */ s) => s.t > pos + 0.2);
      if (!next) return Math.max(0, run.endT - pos);
      if (run.perf.sections[run.perf.sections.length - 1].name === 'coda' && next.name === 'coda') return run.endT - pos;
      run.cutAt = next.t - 0.02;
      // Lift every pedal a moment after the cut so nothing hangs on.
      const lifts = Object.keys(instruments).map((name) => ({ t: next.t + 1.2, kind: 0, p: { instrument: name, down: false } }));
      /** @type {any[]} */
      let tail = lifts;
      let endT = next.t + 1.5;
      if (run.opts.coda) {
        const ce = eventsOf(run.opts.coda, next.t);
        tail = ce;
        endT = next.t + run.opts.coda.durationS;
      }
      const cut = run.cutAt;
      run.ev = [...run.ev.slice(run.i).filter((/** @type {any} */ e) => e.t <= cut || e.kind === 1), ...tail].sort((a, b) => a.t - b.t || a.kind - b.kind);
      run.i = 0;
      run.cutAt = null;
      run.endT = endT;
      return endT - pos;
    },
    /** Stop now with a short fade (mute, hidden tab, photo export). @param {number} [fadeS] */
    stop(fadeS = 0.3) {
      if (!run) return;
      clearInterval(run.timer);
      for (const i of Object.values(instruments)) i.stopAll(fadeS);
      const r = run;
      run = null;
      r.opts.onEnd?.();
    },
    get playing() { return run !== null; },
    /** Seconds into the performance, or -1. */
    position() { return run ? ctx.currentTime - run.t0 : -1; },
  };
}
