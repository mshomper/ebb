// @ts-check
// The development engine, step 3a (doc 24, "Motif bank"): a season's motifs, fitted to a piece's
// meter, and the ways a composer develops them. A motif is written in the material as notes of
// [degree, eighths]: degrees of the home scale counted from the tonic in the fourth octave (0 is
// F4 in summer, D4 in spring; 7 is the octave above, -1 the step below), eighths its rhythm. A
// degree of null is a rest.
//
// A cell is a few bars of melody: notes {t, d, deg, job} with t and d in eighths from the cell's
// start, and its length in bars. Every technique takes a cell and gives a new one; nothing here
// knows about chords (fit.js does that).
//
// Pure and seeded.

/** Bar length in eighth notes, per meter (the ABC unit is an eighth). */
export const BAR_EIGHTHS = /** @type {Record<string, number>} */ ({ '3/4': 6, '4/4': 8, '6/8': 6, '2/4': 4, '9/8': 9 });

/** @typedef {ReturnType<typeof import('../../../core/rng.js').stream>} Stream */

/**
 * @typedef {Object} MNote
 * @property {number} t      start, in eighths
 * @property {number} d      length, in eighths
 * @property {number} deg    scale degree (see the header)
 * @property {string} job    'motif' | 'development' | 'return' | 'goal' | 'passing' | 'chord' | 'suspension'
 * @property {boolean} [fermata]
 */
/** @typedef {{notes: MNote[], bars: number}} Cell */

/**
 * A material motif fitted to a meter: same note order, rhythm re-fitted bar by bar when the motif
 * was written in another meter. Rests are dropped (the gap stays).
 * @param {{meter: string, notes: [number|null, number][]}} m @param {string} meter
 * @returns {Cell}
 */
export function fitMotif(m, meter) {
  const from = BAR_EIGHTHS[m.meter] ?? 8, to = BAR_EIGHTHS[meter] ?? 8;
  /** @type {{t: number, deg: number|null}[]} */
  const on = [];
  let t = 0;
  for (const [deg, d] of m.notes) { on.push({ t, deg }); t += d; }
  const bars = Math.max(1, Math.ceil(t / from));
  const mapped = on.map((n) => ({ t: from === to ? n.t : Math.floor(n.t / from) * to + Math.round(((n.t % from) / from) * to), deg: n.deg }));
  for (let i = 1; i < mapped.length; i++) if (mapped[i].t <= mapped[i - 1].t) mapped[i].t = mapped[i - 1].t + 1;
  const end = bars * to;
  /** @type {MNote[]} */
  const notes = [];
  mapped.forEach((n, i) => {
    const next = i + 1 < mapped.length ? mapped[i + 1].t : end;
    if (n.deg !== null && n.t < end) notes.push({ t: n.t, d: Math.max(1, Math.min(next, end) - n.t), deg: n.deg, job: 'motif' });
  });
  return { notes, bars };
}

/** @param {Cell} c @returns {Cell} */
const copy = (c) => ({ notes: c.notes.map((n) => ({ ...n })), bars: c.bars });

/** The last note of a cell lasts to the cell's end. @param {Cell} c @param {number} L */
function closeOut(c, L) {
  const last = c.notes[c.notes.length - 1];
  if (last) last.d = Math.max(1, c.bars * L - last.t);
  return c;
}

/**
 * The development techniques (doc 24): each returns a new cell, its notes marked 'development'
 * (a plain return keeps 'motif'). `k` is the technique's step (sequence and displacement).
 * @type {Record<string, (c: Cell, L: number, r: Stream, o: {dir: number, maxBars: number}) => Cell | null>}
 */
export const TECHNIQUES = {
  // The motif again, as it was.
  return: (c) => copy(c),
  // Moved up or down by scale steps (the fit step then bends it to the new chord).
  sequence: (c, L, r, o) => {
    const k = (r.next() < 0.7 ? 1 : 2) * (o.dir || (r.next() < 0.5 ? -1 : 1));
    const out = copy(c);
    for (const n of out.notes) { n.deg += k; n.job = 'development'; }
    return out;
  },
  // Only its head or its tail, one bar.
  fragment: (c, L, r) => {
    if (!c.notes.length) return null;
    const head = c.bars === 1 || r.next() < 0.6;
    const span = c.bars === 1 ? Math.ceil(L / 2) : L;
    const from = head ? 0 : c.bars === 1 ? span : (c.bars - 1) * L;
    const notes = c.notes.filter((n) => (head ? n.t < span : n.t >= from)).map((n) => ({ ...n, t: n.t - (head ? 0 : from), job: 'development' }));
    if (!notes.length) return null;
    return closeOut({ notes, bars: 1 }, L);
  },
  // One more bar that carries on the motif's direction by step.
  extension: (c, L, r, o) => {
    if (c.bars + 1 > o.maxBars || !c.notes.length) return null;
    const out = copy(c);
    for (const n of out.notes) n.job = 'development';
    const first = out.notes[0], last = out.notes[out.notes.length - 1];
    const dir = Math.sign(last.deg - first.deg) || o.dir || 1;
    const t0 = c.bars * L;
    const half = Math.ceil(L / 2);
    out.notes.push({ t: t0, d: half, deg: last.deg + dir, job: 'development' }, { t: t0 + half, d: L - half, deg: last.deg + 2 * dir, job: 'development' });
    out.bars += 1;
    return out;
  },
  // Twice as slow.
  augmentation: (c, L, r, o) => {
    if (c.bars * 2 > o.maxBars) return null;
    return { notes: c.notes.map((n) => ({ ...n, t: n.t * 2, d: n.d * 2, job: 'development' })), bars: c.bars * 2 };
  },
  // Upside down around its first note.
  inversion: (c) => {
    if (!c.notes.length) return null;
    const pivot = c.notes[0].deg;
    return { notes: c.notes.map((n) => ({ ...n, deg: 2 * pivot - n.deg, job: 'development' })), bars: c.bars };
  },
  // The same notes, starting an eighth or a quarter later; the end is trimmed to the cell.
  displacement: (c, L, r) => {
    const s = r.next() < 0.6 ? 1 : 2;
    const end = c.bars * L;
    const notes = c.notes.filter((n) => n.t + s < end).map((n) => ({ ...n, t: n.t + s, d: Math.min(n.d, end - n.t - s), job: 'development' }));
    if (!notes.length) return null;
    return { notes, bars: c.bars };
  },
  // Twice as fast, then again a step on, filling the same bars (mornings).
  diminution: (c, L, r, o) => {
    if (c.notes.some((n) => n.d % 2 || n.t % 2)) return null;
    const half = c.notes.map((n) => ({ ...n, t: n.t / 2, d: n.d / 2, job: 'development' }));
    const len = (c.bars * L) / 2;
    const k = o.dir || 1;
    return { notes: [...half, ...half.map((n) => ({ ...n, t: n.t + len, deg: n.deg + k }))], bars: c.bars };
  },
};

/**
 * A breath: one long note, a bar (its degree is set where it lands).
 * @param {number} L @param {number} deg @returns {Cell}
 */
export const holdCell = (L, deg) => ({ notes: [{ t: 0, d: L, deg, job: 'development' }], bars: 1 });
