// @ts-check
// ABC subset reader (doc 24, "Authoring format"): turns an ABC 2.1 tune into timed note events in
// integer ticks (480 per quarter) with MIDI pitch (C = middle C = 60). Pure, plain data out (safe
// to post to a Web Worker), and it never throws: anything it cannot read becomes a plain-language
// warning that names the voice and counts bars from 1.
//
// Supported: header X T M L Q K V; body fields K L M V (as lines or inline [K:G]), inline [V:id];
// notes with ^ ^^ _ __ = and octave marks, accidentals to the end of the bar (same letter and
// octave), keys with modes; lengths (2, /, //, 3/2), rests z x, whole-bar rests Z X; broken
// rhythm > < (also >> <<); tuplets (3 and (p:q:r; ties (merged, also across bar lines); note
// groups [CEG]; grace notes {g}; chord symbols "Dm7"; decorations !word! and H L . ~ T M P;
// dynamics ppp to fff; hairpins !<(! !<)! !>(! !>)!; voice name= and octave=; %, \ and w: lines.
// Not supported (warned or skipped): repeats and endings are not expanded, voice overlay &,
// tempo changes inside the tune, transpose=, %%MIDI and other directives, multiple tunes.

import { parseChord } from './chords.js';

export const TICKS_PER_QUARTER = 480;
const WHOLE = 4 * TICKS_PER_QUARTER;
const EPS = 1e-6;
const LETTER_PC = /** @type {Record<string, number>} */ ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const FIFTHS = /** @type {Record<string, number>} */ ({ F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 });
const SHARPS = 'FCGDAEB';
const FLATS = 'BEADGCF';
/** Mode word (first three letters, or "m") → [mode name, fifths from the major key]. */
const MODES = /** @type {Record<string, [string, number]>} */ ({ maj: ['major', 0], ion: ['ionian', 0],
  min: ['minor', -3], m: ['minor', -3], aeo: ['aeolian', -3], dor: ['dorian', -2], phr: ['phrygian', -4],
  lyd: ['lydian', 1], mix: ['mixolydian', -1], loc: ['locrian', -5] });
const ACC = /** @type {Record<string, number>} */ ({ '^^': 2, '^': 1, '__': -2, '_': -1, '=': 0 });
const DYNAMICS = new Set(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']);
/** Mark → [note field, value]; hairpin marks → ['hairpin', 'cresc+' | 'cresc-' | 'dim+' | 'dim-']. */
const MARKS = /** @type {Record<string, [string, any]>} */ ({ fermata: ['fermata', true], accent: ['accent', true],
  '>': ['accent', true], emphasis: ['accent', true], staccato: ['staccato', true], tenuto: ['tenuto', true],
  roll: ['ornament', 'roll'], trill: ['ornament', 'trill'], mordent: ['ornament', 'mordent'],
  lowermordent: ['ornament', 'mordent'], uppermordent: ['ornament', 'mordent'], pralltriller: ['ornament', 'mordent'],
  turn: ['ornament', 'turn'], arpeggio: ['ornament', 'arpeggio'], '<(': ['hairpin', 'cresc+'],
  '<)': ['hairpin', 'cresc-'], 'crescendo(': ['hairpin', 'cresc+'], 'crescendo)': ['hairpin', 'cresc-'],
  '>(': ['hairpin', 'dim+'], '>)': ['hairpin', 'dim-'], 'diminuendo(': ['hairpin', 'dim+'], 'diminuendo)': ['hairpin', 'dim-'] });
const SHORTHAND = /** @type {Record<string, string>} */ ({ '.': 'staccato', '~': 'roll', H: 'fermata', L: 'accent',
  T: 'trill', M: 'lowermordent', P: 'uppermordent', S: 'segno', O: 'coda', u: 'upbow', v: 'downbow' });
/** Marks that are valid ABC but mean nothing for playback here; skipped without a warning. */
const QUIET = new Set(['segno', 'coda', 'upbow', 'downbow', 'breath', 'slide', 'fine', 'D.C.', 'D.S.', 'open',
  'thumb', 'snap', 'wedge', 'invertedfermata', 'editorial', 'courtesy', 'plus', '+']);

/**
 * @typedef {Object} Key
 * @property {string} tonic   "D", "Bb", "F#" ("C" for K:none)
 * @property {string} mode    "major", "minor", "ionian", "dorian", ... or "none"
 * @property {number} tonicPc tonic pitch class, 0 = C
 * @property {Record<string, number>} accidentals semitone change per letter A..G from the signature
 */
/** @typedef {{num: number, den: number}} Meter */
/** @typedef {{bpm: number, beat: Meter}} Tempo */
/**
 * @typedef {Object} Note
 * @property {number} tick  start, ticks from the first note of the tune
 * @property {number} dur   length in ticks (0 for grace notes)
 * @property {number} midi  MIDI pitch
 * @property {string} voice voice id
 * @property {number} bar   0-based bar index
 * @property {string} [dyn] dynamic in force (pp .. ff), absent before the first one
 * @property {boolean} [grace] @property {boolean} [fermata] @property {boolean} [accent]
 * @property {boolean} [staccato] @property {boolean} [tenuto]
 * @property {string} [ornament] "roll", "trill", "mordent", "turn" or "arpeggio"
 */
/** @typedef {{id: string, name: string, notes: Note[]}} Voice */
/** @typedef {{tick: number, bar: number, symbol: string, voice: string}} ChordMark */
/** @typedef {{dir: string, startTick: number, endTick: number, voice: string}} Hairpin */
/**
 * @typedef {Object} Score
 * @property {string} title @property {Meter|null} meter @property {Tempo|null} tempo @property {Key} key
 * @property {number|null} barLenTicks bar length of the header meter, null in free meter
 * @property {number} pickupTicks length of a short first bar, 0 if none
 * @property {number} bars        bar count, pickup included
 * @property {number[]} barTicks  start tick of every bar
 * @property {Voice[]} voices @property {ChordMark[]} chords @property {Hairpin[]} hairpins
 * @property {string[]} warnings
 */

/**
 * Read a K: field value ("D", "F#m", "E Dorian", "Bblyd", "none", "D ^g").
 * @param {string} spec
 * @returns {Key|null} null when no tonic can be read
 */
export function parseKey(spec) {
  const s = String(spec ?? '').trim();
  /** @type {Record<string, number>} */
  const accidentals = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (/^none\b/i.test(s)) return { tonic: 'C', mode: 'none', tonicPc: 0, accidentals };
  if (s === '') return { tonic: 'C', mode: 'major', tonicPc: 0, accidentals };
  const m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)(.*)$/.exec(s);
  if (!m) return null;
  m[1] = m[1].toUpperCase();
  const word = m[3].toLowerCase();
  let rest = m[4];
  let mode = MODES[word === 'm' ? 'm' : word.slice(0, 3)];
  if (!mode || (word.length > 1 && word.length < 3)) { mode = MODES.maj; rest = m[3] + rest; }
  const fifths = FIFTHS[m[1]] + (m[2] === '#' ? 7 : m[2] === 'b' ? -7 : 0) + mode[1];
  for (let i = 0; i < 7; i++) {
    if (fifths > 0) accidentals[SHARPS[i]] = (i < fifths ? 1 : 0) + (i < fifths - 7 ? 1 : 0);
    if (fifths < 0) accidentals[FLATS[i]] = -((i < -fifths ? 1 : 0) + (i < -fifths - 7 ? 1 : 0));
  }
  for (const tok of rest.trim().split(/\s+/)) {
    if (tok === 'exp') for (const k in accidentals) accidentals[k] = 0;
    const a = /^(\^\^|\^|__|_|=)([A-Ga-g])$/.exec(tok);
    if (a) accidentals[a[2].toUpperCase()] = ACC[a[1]];
  }
  const tonicPc = (LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { tonic: m[1] + m[2], mode: mode[0], tonicPc, accidentals };
}

/** @param {number} a @param {number} b @returns {number} */
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a) || 1);

/** M: value → meter, null for free meter, undefined when unreadable. @param {string} val */
function readMeter(val) {
  const s = val.trim();
  if (s === '' || /^none$/i.test(s)) return null;
  if (s === 'C') return { num: 4, den: 4 };
  if (s === 'C|') return { num: 2, den: 2 };
  const m = /^\(?([\d+\s]+)\)?\s*\/\s*(\d+)$/.exec(s);
  if (!m) return undefined;
  const num = m[1].split('+').reduce((a, b) => a + (Number(b) || 0), 0);
  return num > 0 && +m[2] > 0 ? { num, den: +m[2] } : undefined;
}

/** L: value → fraction of a whole note, or null. @param {string} val @returns {Meter|null} */
function readUnit(val) {
  const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(val);
  return m && +m[1] > 0 && +(m[2] ?? 1) > 0 ? { num: +m[1], den: +(m[2] ?? 1) } : null;
}

/** Q: value → tempo, or null. @param {string} val @param {Meter} unit @returns {Tempo|null} */
function readTempo(val, unit) {
  const t = val.replace(/"[^"]*"/g, ' ');
  const m = /((?:\d+\/\d+\s*)+)=\s*(\d+(?:\.\d+)?)/.exec(t);
  if (m) {
    let num = 0, den = 1;
    for (const f of m[1].trim().split(/\s+/)) {
      const [a, b] = f.split('/').map(Number);
      num = num * b + a * den; den *= b;
    }
    const g = gcd(num, den);
    return { bpm: +m[2], beat: { num: num / g, den: den / g } };
  }
  const n = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(t);
  return n ? { bpm: +n[1], beat: { ...unit } } : null;
}

/** Ticks as a fraction in the meter's own unit ("4/8"). @param {number} ticks @param {number} den */
function asFraction(ticks, den) {
  const units = (ticks * den) / WHOLE;
  if (Math.abs(units - Math.round(units)) < EPS) return `${Math.round(units)}/${den}`;
  const t = Math.round(ticks), g = gcd(t, WHOLE);
  return `${t / g}/${WHOLE / g}`;
}

/** Length multiplier from digits and slashes ("3", "/", "//", "3/2"). @param {string} a @param {string} sl @param {string} b */
function lengthOf(a, sl, b) {
  const num = a ? +a : 1;
  if (!sl) return num;
  return num / (b ? +b * 2 ** (sl.length - 1) : 2 ** sl.length);
}

const NOTE_RE = /(\^\^|\^|__|_|=)?([A-Ga-g])([',]*)(\d*)(\/*)(\d*)/y;
const LEN_RE = /(\d*)(\/*)(\d*)/y;
const REST_RE = /([zx])(\d*)(\/*)(\d*)/y;
const BAR_RE = /\[?[|:\]]+(\d+(?:[,-]\d+)*)?/y;
const TUPLET_RE = /\((\d+)(?::(\d*))?(?::(\d*))?/y;
const INLINE_RE = /\[([IKLMmNPQRrTUVw]):([^\]]*)\]/y;
const BROKEN_RE = /[<>]{1,3}/y;

/** @param {RegExp} re @param {string} s @param {number} i */
const at = (re, s, i) => { re.lastIndex = i; return re.exec(s); };

/** @typedef {{acc: number|null, letter: string, oct: number, len: number, tie?: boolean}} NoteSpec */
/** Letter and octave, the slot an accidental or a tie belongs to. @param {NoteSpec} n */
const slot = (n) => n.letter.toUpperCase() + ((n.letter < 'a' ? 0 : 1) + n.oct);
/**
 * A note while reading: start and end as exact (fractional) ticks, k = slot for ties.
 * @typedef {{voice: string, bar: number, s: number, e: number, midi: number, k?: string, grace?: boolean, dyn?: string}} RawNote
 */
/**
 * Per-voice reading state. t = time now in ticks; mult and zLen describe a pending Z rest; issue
 * is a bar-length warning held back until we know it is not a pickup's matching last bar.
 * @typedef {{id: string, name: string, octave: number, notes: RawNote[], t: number, bar: number, barStart: number,
 *   mult: number, zLen: number, barTicks: number[], pickup: number, issue: {msg: string, len: number, want: number}|null,
 *   key: Key, meter: Meter|null, unit: number, acc: Record<string, number>, ties: RawNote[], graces: NoteSpec[],
 *   deco: Record<string, any>, dyn: string|undefined, tuplet: {p: number, q: number, left: number}|null,
 *   broken: number, hairpin: {dir: string, s: number}|null}} VoiceState
 */
/** @param {string} s @param {number} i @returns {(NoteSpec & {end: number})|null} */
function readNote(s, i) {
  const m = at(NOTE_RE, s, i);
  if (!m) return null;
  let oct = 0;
  for (const c of m[3]) oct += c === "'" ? 1 : -1;
  return { acc: m[1] ? ACC[m[1]] : null, letter: m[2], oct, len: lengthOf(m[4], m[5], m[6]), end: i + m[0].length };
}

/**
 * Read an ABC tune into timed note events. Never throws.
 * @param {string} text
 * @returns {Score}
 */
export function parseAbc(text) {
  /** @type {string[]} */ const warnings = [];
  /** @type {ChordMark[]} */ const chords = [];
  /** @type {Hairpin[]} */ const hairpins = [];
  const hdr = { title: '', meter: /** @type {Meter|null} */ (null), unit: /** @type {Meter|null} */ (null),
    key: /** @type {Key} */ (parseKey('C')), tempoText: '', tempo: /** @type {Tempo|null} */ (null) };
  /** @type {Map<string, {name?: string, octave?: number}>} */ const declared = new Map();
  /** @type {VoiceState[]} */ const voices = [];
  /** @type {Map<string, VoiceState>} */ const byId = new Map();
  /** @type {VoiceState|null} */ let cur = null;
  let inBody = false;

  /** @param {string} msg */
  const warn = (msg) => { if (!warnings.includes(msg)) warnings.push(msg); };
  /** @param {VoiceState} v */
  const where = (v) => `voice ${v.id}, bar ${v.bar + 1}`;
  /** @param {Meter} m */
  const barLen = (m) => (WHOLE * m.num) / m.den;

  /** V: properties we use. @param {string} spec @returns {{name?: string, octave?: number}} */
  function props(spec) {
    const n = /\b(?:name|nm)\s*=\s*(?:"([^"]*)"|(\S+))/.exec(spec), o = /\boctave\s*=\s*([+-]?\d+)/.exec(spec);
    return { ...(n ? { name: n[1] ?? n[2] } : {}), ...(o ? { octave: +o[1] } : {}) };
  }

  /** @param {string} id @returns {VoiceState} */
  function getVoice(id) {
    const old = byId.get(id);
    if (old) return old;
    const d = declared.get(id) ?? {};
    /** @type {VoiceState} */
    const v = { id, name: d.name ?? id, octave: d.octave ?? 0, notes: [], t: 0, bar: 0, barStart: 0, mult: 1, zLen: 0,
      barTicks: [0], pickup: 0, issue: null, key: hdr.key, meter: hdr.meter,
      unit: hdr.unit ? (WHOLE * hdr.unit.num) / hdr.unit.den : WHOLE / 8,
      acc: {}, ties: [], graces: [], deco: {}, dyn: undefined, tuplet: null, broken: 1, hairpin: null };
    byId.set(id, v); voices.push(v);
    return v;
  }
  /** @returns {VoiceState} */
  const voice = () => cur ?? (cur = getVoice(declared.keys().next().value ?? '1'));

  function startBody() {
    inBody = true;
    if (!hdr.unit) hdr.unit = hdr.meter && hdr.meter.num / hdr.meter.den < 0.75 ? { num: 1, den: 16 } : { num: 1, den: 8 };
    if (hdr.tempoText) {
      hdr.tempo = readTempo(hdr.tempoText, hdr.unit);
      if (!hdr.tempo) warn(`the tempo "Q:${hdr.tempoText}" could not be read`);
    }
    for (const id of declared.keys()) getVoice(id);
  }

  /** Field in the header, a body line or an inline [X:..]. @param {string} f @param {string} val */
  function field(f, val) {
    const v = inBody && f !== 'V' ? voice() : null;
    const what = v ? `${where(v)}: ` : '';
    if (f === 'K') {
      if (/^\s*(clef|octave|middle|transpose|stafflines)\s*=/.test(val)) return;
      const k = parseKey(val);
      if (!k) warn(`${what}the key "${val.trim()}" could not be read, kept the previous key`);
      else if (v) v.key = k; else hdr.key = k;
      if (!inBody) startBody();
    } else if (f === 'M') {
      const m = readMeter(val);
      if (m === undefined) warn(`${what}the meter "${val.trim()}" could not be read`);
      else if (v) v.meter = m; else hdr.meter = m;
    } else if (f === 'L') {
      const u = readUnit(val);
      if (!u) warn(`${what}the unit length "${val.trim()}" could not be read`);
      else if (v) v.unit = (WHOLE * u.num) / u.den; else hdr.unit = u;
    } else if (f === 'V') {
      const id = val.trim().split(/\s+/)[0];
      if (!id) { warn('a V: field has no voice id'); return; }
      const p = props(val);
      if (!inBody) { declared.set(id, { ...declared.get(id), ...p }); return; }
      const nv = (cur = getVoice(id));
      if (p.name !== undefined) nv.name = p.name;
      if (p.octave !== undefined) nv.octave = p.octave;
    } else if (f === 'T') { if (!inBody && !hdr.title) hdr.title = val.trim(); }
    else if (f === 'Q') {
      if (!inBody) hdr.tempoText = val; else warn(`${what}tempo changes inside the tune are not used`);
    }
  }

  /** Close the bar at the voice's current time. @param {VoiceState} v */
  function closeBar(v) {
    const len = v.t - v.barStart;
    if (len <= EPS) return;
    if (v.issue) { warn(v.issue.msg); v.issue = null; }
    if (v.meter) {
      const want = barLen(v.meter) * v.mult;
      if (Math.abs(len - want) > EPS) {
        if (v.bar === 0 && len < want && v.mult === 1) v.pickup = len;
        else v.issue = { msg: `${where(v)}: has ${asFraction(len, v.meter.den)}, the meter wants ${asFraction(want, v.meter.den)}`, len, want };
      }
    }
    for (let k = 1; k < v.mult; k++) v.barTicks.push(v.barStart + k * v.zLen);
    v.bar += v.mult; v.mult = 1; v.barStart = v.t; v.barTicks.push(v.t); v.acc = {};
  }

  /** @param {VoiceState} v @param {string} name */
  function decorate(v, name) {
    const mark = Object.hasOwn(MARKS, name) ? MARKS[name] : null;
    if (DYNAMICS.has(name)) v.dyn = name;
    else if (mark && mark[0] !== 'hairpin') v.deco[mark[0]] = mark[1];
    else if (mark) {
      if (!v.hairpin && mark[1].endsWith('-')) warn(`${where(v)}: !${name}! ends a hairpin that never started`);
      endHairpin(v);
      if (mark[1].endsWith('+')) v.hairpin = { dir: mark[1].slice(0, -1), s: v.t };
    } else if (!QUIET.has(name) && !/^\d$/.test(name)) warn(`${where(v)}: the mark !${name}! is not used, skipped it`);
  }
  /** @param {VoiceState} v */
  function endHairpin(v) {
    if (v.hairpin) hairpins.push({ dir: v.hairpin.dir, startTick: Math.round(v.hairpin.s), endTick: Math.round(v.t), voice: v.id });
    v.hairpin = null;
  }

  /**
   * Time factor for the event ending at index i: a running tuplet, a broken rhythm left by the
   * previous event, and a > or < right after this one (which also sets the next event's factor).
   * @param {VoiceState} v @param {string} s @param {number} i @returns {{f: number, end: number}}
   */
  function timing(v, s, i) {
    let f = v.broken;
    v.broken = 1;
    if (v.tuplet) { f *= v.tuplet.q / v.tuplet.p; if (--v.tuplet.left <= 0) v.tuplet = null; }
    const m = at(BROKEN_RE, s, i);
    if (!m) return { f, end: i };
    const small = 0.5 ** m[0].length, dot = m[0][0] === '>';
    v.broken = dot ? small : 2 - small;
    return { f: f * (dot ? 2 - small : small), end: i + m[0].length };
  }

  /** Pitch of a note; an explicit accidental holds to the bar's end. @param {VoiceState} v @param {NoteSpec} n */
  function pitch(v, n) {
    const up = n.letter.toUpperCase(), k = slot(n);
    if (n.acc !== null) v.acc[k] = n.acc;
    const a = k in v.acc ? v.acc[k] : v.key.accidentals[up] ?? 0;
    return 60 + 12 * ((n.letter === up ? 0 : 1) + n.oct + v.octave) + LETTER_PC[up] + a;
  }

  /** @param {VoiceState} v @param {number} s @param {number} e @param {number} midi @param {object} extra */
  function makeNote(v, s, e, midi, extra) {
    /** @type {RawNote} */
    const note = { voice: v.id, bar: v.bar, s, e, midi, ...extra, ...(v.dyn ? { dyn: v.dyn } : {}) };
    v.notes.push(note);
    return note;
  }

  /** Sound a note group (or rest, with no specs). @param {VoiceState} v @param {NoteSpec[]} specs @param {number} adv units @param {number} f */
  function play(v, specs, adv, f) {
    for (const g of v.graces) makeNote(v, v.t, v.t, pitch(v, g), { grace: true });
    v.graces = [];
    /** @type {RawNote[]} */
    const ties = [];
    for (const n of specs) {
      const end = v.t + n.len * v.unit * f, k = slot(n);
      const tied = v.ties.find((t) => t.k === k);
      const midi = tied && n.acc === null ? tied.midi : pitch(v, n);
      const note = tied && tied.midi === midi ? tied : makeNote(v, v.t, end, midi, { k, ...v.deco });
      note.e = end;
      if (n.tie) ties.push(note);
    }
    v.ties = ties; v.deco = {};
    v.t += adv * v.unit * f;
  }

  /** Scan one line of music. @param {string} s */
  function music(s) {
    let i = 0;
    while (i < s.length) {
      const v = voice();
      const c = s[i];
      /** @type {RegExpExecArray|null} */
      let m;
      if (c === '&') { warn(`${where(v)}: voice overlays (&) are not supported, skipped`); i++; continue; }
      if (c === ' ' || c === '\t' || c === '`' || c === 'y' || c === '$' || c === ')') { i++; continue; }
      if (c === '"') {
        const j = s.indexOf('"', i + 1);
        if (j < 0) { warn(`${where(v)}: a chord symbol has no closing quote`); return; }
        const sym = s.slice(i + 1, j).trim();
        i = j + 1;
        if (!sym || /^[\^_<>@]/.test(sym)) continue;
        chords.push({ tick: Math.round(v.t), bar: v.bar, symbol: sym, voice: v.id });
        if (!parseChord(sym)) warn(`${where(v)}: the chord symbol "${sym}" is not understood`);
      } else if (c === '!' || c === '+') {
        const j = s.indexOf(c, i + 1);
        if (j < 0) {
          warn(`${where(v)}: a ${c}mark${c} has no closing ${c}, skipped it`);
          i = s.indexOf(' ', i) < 0 ? s.length : s.indexOf(' ', i);
          continue;
        }
        decorate(v, s.slice(i + 1, j));
        i = j + 1;
      } else if (Object.hasOwn(SHORTHAND, c)) {
        if (c === '.' && (s[i + 1] === '(' || s[i + 1] === ')')) { i += 2; continue; }
        decorate(v, SHORTHAND[c]);
        i++;
      } else if (c === '{') {
        const j = s.indexOf('}', i) < 0 ? s.length : s.indexOf('}', i);
        for (let k = i + 1; k < j;) {
          const n = readNote(s, k);
          if (n) { v.graces.push(n); k = n.end; } else k++;
        }
        i = j + 1;
      } else if ((m = at(INLINE_RE, s, i))) {
        field(m[1], m[2]);
        i += m[0].length;
      } else if (c === '[' && /\d/.test(s[i + 1] ?? '')) {
        warn(`${where(v)}: numbered endings are not expanded (no repeats); everything plays straight through`);
        i += 2;
      } else if (c === '[' && s[i + 1] !== '|') i = group(v, s, i);
      else if ((c === '|' || c === ':' || c === '[') && (m = at(BAR_RE, s, i))) {
        if (/:\||::|:\]|:$/.test(m[0]) || m[1]) warn(`${where(v)}: repeat signs are not expanded; the music plays straight through once`);
        closeBar(v);
        i += m[0].length;
      } else if (c === '(') {
        if ((m = at(TUPLET_RE, s, i))) {
          const p = +m[1];
          const compound = !!v.meter && v.meter.num % 3 === 0 && v.meter.num > 3;
          const q = m[2] ? +m[2] : ({ 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 })[p] ?? (compound ? 3 : 2);
          if (p > 0) v.tuplet = { p, q, left: m[3] ? +m[3] : p };
          i += m[0].length;
        } else i++; // slur
      } else if (c === '-') i++;
      else if ((m = at(REST_RE, s, i))) {
        const t = timing(v, s, i + m[0].length);
        play(v, [], lengthOf(m[2], m[3], m[4]), t.f);
        i = t.end;
      } else if ((m = at(/[ZX](\d*)/y, s, i))) {
        if (!v.meter) warn(`${where(v)}: a whole-bar rest needs a meter, counted it as whole notes`);
        if (v.t - v.barStart > EPS) warn(`${where(v)}: a whole-bar rest should stand alone in its bar`);
        v.zLen = v.meter ? barLen(v.meter) : WHOLE;
        v.mult = m[1] ? +m[1] : 1;
        play(v, [], (v.mult * v.zLen) / v.unit, 1);
        i += m[0].length;
      } else {
        const n = readNote(s, i);
        if (!n) { warn(`${where(v)}: could not read "${c}", skipped it`); i++; continue; }
        i = n.end;
        if (s[i] === '-') { n.tie = true; i++; }
        const t = timing(v, s, i);
        play(v, [n], n.len, t.f);
        i = t.end;
      }
    }
  }

  /** A note group [CEG]2; returns the index after it. @param {VoiceState} v @param {string} s @param {number} i */
  function group(v, s, i) {
    /** @type {NoteSpec[]} */
    const specs = [];
    let j = i + 1;
    while (j < s.length && s[j] !== ']') {
      const n = readNote(s, j);
      if (n) {
        j = n.end;
        if (s[j] === '-') { n.tie = true; j++; }
        specs.push(n);
      } else if (s[j] === '!') {
        const e = s.indexOf('!', j + 1);
        if (e < 0) break;
        decorate(v, s.slice(j + 1, e));
        j = e + 1;
      } else if (Object.hasOwn(SHORTHAND, s[j])) { decorate(v, SHORTHAND[s[j]]); j++; }
      else {
        if (s[j] !== ' ') warn(`${where(v)}: could not read "${s[j]}" inside [ ], skipped it`);
        j++;
      }
    }
    if (s[j] !== ']') warn(`${where(v)}: a note group [ has no closing ]`);
    const lm = /** @type {RegExpExecArray} */ (at(LEN_RE, s, j + 1));
    const mul = lengthOf(lm[1], lm[2], lm[3]);
    j += 1 + lm[0].length;
    if (s[j] === '-') { for (const n of specs) n.tie = true; j++; }
    if (!specs.length) { warn(`${where(v)}: an empty note group [ ] was skipped`); return j; }
    const t = timing(v, s, j);
    for (const n of specs) n.len *= mul;
    play(v, specs, specs[0].len, t.f);
    return t.end;
  }

  // ---- read the lines ----
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/(^|[^\\])%.*$/, '$1').replace(/\\\s*$/, '').trimEnd();
    if (!line.trim()) continue;
    const isField = inBody ? /^([IKLMmNPQRrsTUVWw+]):(.*)$/.exec(line) : /^([A-Za-z+]):(.*)$/.exec(line);
    if (isField) {
      const [, f, val] = isField;
      if (inBody && f === 'X') { warn('a second tune (X:) starts here; only the first tune is read'); break; }
      if (f === 'w' || f === 'W' || f === '+') continue;
      field(f, val);
      continue;
    }
    if (!inBody) { warn('the music starts before any K: line; read it in C major'); startBody(); }
    music(line);
  }
  if (!inBody) startBody();

  // ---- finish ----
  for (const v of voices) {
    if (v.t - v.barStart > EPS) closeBar(v);
    if (v.barTicks.length > 1 && Math.abs(v.barTicks[v.barTicks.length - 1] - v.t) < EPS) v.barTicks.pop();
    if (v.issue) {
      const { len, want, msg } = v.issue;
      if (!(v.pickup > 0 && len < want && Math.abs(v.pickup + len - want) < EPS)) warn(msg);
    }
    if (v.hairpin) { warn(`voice ${v.id}: a hairpin is never closed, ended it at the end of the voice`); endHairpin(v); }
    if (v.graces.length) warn(`voice ${v.id}: grace notes at the end have no note to ornament`);
  }
  // Bars come from the voice with the most of them; an empty tune has none.
  const ref = voices.reduce((/** @type {VoiceState|null} */ a, v) => (!a || v.barTicks.length > a.barTicks.length ? v : a), null);
  const full = ref && ref.t > EPS ? ref : null;
  /** Notes sorted by tick; at one tick, grace notes first as written, then by pitch. @param {RawNote[]} raw */
  const finish = (raw) => raw
    .map(({ s, e, k, ...n }, order) => ({ ...n, tick: Math.round(s), dur: n.grace ? 0 : Math.round(e) - Math.round(s), order }))
    .sort((a, b) => a.tick - b.tick || +!!b.grace - +!!a.grace || (a.grace ? 0 : a.midi - b.midi) || a.order - b.order)
    .map(({ order, ...n }) => /** @type {Note} */ (n));
  return {
    title: hdr.title, meter: hdr.meter, tempo: hdr.tempo, key: hdr.key,
    barLenTicks: hdr.meter ? Math.round(barLen(hdr.meter)) : null,
    pickupTicks: full ? Math.round(full.pickup) : 0,
    bars: full ? full.barTicks.length : 0,
    barTicks: full ? full.barTicks.map(Math.round) : [],
    voices: voices.map((v) => ({ id: v.id, name: v.name, notes: finish(v.notes) })),
    chords: chords.sort((a, b) => a.tick - b.tick),
    hairpins, warnings,
  };
}
