// @ts-check
// The development engine, step 4 (doc 24, "The fit step"): bends a grown melody onto its chords.
// A note on a strong beat, or a long one, lands on a chord tone, or on a suspension that resolves
// down by step to one. A short note on a weak beat may be a passing or neighbor tone (reached and
// left by step), but never a half step against the bass. A note held into a new chord that does not
// share it is re-struck there on the nearest tone of the new chord (so a melody over a rocking bass
// leans on the notes both chords share). Everything else moves to the nearest chord tone.
//
// Notes and chord events are in global eighths (the whole piece). Pure.

import { chordAt } from './timeline.js';

/** @typedef {import('./motifs.js').MNote} MNote */
/** @typedef {import('./timeline.js').TEvent} TEvent */

/**
 * @typedef {Object} FitCtx
 * @property {TEvent[]} events   every chord of the piece, global eighths, ascending
 * @property {number} len        eighths per bar
 * @property {number[]} strong   strong positions in a bar, in eighths
 * @property {{pc: (d: number) => number, midi: (d: number) => number}} scale
 * @property {[number, number]} [register]  lowest and highest MIDI note a snapped note may take
 */

const near = (/** @type {number} */ a, /** @type {number} */ b) => { const x = Math.abs(a - b) % 12; return Math.min(x, 12 - x); };

/** @param {FitCtx} F @param {number} deg @param {TEvent} e */
export const isChordTone = (F, deg, e) => e.pcs.includes(F.scale.pc(deg));

/**
 * The chord tone of e nearest a degree: smooth after prev, not the note before again (a melody
 * that keeps landing on the same tone stalls), a little less often the bass's own note (octaves
 * with the bass), and inside the register.
 * @param {FitCtx} F @param {number} deg @param {TEvent} e @param {number|null} prev
 */
export function snap(F, deg, e, prev) {
  let best = deg, cost = Infinity;
  const [lo, hi] = F.register ?? [0, 127];
  for (const off of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const d = deg + off;
    if (!isChordTone(F, d, e)) continue;
    const m = F.scale.midi(d);
    const c = Math.abs(off) + (prev === null ? 0 : Math.max(0, Math.abs(d - prev) - 2) * 0.6 + (d === prev ? 0.8 : 0))
      + (F.scale.pc(d) === e.bass ? 0.3 : 0) + (m < lo || m > hi ? 4 : 0);
    if (c < cost) { cost = c; best = d; }
  }
  return best;
}

/**
 * Fit a melody to its chords (in place; notes may be split). Returns the notes, sorted.
 * @param {MNote[]} notes @param {FitCtx} F
 * @returns {MNote[]}
 */
export function fitMelody(notes, F) {
  notes.sort((a, b) => a.t - b.t);
  // Held into a chord that does not share it: re-strike on the new chord.
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    for (const e of F.events) {
      if (e.t <= n.t || e.t >= n.t + n.d) continue;
      if (isChordTone(F, n.deg, e)) continue;
      const rest = n.t + n.d - e.t;
      n.d = e.t - n.t;
      notes.splice(i + 1, 0, { t: e.t, d: rest, deg: snap(F, n.deg, e, n.deg), job: 'chord', fermata: n.fermata });
      n.fermata = false;
      break;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const e = chordAt(F.events, n.t);
      if (!e || !e.pcs.length) continue;
      if (isChordTone(F, n.deg, e)) { if (n.job === 'passing' || n.job === 'suspension') n.job = 'chord'; continue; }
      const prev = i > 0 && notes[i - 1].t + notes[i - 1].d >= n.t - 1 ? notes[i - 1] : null;
      const next = i + 1 < notes.length && notes[i + 1].t <= n.t + n.d + 1 ? notes[i + 1] : null;
      const pos = n.t % F.len;
      // Strong: on the bar's strong beats, or long. A quarter between two steps may still pass.
      const strong = F.strong.includes(pos) || n.d >= 4 || (n.d >= 3 && pos % 2 === 0);
      const halfBass = near(F.scale.pc(n.deg), e.bass) === 1;
      const sameChord = next && chordAt(F.events, next.t) === e;
      if (strong) {
        // A suspension: prepared (or stepped into), resolving down a step to a chord tone.
        if (next && sameChord && next.deg === n.deg - 1 && isChordTone(F, next.deg, e) && !halfBass && n.d <= F.len / 2
          && prev && Math.abs(prev.deg - n.deg) <= 1) { n.job = 'suspension'; continue; }
      } else if (prev && next && Math.abs(n.deg - prev.deg) === 1 && Math.abs(next.deg - n.deg) === 1 && Math.sign(n.deg - prev.deg) === Math.sign(next.deg - n.deg) && !halfBass) {
        n.job = 'passing';
        continue;
      } else if (prev && next && prev.deg === next.deg && Math.abs(n.deg - prev.deg) === 1 && !halfBass) {
        n.job = 'passing';
        continue;
      }
      n.deg = snap(F, n.deg, e, prev ? prev.deg : null);
      if (n.job === 'passing' || n.job === 'suspension') n.job = 'chord';
    }
  }
  return notes;
}
