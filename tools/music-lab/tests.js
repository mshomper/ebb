// @ts-check
// Listening tests for the instrument bench: each is a short list of timed key, release and pedal
// events, played through a small look-ahead scheduler on the audio clock (doc 24: 150 ms window,
// 25 ms timer), the same way the game will schedule music, so Stop always works and timing never
// drifts. The phrase is a short original cadence in D written for this bench; it quotes nothing.

/** @typedef {{t: number, on?: number, off?: number, vel?: number, pedal?: boolean, mark?: number}} Ev */
/** @typedef {{noteOn: (m: number, v: number, w?: number) => any, noteOff: (m: number, w?: number) => void, pedal: (d: boolean, w?: number) => void, stopAll: (f?: number) => void}} Playable */

/**
 * @param {BaseAudioContext} ctx
 * @param {(mark: number|null) => void} [onMark] told when an event carrying `mark` sounds (the chart cursor)
 */
export function createPlayer(ctx, onMark) {
  /** @type {{evs: Ev[], i: number, t0: number, inst: Playable, timer: any, done: () => void} | null} */
  let run = null;
  /** @type {any[]} */
  let markTimers = [];

  function tick() {
    if (!run) return;
    const horizon = ctx.currentTime + 0.15;
    while (run.i < run.evs.length && run.t0 + run.evs[run.i].t <= horizon) {
      const e = run.evs[run.i++];
      const at = run.t0 + e.t;
      if (e.pedal !== undefined) run.inst.pedal(e.pedal, at);
      if (e.off !== undefined) run.inst.noteOff(e.off, at);
      if (e.on !== undefined) run.inst.noteOn(e.on, e.vel ?? 72, at);
      if (e.mark !== undefined && onMark) {
        const m = e.mark;
        markTimers.push(setTimeout(() => onMark(m), Math.max(0, (at - ctx.currentTime) * 1000)));
      }
    }
    if (run.i >= run.evs.length) {
      const r = run;
      const last = r.evs.length ? r.evs[r.evs.length - 1].t : 0;
      clearInterval(r.timer);
      markTimers.push(setTimeout(() => { if (run === r) { run = null; onMark?.(null); r.done(); } }, Math.max(0, (r.t0 + last - ctx.currentTime) * 1000 + 300)));
    }
  }

  return {
    /** @param {Ev[]} evs @param {Playable} inst @returns {Promise<void>} */
    play(evs, inst) {
      this.stop();
      const sorted = [...evs].sort((a, b) => a.t - b.t || order(a) - order(b));
      return new Promise((done) => {
        run = { evs: sorted, i: 0, t0: ctx.currentTime + 0.12, inst, timer: setInterval(tick, 25), done };
        tick();
      });
    },
    stop() {
      if (!run) return;
      clearInterval(run.timer);
      run.inst.stopAll(0.25);
      const d = run.done;
      run = null;
      for (const m of markTimers) clearTimeout(m);
      markTimers = [];
      onMark?.(null);
      d();
    },
    get playing() { return run !== null; },
  };
}

/** At one instant: pedal lifts first, then key releases, then new keys, then pedal presses. @param {Ev} e */
function order(e) {
  if (e.pedal === false) return 0;
  if (e.off !== undefined) return 1;
  if (e.on !== undefined) return 2;
  return 3;
}

/** A note held for dur seconds. @param {number} t @param {number} midi @param {number} dur @param {number} vel @param {number} [mark] @returns {Ev[]} */
function note(t, midi, dur, vel, mark) {
  return [{ t, on: midi, vel, mark }, { t: t + dur, off: midi }];
}

/** Slow crescendo on one key: velocity 4 to 127 in steps of 4. @param {number} midi */
export function sweep(midi) {
  /** @type {Ev[]} */
  const evs = [];
  let t = 0;
  for (let v = 4; v <= 127; v += 4) { evs.push(...note(t, midi, 0.5, v, v)); t += 0.62; }
  evs.push(...note(t, midi, 0.8, 127, 127));
  return evs;
}

/** Every velocity, one at a time, across each blend between two recordings. @param {number} midi @param {number[]} bounds */
export function sweepFine(midi, bounds) {
  /** @type {Ev[]} */
  const evs = [];
  let t = 0;
  for (const b of bounds) {
    for (let v = Math.max(1, b - 9); v <= Math.min(127, b + 9); v++) { evs.push(...note(t, midi, 0.42, v, v)); t += 0.5; }
    t += 1.2;
  }
  return evs;
}

const BEAT = 60 / 72;

/** The bench's phrase: five bars of an original cadence in D, with legato pedaling. */
export function phrase() {
  // [bar, LH notes, RH chord, melody [beatOffset, midi, beats]...]
  const bars = /** @type {[number[], number[], [number, number, number][]][]} */ ([
    [[38, 45], [64, 66, 69], [[0, 74, 1], [1, 76, 1], [2, 78, 2]]],
    [[43, 50], [62, 67, 71], [[0, 79, 3], [3, 78, 1]]],
    [[35, 42], [62, 66, 69], [[0, 76, 2], [2, 74, 1], [3, 73, 1]]],
    [[33, 40], [62, 64, 69], [[0, 76, 2], [2, 73, 2]]],
    [[38, 45, 50], [62, 66, 69], [[0, 74, 4]]],
  ]);
  /** @type {Ev[]} */
  const evs = [];
  bars.forEach(([lh, rh, mel], i) => {
    const b = i * 4 * BEAT;
    const len = (i === bars.length - 1 ? 6 : 4) * BEAT;
    evs.push({ t: Math.max(0, b - 0.01), pedal: false });
    for (const m of lh) evs.push(...note(b, m, len - 0.05, 52));
    // Bar 4: suspension D over A resolving to C sharp on beat 3.
    if (i === 3) {
      evs.push(...note(b + 0.01, 62, 2 * BEAT, 44), ...note(b + 2 * BEAT, 61, 2 * BEAT - 0.05, 42));
      for (const m of rh.slice(1)) evs.push(...note(b + 0.01, m, len - 0.05, 44));
    } else {
      for (const m of rh) evs.push(...note(b + 0.01, m, len - 0.05, 44));
    }
    // Melody slightly ahead of the accompaniment, as a pianist plays (doc 24: about 8 ms).
    for (const [o, m, beats] of mel) evs.push(...note(Math.max(0, b + o * BEAT - 0.008), m, beats * BEAT - 0.04, o === 0 ? 70 : 62));
    evs.push({ t: b + 0.14 * BEAT, pedal: true });
  });
  const end = bars.length * 4 * BEAT + 2 * BEAT;
  evs.push({ t: end, pedal: false });
  return evs;
}

/** Legato pedaling through the phrase, then a held chord and the dampers falling. */
export function pedalTest() {
  const evs = phrase();
  const t = 5 * 4 * BEAT + 3 * BEAT;
  for (const m of [38, 50, 57, 62, 66, 69, 74]) evs.push(...note(t, m, 0.4, 60));
  evs.push({ t: t + 0.05, pedal: true }, { t: t + 4.5, pedal: false });
  return evs;
}

/** Short notes without pedal, then longer ones: dampers and key-off sounds. */
export function staccato() {
  /** @type {Ev[]} */
  const evs = [];
  const arp = [50, 54, 57, 62, 66, 69, 74, 78, 81, 86];
  let t = 0;
  for (const m of arp) { evs.push(...note(t, m, 0.12, 64)); t += 0.26; }
  t += 0.6;
  for (const m of [...arp].reverse()) { evs.push(...note(t, m, 0.55, 56)); t += 0.7; }
  return evs;
}

/** One key repeated fast, then faster. */
export function repeats() {
  /** @type {Ev[]} */
  const evs = [];
  let t = 0;
  for (let i = 0; i < 16; i++) { evs.push(...note(t, 60, 0.08, 66)); t += 0.125; }
  t += 0.8;
  for (let i = 0; i < 16; i++) { evs.push(...note(t, 60, 0.05, 66)); t += 1 / 12; }
  return evs;
}

/** Every A from the bottom of the keyboard to the top, then the top C, at mezzo-forte. */
export function register() {
  /** @type {Ev[]} */
  const evs = [];
  let t = 0;
  for (let m = 21; m <= 105; m += 12) { evs.push(...note(t, m, 1.1, 76)); t += 1.4; }
  evs.push(...note(t, 108, 1.1, 76));
  return evs;
}

/** A fast pedaled cascade of 48 notes, more than the voice limit, to hear stealing. */
export function cascade() {
  /** @type {Ev[]} */
  const evs = [{ t: 0, pedal: true }];
  const scale = [0, 2, 4, 7, 9];
  let t = 0.05;
  for (let i = 0; i < 48; i++) {
    const m = 38 + Math.floor(i / 5) * 12 + scale[i % 5];
    evs.push(...note(t, Math.min(m, 105), 0.1, 58 + (i % 5) * 3));
    t += 0.09;
  }
  evs.push({ t: t + 3, pedal: false });
  return evs;
}

/** Octaves played together up the keyboard: the clearest test of tuning between zones. */
export function octaves() {
  /** @type {Ev[]} */
  const evs = [];
  let t = 0;
  for (let m = 24; m <= 96; m += 12) { evs.push(...note(t, m, 1.6, 60), ...note(t, m + 12, 1.6, 60)); t += 2; }
  return evs;
}

/** Wide, open chords from low to high: root, fifth, tenth and above. */
export function wideChords() {
  /** @type {Ev[]} */
  const evs = [];
  let t = 0;
  for (const r of [26, 38, 50, 62]) {
    for (const m of [r, r + 7, r + 16, r + 19, r + 24]) evs.push(...note(t, Math.min(m, 108), 2.2, 54));
    t += 2.8;
  }
  return evs;
}
