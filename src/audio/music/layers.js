// @ts-check
// Support layers (doc 24, Influences: "a simple lead over quiet supporting layers"). Two layers sit
// around the melody and the left hand, generated from the chord symbols:
//   bed    a held chord on strings or the pad that moves with the phrases. Each section says how:
//          out (none), in (enters softly), swell (grows across the section), steady, thin (fades
//          and loses its top voice). Styles: warm (three close voices under the melody, moving as
//          little as possible) or open-fifths (root and fifth stacked across three octaves, winter).
//   touch  a harp, mallet or bell touch on the last chord of a section (the cadence), with a chance.
// The piece names its preferences in palette.bed / palette.touch and the plan in layers. Numbers
// come from recipes/music/realize.json "layers". Pure: the caller passes the seeded stream.

/** @typedef {{next(): number}} Rng */
/** @typedef {{tick: number, dur: number, midi: number, voice: string, offsetMs: number, velOffset: number, instrument: string}} GenNote */

/**
 * @param {number[]} pcs pitch classes @param {number} low @param {number} high
 * @returns {number[]} every MIDI note in the range whose pitch class is in pcs
 */
function inRange(pcs, low, high) {
  /** @type {number[]} */
  const out = [];
  for (let m = low; m <= high; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

/**
 * Three close voices for each chord, under the melody, moving as little as possible.
 * @param {{root: number, intervals: number[]}[]} chords already in the sounding key (pitch classes)
 * @param {(number|undefined)[]} ceilings the lowest melody note over each chord
 * @param {{low: number, high: number, voices: number, maxGap: number}} c
 */
export function warmBed(chords, ceilings, c) {
  /** @type {number[][]} */
  const out = [];
  /** @type {number[] | null} */
  let prev = null;
  chords.forEach((ch, i) => {
    const pcs = [...new Set(ch.intervals.map((iv) => (ch.root + iv) % 12))];
    // Prefer the colour tones: drop the root first when there are more tones than voices.
    const tones = pcs.length > c.voices ? pcs.filter((p) => p !== ch.root % 12).slice(0, c.voices) : pcs;
    const top = Math.min(c.high, (ceilings[i] ?? 127) - 1);
    const cand = inRange(tones, c.low, top);
    /** @type {number[] | null} */
    let best = null;
    // The most voices that fit under the melody (fewer when it dips low; none if nothing fits).
    for (let n = Math.min(c.voices, tones.length); n >= 1 && !best; n--) {
      let bestCost = Infinity;
      const walk = (/** @type {number} */ from, /** @type {number[]} */ acc) => {
        if (acc.length === n) {
          if (new Set(acc.map((m) => m % 12)).size < n) return;
          for (let k = 1; k < n; k++) if (acc[k] - acc[k - 1] > c.maxGap) return;
          let cost = 0;
          if (prev && prev.length) for (let k = 0; k < n; k++) cost += Math.abs(acc[k] - prev[Math.min(k, prev.length - 1)]);
          else cost = Math.abs(acc[0] - (c.low + 7));
          if (cost < bestCost) { bestCost = cost; best = [...acc]; }
          return;
        }
        for (let j = from; j < cand.length; j++) if (!acc.length || cand[j] > acc[acc.length - 1]) walk(j + 1, [...acc, cand[j]]);
      };
      walk(0, []);
    }
    const v = best ?? [];
    out.push(v);
    if (v.length) prev = v;
  });
  return out;
}

/**
 * Root and fifth stacked across three octaves, never below the lowest allowed note.
 * @param {{root: number, bass: number|null|undefined}} ch @param {number|undefined} ceiling @param {{lowest: number, stack: number[]}} c
 */
export function openFifths(ch, ceiling, c) {
  const pc = (ch.bass ?? ch.root) % 12;
  let r = c.lowest + ((pc - c.lowest) % 12 + 12) % 12;
  return c.stack.map((iv) => r + iv).filter((m) => m < (ceiling ?? 127) - 1);
}

/** How loud the bed is (velocity offset below the melody) at x, 0..1 through a section. @param {string} mode @param {number} x @param {any} L */
export function bedLevel(mode, x, L) {
  const s = L.steadyDb, q = L.quietDb;
  if (mode === 'in') return q + (s - q) * Math.min(1, x * 2);
  if (mode === 'swell') return q + (L.peakDb - q) * x;
  if (mode === 'thin') return s + (q - s) * x;
  return s;
}

/**
 * The support layers of a performance.
 * @param {{
 *   piece: any, path: string[], chords: {tick: number, end: number, chord: any, section: number}[],
 *   shift: number, mel: {tick: number, dur: number, midi: number}[], choose: (list: string[]) => string|undefined,
 *   L: any, r: Rng,
 * }} o
 * @returns {{notes: GenNote[], bed: string|null, touch: string|null}}
 */
export function supportLayers(o) {
  const { piece, path, chords, shift, mel, choose, L, r } = o;
  /** @type {GenNote[]} */
  const notes = [];
  const plan = piece.layers ?? {};
  const live = chords.filter((c) => c.chord && !c.chord.none);
  const sounding = live.map((c) => ({ root: (c.chord.root + shift + 120) % 12, intervals: c.chord.intervals, bass: c.chord.bass === null || c.chord.bass === undefined ? null : (c.chord.bass + shift + 120) % 12 }));
  const ceiling = live.map((c) => {
    const over = mel.filter((n) => n.tick < c.end && n.tick + n.dur > c.tick).map((n) => n.midi);
    return over.length ? Math.min(...over) : undefined;
  });

  // Bed.
  const bedInst = plan.bed && piece.palette?.bed ? choose(piece.palette.bed) ?? null : null;
  if (bedInst) {
    const style = plan.bed.style ?? 'warm';
    const voiced = style === 'open-fifths'
      ? sounding.map((ch, i) => openFifths(ch, ceiling[i], L.openFifths))
      : warmBed(sounding, ceiling, L.warm);
    // A little seeded variety: now and then a section's bed moves one step quieter or louder.
    const order = ['out', 'thin', 'in', 'steady', 'swell'];
    /** @type {Record<number, string>} */
    const modeOf = {};
    path.forEach((name, si) => {
      let m = plan.bed.sections?.[name] ?? 'out';
      if (m !== 'out' && r.next() < L.vary) m = order[Math.max(1, Math.min(order.length - 1, order.indexOf(m) + (r.next() < 0.5 ? -1 : 1)))];
      modeOf[si] = m;
    });
    /** @type {Map<number, GenNote>} the bed notes sounding into the next chord, by pitch */
    let tied = new Map();
    live.forEach((c, i) => {
      const mode = modeOf[c.section] ?? 'out';
      if (mode === 'out') { tied = new Map(); return; }
      const sec = live.filter((x) => x.section === c.section);
      const k = sec.indexOf(c);
      const x = sec.length > 1 ? k / (sec.length - 1) : 1;
      let v = voiced[i];
      if (mode === 'thin' && k === sec.length - 1 && v.length > 2) v = v.slice(0, -1);
      const db = bedLevel(mode, x, L.bed);
      const last = i === live.length - 1;
      const tail = last ? 0 : L.bed.overlapTicks;
      /** @type {Map<number, GenNote>} */
      const next = new Map();
      for (const m of v) {
        // A note the last chord already holds keeps sounding (a string player does not re-bow a
        // common tone); only new notes start.
        const held = tied.get(m);
        if (held && held.tick + held.dur - L.bed.overlapTicks === c.tick) { held.dur = c.end - held.tick + tail; next.set(m, held); continue; }
        const n = { tick: c.tick, dur: c.end - c.tick + tail, midi: m, voice: 'bed', offsetMs: 0, velOffset: db, instrument: bedInst };
        notes.push(n);
        next.set(m, n);
      }
      // A note this chord does not keep stops a little before the change, with no overlap, so a slow
      // release (strings, the pad) never rings a step against the new chord (Matt, October 20, 2026:
      // the bed sometimes clashed). Shared notes above carry straight through, so the bed never breathes.
      const lift = L.bed.leaveLiftTicks?.[bedInst] ?? L.bed.leaveLiftTicks?.default ?? 0;
      for (const [m, n] of tied) {
        if (next.get(m) === n) continue;
        n.dur = Math.max((c.tick - n.tick) * 0.5, c.tick - n.tick - lift);
      }
      tied = next;
    });
  }

  // Touches on the cadences.
  const touchInst = plan.touch && piece.palette?.touch ? choose(piece.palette.touch) ?? null : null;
  if (touchInst) {
    const chance = plan.touch.chance ?? 0.7;
    const T = L.touch;
    live.forEach((c, i) => {
      const lastOfSection = i === live.length - 1 || live[i + 1].section !== c.section;
      if (!lastOfSection || r.next() >= chance) return;
      const ch = sounding[i];
      const pcs = [...new Set(ch.intervals.map((iv) => (ch.root + iv) % 12))];
      const low = Math.max(T.low, (ceiling[i] ?? T.low) - 12);
      const tones = inRange(pcs, low, T.high).slice(0, T.notes);
      const rolled = T.rolled.includes(touchInst);
      tones.forEach((m, k) => notes.push({ tick: c.tick, dur: c.end - c.tick, midi: m, voice: 'touch', offsetMs: rolled ? k * T.rollMs : 0, velOffset: T.db, instrument: touchInst }));
    });
  }
  return { notes, bed: bedInst, touch: touchInst };
}
