// @ts-check
// Music notation tests (doc 24): the ABC subset reader (src/audio/music/score.js) and the chord
// symbol reader (src/audio/music/chords.js). Pure modules, no audio. Run on
// tools/unit-tests-audio.html, and in Node with tools/run-audio-tests.mjs.
//
// Conventions the reader promises (doc 24, "Authoring format"):
// - Time is in integer ticks, 480 per quarter note. Tick 0 is the first note of the tune.
// - Pitch is MIDI: C (upper case, no marks) is middle C = 60, c = 72, c' = 84, C, = 48.
// - Tied notes come out merged into one note with the summed length.
// - Notes inside [ ] share one tick. Grace notes { } have dur 0, grace true, and the tick of the
//   note they ornament.
// - Chord symbols ("Dmaj9") come out in score.chords with the tick and bar they sit on.
// - Wrong bar lengths, repeats and anything not understood become plain-language warnings,
//   never exceptions, so the lab can show them next to the notation. Notes carry a 0-based bar
//   index; warnings count bars from 1, as a musician would ("voice mel, bar 2: ...").
// - A first bar shorter than the meter is a pickup. A later bar of the wrong length warns.

import { parseAbc, parseKey, TICKS_PER_QUARTER } from '../src/audio/music/score.js';
import { parseChord } from '../src/audio/music/chords.js';

const ABC = 'music: notation';
const CH = 'music: chord symbols';
const Q = 480;

/** @param {any} a */
const js = (a) => JSON.stringify(a);

/** One-voice tune with a small header. @param {string} body @param {string} [head] */
const tune = (body, head = 'M:4/4\nL:1/8\nK:C') => `X:1\nT:test\n${head}\n${body}\n`;

/** The notes of the first voice as [tick, dur, midi] triples. @param {any} score */
const tdm = (score) => score.voices[0].notes.map((/** @type {any} */ n) => [n.tick, n.dur, n.midi]);
/** The midi numbers of the first voice. @param {any} score */
const mids = (score) => score.voices[0].notes.map((/** @type {any} */ n) => n.midi);

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addMusicTests(test, assert, eq) {
  // ---------------- pitch and octave ----------------

  test(ABC, 'ticks per quarter is 480', () => eq(TICKS_PER_QUARTER, Q));

  test(ABC, 'letters and octave marks map to MIDI (C = middle C)', () => {
    const s = parseAbc(tune('C, D, C D E F G A B c d c\' c\'\' C,, |'));
    eq(js(mids(s)), js([48, 50, 60, 62, 64, 65, 67, 69, 71, 72, 74, 84, 96, 36]));
  });

  test(ABC, 'explicit accidentals: sharp, flat, natural, double sharp, double flat', () => {
    const s = parseAbc(tune('^C _E =F ^^G __B |'));
    eq(js(mids(s)), js([61, 63, 65, 69, 69]));
  });

  test(ABC, 'key signature applies to every octave', () => {
    const s = parseAbc(tune('F f F, C c B |', 'M:4/4\nL:1/8\nK:D'));
    eq(js(mids(s)), js([66, 78, 54, 61, 73, 71]));
  });

  test(ABC, 'an accidental lasts to the end of its bar, for that letter and octave only', () => {
    const s = parseAbc(tune('^F F f F | F |'));
    // ^F sharpens F4 for the rest of bar 1 (F4 again is 66), f is F5 natural (77); bar 2 resets.
    eq(js(mids(s)), js([66, 66, 77, 66, 65]));
  });

  test(ABC, 'a natural cancels the key signature until the bar ends', () => {
    const s = parseAbc(tune('F =F F | F |', 'M:3/8\nL:1/8\nK:G'));
    eq(js(mids(s)), js([66, 65, 65, 66]));
  });

  test(ABC, 'flat keys', () => {
    const s = parseAbc(tune('B E A D |', 'M:4/4\nL:1/4\nK:Bb'));
    eq(js(mids(s)), js([70, 63, 69, 62]));
  });

  // ---------------- keys and modes ----------------

  test(ABC, 'parseKey: major, minor and the church modes', () => {
    const cases = /** @type {[string, string, string, Record<string, number>][]} */ ([
      ['D', 'D', 'major', { F: 1, C: 1 }],
      ['Dmaj', 'D', 'major', { F: 1, C: 1 }],
      ['Dm', 'D', 'minor', { B: -1 }],
      ['Dmin', 'D', 'minor', { B: -1 }],
      ['Edor', 'E', 'dorian', { F: 1, C: 1 }],
      ['E Dorian', 'E', 'dorian', { F: 1, C: 1 }],
      ['Ador', 'A', 'dorian', { F: 1 }],
      ['Glyd', 'G', 'lydian', { F: 1, C: 1 }],
      ['Dmix', 'D', 'mixolydian', { F: 1 }],
      ['Bbmaj', 'Bb', 'major', { B: -1, E: -1 }],
      ['Bblyd', 'Bb', 'lydian', { B: -1 }],
      ['F#m', 'F#', 'minor', { F: 1, C: 1, G: 1 }],
      ['Aaeo', 'A', 'aeolian', {}],
      ['Ephr', 'E', 'phrygian', {}],
      ['Bloc', 'B', 'locrian', {}],
      ['Cion', 'C', 'ionian', {}],
    ]);
    for (const [spec, tonic, mode, acc] of cases) {
      const k = parseKey(spec);
      eq(k.tonic, tonic, `${spec} tonic`);
      eq(k.mode, mode, `${spec} mode`);
      const got = Object.fromEntries(Object.entries(k.accidentals).filter(([, v]) => v !== 0).sort());
      eq(js(got), js(Object.fromEntries(Object.entries(acc).sort())), `${spec} accidentals`);
    }
  });

  test(ABC, 'parseKey gives the tonic pitch class', () => {
    eq(parseKey('D').tonicPc, 2);
    eq(parseKey('Bb').tonicPc, 10);
    eq(parseKey('F#m').tonicPc, 6);
    eq(parseKey('Edor').tonicPc, 4);
  });

  test(ABC, 'K:none means no key signature', () => {
    const s = parseAbc(tune('F B |', 'M:2/4\nL:1/4\nK:none'));
    eq(js(mids(s)), js([65, 71]));
  });

  // ---------------- lengths ----------------

  test(ABC, 'note lengths against L:1/8 (number, slash, fraction, double slash)', () => {
    const s = parseAbc(tune('C C2 C/ C/2 C3/2 C// C4 C6 |'));
    const durs = s.voices[0].notes.map((/** @type {any} */ n) => n.dur);
    eq(js(durs), js([240, 480, 120, 120, 360, 60, 960, 1440]));
  });

  test(ABC, 'ticks accumulate', () => {
    const s = parseAbc(tune('C2 D E2 F | G8 |'));
    eq(js(tdm(s)), js([[0, 480, 60], [480, 240, 62], [720, 480, 64], [1200, 240, 65], [1440, 1920, 67]]));
  });

  test(ABC, 'default unit length comes from the meter when L is missing', () => {
    // ABC rule: meter below 0.75 → 1/16, otherwise 1/8.
    eq(parseAbc(tune('C |', 'M:4/4\nK:C')).voices[0].notes[0].dur, 240);
    eq(parseAbc(tune('C |', 'M:2/4\nK:C')).voices[0].notes[0].dur, 120);
    eq(parseAbc(tune('C |', 'M:6/8\nK:C')).voices[0].notes[0].dur, 240);
  });

  test(ABC, 'rests advance time and make no notes; Z rests whole bars', () => {
    const s = parseAbc(tune('C z D x | Z2 | E8 |'));
    eq(js(tdm(s)), js([[0, 240, 60], [480, 240, 62], [960 + 2 * 1920, 1920, 64]]));
    eq(s.bars, 4);
  });

  test(ABC, 'broken rhythm: > dots the first, halves the second; < the other way', () => {
    const s = parseAbc(tune('C>D E<F G4 |'));
    eq(js(tdm(s)), js([[0, 360, 60], [360, 120, 62], [480, 120, 64], [600, 360, 65], [960, 960, 67]]));
  });

  test(ABC, 'triplets: (3 puts three notes in the time of two', () => {
    const s = parseAbc(tune('(3CDE F2 G4 |'));
    eq(js(tdm(s)), js([[0, 160, 60], [160, 160, 62], [320, 160, 64], [480, 480, 65], [960, 960, 67]]));
  });

  test(ABC, 'triplets in compound meter: (2 puts two notes in the time of three', () => {
    const s = parseAbc(tune('(2CD E F G A |', 'M:6/8\nL:1/8\nK:C'));
    const t = tdm(s);
    eq(js(t.slice(0, 3)), js([[0, 360, 60], [360, 360, 62], [720, 240, 64]]));
  });

  test(ABC, 'general tuplets (p:q:r)', () => {
    const s = parseAbc(tune('(5:4:5CDEFG A4 |'));
    const durs = s.voices[0].notes.map((/** @type {any} */ n) => n.dur);
    eq(js(durs), js([192, 192, 192, 192, 192, 960]));
  });

  // ---------------- ties, chords, graces ----------------

  test(ABC, 'ties merge into one note, also across a bar line', () => {
    const s = parseAbc(tune('C4- C2 D2 | E6- | E2 F6 |'));
    eq(js(tdm(s)), js([[0, 1440, 60], [1440, 480, 62], [1920, 1920, 64], [3840, 1440, 65]]));
  });

  test(ABC, 'a tie keeps the accidental across the bar line', () => {
    const s = parseAbc(tune('z6 ^F2- | F2 F6 |'));
    eq(js(tdm(s)), js([[1440, 960, 66], [2400, 1440, 65]]));
  });

  test(ABC, 'note groups in brackets sound together; the group length is its first note', () => {
    const s = parseAbc(tune('[CEG]2 [DF]4 [E2G2] |'));
    eq(js(tdm(s)), js([[0, 480, 60], [0, 480, 64], [0, 480, 67], [480, 960, 62], [480, 960, 65], [1440, 480, 64], [1440, 480, 67]]));
  });

  test(ABC, 'a length after the bracket scales the whole group', () => {
    const s = parseAbc(tune('[CE]4 [CE]2 z2 |'));
    eq(js(tdm(s).slice(0, 2)), js([[0, 960, 60], [0, 960, 64]]));
  });

  test(ABC, 'grace notes take no time and carry the next note\'s tick', () => {
    const s = parseAbc(tune('C2 {B}c2 {ag}f4 |'));
    const n = s.voices[0].notes;
    eq(js(n.map((/** @type {any} */ x) => [x.tick, x.dur, x.midi, !!x.grace])), js([
      [0, 480, 60, false], [480, 0, 71, true], [480, 480, 72, false], [960, 0, 81, true], [960, 0, 79, true], [960, 960, 77, false],
    ]));
  });

  // ---------------- chord symbols ----------------

  test(ABC, 'chord symbols are collected with their tick and bar', () => {
    const s = parseAbc(tune('"Dmaj9"D4 "G/B"B4 | "Em7"E8 |', 'M:4/4\nL:1/8\nK:D'));
    eq(js(s.chords.map((/** @type {any} */ c) => [c.tick, c.bar, c.symbol])), js([[0, 0, 'Dmaj9'], [960, 0, 'G/B'], [1920, 1, 'Em7']]));
  });

  test(ABC, 'a chord symbol may sit on a rest', () => {
    const s = parseAbc(tune('"Bm"z8 |'));
    eq(js(s.chords.map((/** @type {any} */ c) => [c.tick, c.symbol])), js([[0, 'Bm']]));
  });

  test(ABC, 'annotations starting with ^ _ < > @ are not chord symbols', () => {
    const s = parseAbc(tune('"^dolce"C8 |'));
    eq(s.chords.length, 0);
  });

  // ---------------- decorations ----------------

  test(ABC, 'dynamics carry forward in their voice until changed', () => {
    const s = parseAbc(tune('!pp!C D !mp!E F | G !mf!A B c |'));
    eq(js(s.voices[0].notes.map((/** @type {any} */ n) => n.dyn)), js(['pp', 'pp', 'mp', 'mp', 'mp', 'mf', 'mf', 'mf']));
  });

  test(ABC, 'notes before any dynamic have no dyn', () => {
    const s = parseAbc(tune('C D !p!E F |', 'M:2/4\nL:1/8\nK:C'));
    eq(s.voices[0].notes[0].dyn ?? null, null);
  });

  test(ABC, 'fermata, accent, staccato and tenuto marks', () => {
    const s = parseAbc(tune('!fermata!C2 H D2 !>!E .F !tenuto!G |'.replace('H D2', 'HD2')));
    const n = s.voices[0].notes;
    assert(n[0].fermata && n[1].fermata, 'fermata (both spellings)');
    assert(n[2].accent, 'accent');
    assert(n[3].staccato, 'staccato');
    assert(n[4].tenuto, 'tenuto');
  });

  test(ABC, 'hairpins are recorded with start and end ticks', () => {
    const s = parseAbc(tune('!<(!C D E F !<)!G4 | !>(!c4 !>)!G4 |'));
    eq(js(s.hairpins.map((/** @type {any} */ h) => [h.dir, h.startTick, h.endTick])), js([['cresc', 0, 960], ['dim', 1920, 2880]]));
  });

  test(ABC, 'slurs and other unknown decorations are ignored without breaking the notes', () => {
    const s = parseAbc(tune('(C D E) !trill!F !mordent!G A B c |'));
    eq(s.voices[0].notes.length, 8);
  });

  // ---------------- voices, bars, inline fields ----------------

  test(ABC, 'two voices, each on its own lines, with bars counted from 0', () => {
    const s = parseAbc('X:1\nM:3/4\nL:1/4\nK:F\nV:mel\nA B c | d3 |\nV:acc\nF,3 | B,,3 |\n');
    eq(s.voices.length, 2);
    eq(s.voices[0].id, 'mel');
    eq(s.voices[1].id, 'acc');
    eq(js(s.voices[0].notes.map((/** @type {any} */ n) => n.bar)), js([0, 0, 0, 1]));
    eq(js(tdm({ voices: [s.voices[1]] })), js([[0, 1440, 53], [1440, 1440, 46]]));
    eq(s.bars, 2);
  });

  test(ABC, 'a voice can continue over several lines', () => {
    const s = parseAbc('X:1\nM:2/4\nL:1/4\nK:C\nV:mel\nC D |\nE F |\nV:acc\nC,2 | C,2 |\n');
    eq(s.voices[0].notes.length, 4);
    eq(s.voices[0].notes[3].tick, 1440);
  });

  test(ABC, 'voice header properties: name kept, octave shifts the voice', () => {
    const s = parseAbc('X:1\nM:2/4\nL:1/4\nK:C\nV:lh clef=bass octave=-1 name="left"\nC E |\n');
    eq(js(mids(s)), js([48, 52]));
    eq(s.voices[0].name, 'left');
  });

  test(ABC, 'inline fields change key, meter and unit length mid-tune', () => {
    const s = parseAbc(tune('F2 F2 | [K:G] F2 F2 | [L:1/4] F F |', 'M:2/4\nL:1/8\nK:C'));
    eq(js(tdm(s)), js([[0, 480, 65], [480, 480, 65], [960, 480, 66], [1440, 480, 66], [1920, 480, 66], [2400, 480, 66]]));
  });

  test(ABC, 'inline meter change moves bar lengths', () => {
    const s = parseAbc(tune('C2 D2 | [M:3/4] E2 F2 G2 | A4 |', 'M:2/4\nL:1/8\nK:C'));
    eq(s.voices[0].notes[5].tick, 960 + 1440);
    eq(js(s.barTicks), js([0, 960, 2400]));
    assert(!s.warnings.some((/** @type {string} */ w) => /\bbar 2\b/.test(w)), `no false bar-length warning for bar 2: ${js(s.warnings)}`);
  });

  test(ABC, 'bar ticks list the start of every bar', () => {
    const s = parseAbc(tune('C8 | D8 | E8 |]'));
    eq(js(s.barTicks), js([0, 1920, 3840]));
    eq(s.barLenTicks, 1920);
  });

  test(ABC, 'a short first bar is a pickup and does not warn', () => {
    const s = parseAbc(tune('G2 | c8 | B8 |'));
    eq(js(s.barTicks), js([0, 480, 2400]));
    eq(s.pickupTicks, 480);
    eq(s.warnings.length, 0);
  });

  test(ABC, 'a wrong bar length warns in plain language with the voice and bar', () => {
    const s = parseAbc('X:1\nM:6/8\nL:1/8\nK:D\nV:mel\nD3 F3 | A2 F2 |\n');
    assert(s.warnings.some((/** @type {string} */ w) => /mel/.test(w) && /bar 2/.test(w)), `warnings: ${js(s.warnings)}`);
  });

  test(ABC, 'repeats are not expanded and say so', () => {
    const s = parseAbc(tune('|: C8 :| D8 |'));
    assert(s.warnings.some((/** @type {string} */ w) => /repeat/i.test(w)), `warnings: ${js(s.warnings)}`);
    eq(s.voices[0].notes.length, 2);
  });

  test(ABC, 'header fields: title, meter, tempo', () => {
    const s = parseAbc('X:1\nT:Reeds in first light\nM:6/8\nL:1/8\nQ:3/8=60\nK:D\nD6 |\n');
    eq(s.title, 'Reeds in first light');
    eq(js(s.meter), js({ num: 6, den: 8 }));
    eq(js(s.tempo), js({ bpm: 60, beat: { num: 3, den: 8 } }));
  });

  test(ABC, 'free meter (M:none) still counts time, and does not warn about bar lengths', () => {
    const s = parseAbc(tune('C4 D2 | E6 F2 G2 |', 'M:none\nL:1/8\nK:C'));
    eq(s.meter, null);
    eq(s.voices[0].notes[4].tick, 480 * 7);
    eq(s.warnings.length, 0);
  });

  test(ABC, 'comments, spaces, line continuations and lyrics are ignored', () => {
    const s = parseAbc('X:1\nM:4/4\nL:1/8\nK:C % key of C\n% a whole comment line\nC D E F \\\nG A B c |\nw: la la la\n');
    eq(s.voices[0].notes.length, 8);
    eq(s.voices[0].notes[7].tick, 7 * 240);
  });

  test(ABC, 'a tune with no V: line has one voice called "1"', () => {
    const s = parseAbc(tune('C8 |'));
    eq(s.voices.length, 1);
    eq(s.voices[0].id, '1');
  });

  test(ABC, 'nonsense becomes a warning, not an exception', () => {
    const s = parseAbc(tune('C D ~ E @ F |'));
    assert(Array.isArray(s.warnings), 'warnings is a list');
    eq(s.voices[0].notes.length, 4);
  });

  test(ABC, 'notes come out sorted by tick; at one tick, grace notes first as written, then by pitch', () => {
    const s = parseAbc(tune('[GEC]8 |'));
    eq(js(mids(s)), js([60, 64, 67]));
  });

  // ---------------- chord symbols ----------------

  /** @param {string} sym */
  const iv = (sym) => { const c = parseChord(sym); return c ? js([c.root, c.intervals, c.bass]) : 'null'; };

  test(CH, 'triads and power chord', () => {
    eq(iv('C'), js([0, [0, 4, 7], null]));
    eq(iv('Cm'), js([0, [0, 3, 7], null]));
    eq(iv('Cmin'), js([0, [0, 3, 7], null]));
    eq(iv('C-'), js([0, [0, 3, 7], null]));
    eq(iv('Cdim'), js([0, [0, 3, 6], null]));
    eq(iv('Caug'), js([0, [0, 4, 8], null]));
    eq(iv('C+'), js([0, [0, 4, 8], null]));
    eq(iv('C5'), js([0, [0, 7], null]));
  });

  test(CH, 'suspensions', () => {
    eq(iv('Csus2'), js([0, [0, 2, 7], null]));
    eq(iv('Csus4'), js([0, [0, 5, 7], null]));
    eq(iv('Csus'), js([0, [0, 5, 7], null]));
    eq(iv('C7sus4'), js([0, [0, 5, 7, 10], null]));
  });

  test(CH, 'sevenths', () => {
    eq(iv('Cmaj7'), js([0, [0, 4, 7, 11], null]));
    eq(iv('CM7'), js([0, [0, 4, 7, 11], null]));
    eq(iv('C7'), js([0, [0, 4, 7, 10], null]));
    eq(iv('Cm7'), js([0, [0, 3, 7, 10], null]));
    eq(iv('CmM7'), js([0, [0, 3, 7, 11], null]));
    eq(iv('Cm7b5'), js([0, [0, 3, 6, 10], null]));
    eq(iv('Cdim7'), js([0, [0, 3, 6, 9], null]));
  });

  test(CH, 'sixths and added tones', () => {
    eq(iv('C6'), js([0, [0, 4, 7, 9], null]));
    eq(iv('Cm6'), js([0, [0, 3, 7, 9], null]));
    eq(iv('C6/9'), js([0, [0, 4, 7, 9, 14], null]));
    eq(iv('C69'), js([0, [0, 4, 7, 9, 14], null]));
    eq(iv('Cadd9'), js([0, [0, 4, 7, 14], null]));
    eq(iv('C(add9)'), js([0, [0, 4, 7, 14], null]));
    eq(iv('Cadd2'), js([0, [0, 2, 4, 7], null]));
    eq(iv('Cmadd9'), js([0, [0, 3, 7, 14], null]));
  });

  test(CH, 'extensions', () => {
    eq(iv('Cmaj9'), js([0, [0, 4, 7, 11, 14], null]));
    eq(iv('C9'), js([0, [0, 4, 7, 10, 14], null]));
    eq(iv('Cm9'), js([0, [0, 3, 7, 10, 14], null]));
    eq(iv('C11'), js([0, [0, 4, 7, 10, 14, 17], null]));
    eq(iv('Cm11'), js([0, [0, 3, 7, 10, 14, 17], null]));
    eq(iv('C13'), js([0, [0, 4, 7, 10, 14, 21], null]));
    eq(iv('Cmaj7#11'), js([0, [0, 4, 7, 11, 18], null]));
    eq(iv('Cmaj9#11'), js([0, [0, 4, 7, 11, 14, 18], null]));
    eq(iv('C7b9'), js([0, [0, 4, 7, 10, 13], null]));
  });

  test(CH, 'roots with sharps and flats', () => {
    eq(parseChord('Bb')?.root, 10);
    eq(parseChord('Eb')?.root, 3);
    eq(parseChord('F#m')?.root, 6);
    eq(parseChord('C#m7')?.root, 1);
    eq(parseChord('Ab')?.root, 8);
    eq(parseChord('Gb')?.root, 6);
  });

  test(CH, 'slash chords keep a bass pitch class', () => {
    eq(iv('C/E'), js([0, [0, 4, 7], 4]));
    eq(iv('D/F#'), js([2, [0, 4, 7], 6]));
    eq(iv('Am/G'), js([9, [0, 3, 7], 7]));
    eq(iv('F#m7/B'), js([6, [0, 3, 7, 10], 11]));
    eq(iv('G/B'), js([7, [0, 4, 7], 11]));
    eq(iv('Bb/D'), js([10, [0, 4, 7], 2]));
  });

  test(CH, 'the symbol and a quality name are kept', () => {
    const c = parseChord('Dmaj9');
    eq(c?.symbol, 'Dmaj9');
    eq(c?.quality, 'maj9');
    eq(parseChord('Em')?.quality, 'm');
    eq(parseChord('G')?.quality, '');
  });

  test(CH, 'no chord, and nonsense', () => {
    eq(js(parseChord('N.C.')), js({ none: true, symbol: 'N.C.' }));
    eq(parseChord('Hmaj7'), null);
    eq(parseChord(''), null);
    eq(parseChord('Cfoo'), null);
  });
}
