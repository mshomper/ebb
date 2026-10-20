// @ts-check
// The guitar's hand (doc 24, Instruments; Matt, October 20, 2026: a guitar is first strummed for
// rhythm, then a clean melody, then a counter-harmony). Two pieces for the realizer:
//   guitarVoicing  a chord shaped the way a guitarist's hand takes it: one note per string at most,
//                  frets within a four-fret window (open strings allowed), the chord's bass (or root)
//                  on the lowest string played, as many of the chord's tones as fit, no strings below
//                  the bass, little motion from the last shape.
//   strumNotes     a chord span strummed by a pattern of down and up strokes on the eighths: a down
//                  stroke sweeps every string low to high, an up stroke the top strings high to low,
//                  lighter; each stroke rings until the next one.
// Pure. Numbers come from recipes/music/realize.json textures.strum.

/** Standard tuning, low to high: E2 A2 D3 G3 B3 E4. */
const OPEN = [40, 45, 50, 55, 59, 64];

/**
 * @param {number[]} pcs the chord's pitch classes (0 = C), including a slash bass
 * @param {number} bassPc the note the guitar's lowest string should give (the slash bass, or the root)
 * @param {number[] | null} prev the last shape (MIDI, low to high), for small motion
 * @param {{maxWindow?: number, minStrings?: number}} [o]
 * @returns {number[]} MIDI notes, low to high
 */
export function guitarVoicing(pcs, bassPc, prev, o = {}) {
  const want = new Set(pcs.map((p) => ((p % 12) + 12) % 12));
  const maxW = o.maxWindow ?? 7, minStrings = o.minStrings ?? 4;
  /** @type {{notes: number[], score: number} | null} */
  let best = null;
  for (let w = 0; w <= maxW; w++) {
    const w1 = Math.max(1, w);
    const frets = (/** @type {number} */ _s) => [0, w1, w1 + 1, w1 + 2, w1 + 3];
    for (let s0 = 0; s0 <= 2; s0++) {
      const bf = frets(s0).filter((f) => (OPEN[s0] + f) % 12 === bassPc);
      for (const f0 of bf) {
        const notes = [OPEN[s0] + f0];
        const have = new Set([bassPc]);
        for (let s = s0 + 1; s < 6; s++) {
          const opts = frets(s).map((f) => OPEN[s] + f).filter((m) => want.has(m % 12) && m > notes[notes.length - 1]);
          if (!opts.length) continue;
          // a tone not yet in the shape first; then the lower fret
          opts.sort((a, b) => (have.has(a % 12) ? 1 : 0) - (have.has(b % 12) ? 1 : 0) || a - b);
          notes.push(opts[0]);
          have.add(opts[0] % 12);
        }
        if (notes.length < Math.min(minStrings, 6 - s0)) continue;
        let score = 3 * have.size + notes.length - 0.6 * w - 0.8 * s0;
        if (have.size < want.size) score -= 2 * (want.size - have.size);
        // a half step between neighbouring strings sounds harsh in a strum
        for (let k = 1; k < notes.length; k++) if (notes[k] - notes[k - 1] === 1) score -= 2.5;
        // Low down, the two lowest strings stand a fifth or an octave apart (a third or a seventh
        // there is muddy: Fmaj7 as F2 A2 E3 sounded odd to Matt, October 20, 2026).
        if (notes.length > 1 && notes[0] < 52 && ![7, 12].includes(notes[1] - notes[0])) score -= 6;
        // and no step (a second) between neighbouring strings below G3
        for (let k = 1; k < notes.length; k++) if (notes[k - 1] < 55 && notes[k] - notes[k - 1] <= 2) score -= 4;
        // Double the root or fifth, not the colour (a doubled third or seventh stands out).
        const fifth = (bassPc + 7) % 12;
        const count = new Map();
        for (const m of notes) count.set(m % 12, (count.get(m % 12) ?? 0) + 1);
        for (const [pc, k] of count) if (k > 1 && pc !== bassPc && pc !== fifth) score -= 2 * (k - 1);
        if (prev && prev.length) score -= 0.08 * Math.abs(notes[notes.length - 1] - prev[prev.length - 1]) + 0.05 * Math.abs(notes[0] - prev[0]);
        if (!best || score > best.score) best = { notes, score };
      }
    }
  }
  if (best) return best.notes;
  // Nothing fits (an unusual chord): the bass and the tones above it, close, from the A string up.
  const out = [OPEN[1] + ((bassPc - OPEN[1] + 12) % 12)];
  for (const p of [...want].filter((p) => p !== bassPc)) out.push(out[0] + ((p - out[0] + 120) % 12));
  return out.sort((a, b) => a - b);
}

/**
 * Strum one chord span.
 * @param {{tick: number, end: number, shape: number[], barTicks: number, eighth: number, pattern: string}} span
 *   pattern: one character per eighth of the bar, D down, U up, anything else rest (e.g. 'D.DU.UDU')
 * @param {any} S realize.json textures.strum
 * @param {(tick: number, dur: number, midi: number, offsetMs: number, velOffset: number) => void} push
 */
export function strumNotes(span, S, push) {
  const strokes = [];
  const first = Math.floor(span.tick / span.eighth) * span.eighth;
  for (let tk = first; tk < span.end; tk += span.eighth) {
    if (tk < span.tick) continue;
    const slot = Math.round((tk % span.barTicks) / span.eighth) % span.pattern.length;
    const ch = span.pattern[slot];
    // the chord's first eighth always sounds, so a change is never silent
    const kind = ch === 'D' || ch === 'U' ? ch : tk === span.tick ? 'D' : null;
    if (kind) strokes.push({ tk, kind, onBeat: slot % 2 === 0 });
  }
  strokes.forEach((s, i) => {
    const until = i + 1 < strokes.length ? strokes[i + 1].tk : span.end;
    const dur = Math.max(span.eighth / 2, until - s.tk);
    const notes = s.kind === 'D' ? span.shape : span.shape.slice(-(S.upStrings ?? 4)).reverse();
    const spread = s.kind === 'D' ? S.downSpreadMs : S.upSpreadMs;
    const base = s.kind === 'D' ? (s.onBeat ? S.beatAccent : S.offbeatDown) : S.up;
    notes.forEach((m, k) => push(s.tk, dur, m, (k * spread) / Math.max(1, notes.length - 1), base - (s.kind === 'D' ? k * (S.downTaper ?? 0) : 0)));
  });
}
