// @ts-check
// A ship's bell far out on the water (docs/future/14, the passing boat): made in code by modal
// synthesis, as the island's knocks are (doc 25): a few inharmonic partials of a bell, struck, each
// decaying at its own rate, then softened by distance (a low-pass) and set quietly on the ambience
// bus. `setpiece:bell { f0, db, decayS, cutoffHz, seed }` rings it once; the numbers come with the
// event from recipes/setpieces/boat.json bell.

/** A bell's partials as shares of its strike note, and how long each rings (share of decayS). */
const PARTIALS = [[0.5, 1], [1, 0.8], [1.19, 0.55], [1.5, 0.45], [2, 0.35], [2.5, 0.25], [2.67, 0.2], [3.01, 0.15]];

/**
 * Ring the bell once. @param {BaseAudioContext} ctx @param {AudioNode} dest
 * @param {{ f0: number, db: number, decayS: number, cutoffHz: number, seed?: number }} b
 */
export function ringBell(ctx, dest, b) {
  const t = ctx.currentTime + 0.02;
  const out = ctx.createGain();
  out.gain.value = Math.pow(10, b.db / 20);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = b.cutoffHz;
  out.connect(lp).connect(dest);
  // A slight detune from the seed, so no two strikes are the same.
  const detune = 1 + (((b.seed ?? 0) % 7) - 3) * 0.002;
  PARTIALS.forEach(([share, ring], i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = b.f0 * share * detune;
    const peak = 1 / (1 + i * 0.6), len = b.decayS * ring;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
  });
  setTimeout(() => { try { out.disconnect(); lp.disconnect(); } catch { /* gone */ } }, (b.decayS + 0.5) * 1000);
}
