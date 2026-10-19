// @ts-check
// Small pieces shared by the code-built pad and bell (doc 24): the instrument's output stage with
// its gentle high-pass (no sub-bass below 60 Hz), the sustain-pedal timeline, and the smooth swell
// curve used for attacks. Pure helpers; every number arrives from recipes/music/synth.json.

/** Butterworth stage Qs (linear) for an even filter order. @param {number} poles */
export function butterQs(poles) {
  const n = Math.max(1, Math.round(poles / 2));
  if (n === 1) return [Math.SQRT1_2];
  /** @type {number[]} */
  const qs = [];
  for (let k = 0; k < n; k++) qs.push(1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (4 * n))));
  return qs;
}

/** Web Audio reads a lowpass or highpass Q in dB; the recipes speak plain linear Q. @param {number} q */
export function qDb(q) {
  return 20 * Math.log10(Math.max(1e-3, q));
}

/** @param {number} x @param {number} a @param {number} b */
export function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

/**
 * The instrument's output stage: input gain, then a Butterworth high-pass of `poles` order at `hz`.
 * @param {BaseAudioContext} ctx @param {AudioNode} output @param {{hz: number, poles: number}} hp
 */
export function createBus(ctx, output, hp) {
  const input = ctx.createGain();
  /** @type {BiquadFilterNode[]} */
  const stages = butterQs(hp.poles).map((q) => {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp.hz;
    f.Q.value = qDb(q);
    return f;
  });
  /** @type {AudioNode} */
  let node = input;
  for (const s of stages) { node.connect(s); node = s; }
  node.connect(output);
  return {
    input,
    /** Retune the high-pass corner (the order is fixed when the instrument is made). @param {{hz: number}} next */
    set(next) { for (const s of stages) s.frequency.setTargetAtTime(next.hz, ctx.currentTime, 0.05); },
  };
}

/** Sustain-pedal timeline, so notes scheduled ahead see the pedal as it will be at their time. */
export function createPedal() {
  /** @type {{t: number, down: boolean}[]} */
  let events = [];
  return {
    /** @param {number} t */
    downAt(t) { let d = false; for (const e of events) { if (e.t <= t) d = e.down; else break; } return d; },
    /** @param {number} t @param {boolean} down */
    push(t, down) { events.push({ t, down }); events.sort((a, b) => a.t - b.t); },
    clear() { events = []; },
  };
}

/** @type {Map<string, Float32Array>} */
const curves = new Map();

/**
 * Swell from 0 to 1: sin(pi x / 2) raised to `power`. Power 2 starts with zero slope (no click,
 * a slow bloom); power 1 starts sooner and eases into the top. Cached per shape.
 * @param {number} n points @param {number} power
 */
export function swellCurve(n, power) {
  const key = `${n}:${power}`;
  let c = curves.get(key);
  if (!c) {
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.pow(Math.sin((Math.PI / 2) * (i / (n - 1))), power);
    curves.set(key, c);
  }
  return c;
}

/** dB lost per second for an exponential that falls `db` over `s` seconds, as a setTarget time constant. @param {number} s @param {number} db */
export function tauFor(s, db) {
  return Math.max(1e-3, s) / (db / 8.686);
}
