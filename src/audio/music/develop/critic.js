// @ts-check
// The development engine's critic for melody (doc 24, "The critic"): scores a grown melody so the
// engine can keep the best of its candidates. Higher is better. Every weight is in
// recipes/music/develop.json melody.score, and the lab shows each term.
//
//   leaps        a leap of a fifth or more (a fourth counts a third) not followed by a step back,
//                not across a rest
//   range        more than a tenth within a phrase
//   highPoints   the phrase's highest note struck more than once
//   repeats      the same note three times running
//   steps        how far the share of steps is from stepShare (a singable line moves mostly by step)
//   rhythm       rewards a few different note lengths
//   motifShare   how far the share of motif notes is from motifShare (half motif, half development)
//   tension      the phrases' high points follow the template's tension
//   frogBand     evening and night notes in the frogs' band (frogBand, MIDI), which they would mask
//   parallels    fifths or octaves with the bass at two chord changes running

/** @typedef {import('./motifs.js').MNote} MNote */

/**
 * @param {MNote[]} notes global eighths, sorted
 * @param {{scale: {midi: (d: number) => number, pc: (d: number) => number}, events: import('./timeline.js').TEvent[], phraseSpans: [number, number, [number, number]][], night: boolean}} C
 *   phraseSpans: each phrase's start, end and tension pair
 * @param {any} S rules.melody.score
 * @returns {{total: number, terms: Record<string, number>}}
 */
export function judgeMelody(notes, C, S) {
  /** @type {Record<string, number>} */
  const terms = {};
  const m = notes.map((n) => C.scale.midi(n.deg));
  const n = notes.length;

  let leaps = 0, steps = 0, moves = 0, repeats = 0;
  for (let i = 1; i < n; i++) {
    // Across a rest (a breath, a new phrase) the line starts again.
    if (notes[i].t > notes[i - 1].t + notes[i - 1].d) continue;
    const iv = m[i] - m[i - 1];
    if (iv === 0) { if (i >= 2 && m[i - 2] === m[i]) repeats++; continue; }
    moves++;
    if (Math.abs(iv) <= 2) steps++;
    if (Math.abs(iv) >= 5 && i + 1 < n) {
      const back = m[i + 1] - m[i];
      // A fourth is a small leap (a third of one); a fifth or more counts whole.
      if (!(Math.sign(back) === -Math.sign(iv) && Math.abs(back) <= 4)) leaps += Math.abs(iv) >= 7 ? 1 : 0.3;
    }
  }
  terms.leaps = -(S.leaps ?? 0) * leaps;
  terms.repeats = -(S.repeats ?? 0) * repeats;
  terms.steps = -(S.steps ?? 0) * Math.abs(steps / Math.max(1, moves) - (S.stepShare ?? 0.7)) * 10;

  const lens = new Set(notes.map((x) => x.d));
  terms.rhythm = (S.rhythm ?? 0) * Math.min(4, lens.size) / 4;

  let range = 0, highs = 0;
  /** @type {number[]} */
  const peaks = [];
  for (const [a, b] of C.phraseSpans) {
    const idx = notes.map((x, i) => (x.t >= a && x.t < b ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) { peaks.push(0); continue; }
    const ms = idx.map((i) => m[i]);
    const top = Math.max(...ms), low = Math.min(...ms);
    range += Math.max(0, top - low - 16);
    // Struck again later (not just held or tied on) counts as a second high point.
    let hits = 0;
    idx.forEach((i, k) => { if (m[i] === top && (k === 0 || m[idx[k - 1]] !== top)) hits++; });
    highs += Math.max(0, hits - 1);
    peaks.push(top);
  }
  terms.range = -(S.range ?? 0) * range;
  terms.highPoints = -(S.highPoints ?? 0) * highs;

  const motif = notes.filter((x) => x.job === 'motif' || x.job === 'return').length;
  const dev = notes.filter((x) => x.job === 'development').length;
  terms.motifShare = -(S.motifShare ?? 0) * Math.abs(motif / Math.max(1, motif + dev) - (S.motifTarget ?? 0.5)) * 4;

  // Tension: do the phrases peak higher where the template asks for more tension?
  const tens = C.phraseSpans.map(([, , t]) => (t[0] + t[1]) / 2);
  terms.tension = (S.tension ?? 0) * correlation(peaks, tens);

  const [fl, fh] = S.frogBand ?? [74, 90];
  terms.frogBand = C.night ? -(S.frogBandWeight ?? 0) * m.filter((x) => x >= fl && x <= fh).length : 0;

  // Parallel fifths and octaves with the bass, chord change to chord change.
  let par = 0;
  /** @type {number|null} */
  let last = null;
  let lastBass = -1, lastMel = -1;
  for (const e of C.events) {
    const k = notes.findIndex((x) => x.t <= e.t && x.t + x.d > e.t);
    if (k < 0) { last = null; continue; }
    const ic = (C.scale.pc(notes[k].deg) - e.bass + 12) % 12;
    const perfect = ic === 0 || ic === 7 ? ic : null;
    if (perfect !== null && perfect === last && e.bass !== lastBass && m[k] !== lastMel) par++;
    last = perfect; lastBass = e.bass; lastMel = m[k];
  }
  terms.parallels = -(S.parallels ?? 0) * par;

  const total = Object.values(terms).reduce((s, v) => s + v, 0);
  return { total, terms };
}

/** Pearson correlation, 0 when either side is flat. @param {number[]} a @param {number[]} b */
function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n, mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
