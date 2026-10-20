// @ts-check
// Writes a grown section as ABC (doc 24, "Authoring format"), the way the tides are written: the
// melody voice carries the chord symbols, a note held across a bar line or a chord change is tied,
// rests fill the gaps, and an optional counter voice follows. Notes are spelled in the home key
// (its signature does the sharps and flats); a tone outside the key, such as a borrowed chord's,
// gets its accidental, flats first. Pure.

import { parseKey } from '../score.js';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NAT = [0, 2, 4, 5, 7, 9, 11];

/**
 * A MIDI note's letter and alteration in a key.
 * @param {number} midi @param {Record<string, number>} sig the key's alteration per letter
 */
function spell(midi, sig) {
  const pc = ((midi % 12) + 12) % 12;
  /** @type {[number, number]|null} */
  let pick = null;
  // In the key first; then a natural; then a flat; then a sharp.
  for (let i = 0; i < 7 && !pick; i++) if ((NAT[i] + sig[LETTERS[i]] + 12) % 12 === pc) pick = [i, sig[LETTERS[i]]];
  for (let i = 0; i < 7 && !pick; i++) if (NAT[i] === pc) pick = [i, 0];
  for (let i = 0; i < 7 && !pick; i++) if ((NAT[i] + 11) % 12 === pc) pick = [i, -1];
  for (let i = 0; i < 7 && !pick; i++) if ((NAT[i] + 1) % 12 === pc) pick = [i, 1];
  const [li, alt] = /** @type {[number, number]} */ (pick);
  const octave = Math.floor((midi - alt) / 12) - 1;
  return { letter: LETTERS[li], alt, octave };
}

/** @param {string} letter @param {number} octave */
function pitchText(letter, octave) {
  if (octave >= 5) return letter.toLowerCase() + "'".repeat(octave - 5);
  return letter + ','.repeat(Math.max(0, 4 - octave));
}

/**
 * One voice's bars.
 * @param {{t: number, d: number, midi: number, fermata?: boolean}[]} notes section-local eighths
 * @param {{bars: number, len: number, events: {t: number, symbol: string}[]}} s
 * @param {Record<string, number>} sig
 * @param {{chords: boolean, dyn?: string|null}} o
 */
function voiceBars(notes, s, sig, o) {
  const end = s.bars * s.len;
  const cuts = new Set([0, end]);
  for (let b = 1; b < s.bars; b++) cuts.add(b * s.len);
  if (o.chords) for (const e of s.events) cuts.add(e.t);
  for (const n of notes) { cuts.add(Math.max(0, n.t)); cuts.add(Math.min(end, n.t + n.d)); }
  const pts = [...cuts].filter((x) => x >= 0 && x <= end).sort((a, b) => a - b);
  const sym = new Map(o.chords ? s.events.map((e) => [e.t, e.symbol]) : []);
  /** @type {string[][]} */
  const bars = Array.from({ length: s.bars }, () => []);
  /** @type {Map<string, number>} */
  let acc = new Map();
  let bar = -1;
  let first = true;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const bi = Math.floor(a / s.len);
    if (bi !== bar) { bar = bi; acc = new Map(); }
    const n = notes.find((x) => x.t <= a && x.t + x.d >= b);
    let tok = '';
    if (first && o.dyn) tok += `!${o.dyn}!`;
    if (sym.has(a)) tok += `"${sym.get(a)}"`;
    first = false;
    const len = b - a;
    const dur = len === 1 ? '' : String(len);
    if (!n) { tok += `z${dur}`; bars[bi].push(tok); continue; }
    if (n.fermata && b === n.t + n.d) tok += '!fermata!';
    const p = spell(n.midi, sig);
    const k = p.letter + p.octave;
    const cur = acc.has(k) ? acc.get(k) : sig[p.letter];
    if (cur !== p.alt) { tok += p.alt === 1 ? '^' : p.alt === -1 ? '_' : '='; acc.set(k, p.alt); }
    tok += pitchText(p.letter, p.octave) + dur + (b < n.t + n.d ? '-' : '');
    bars[bi].push(tok);
  }
  return bars.map((x) => x.join(' ')).join(' | ') + ' |';
}

/**
 * A section's ABC: the melody with the chord symbols, then the counter voice if there is one.
 * @param {string} meter @param {string} key
 * @param {{bars: number, len: number, events: {t: number, symbol: string}[]}} s
 * @param {{t: number, d: number, midi: number, fermata?: boolean}[]} mel
 * @param {{t: number, d: number, midi: number}[]} counter
 * @param {string|null} dyn a dynamic mark at the start ('mp'), or null
 */
export function sectionAbc(meter, key, s, mel, counter, dyn) {
  const sig = parseKey(key).accidentals;
  let text = `X:1\nM:${meter}\nL:1/8\nK:${key}\nV:mel\n${voiceBars(mel, s, sig, { chords: true, dyn })}\n`;
  if (counter.length) text += `V:counter\n${voiceBars(counter, s, sig, { chords: false })}\n`;
  return text;
}
