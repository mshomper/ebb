// @ts-check
// Chord symbol reader (doc 24, "Authoring format"): turns the chord symbols written above ABC
// bars ("Dmaj9", "G/B", "C6/9", "N.C.") into a root pitch class, intervals above the root in
// semitones and an optional bass pitch class. Pure and plain data; never throws. A symbol it
// cannot read gives null, so the score reader can warn about it.
//
// Supported: roots A to G with # or b; major, minor (m, min, -), dim (dim, o), aug (aug, +), the
// power chord 5; 6, 6/9 (also 69), 7, maj7 (also M7, ma7), mM7, dim7, 9, 11, 13 in major, minor
// and dominant forms; sus2, sus4, sus; add2, add4, add6, add9, add11, add13 with or without
// parentheses; alterations b5 #5 b9 #9 #11 b13; a slash bass note ("G/B").
// Not supported: polychords, "alt", omit and no, half-diminished and triangle signs, Unicode
// sharp and flat signs.
// Conventions: 11 chords include the 9th; 13 chords include the 9th but not the 11th.

const PC = /** @type {Record<string, number>} */ ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const ADD = /** @type {Record<string, number>} */ ({ 2: 2, 4: 5, 6: 9, 9: 14, 11: 17, 13: 21 });
const DEGREE = /** @type {Record<string, number>} */ ({ 5: 7, 9: 14, 11: 17, 13: 21 });

/**
 * A readable chord symbol.
 * @typedef {Object} Chord
 * @property {string} symbol      the symbol as written, trimmed
 * @property {number} root        root pitch class, 0 = C .. 11 = B
 * @property {string} quality     the text between the root and the slash bass, e.g. "maj9", "m", ""
 * @property {number[]} intervals semitones above the root, ascending, starting with 0
 * @property {number|null} bass   bass pitch class of a slash chord, or null
 */

/**
 * "No chord" (N.C.): the harmony rests.
 * @typedef {Object} NoChord
 * @property {true} none
 * @property {string} symbol
 */

/** @param {string} letter @param {string} acc */
const pcOf = (letter, acc) => (PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;

/**
 * Read a chord symbol.
 * @param {string} symbol
 * @returns {Chord|NoChord|null} null when the symbol is empty or not understood
 */
export function parseChord(symbol) {
  const sym = String(symbol ?? '').trim();
  if (!sym) return null;
  if (/^N\.?C\.?$/i.test(sym)) return { none: true, symbol: sym };
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym);
  if (!m) return null;
  let quality = m[3];
  /** @type {number|null} */
  let bass = null;
  const slash = /\/([A-G])([#b]?)$/.exec(quality);
  if (slash) {
    bass = pcOf(slash[1], slash[2]);
    quality = quality.slice(0, slash.index);
  }
  const intervals = qualityIntervals(quality);
  if (!intervals) return null;
  return { symbol: sym, root: pcOf(m[1], m[2]), quality, intervals, bass };
}

/**
 * Intervals for a quality string such as "m7b5" or "maj9#11", or null if not understood.
 * @param {string} quality
 * @returns {number[]|null}
 */
function qualityIntervals(quality) {
  let s = quality.replace(/[()]/g, '');
  /** @param {RegExp} re */
  const eat = (re) => {
    const m = re.exec(s);
    if (m) s = s.slice(m[0].length);
    return m;
  };
  let third = 4, fifth = 7, seventh = false, maj7 = false, dim = false, power = false;
  /** @type {number[]} */
  const extra = [];
  /** @type {[string, string][]} */
  const alter = [];

  // Triad quality.
  if (eat(/^(maj|ma|M)(?=\d|$|add|sus|[#b])/)) maj7 = true;
  else if (eat(/^(min|mi|m|-)/)) third = 3;
  else if (eat(/^(dim|o)/)) { third = 3; fifth = 6; dim = true; }
  else if (eat(/^(aug|\+)/)) fifth = 8;
  if (third === 3 && !dim && eat(/^(maj|ma|M)/)) maj7 = true; // minor-major seventh

  // Extension number.
  const n = eat(/^(13|11|6\/9|69|9|7|6|5)/);
  if (n) {
    const v = n[1];
    if (v === '5') power = true;
    else if (v === '6') extra.push(9);
    else if (v === '6/9' || v === '69') extra.push(9, 14);
    else {
      seventh = true;
      if (v === '9' || v === '11' || v === '13') extra.push(14);
      if (v === '11') extra.push(17);
      if (v === '13') extra.push(21);
    }
  }

  // Suspensions, added tones and alterations, in any order.
  while (s) {
    let m;
    if ((m = eat(/^sus([24])?/))) third = m[1] === '2' ? 2 : 5;
    else if ((m = eat(/^add(13|11|9|6|4|2)/))) extra.push(ADD[m[1]]);
    else if ((m = eat(/^([b#])(13|11|9|5)/))) alter.push([m[1], m[2]]);
    else return null;
  }

  const iv = new Set([0, fifth]);
  if (!power) iv.add(third);
  if (seventh) iv.add(dim ? 9 : maj7 ? 11 : 10);
  for (const e of extra) iv.add(e);
  for (const [sign, deg] of alter) {
    const base = DEGREE[deg];
    iv.delete(base);
    iv.add(base + (sign === '#' ? 1 : -1));
  }
  return [...iv].sort((a, b) => a - b);
}

/**
 * The chord's MIDI notes stacked up from a root MIDI note (the intervals added to it). The slash
 * bass is not included; voicing decides where it goes.
 * @param {Chord|NoChord|null} chord
 * @param {number} rootMidi
 * @returns {number[]} empty for no chord
 */
export function chordTones(chord, rootMidi) {
  if (!chord || 'none' in chord) return [];
  return chord.intervals.map((i) => rootMidi + i);
}

/**
 * The distinct pitch classes the chord uses, the slash bass included, sorted ascending.
 * @param {Chord|NoChord|null} chord
 * @returns {number[]} empty for no chord
 */
export function pitchClasses(chord) {
  if (!chord || 'none' in chord) return [];
  const set = new Set(chord.intervals.map((i) => (chord.root + i) % 12));
  if (chord.bass !== null) set.add(chord.bass);
  return [...set].sort((a, b) => a - b);
}
