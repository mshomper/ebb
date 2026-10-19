// @ts-check
// Chord symbols to voicings (doc 24, "Voice-leading" and "Realizing a piece", step 3). For each
// chord, many candidate voicings are built (bass, then upper voices from the chord's colour tones
// first), and a dynamic-programming pass picks the path through the whole progression with the
// least voice motion, plus penalties for what a trained ear hears as faults:
//   - parallel fifths and octaves between the outer voices,
//   - close intervals low down (nothing closer than a fifth below C3),
//   - a doubled leading tone, or a doubled third,
//   - upper voices too far apart, or crossing above the melody,
//   - leaps in inner voices (they should move by step and keep common tones).
// Every weight comes from the caller (recipes/music/voicing.json via the realizer), so the rules
// can be tuned in the lab. Pure module: no audio, no randomness.

/**
 * @typedef {Object} ChordLike
 * @property {number} root       pitch class 0..11
 * @property {number[]} intervals semitones above the root (from chords.js), may exceed 12
 * @property {number|null} [bass] pitch class of a slash bass, or null
 */

/**
 * @typedef {Object} VoicingRules
 * @property {number} voices              total voices including the bass (3 to 6)
 * @property {[number, number]} bassRange MIDI low..high for the bass
 * @property {[number, number]} upperRange MIDI low..high for the upper voices
 * @property {number} [melodyFloor]       upper voices stay at least 1 semitone below this (MIDI)
 * @property {number} [leadingPc]         the key's leading tone, never doubled
 * @property {number} [maxCandidates]     cap on candidates per chord (default 400)
 * @property {{motion: number, bassMotion: number, parallel: number, lowClose: number, lowCloseBelow: number,
 *   doubledLeading: number, doubledThird: number, wideGap: number, wideGapSemis: number, innerLeap: number,
 *   commonTone: number, missingThird: number, missingSeventh: number, topLeap: number, bassTenorMin: number,
 *   bassTenorClose: number, semitone: number, minorNinth: number, missingColor: number, bassCenter: number,
 *   bassHome: number}} w   weights (see recipes/music/voicing.json)
 */

/** Role of an interval above the root, for choosing which tones a voicing must keep. @param {number} iv */
export function roleOf(iv) {
  const s = ((iv % 12) + 12) % 12;
  if (iv === 0) return 'root';
  if (s === 3 || s === 4) return iv > 12 ? 'ext' : 'third';
  if (s === 2 || s === 5) return iv > 12 ? 'ext' : 'sus';
  if (s === 7) return 'fifth';
  if (s === 6 || s === 8) return iv > 12 ? 'ext' : 'fifth';
  if (s === 10 || s === 11) return 'seventh';
  if (s === 9) return iv > 12 ? 'ext' : 'sixth';
  if (s === 1) return 'ext';
  return 'ext';
}

/**
 * The chord's tones as pitch classes with their roles, colour tones first, root and fifth last.
 * @param {ChordLike} c
 * @returns {{pc: number, role: string}[]}
 */
export function chordTones(c) {
  /** @type {Map<number, string>} */
  const m = new Map();
  for (const iv of c.intervals) {
    const pc = (c.root + iv) % 12;
    if (!m.has(pc)) m.set(pc, roleOf(iv));
  }
  const rank = { third: 0, sus: 0, seventh: 1, sixth: 1, ext: 2, fifth: 3, root: 4 };
  return [...m.entries()].map(([pc, role]) => ({ pc, role })).sort((a, b) => /** @type {any} */ (rank)[a.role] - /** @type {any} */ (rank)[b.role]);
}

/**
 * Every candidate voicing for one chord: a bass in range, and upper voices (distinct notes,
 * ascending) whose pitch classes cover the chord's most important tones.
 * @param {ChordLike} c @param {VoicingRules} r
 * @returns {number[][]} each ascending, bass first
 */
export function candidates(c, r) {
  const tones = chordTones(c);
  const bassPc = c.bass ?? c.root;
  const upperN = Math.max(1, r.voices - 1);
  /** @type {number[]} */
  const basses = [];
  for (let m = r.bassRange[0]; m <= r.bassRange[1]; m++) if (((m % 12) + 12) % 12 === bassPc) basses.push(m);
  const top = Math.min(r.upperRange[1], (r.melodyFloor ?? 128) - 1);
  // Upper pitch classes: the colour tones first; the root and fifth may fill or double.
  const pcs = tones.map((t) => t.pc);
  /** @type {number[]} */
  const notes = [];
  for (let m = r.upperRange[0]; m <= top; m++) if (pcs.includes(((m % 12) + 12) % 12)) notes.push(m);
  /** @type {number[][]} */
  const out = [];
  const max = r.maxCandidates ?? 400;
  /** @param {number} start @param {number[]} acc */
  function pick(start, acc) {
    if (out.length >= max * 4) return;
    if (acc.length === upperN) { for (const b of basses) if (b < acc[0]) out.push([b, ...acc]); return; }
    for (let i = start; i < notes.length; i++) {
      const n = notes[i];
      if (acc.length && n - acc[acc.length - 1] > 12) break; // keep upper voices within an octave of each other
      acc.push(n); pick(i + 1, acc); acc.pop();
    }
  }
  pick(0, []);
  // Keep the ones that cover the most important tones; drop voicings missing the third (or sus).
  const essentialPcs = tones.filter((t) => t.role !== 'root' && t.role !== 'fifth').map((t) => t.pc);
  out.sort((a, b) => coverage(b, essentialPcs) - coverage(a, essentialPcs));
  return out.slice(0, max);
}

/** @param {number[]} v @param {number[]} pcs */
function coverage(v, pcs) {
  const have = new Set(v.slice(1).map((m) => m % 12));
  return pcs.filter((p) => have.has(p)).length;
}

/**
 * Cost of a single voicing on its own (spacing, doubling, missing tones).
 * @param {number[]} v @param {ChordLike} c @param {VoicingRules} r
 */
export function staticCost(v, c, r) {
  const w = r.w;
  let cost = 0;
  // Close intervals low down: adjacent voices closer than a fifth with the lower one below C3.
  for (let i = 0; i + 1 < v.length; i++) {
    const gap = v[i + 1] - v[i];
    if (v[i] < w.lowCloseBelow && gap < 7) cost += w.lowClose * (7 - gap);
    if (i > 0 && gap > w.wideGapSemis) cost += w.wideGap * (gap - w.wideGapSemis);
  }
  // Bass to the next voice: open spacing (a fifth or a tenth, doc 24), never a muddy third.
  const bt = v[1] - v[0];
  if (bt < w.bassTenorMin) cost += w.bassTenorClose * (w.bassTenorMin - bt);
  // Semitone clusters between neighbouring upper voices, and minor ninths anywhere: both sound
  // like a mistake in a soft texture (a major seventh under the root is the usual culprit).
  for (let i = 1; i + 1 < v.length; i++) if (v[i + 1] - v[i] === 1) cost += w.semitone;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (v[j] - v[i] === 13) cost += w.minorNinth;
  // The bass likes a home register; it may leave it, at a small cost per semitone.
  cost += w.bassCenter * Math.abs(v[0] - w.bassHome);
  const tones = chordTones(c);
  const pcsUpper = v.slice(1).map((m) => m % 12);
  // A named colour tone (the 9 of maj9, the 9 of add9, a sharp 11) is the point of the chord.
  for (const t of tones) if (t.role === 'ext' && !pcsUpper.includes(t.pc)) cost += w.missingColor;
  const count = (/** @type {number} */ pc) => v.filter((m) => m % 12 === pc).length;
  const third = tones.find((t) => t.role === 'third' || t.role === 'sus');
  if (third && !pcsUpper.includes(third.pc)) cost += w.missingThird;
  if (third && third.role === 'third' && count(third.pc) > 1) cost += w.doubledThird;
  const sev = tones.find((t) => t.role === 'seventh' || t.role === 'sixth');
  if (sev && !pcsUpper.includes(sev.pc)) cost += w.missingSeventh;
  if (r.leadingPc !== undefined && count(r.leadingPc) > 1) cost += w.doubledLeading;
  return cost;
}

/**
 * Cost of moving from one voicing to the next: total semitone motion (voice by voice, upper
 * voices matched in order), leaps in inner voices, common tones kept, and parallel perfect
 * intervals between the outer voices.
 * @param {number[]} a previous @param {number[]} b next @param {VoicingRules} r
 */
export function moveCost(a, b, r) {
  const w = r.w;
  let cost = w.bassMotion * Math.abs(b[0] - a[0]);
  const ua = a.slice(1), ub = b.slice(1);
  const n = Math.max(ua.length, ub.length);
  for (let i = 0; i < n; i++) {
    const x = ua[Math.min(i, ua.length - 1)], y = ub[Math.min(i, ub.length - 1)];
    const d = Math.abs(y - x);
    cost += w.motion * d;
    const inner = i < n - 1;
    if (inner && d > 2) cost += w.innerLeap * (d - 2);
    if (!inner && d > 4) cost += w.topLeap * (d - 4);
  }
  // Common tones kept in place.
  const kept = ub.filter((m) => ua.includes(m)).length;
  cost -= w.commonTone * kept;
  // Parallel fifths or octaves between bass and top voice, both moving the same way.
  const ta = ua[ua.length - 1], tb = ub[ub.length - 1];
  const ia = (ta - a[0]) % 12, ib = (tb - b[0]) % 12;
  const moved = b[0] !== a[0] && tb !== ta;
  const same = Math.sign(b[0] - a[0]) === Math.sign(tb - ta);
  if (moved && same && ia === ib && (ia === 7 || ia === 0)) cost += w.parallel;
  // Also any pair of voices moving in parallel octaves or fifths.
  for (let i = 0; i < a.length && i < b.length; i++) for (let j = i + 1; j < a.length && j < b.length; j++) {
    if (i === 0 && j === Math.min(a.length, b.length) - 1) continue; // outer pair counted above
    const pa = (a[j] - a[i]) % 12, pb = (b[j] - b[i]) % 12;
    if (pa === pb && (pa === 7 || pa === 0) && a[i] !== b[i] && Math.sign(b[i] - a[i]) === Math.sign(b[j] - a[j])) cost += w.parallel * 0.5;
  }
  return cost;
}

/**
 * Voice a whole progression: the least-cost path through every chord's candidates.
 * @param {ChordLike[]} chords
 * @param {VoicingRules | VoicingRules[]} rules one set for all, or one per chord (melody floors change)
 * @param {number[]} [start] the voicing sounding before the first chord, if any
 * @returns {number[][]} one voicing per chord
 */
export function voiceProgression(chords, rules, start) {
  if (!chords.length) return [];
  const R = (/** @type {number} */ i) => (Array.isArray(rules) ? rules[i] : rules);
  /** @type {number[][][]} */
  const cands = chords.map((c, i) => {
    const cs = candidates(c, R(i));
    return cs.length ? cs : [fallback(c, R(i))];
  });
  /** @type {number[][]} */
  const cost = [];
  /** @type {number[][]} */
  const back = [];
  cost[0] = cands[0].map((v) => staticCost(v, chords[0], R(0)) + (start ? moveCost(start, v, R(0)) : 0));
  back[0] = cands[0].map(() => -1);
  for (let i = 1; i < chords.length; i++) {
    cost[i] = []; back[i] = [];
    for (let k = 0; k < cands[i].length; k++) {
      const v = cands[i][k];
      const sc = staticCost(v, chords[i], R(i));
      let best = Infinity, arg = 0;
      for (let j = 0; j < cands[i - 1].length; j++) {
        const c = cost[i - 1][j] + moveCost(cands[i - 1][j], v, R(i));
        if (c < best) { best = c; arg = j; }
      }
      cost[i][k] = best + sc;
      back[i][k] = arg;
    }
  }
  const last = chords.length - 1;
  let k = cost[last].indexOf(Math.min(...cost[last]));
  /** @type {number[][]} */
  const path = [];
  for (let i = last; i >= 0; i--) { path[i] = cands[i][k]; k = back[i][k]; }
  return path;
}

/** If no candidate fits the ranges, a plain root-position triad in the middle of the ranges. @param {ChordLike} c @param {VoicingRules} r */
function fallback(c, r) {
  const b = r.bassRange[0] + (((c.bass ?? c.root) - r.bassRange[0]) % 12 + 12) % 12;
  const u = r.upperRange[0] + ((c.root - r.upperRange[0]) % 12 + 12) % 12;
  return [b, u, u + (c.intervals[1] ?? 4), u + (c.intervals[2] ?? 7)].slice(0, Math.max(2, r.voices));
}
