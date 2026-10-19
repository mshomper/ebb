// @ts-check
// Turns an anchor piece and a seed into a performance (doc 24, "Realizing a piece"): the form path
// (optional sections rolled, or the short form), a key from the piece's allowed keys, the
// melody's octave, the instruments, the accompaniment (the piece's own written voice where there
// is one, otherwise voiced from the chord symbols by voicing.js and played in a pattern), the
// tempo and its rubato, human timing and velocity, and legato pedaling. The same piece, context
// and seed always give the same performance; a new seed gives a new performance of the same
// melody and harmony. Pure: no audio here, so the lab can draw a performance before playing it.
//
// Numbers come from recipes/music/realize.json and recipes/music/voicing.json. Randomness is the
// music stream (src/core/rng.js), never Math.random.

import { parseAbc, TICKS_PER_QUARTER } from './score.js';
import { parseChord } from './chords.js';
import { voiceProgression } from './voicing.js';
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
 * @property {string} pattern       the accompaniment pattern chosen
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
  const path = formPath(piece, !!ctx.shortForm, r);

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
  let pattern = pick(piece.variation?.patterns ?? ['sustained']);
  const usePad = accList.includes('pad') && (pattern === 'pad-only' || r.next() < 0.5);
  const accInst = accList.find((/** @type {string} */ x) => x !== 'pad') ?? (usePad ? null : melInst);

  // Tempo, then a thinner pattern if the day's note density ceiling would be exceeded.
  const bpm = (piece.tempo[0] + r.next() * (piece.tempo[1] - piece.tempo[0])) * (ctx.dayColor.tempo ?? 1);
  const baseTps = (bpm * beatTicks) / 60;
  const melRate = mel.length / Math.max(1, totalTicks / baseTps);
  if (pattern === 'broken-8ths' && melRate + (2 * baseTps) / beatTicks * (compound ? 3 : 2) > (ctx.dayColor.density ?? 3)) pattern = 'slow-roll';

  // Generated accompaniment where a section has no written one.
  const writtenAcc = new Set(raw.filter((n) => n.voice === 'acc').map((n) => n.section));
  /** @type {{tick: number, dur: number, midi: number, voice: string, offsetMs: number, velOffset: number, instrument: string}[]} */
  const gen = [];
  const needs = chords.filter((c) => c.chord && !c.chord.none && !writtenAcc.has(c.section));
  const styleName = R.patterns[pattern]?.voicing ?? 'open';
  const style = V.byStyle[styleName];
  if (needs.length && (accInst || usePad)) {
    const rules = needs.map((c) => {
      const under = raw.filter((n) => n.voice === 'mel' && n.tick < c.end && n.tick + n.dur > c.tick).map((n) => n.midi);
      return { ...style, w: V.weights, leadingPc: (keyPc(key) + 11) % 12, melodyFloor: under.length ? Math.min(...under) : undefined };
    });
    const shifted = needs.map((c) => ({ root: (c.chord.root + shift + 120) % 12, intervals: c.chord.intervals, bass: c.chord.bass === null || c.chord.bass === undefined ? null : (c.chord.bass + shift + 120) % 12 }));
    const voicings = voiceProgression(shifted, rules);
    needs.forEach((c, i) => {
      const v = voicings[i];
      const len = c.end - c.tick;
      const bass = v[0], upper = v.slice(1);
      if (usePad) for (const m of upper) gen.push({ tick: c.tick, dur: len, midi: m - (R.pad.octaveDown ?? 0), voice: 'pad', offsetMs: 0, velOffset: -R.dynamics.padOffset, instrument: 'pad' });
      if (!accInst || pattern === 'pad-only') return;
      const push = (/** @type {number} */ tick, /** @type {number} */ dur, /** @type {number} */ midi, /** @type {string} */ voice, /** @type {number} */ offsetMs = 0, /** @type {number} */ vo = 0) =>
        gen.push({ tick, dur, midi, voice, offsetMs, velOffset: vo - R.dynamics.accompanimentOffset, instrument: accInst });
      const hold = Math.max(Q / 4, len - Q / 8);
      if (pattern === 'sustained') { push(c.tick, hold, bass, 'bass'); for (const m of upper) push(c.tick, hold, m, 'acc'); }
      else if (pattern === 'slow-roll') { push(c.tick, hold, bass, 'bass'); upper.forEach((m, k) => push(c.tick, hold, m, 'acc', (k + 1) * (R.patterns['slow-roll'].stepMs ?? 90), -2)); }
      else if (pattern === 'broken-8ths') {
        push(c.tick, hold, bass, 'bass');
        const order = upper.length > 2 ? [0, 1, 2, 1] : [0, 1];
        let k = 0;
        for (let t = c.tick + Q / 2; t < c.end; t += Q / 2) { push(t, (Q / 2) * 0.95, upper[Math.min(order[k % order.length], upper.length - 1)], 'acc', 0, -6); k++; }
      } else if (pattern === 'open-fifth-offbeat') {
        push(c.tick, hold, bass, 'bass');
        if (upper.length) push(c.tick, hold, upper[0], 'acc', 0, -4);
        const dyad = upper.slice(-2);
        const offs = compound ? [Q / 2, Q / 2 + beatTicks] : Array.from({ length: Math.round(barTicks / beatTicks) }, (_, b) => b * beatTicks + beatTicks / 2);
        for (let bt = c.tick; bt < c.end; bt += barTicks) for (const o of offs) if (bt + o < c.end) for (const m of dyad) push(bt + o, Q / 2, m, 'acc', 0, -8);
      }
    });
  }

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
    const t0 = time(n.tick) + lead + jit(R.humanize.jitterMs / 1000);
    const inst = n.voice === 'mel' ? melInst : accInst ?? melInst;
    if (n.voice !== 'mel') instruments[n.voice] = inst;
    notes.push({ t: Math.max(0, t0), dur: n.grace ? 0.07 : Math.max(0.05, time(n.tick + n.dur) - time(n.tick) - 0.02), midi: n.midi, vel: clampVel(vel), voice: n.voice, instrument: inst, tick: n.tick });
  }
  lastDyn = null;
  for (const g of gen) {
    const d = raw.filter((n) => n.voice === 'mel' && n.dyn && n.tick <= g.tick).pop()?.dyn ?? null;
    const vel = dynVel(d) + g.velOffset + archOf(g.tick) * 0.5 + jit(R.humanize.velJitter);
    const t0 = time(g.tick) + g.offsetMs / 1000 + jit(R.humanize.jitterMs / 1000);
    instruments[g.voice] = g.instrument;
    notes.push({ t: Math.max(0, t0), dur: Math.max(0.05, time(g.tick + g.dur) - time(g.tick) - 0.02), midi: g.midi, vel: clampVel(vel), voice: g.voice, instrument: g.instrument, tick: g.tick });
  }
  // Ornament: sometimes roll the final chord upward.
  const lastTick = Math.max(...notes.map((n) => n.tick));
  if (r.next() < (piece.variation?.ornament ?? 0)) {
    const fin = notes.filter((n) => n.tick === lastTick).sort((a, b) => a.midi - b.midi);
    fin.forEach((n, k) => { n.t += (k * R.roll.rollMs) / 1000; });
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
    pattern: usePad && pattern !== 'pad-only' ? `${pattern} with pad` : pattern,
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
  /** @type {string[]} */
  const voiceOrder = [];
  /** @type {Record<string, string[]>} */
  const bodies = {};
  path.forEach((name, i) => {
    /** @type {Record<string, string[]>} */
    const mine = {};
    let cur = '1';
    for (const ln of piece.sections[name].abc.split('\n')) {
      if (/^[XMLQK]:/.test(ln)) { if (i === 0) header.push(ln); continue; }
      if (/^T:/.test(ln)) continue;
      const v = /^V:\s*(\S+)/.exec(ln);
      if (v) { cur = v[1]; if (!voiceOrder.includes(cur)) voiceOrder.push(cur); continue; }
      if (ln.trim()) (mine[cur] ??= []).push(ln.trim().replace(/\|\]\s*$/, '|'));
    }
    if (!voiceOrder.length) voiceOrder.push('1');
    for (const v of voiceOrder) {
      // A voice this section does not have rests for its bars.
      const lines = mine[v] ?? [Array.from({ length: piece.sections[name].bars }, () => 'Z |').join(' ')];
      if (v === voiceOrder[0]) lines[0] = `"^${name}"${lines[0]}`;
      (bodies[v] ??= []).push(...lines);
    }
  });
  const k = header.find((l) => l.startsWith('K:')) ?? 'K:C';
  const rest = header.filter((l) => !l.startsWith('K:'));
  const top = voiceOrder.length > 1 ? [`%%score {${voiceOrder.join(' ')}}`] : [];
  const body = voiceOrder.flatMap((v) => [v === 'acc' ? `V:${v} clef=bass` : `V:${v}`, ...bodies[v]]);
  const last = body.length - 1;
  body[last] = body[last].replace(/\|\s*$/, '|]');
  return [...rest, `T:${piece.title}`, ...top, k, ...body, ''].join('\n');
}
