// @ts-check
// The development engine: where every chord of a grown piece sounds, section by section, in
// eighths, exactly as piece.js writes the chord symbols (one section per phrase, then the coda).
// The melody (melody.js) and the counter-line (counter.js) are grown against this, and the ABC
// writer (abc-write.js) puts the symbols back at the same places.
//
// Also the home scale: scale degrees (motifs.js) to MIDI notes and pitch classes.

import { parseChord, pitchClasses } from '../chords.js';
import { BAR_EIGHTHS } from './motifs.js';

/**
 * @typedef {Object} TEvent   a chord sounding from t (eighths from the section's start)
 * @property {number} t
 * @property {string} symbol
 * @property {number[]} pcs   its pitch classes, the bass included
 * @property {number} bass    the bass pitch class (the root when there is no slash)
 * @property {number} root
 * @property {string|null} figure  'rock', a written line's name, or null
 * @property {boolean} kept   brought back unchanged by a return
 * @property {boolean} fermata the piece's last chord
 */
/**
 * @typedef {Object} Section
 * @property {string} name   'p1'.. or 'coda'
 * @property {number} phrase index into the plan, or -1 for the coda
 * @property {number} bars   written bars
 * @property {number} len    eighths per written bar
 * @property {TEvent[]} events
 * @property {(string|null)[]} figures  per written bar
 * @property {boolean[]} kept per written bar
 */

/** @param {string} symbol @param {number} t @param {Partial<TEvent>} [extra] @returns {TEvent} */
function event(symbol, t, extra = {}) {
  const c = /** @type {any} */ (parseChord(symbol));
  const ok = c && !c.none;
  return {
    t, symbol, pcs: ok ? pitchClasses(c) : [], bass: ok ? (c.bass ?? c.root) : 0, root: ok ? c.root : 0,
    figure: null, kept: false, fermata: false, ...extra,
  };
}

/**
 * The piece's sections and chord events.
 * @param {any} material
 * @param {{bars: import('./harmony.js').HBar[]}} walked
 * @param {import('./plan.js').PhrasePlan[]} plan
 * @param {string} meter
 * @param {any} ending the chosen ending (material.endings entry)
 * @returns {Section[]}
 */
export function sectionTimelines(material, walked, plan, meter, ending) {
  const len = BAR_EIGHTHS[meter] ?? 8;
  const span = material.harmonicBars?.[meter] ?? 1;
  /** @type {Section[]} */
  const out = [];
  plan.forEach((_, i) => {
    const bars = walked.bars.filter((b) => b.phrase === i);
    /** @type {TEvent[]} */
    const events = [];
    /** @type {(string|null)[]} */
    const figures = [];
    /** @type {boolean[]} */
    const kept = [];
    bars.forEach((b, k) => {
      const w = k * span;
      for (let s = 0; s < span; s++) { figures.push(b.figure ?? null); kept.push(!!b.kept); }
      const extra = { figure: b.figure ?? null, kept: !!b.kept };
      // A held chord sounds on (piece.js writes no symbol), except on a phrase's first bar.
      if (b.held && k > 0 && b.chords.length === 1) return;
      if (b.chords.length === 1) { events.push(event(b.chords[0].symbol, w * len, extra)); return; }
      if (span > 1) {
        events.push(event(b.chords[0].symbol, w * len, extra), event(b.chords[1].symbol, (w + span - 1) * len, extra));
        return;
      }
      b.chords.forEach((c, j) => events.push(event(c.symbol, w * len + (j === 0 ? 0 : Math.round(len * c.at)), extra)));
    });
    out.push({ name: `p${i + 1}`, phrase: i, bars: bars.length * span, len, events, figures, kept });
  });
  // The coda: each ending bar a chord (a harmonic bar long), the last one bar, held.
  const lastBar = walked.bars[walked.bars.length - 1];
  const endBars = ending?.hold ? [[lastBar.chords[lastBar.chords.length - 1].symbol, 0]] : (ending?.bars ?? [['G/D', 0.2], ['D', 0]]);
  /** @type {TEvent[]} */
  const events = [];
  let w = 0;
  endBars.forEach((/** @type {[string, number]} */ [sym], /** @type {number} */ k) => {
    const last = k === endBars.length - 1;
    events.push(event(sym, w * len, { fermata: last }));
    w += last ? 1 : span;
  });
  out.push({ name: 'coda', phrase: -1, bars: w, len, events, figures: Array(w).fill(null), kept: Array(w).fill(false) });
  return out;
}

/** The chord sounding at t. @param {TEvent[]} events ascending @param {number} t */
export function chordAt(events, t) {
  let e = events[0];
  for (const x of events) { if (x.t <= t) e = x; else break; }
  return e;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PCS = /** @type {Record<string, number>} */ ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

/**
 * The home scale (an ionian key such as "D" or "F", or "Bb").
 * @param {string} home
 */
export function homeScale(home) {
  const m = /^([A-G])([#b]?)/.exec(home) ?? ['', 'C', ''];
  const tonicPc = (PCS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const tonicMidi = 60 + tonicPc;
  const mod = (/** @type {number} */ d) => ((d % 7) + 7) % 7;
  return {
    tonicPc,
    /** @param {number} d */ midi: (d) => tonicMidi + 12 * Math.floor(d / 7) + MAJOR[mod(d)],
    /** @param {number} d */ pc: (d) => (tonicPc + MAJOR[mod(d)]) % 12,
    /** The degree of a MIDI note, if it is in the scale. @param {number} midi */
    degOf: (midi) => {
      for (let d = -21; d <= 28; d++) if (tonicMidi + 12 * Math.floor(d / 7) + MAJOR[mod(d)] === midi) return d;
      return null;
    },
  };
}
