// @ts-check
// Turns an anchor piece and a seed into a performance (doc 24, "Realizing a piece"): the form path
// (optional sections rolled, or the short form), a key from the piece's allowed keys, the
// melody's octave, the instruments, the accompaniment (the piece's own written voice where there
// is one, otherwise voiced from the chord symbols by voicing.js and played in textures, see texture.js), the
// tempo and its rubato, human timing and velocity, and legato pedaling. The same piece, context
// and seed always give the same performance; a new seed gives a new performance of the same
// melody and harmony. Pure: no audio here, so the lab can draw a performance before playing it.
//
// Numbers come from recipes/music/realize.json and recipes/music/voicing.json. Randomness is the
// music stream (src/core/rng.js), never Math.random.

import { parseAbc, TICKS_PER_QUARTER } from './score.js';
import { parseChord } from './chords.js';
import { voiceProgression } from './voicing.js';
import { planTextures, playTexture, describeTextures } from './texture.js';
import { supportLayers } from './layers.js';
import { stream, hash32 } from '../../core/rng.js';

const Q = TICKS_PER_QUARTER;
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm']);

/**
 * @typedef {Object} PNote  one sounding note of a performance
 * @property {number} t     seconds from the start
 * @property {number} dur   seconds
 * @property {number} midi
 * @property {number} vel   1..127
 * @property {string} voice 'mel' | 'acc' | 'bass' | 'pad' | 'counter'
 * @property {string} instrument
 * @property {number} tick  position in the assembled score (for the notation highlight)
 */

/**
 * @typedef {Object} Performance
 * @property {string} id
 * @property {number} seed
 * @property {number} durationS
 * @property {number} bpm           beats per minute as realize.json counts beats
 * @property {number} transpose     semitones from the piece as written
 * @property {string} key
 * @property {string[]} path        section names in order
 * @property {string} pattern       the left-hand textures played, described ("mostly struck, some arpeggio")
 * @property {string[]} textures     the texture of each generated chord, in order
 * @property {Record<string, string>} instruments  voice to instrument
 * @property {PNote[]} notes
 * @property {{t: number, down: boolean, instrument: string}[]} pedal
 * @property {{index: number, t: number, tick: number, chord: string, section: string}[]} bars
 * @property {{name: string, t: number, tick: number}[]} sections
 * @property {[number, number][]} tickTimes  [tick, seconds] samples, for following the notation
 * @property {string} abc           the path's notation assembled into one tune (as written, untransposed)
 * @property {{low: number, high: number}} range  lowest and highest MIDI note, per instrument in ranges
 * @property {Record<string, {low: number, high: number}>} ranges
 */

/**
 * @typedef {Object} RealizeContext
 * @property {number} seed
 * @property {Record<string, number>} dayColor  register, density, tempo, voices (from the director)
 * @property {string[]} available  instruments that exist, e.g. ['piano', 'pad', 'bell', 'fm-piano']
 * @property {boolean} [shortForm]
 * @property {string} [key]        force a key (the director's key drift)
 * @property {string[]} [residents]
 * @property {string[]} [path]     play these sections instead of the form (the performer's coda)
 */

/** @param {string} s */
function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = hash32(h, s.charCodeAt(i));
  return h;
}

/** @param {string} key e.g. 'D', 'Bm', 'F#m' @returns {number} */
function keyPc(key) {
  const m = /^([A-G])([#b]?)/.exec(key);
  if (!m) return 0;
  return (PC[/** @type {'C'} */ (m[1])] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

/** Signed semitone shift from one key to another, the smaller way round. @param {string} from @param {string} to */
export function keyShift(from, to) {
  let d = (keyPc(to) - keyPc(from) + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

/** @param {number} x */
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Name a chord after transposing it. @param {any} c parsed chord @param {number} shift @param {boolean} flats */
function chordName(c, shift, flats) {
  if (!c || c.none) return c?.symbol ?? '';
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  const root = names[(c.root + shift + 120) % 12];
  const bass = c.bass === null || c.bass === undefined ? '' : `/${names[(c.bass + shift + 120) % 12]}`;
  return `${root}${c.quality}${bass}`;
}

/** Parse every section of a piece once. @type {WeakMap<any, Record<string, any>>} */
const parsed = new WeakMap();
/** @param {any} piece */
function sectionsOf(piece) {
  let p = parsed.get(piece);
  if (!p) {
    p = {};
    for (const [name, s] of Object.entries(piece.sections)) p[name] = parseAbc(s.abc);
    parsed.set(piece, p);
  }
  return p;
}

/**
 * The form path: each token of the grammar, optional ones ("B?") rolled with the piece's chance.
 * @param {any} piece @param {boolean} short @param {ReturnType<typeof stream>} r
 */
export function formPath(piece, short, r) {
  const grammar = short ? piece.form.short : piece.form.grammar;
  /** @type {string[]} */
  const path = [];
  for (const tok of grammar.trim().split(/\s+/)) {
    if (tok.endsWith('?')) {
      const name = tok.slice(0, -1);
      if (r.next() < (piece.form.optional?.[name] ?? 0.5)) path.push(name);
    } else path.push(tok);
  }
  return path.filter((n) => piece.sections[n]);
}

/**
 * Realize a piece.
 * @param {any} piece recipes/music/pieces/<id>.json
 * @param {RealizeContext} ctx
 * @param {{realize: any, voicing: any}} recipes recipes/music/realize.json and voicing.json
 * @returns {Performance}
 */
export function realize(piece, ctx, recipes) {
  const R = recipes.realize;
  const V = recipes.voicing;
  const r = stream(ctx.seed >>> 0, 0x6d75, strHash(piece.id));
  const pick = (/** @type {any[]} */ a) => a[r.int(a.length)];
  const secs = sectionsOf(piece);
  const formed = formPath(piece, !!ctx.shortForm, r);
  const path = ctx.path?.filter((n) => piece.sections[n]) ?? formed;

  // Key: forced by the director, or drawn from the piece's allowed keys (home most often).
  const written = piece.keys[0];
  const key = ctx.key && piece.keys.includes(ctx.key) ? ctx.key : r.next() < 0.6 ? written : pick(piece.keys);
  const shift = keyShift(written, key);
  const flats = FLAT_KEYS.has(key);

  // Meter and beat.
  const first = secs[path[0]];
  const meter = first.meter ?? { num: 4, den: 4 };
  const compound = R.beat.compound.includes(`${meter.num}/${meter.den}`);
  const beatTicks = compound ? (3 * Q) / 2 : Q;
  const barTicks = first.barLenTicks;

  // Assemble the path: global ticks, bars, chord spans, melody and written accompaniment.
  /** @type {{name: string, start: number, end: number}[]} */
  const spans = [];
  /** @type {{tick: number, end: number, chord: any, symbol: string, section: number}[]} */
  const chords = [];
  /** @type {{tick: number, dur: number, midi: number, dyn: string|null, voice: string, fermata: boolean, grace: boolean, section: number}[]} */
  const raw = [];
  let at = 0;
  path.forEach((name, si) => {
    const s = secs[name];
    const len = piece.sections[name].bars * s.barLenTicks;
    spans.push({ name, start: at, end: at + len });
    for (const c of s.chords) chords.push({ tick: at + c.tick, end: 0, chord: parseChord(c.symbol), symbol: c.symbol, section: si });
    for (const v of s.voices) {
      const voice = v.id === 'acc' ? 'acc' : v.id === 'counter' ? 'counter' : 'mel';
      for (const n of v.notes) raw.push({ tick: at + n.tick, dur: n.dur, midi: n.midi + shift, dyn: n.dyn ?? null, voice, fermata: !!n.fermata, grace: !!n.grace, section: si });
    }
    at += len;
  });
  const totalTicks = at;
  chords.sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < chords.length; i++) chords[i].end = i + 1 < chords.length ? chords[i + 1].tick : totalTicks;

  // Melody octave: from the piece's allowed shifts, nearest the day's register centre, with a
  // little seeded variety between the two best.
  const mel = raw.filter((n) => n.voice === 'mel' && !n.grace);
  const melMid = mel.length ? (Math.min(...mel.map((n) => n.midi)) + Math.max(...mel.map((n) => n.midi))) / 2 : 67;
  const octs = [...(piece.variation?.octave ?? [0])].sort((a, b) => Math.abs(melMid + a - ctx.dayColor.register) - Math.abs(melMid + b - ctx.dayColor.register));
  const melOct = octs.length > 1 && r.next() < 0.25 ? octs[1] : octs[0];
  for (const n of raw) if (n.voice === 'mel') n.midi += melOct;

  // Instruments: the first available in each palette list, sometimes the second.
  const avail = new Set(ctx.available);
  /** @param {string[]} list */
  const choose = (list) => { const ok = list.filter((x) => avail.has(x)); return ok.length > 1 && r.next() < 0.3 ? ok[1] : ok[0]; };
  const melInst = choose(piece.palette.melody) ?? 'piano';
  const accList = piece.palette.accomp.filter((/** @type {string} */ x) => avail.has(x));
  const wantsBed = !!(piece.layers?.bed && piece.palette?.bed);
  const usePad = !wantsBed && accList.includes('pad') && r.next() < 0.5;
  const accInst = accList.find((/** @type {string} */ x) => x !== 'pad') ?? (usePad ? null : melInst);

  // Tempo; the day's note density ceiling decides how fast an arpeggio may move, or whether at all.
  const bpm = (piece.tempo[0] + r.next() * (piece.tempo[1] - piece.tempo[0])) * (ctx.dayColor.tempo ?? 1);
  const baseTps = (bpm * beatTicks) / 60;
  const melRate = mel.length / Math.max(1, totalTicks / baseTps);
  const ceiling = ctx.dayColor.density ?? 3;
  // Arpeggio notes are soft and held under the pedal, so they count densityWeight each toward the
  // ceiling: eighths by day, slower steps toward evening and night, none if even those are too busy.
  const arpW = R.textures.arpeggio.densityWeight;
  const arpStep = (compound ? [Q / 2, beatTicks] : [Q / 2, Q, 2 * Q]).find((st) => (arpW * baseTps) / st <= ceiling) ?? 0;
  const fits = (/** @type {string} */ t) => (t === 'arpeggio' ? arpStep > 0 : t === 'broken' || t === 'offbeat-dyads' ? melRate + baseTps / (Q / 2) <= ceiling : true);

  // Generated accompaniment where a section has no written one: a texture per chord, voiced by
  // the texture's voicing style with the smallest motion from chord to chord.
  const writtenAcc = new Set(raw.filter((n) => n.voice === 'acc').map((n) => n.section));
  /** @type {{tick: number, dur: number, midi: number, voice: string, offsetMs: number, velOffset: number, instrument: string}[]} */
  const gen = [];
  const needs = chords.filter((c) => c.chord && !c.chord.none && !writtenAcc.has(c.section));
  const T = R.textures;
  /** @type {string[]} */
  let used = [];
  if (needs.length && (accInst || usePad)) {
    const pw = piece.variation?.textures;
    const weights = pw && !Array.isArray(pw) ? pw : Array.isArray(pw) ? only(T.weights, pw) : T.weights;
    const marked = needs.map((c, i) => ({ section: c.section, first: i === 0 || needs[i - 1].section !== c.section, last: i === needs.length - 1 || needs[i + 1].section !== c.section }));
    used = accInst ? planTextures(marked, path, weights, T, r, fits) : needs.map(() => 'struck');
    const rules = needs.map((c, i) => {
      const under = raw.filter((n) => n.voice === 'mel' && n.tick < c.end && n.tick + n.dur > c.tick).map((n) => n.midi);
      return { ...V.byStyle[T.voicing[used[i]] ?? 'open'], w: V.weights, leadingPc: (keyPc(key) + 11) % 12, melodyFloor: under.length ? Math.min(...under) : undefined };
    });
    const shifted = needs.map((c) => ({ root: (c.chord.root + shift + 120) % 12, intervals: c.chord.intervals, bass: c.chord.bass === null || c.chord.bass === undefined ? null : (c.chord.bass + shift + 120) % 12 }));
    const voicings = voiceProgression(shifted, rules);
    needs.forEach((c, i) => {
      const v = voicings[i];
      const bass = v[0], upper = v.slice(1);
      if (usePad) for (const m of upper) gen.push({ tick: c.tick, dur: c.end - c.tick, midi: m - (R.pad.octaveDown ?? 0), voice: 'pad', offsetMs: 0, velOffset: -R.dynamics.padOffset, instrument: 'pad' });
      if (!accInst) return;
      const push = (/** @type {number} */ tick, /** @type {number} */ dur, /** @type {number} */ midi, /** @type {string} */ voice, offsetMs = 0, vo = 0) =>
        gen.push({ tick, dur, midi, voice, offsetMs, velOffset: vo - R.dynamics.accompanimentOffset, instrument: accInst });
      playTexture(used[i], { tick: c.tick, end: c.end, bass, upper, Q, beatTicks, barTicks, compound, arpStep }, push, T, r);
    });
    if (!accInst) used = [];
  }

  // Support layers: a bed that moves with the phrases and touches on the cadences (layers.js).
  const support = supportLayers({ piece, path, chords, shift, mel: raw.filter((n) => n.voice === 'mel'), choose, L: R.layers, r });
  gen.push(...support.notes);
  // The counter-line is a written part: the first instrument of its list that exists (no coin toss).
  const counterInst = piece.palette?.counter?.find((/** @type {string} */ x) => avail.has(x));

  // Tempo map: per section a gentle arch and a ritardando into its end, fermatas held.
  const fermataSpans = mel.filter((n) => n.fermata).map((n) => [n.tick + 0, n.tick + n.dur, n.section]);
  /** @type {[number, number][]} */
  const tickTimes = [];
  const STEP = 20;
  let sec = 0;
  const shapes = spans.map((s, i) => ({ push: r.next() * R.rubato.pushMax, rit: i === spans.length - 1 ? R.rubato.finalRit : R.rubato.ritMin + r.next() * (R.rubato.ritMax - R.rubato.ritMin) }));
  /** @type {number[]} */
  const timeAt = new Array(Math.ceil(totalTicks / STEP) + 2);
  timeAt[0] = 0;
  let si = 0;
  for (let k = 0; k * STEP < totalTicks; k++) {
    const tk = k * STEP + STEP / 2;
    while (si < spans.length - 1 && tk >= spans[si].end) si++;
    const s = spans[si];
    const x = (tk - s.start) / Math.max(1, s.end - s.start);
    let tps = baseTps * (1 + shapes[si].push * Math.sin(Math.PI * x)) * (1 - shapes[si].rit * smooth((x - 0.8) / 0.2));
    if (fermataSpans.some(([a, b]) => tk >= a && tk < b)) tps /= R.rubato.fermata;
    sec += STEP / tps;
    // Breath after an inner fermata.
    for (const [, b, fs] of fermataSpans) if (b >= k * STEP && b < (k + 1) * STEP && fs !== spans.length - 1) sec += R.rubato.fermataGapS;
    timeAt[k + 1] = sec;
  }
  /** @param {number} tick */
  const time = (tick) => {
    const f = Math.min(timeAt.length - 2, Math.max(0, tick / STEP));
    const i = Math.floor(f);
    const a = timeAt[i] ?? 0, b = timeAt[i + 1] ?? a;
    return a + (b - a) * (f - i);
  };
  for (let tk = 0; tk <= totalTicks; tk += Q / 2) tickTimes.push([tk, time(tk)]);

  // Velocity: the written dynamic, an arch over each phrase, a lift on downbeats, a little jitter.
  /** @param {string|null} d */
  const dynVel = (d) => (d && R.dynamics[d] !== undefined ? R.dynamics[d] : R.dynamics.default);
  const archOf = (/** @type {number} */ tick) => {
    const s = spans.find((x) => tick >= x.start && tick < x.end) ?? spans[spans.length - 1];
    return R.phraseArch * Math.sin(Math.PI * Math.min(1, (tick - s.start) / Math.max(1, s.end - s.start)));
  };
  const jit = (/** @type {number} */ a) => (r.next() * 2 - 1) * a;
  // Notes one hand strikes together share their timing wiggle, so a chord stays a chord.
  /** @type {Map<string, number>} */
  const handJit = new Map();
  const handT = (/** @type {string} */ hand, /** @type {number} */ tick) => {
    const k = `${hand}:${tick}`;
    let v = handJit.get(k);
    if (v === undefined) handJit.set(k, (v = jit(R.humanize.jitterMs / 1000)));
    return v;
  };
  /** @type {Record<string, string>} */
  const instruments = { mel: melInst };
  /** @type {PNote[]} */
  const notes = [];
  // Carry the last written dynamic forward per section into notes without one.
  let lastDyn = /** @type {string|null} */ (null);
  for (const n of raw.sort((a, b) => a.tick - b.tick)) {
    if (n.voice === 'mel' && n.dyn) lastDyn = n.dyn;
    const base = dynVel(n.voice === 'mel' ? n.dyn ?? lastDyn : lastDyn);
    const down = n.tick % barTicks === 0;
    const vel = n.voice === 'mel'
      ? base + archOf(n.tick) + (down ? 3 : 0) + jit(R.humanize.velJitter)
      : base - (n.voice === 'counter' ? R.dynamics.counterOffset : R.dynamics.accompanimentOffset) + archOf(n.tick) * 0.5 + jit(R.humanize.velJitter);
    const lead = n.voice === 'mel' && n.tick % beatTicks === 0 ? -R.humanize.melodyLeadMs / 1000 : 0;
    const t0 = time(n.tick) + lead + handT(n.voice === 'mel' ? 'right' : n.voice === 'counter' ? 'counter' : 'left', n.tick);
    const inst = n.voice === 'mel' ? melInst : n.voice === 'counter' ? counterInst ?? accInst ?? melInst : accInst ?? melInst;
    if (n.voice !== 'mel') instruments[n.voice] = inst;
    notes.push({ t: Math.max(0, t0), dur: n.grace ? 0.07 : Math.max(0.05, time(n.tick + n.dur) - time(n.tick) - 0.02), midi: n.midi, vel: clampVel(vel), voice: n.voice, instrument: inst, tick: n.tick });
  }
  lastDyn = null;
  for (const g of gen) {
    const d = raw.filter((n) => n.voice === 'mel' && n.dyn && n.tick <= g.tick).pop()?.dyn ?? null;
    let vel = dynVel(d) + g.velOffset + archOf(g.tick) * 0.5 + jit(R.humanize.velJitter);
    if (g.voice === 'bed') vel = Math.max(vel, R.layers.bed.minVel);
    const t0 = time(g.tick) + g.offsetMs / 1000 + handT(g.voice === 'bass' || g.voice === 'acc' ? 'left' : g.voice, g.tick);
    instruments[g.voice] = g.instrument;
    notes.push({ t: Math.max(0, t0), dur: Math.max(0.05, time(g.tick + g.dur) - time(g.tick) - 0.02), midi: g.midi, vel: clampVel(vel), voice: g.voice, instrument: g.instrument, tick: g.tick });
  }
  // Ornament: sometimes roll the final chord upward.
  const lastTick = Math.max(...notes.map((n) => n.tick));
  if (r.next() < (piece.variation?.ornament ?? 0)) {
    const fin = notes.filter((n) => n.tick === lastTick).sort((a, b) => a.midi - b.midi);
    fin.forEach((n, k) => { n.t += (k * R.textures.roll.stepMs[1]) / 1000; });
  }
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);

  // Legato pedaling on the piano: lift just before each chord change, press just after.
  /** @type {{t: number, down: boolean, instrument: string}[]} */
  const pedal = [];
  const pedalled = [...new Set(notes.filter((n) => n.instrument === 'piano').map((n) => n.instrument))];
  for (const inst of pedalled) {
    for (const c of chords) {
      const t = time(c.tick);
      if (t > 0.05) pedal.push({ t: t - R.pedal.liftBeforeS, down: false, instrument: inst });
      pedal.push({ t: t + R.pedal.pressAfterS, down: true, instrument: inst });
    }
    const endT = Math.max(...notes.map((n) => n.t + n.dur));
    pedal.push({ t: endT + R.pedal.finalReleaseS, down: false, instrument: inst });
  }

  const bars = [];
  for (let b = 0, tk = 0; tk < totalTicks; b++, tk += barTicks) {
    const c = chords.filter((x) => x.tick <= tk + barTicks - 1 && x.end > tk).find((x) => x.tick >= tk) ?? chords.filter((x) => x.tick <= tk).pop();
    const s = spans.find((x) => tk >= x.start && tk < x.end);
    bars.push({ index: b + 1, t: time(tk), tick: tk, chord: c ? chordName(c.chord, shift, flats) : '', section: s?.name ?? '' });
  }

  /** @type {Record<string, {low: number, high: number}>} */
  const ranges = {};
  for (const n of notes) {
    const x = ranges[n.instrument] ?? (ranges[n.instrument] = { low: n.midi, high: n.midi });
    x.low = Math.min(x.low, n.midi);
    x.high = Math.max(x.high, n.midi);
  }
  const all = notes.map((n) => n.midi);
  return {
    id: piece.id,
    seed: ctx.seed >>> 0,
    durationS: Math.max(...notes.map((n) => n.t + n.dur)) + 0.5,
    bpm,
    transpose: shift,
    key,
    path,
    pattern: `${describeTextures(used)}${usePad ? (accInst ? ' with pad' : 'pad only') : ''}`.replace(/^written(pad only)$/, '$1'),
    textures: used,
    instruments,
    notes,
    pedal: pedal.sort((a, b) => a.t - b.t),
    bars,
    sections: spans.map((s) => ({ name: s.name, t: time(s.start), tick: s.start })),
    tickTimes,
    abc: assembleAbc(piece, path),
    range: { low: Math.min(...all), high: Math.max(...all) },
    ranges,
  };
}

/** @param {Record<string, number>} w @param {string[]} keep */
function only(w, keep) {
  return Object.fromEntries(Object.entries(w).filter(([k]) => keep.includes(k)));
}

/** @param {number} v */
function clampVel(v) {
  return Math.max(1, Math.min(127, Math.round(v)));
}

/**
 * The path's notation as one tune, for the lab's sheet music: the first section's header, then
 * each voice's lines section by section (a section without that voice gets bar rests).
 * @param {any} piece @param {string[]} path
 */
export function assembleAbc(piece, path) {
  /** @type {string[]} */
  const header = [];
  // Every voice any section on the path has, in order of first appearance, so a voice that only
  // enters later (a counter-line in the return) rests in the sections before it.
  /** @type {string[]} */
  const voiceOrder = [];
  /** @type {Record<string, number[]>} each voice's pitches, to choose its clef */
  const pitches = {};
  const secs = sectionsOf(piece);
  for (const name of path) {
    for (const ln of piece.sections[name].abc.split('\n')) {
      const v = /^V:\s*(\S+)/.exec(ln);
      if (v && !voiceOrder.includes(v[1])) voiceOrder.push(v[1]);
    }
    for (const v of secs[name].voices) (pitches[v.id] ??= []).push(...v.notes.map((/** @type {any} */ n) => n.midi));
  }
  if (!voiceOrder.length) voiceOrder.push('1');
  /** @type {Record<string, string[]>} */
  const bodies = {};
  path.forEach((name, i) => {
    /** @type {Record<string, string[]>} */
    const mine = {};
    let cur = voiceOrder[0];
    for (const ln of piece.sections[name].abc.split('\n')) {
      if (/^[XMLQK]:/.test(ln)) { if (i === 0) header.push(ln); continue; }
      if (/^T:/.test(ln)) continue;
      const v = /^V:\s*(\S+)/.exec(ln);
      if (v) { cur = v[1]; continue; }
      if (ln.trim()) (mine[cur] ??= []).push(ln.trim().replace(/\|\]\s*$/, '|'));
    }
    for (const v of voiceOrder) {
      // A voice this section does not have rests (invisibly) for its bars.
      const lines = mine[v] ?? [Array.from({ length: piece.sections[name].bars }, () => 'X |').join(' ')];
      if (v === voiceOrder[0]) lines[0] = `"^${name}"${lines[0]}`;
      (bodies[v] ??= []).push(...lines);
    }
  });
  const k = header.find((l) => l.startsWith('K:')) ?? 'K:C';
  const rest = header.filter((l) => !l.startsWith('K:'));
  const top = voiceOrder.length > 1 ? [`%%score {${voiceOrder.join(' ')}}`] : [];
  // The left hand, and any line that mostly sits below middle C (a cello), read in the bass clef.
  const low = (/** @type {string} */ v) => {
    const p = [...(pitches[v] ?? [])].sort((x, y) => x - y);
    return v === 'acc' || (p.length > 0 && p[p.length >> 1] < 60);
  };
  const body = voiceOrder.flatMap((v) => [low(v) ? `V:${v} clef=bass` : `V:${v}`, ...bodies[v]]);
  const last = body.length - 1;
  body[last] = body[last].replace(/\|\s*$/, '|]');
  return [...rest, `T:${piece.title}`, ...top, k, ...body, ''].join('\n');
}
