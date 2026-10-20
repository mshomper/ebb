// @ts-check
// The development engine, step 2 (doc 24): walk the season's chord grammar through a phrase plan.
// Each phrase starts from where the last one ended, moves by the grammar's weighted moves toward
// its tension target, and lands its cadence: the last bar is the cadence's goal and the bar before
// holds one of its approaches (or, now and then, shares that bar with the chord before it).
// Steps are checked for reach, so a walk never strands itself away from its cadence.
//
// Pure and seeded. Places are the grammar's names ("I", "vi7", "bVII"); symbols are chord symbols
// in the material's home key, with colors ("Dadd9") drawn per chord.

import { pickWeighted } from './plan.js';

/** @typedef {import('./plan.js').PhrasePlan} PhrasePlan */
/** @typedef {ReturnType<typeof import('../../../core/rng.js').stream>} Stream */

/**
 * @typedef {Object} HChord   one chord of a grown piece
 * @property {string} place
 * @property {string} symbol
 * @property {number} at       where it starts in its bar, 0 or a fraction (a split bar)
 * @property {boolean} color   a color symbol rather than the plain one
 */
/**
 * @typedef {Object} HBar
 * @property {HChord[]} chords
 * @property {number} phrase   index into the plan
 * @property {number} target   the tension the plan asked for at this bar
 * @property {boolean} held    the bar's first chord continues the bar before
 * @property {string|null} cadence  on a phrase's last bar, the cadence it lands
 * @property {boolean} [kept]  brought back unchanged from an earlier phrase (a return)
 */

/**
 * Fewest moves from every place to every place (holding is free, so "within n" means "<= n").
 * @param {any} material @returns {Record<string, Record<string, number>>}
 */
export function reach(material) {
  const places = Object.keys(material.chords);
  /** @type {Record<string, Record<string, number>>} */
  const d = {};
  for (const a of places) {
    d[a] = { [a]: 0 };
    const q = [a];
    while (q.length) {
      const x = /** @type {string} */ (q.shift());
      for (const y of Object.keys(material.moves[x] ?? {})) {
        if (d[a][y] === undefined) { d[a][y] = d[a][x] + 1; q.push(y); }
      }
    }
  }
  return d;
}

/** @param {any} material @param {Record<string, Record<string, number>>} dist @param {string} a @param {string} b */
const steps = (material, dist, a, b) => dist[a]?.[b] ?? Infinity;

/**
 * Choose a symbol for a place: the plain one, or a color. Colors scale by colorAmount, borrowed ones
 * (material.borrowed) by borrowedAmount instead, and a color whose partner just sounded
 * (material.colorPairs, such as D2 and G2) is pairPull times likelier.
 * @param {any} material @param {string} place @param {any} H rules.harmony
 * @param {string|null} prevSymbol @param {Stream} r
 * @returns {{symbol: string, color: boolean}}
 */
export function voiceSymbol(material, place, H, prevSymbol, r) {
  const c = material.chords[place];
  const borrowed = new Set(material.borrowed ?? []);
  const partners = new Set();
  for (const [a, b] of material.colorPairs ?? []) {
    if (a === prevSymbol) partners.add(b);
    if (b === prevSymbol) partners.add(a);
  }
  /** @type {[string, number][]} */
  const colors = Object.entries(c.colors ?? {}).map(([sym, w]) => [sym, /** @type {number} */ (w)
    * (borrowed.has(sym) ? (H.borrowedAmount ?? 1) : (H.colorAmount ?? 1))
    * (partners.has(sym) ? (H.pairPull ?? 1) : 1)]);
  // Colors share at most 90 percent, so the plain chord always keeps a voice.
  const sum = colors.reduce((s, [, w]) => s + w, 0);
  const scale = sum > 0.9 ? 0.9 / sum : 1;
  let x = r.next();
  for (const [sym, w] of colors) {
    x -= w * scale;
    if (x < 0) return { symbol: sym, color: true };
  }
  return { symbol: c.symbol, color: false };
}

/**
 * One step of the walk: the next place from `from`, which must still reach `goal` in `left` moves.
 * @param {any} material @param {any} H rules.harmony @param {Record<string, Record<string, number>>} dist
 * @param {string} from @param {string} goal @param {number} left moves remaining after this one
 * @param {number} target tension wanted here @param {boolean} mayHold @param {Stream} r
 * @returns {{place: string, held: boolean, forced: boolean}}
 */
function step(material, H, dist, from, goal, left, target, mayHold, r) {
  /** @type {Record<string, number>} */
  const w = {};
  const k = H.tensionFollow ?? 3;
  for (const [to, mw] of Object.entries(material.moves[from] ?? {})) {
    if (steps(material, dist, to, goal) > left) continue;
    const borrowed = material.chords[to].borrowed ? (H.borrowedAmount ?? 1) : 1;
    w[to] = /** @type {number} */ (mw) * borrowed * Math.exp(-k * Math.abs(material.chords[to].tension - target));
  }
  if (mayHold && steps(material, dist, from, goal) <= left) {
    w[`=${from}`] = (material.hold ?? 0) * (H.hold ?? 1) * Math.exp(-k * Math.abs(material.chords[from].tension - target));
  }
  const pick = pickWeighted(w, r);
  if (pick) return pick.startsWith('=') ? { place: from, held: true, forced: false } : { place: pick, held: false, forced: false };
  // Nothing reaches the goal in time: take any move and let the cadence be forced (the judge notices).
  const any = pickWeighted(material.moves[from] ?? {}, r);
  return { place: any ?? from, held: !any, forced: true };
}

/**
 * Walk the grammar through a plan.
 * @param {any} material @param {any} rules recipes/music/develop.json
 * @param {PhrasePlan[]} plan @param {Stream} r
 * @returns {{bars: HBar[], forced: number}}
 */
export function walk(material, rules, plan, r) {
  const H = rules.harmony ?? {};
  const dist = reach(material);
  /** @type {HBar[]} */
  const bars = [];
  let forced = 0;
  /** @type {string|null} */
  let prev = null;
  /** @type {{symbol: string, color: boolean}|null} */
  let prevSym = null;

  /** @param {string} place @param {boolean} held */
  const sym = (place, held) => (held && prevSym ? prevSym : voiceSymbol(material, place, H, prevSym?.symbol ?? null, r));

  plan.forEach((ph, pi) => {
    const cad = material.cadences[ph.cadence];
    const n = ph.bars;
    const tgt = (/** @type {number} */ i) => ph.tension[0] + (ph.tension[1] - ph.tension[0]) * (n > 1 ? i / (n - 1) : 1);
    // Slots: one chord per bar, except that a split bar before the goal holds two (the walk's last
    // chord, then the cadence's approach on its later half). The approach takes slot `walkSlots`.
    const split = n >= 3 && r.next() < (H.splitLast ?? 0);
    const walkSlots = split ? n - 1 : n - 2;
    const opening = prev === null;
    /** @type {HBar[]} */
    const pb = [];
    for (let i = 0; i < n; i++) pb.push({ chords: [], phrase: pi, target: tgt(i), held: false, cadence: null });
    // Bars that are already decided: a piece opens at home; a return keeps its source's first bars.
    let start = 0;
    if (ph.from !== undefined) {
      const src = bars.filter((b) => b.phrase === ph.from);
      const keep = Math.min(ph.keep ?? 2, walkSlots, src.length);
      for (let s = 0; s < keep; s++) {
        pb[s].chords = src[s].chords.map((c) => ({ ...c }));
        pb[s].held = s > 0 && src[s].held;
        pb[s].kept = true;
        const lastC = pb[s].chords[pb[s].chords.length - 1];
        prev = lastC.place; prevSym = { symbol: lastC.symbol, color: lastC.color };
      }
      start = keep;
    } else if (opening && walkSlots > 0) {
      const v = sym('I', false);
      pb[0].chords.push({ place: 'I', symbol: v.symbol, at: 0, color: v.color });
      prev = 'I'; prevSym = v;
      start = 1;
    }
    // The cadence's approach: one of its 'from' places that the walk can still reach.
    /** @type {Record<string, number>} */
    const fromChoices = {};
    for (const f of cad.from) {
      const need = prev === null ? (f === 'I' ? 0 : Infinity) : steps(material, dist, /** @type {string} */ (prev), f);
      const room = walkSlots - start + 1;
      if (need <= room) fromChoices[f] = 1 / (1 + need * 0.25);
    }
    let approach = pickWeighted(fromChoices, r);
    if (!approach) { approach = cad.from[0]; forced++; }

    // The walk.
    for (let s = start; s < walkSlots; s++) {
      const bar = pb[s];
      const lastHeld = s > 0 ? pb[s - 1].held : bars[bars.length - 1]?.held ?? false;
      const st = step(material, H, dist, /** @type {string} */ (prev), approach, walkSlots - s, tgt(s), !lastHeld, r);
      if (st.forced) forced++;
      const v = sym(st.place, st.held);
      bar.chords.push({ place: st.place, symbol: v.symbol, at: 0, color: v.color });
      bar.held = st.held;
      prev = st.place; prevSym = v;
    }
    // The approach: a bar of its own, or the later half of the split bar.
    const aBar = pb[n - 2];
    if (prev !== null && prev !== approach && !material.moves[prev]?.[approach]) forced++;
    if (split) {
      if (prev !== approach) {
        const v = sym(approach, false);
        aBar.chords.push({ place: approach, symbol: v.symbol, at: 0.5, color: v.color });
        prev = approach; prevSym = v;
      }
    } else {
      const held = prev === approach;
      const v = sym(approach, held);
      aBar.chords.push({ place: approach, symbol: v.symbol, at: 0, color: v.color });
      aBar.held = held;
      prev = approach; prevSym = v;
    }
    // The goal.
    const goal = pb[n - 1];
    const v = sym(cad.to, false);
    goal.chords.push({ place: cad.to, symbol: v.symbol, at: 0, color: v.color });
    goal.cadence = ph.cadence;
    prev = cad.to; prevSym = v;
    bars.push(...pb);
  });
  return { bars, forced };
}

/**
 * The piece's chords as a list of places, one per chord change (holds merged).
 * @param {HBar[]} bars @returns {string[]}
 */
export function changes(bars) {
  /** @type {string[]} */
  const out = [];
  for (const b of bars) for (const c of b.chords) if (out[out.length - 1] !== c.place) out.push(c.place);
  return out;
}
