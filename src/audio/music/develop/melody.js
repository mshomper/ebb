// @ts-check
// The development engine, step 3 (doc 24, "How a melody is grown"): a melody over a grown piece's
// harmony. Each phrase opens with a motif from the season's bank that suits its role (an opening,
// an answer, a climb, a cadence); the bars after it develop the motif (return, sequence, fragment,
// extension, augmentation, inversion, displacement, diminution, each weighted); the last bar lands
// a goal note on the cadence's chord, reached by step. A return brings back the melody of the
// phrase it restates, then goes its own way. The coda sings the ending's chords, held. Then the fit
// step (fit.js) bends every note onto the chords, and the critic (critic.js) scores the result.
//
// Notes are in global eighths and scale degrees (motifs.js). Pure and seeded.

import { det } from '../../../core/rng.js';
import { pickWeighted } from './plan.js';
import { fitMotif, TECHNIQUES, holdCell } from './motifs.js';
import { fitMelody, isChordTone } from './fit.js';

/** @typedef {import('./motifs.js').MNote} MNote */
/** @typedef {import('./motifs.js').Cell} Cell */
/** @typedef {import('./timeline.js').Section} Section */
/** @typedef {import('./timeline.js').TEvent} TEvent */
/** @typedef {ReturnType<typeof import('../../../core/rng.js').stream>} Stream */

/** Strong positions in a bar, in eighths. */
export const STRONG = /** @type {Record<string, number[]>} */ ({ '3/4': [0], '4/4': [0, 4], '6/8': [0, 3], '2/4': [0], '9/8': [0, 3, 6] });

/** What kind of motif a phrase role opens with. @param {string} role */
export function roleKind(role) {
  if (/cadence/.test(role)) return 'cadential';
  if (/answer/.test(role)) return 'answer';
  if (/climb|peak|development|turn/.test(role)) return 'climbing';
  return 'opening';
}

/**
 * @typedef {Object} MelodyCtx
 * @property {Section[]} sections  from timeline.js, the coda last
 * @property {import('./plan.js').PhrasePlan[]} plan
 * @property {string} meter
 * @property {number} span       written bars per harmonic bar
 * @property {[number, number]} register  lowest and highest MIDI note
 * @property {Record<string, number>} weights  technique weights (already leaned for the slot)
 * @property {ReturnType<typeof import('./timeline.js').homeScale>} scale
 * @property {TEvent[]} events   every chord, global eighths
 * @property {number[]} offsets  each section's start, global eighths
 */

/** The octave shift (in degrees) that puts a cell nearest prev and inside the register. @param {MelodyCtx} C @param {Cell} cell @param {number|null} prev */
function anchor(C, cell, prev) {
  if (!cell.notes.length) return cell;
  const [lo, hi] = C.register;
  const first = cell.notes[0].deg;
  let best = 0, cost = Infinity;
  for (const k of [-14, -7, 0, 7, 14]) {
    let out = 0;
    for (const n of cell.notes) { const m = C.scale.midi(n.deg + k); out += Math.max(0, lo - m, m - hi); }
    const c = out * 3 + (prev === null ? Math.abs(k) * 0.2 : Math.abs(first + k - prev) * 0.5);
    if (c < cost) { cost = c; best = k; }
  }
  // A note a little outside stays (the motif keeps its shape); one far outside folds back an octave.
  const slack = 3;
  for (const n of cell.notes) {
    n.deg += best;
    while (C.scale.midi(n.deg) > hi + slack) n.deg -= 7;
    while (C.scale.midi(n.deg) < lo - slack) n.deg += 7;
  }
  return cell;
}

/**
 * The goal note of a phrase's last bar: a tone of the goal chord near the note before, the root or
 * the third most often (the tonic more often still at the end of the piece).
 * @param {MelodyCtx} C @param {TEvent} e @param {number|null} prev @param {boolean} final @param {Stream} r
 */
function goalDegree(C, e, prev, final, r) {
  /** @type {Record<string, number>} */
  const w = {};
  const [lo, hi] = C.register;
  const from = prev ?? 2;
  for (let d = from - 5; d <= from + 5; d++) {
    const m = C.scale.midi(d);
    if (m < lo || m > hi || !isChordTone(/** @type {any} */ (C), d, e)) continue;
    const pc = C.scale.pc(d);
    const iv = (pc - e.root + 12) % 12;
    const role = iv === 0 ? 1 : iv === 3 || iv === 4 ? 0.9 : iv === 7 ? 0.5 : 0.25;
    const tonic = final && pc === C.scale.tonicPc ? 3 : 1;
    const dist = Math.abs(d - from);
    w[String(d)] = role * tonic * (dist === 1 ? 1.5 : dist === 0 ? 0.6 : det.exp(-(dist - 1) / 1.5));
  }
  const k = pickWeighted(w, r);
  return k === null ? from : Number(k);
}

/**
 * Grow one melody candidate.
 * @param {any} material @param {any} M rules.melody
 * @param {MelodyCtx} C @param {Stream} r
 * @returns {{notes: MNote[], phrases: {motif: string|null, techniques: string[]}[]}}
 */
export function growMelodyOnce(material, M, C, r) {
  const motifs = Object.entries(material.motifs ?? {});
  /** @type {Record<string, Cell>} */
  const cells = Object.fromEntries(motifs.map(([id, m]) => [id, fitMotif(/** @type {any} */ (m), C.meter)]));
  const pools = M.pools ?? {};
  /** @type {MNote[]} */
  const out = [];
  /** @type {MNote[][]} phrase melodies, section-local */
  const byPhrase = [];
  /** @type {{motif: string|null, techniques: string[]}[]} */
  const phrases = [];
  /** @type {string|null} */
  let head = null;
  /** @type {string|null} */
  let lastMotif = null;
  /** @type {number|null} */
  let prev = null;
  const F = { events: C.events, len: 0, strong: STRONG[C.meter] ?? [0], scale: C.scale, register: C.register };

  /** Pick a motif for a kind of phrase. @param {string} kind */
  const motifFor = (kind) => {
    const roles = pools[kind] ?? [kind];
    /** @type {Record<string, number>} */
    const w = {};
    for (const [id, m] of motifs) {
      const mr = /** @type {any} */ (m).role;
      const i = roles.indexOf(mr);
      if (i < 0) continue;
      w[id] = (i === 0 ? 1 : 0.5) * (id === lastMotif ? 0.3 : 1);
    }
    return pickWeighted(w, r) ?? (motifs[0]?.[0] ?? null);
  };

  C.sections.forEach((s, si) => {
    const L = s.len;
    F.len = L;
    const base = C.offsets[si];
    /** @type {MNote[]} */
    const local = [];
    const put = (/** @type {MNote[]} */ ns, /** @type {number} */ at) => { for (const n of ns) local.push({ ...n, t: n.t + at }); };
    if (s.phrase < 0) {
      // The coda: each chord of the ending, held, on the tone nearest the note before.
      s.events.forEach((e, k) => {
        const end = k + 1 < s.events.length ? s.events[k + 1].t : s.bars * L;
        const deg = goalDegree(C, e, prev, k === s.events.length - 1, r);
        local.push({ t: e.t, d: end - e.t, deg, job: 'goal', fermata: e.fermata });
        prev = deg;
      });
      for (const n of local) out.push({ ...n, t: n.t + base });
      return;
    }
    const ph = C.plan[s.phrase];
    const kind = roleKind(ph.role);
    const goalBars = C.span;
    const dir = ph.tension[1] >= ph.tension[0] ? 1 : -1;
    /** @type {string[]} */
    const used = [];
    let bar = 0;
    /** @type {string|null} */
    let motifId = null;
    /** @type {Cell|null} */
    let src = null;
    // A return: the melody of the phrase it restates, for the bars it keeps.
    if (ph.from !== undefined && byPhrase[ph.from]?.length) {
      const keepBars = Math.min((ph.keep ?? 2) * C.span, s.bars - goalBars);
      const end = keepBars * L;
      for (const n of byPhrase[ph.from]) if (n.t < end) local.push({ ...n, d: Math.min(n.d, end - n.t), job: n.job === 'goal' ? 'goal' : 'return' });
      bar = keepBars;
      motifId = phrases[ph.from].motif;
      src = motifId ? cells[motifId] : null;
      used.push('return');
      const last = local[local.length - 1];
      if (last) prev = last.deg;
    }
    while (bar < s.bars - goalBars) {
      const room = s.bars - goalBars - bar;
      /** @type {Cell|null} */
      let cell = null;
      let tech = '';
      if (!src) {
        // The phrase's opening: a motif for its role; a climbing phrase often develops the piece's head motif.
        if (kind === 'climbing' && head && r.next() < (M.headDevelop ?? 0.5)) {
          motifId = head;
          tech = r.next() < 0.6 ? 'sequence' : 'inversion';
          cell = TECHNIQUES[tech](cells[head], L, r, { dir, maxBars: room });
        } else {
          motifId = motifFor(kind);
          tech = 'motif';
          cell = motifId ? structuredClone(cells[motifId]) : null;
        }
        if (motifId && !head) head = motifId;
        src = motifId ? cells[motifId] : null;
        lastMotif = motifId;
      } else {
        // A written line or figure under this bar may call for its own motif (the sus turn).
        const fig = s.figures[bar];
        const over = fig ? motifs.find(([, m]) => /** @type {any} */ (m).over?.includes(fig)) : undefined;
        if (over && r.next() < (M.overChance ?? 0.7)) {
          tech = 'motif';
          cell = structuredClone(cells[over[0]]);
        } else {
          tech = pickWeighted(C.weights, r) ?? 'return';
          cell = TECHNIQUES[tech]?.(src, L, r, { dir, maxBars: room }) ?? null;
        }
      }
      if (cell && cell.bars > room) { tech = 'fragment'; cell = src ? TECHNIQUES.fragment(src, L, r, { dir, maxBars: room }) : null; }
      if (!cell || !cell.notes.length || cell.bars > room) { tech = 'hold'; cell = holdCell(L, prev ?? 2); }
      anchor(C, cell, prev);
      put(cell.notes, bar * L);
      used.push(tech);
      prev = cell.notes[cell.notes.length - 1].deg;
      bar += cell.bars;
    }
    // Nothing sounds over the goal bar but the goal.
    const gt = (s.bars - goalBars) * L;
    for (let i = local.length - 1; i >= 0; i--) {
      const n = local[i];
      if (n.t >= gt) local.splice(i, 1);
      else if (n.t + n.d > gt) n.d = gt - n.t;
    }
    // Fit the phrase so far, so the goal is chosen from the note that will sound before it.
    const fitted = fitMelody(local.map((n) => ({ ...n, t: n.t + base })), F);
    local.length = 0;
    for (const n of fitted) local.push({ ...n, t: n.t - base });
    if (local.length) prev = local[local.length - 1].deg;
    const last = s.phrase === C.plan.length - 1;
    const ge = C.events.filter((e) => e.t <= base + gt).pop() ?? C.events[0];
    const goal = goalDegree(C, ge, prev, last, r);
    // Reached by step: a held note before a leap gives up its last eighth to a passing tone.
    const before = local[local.length - 1];
    if (before && Math.abs(before.deg - goal) > 2 && before.d >= 2 && before.t + before.d === gt) {
      before.d -= 1;
      local.push({ t: gt - 1, d: 1, deg: goal + (before.deg > goal ? 1 : -1), job: 'passing' });
    }
    const breath = M.breath?.[C.meter] ?? 1;
    local.push({ t: gt, d: goalBars * L - breath, deg: goal, job: 'goal' });
    prev = goal;
    byPhrase[s.phrase] = local.map((n) => ({ ...n }));
    phrases.push({ motif: motifId, techniques: used });
    for (const n of local) out.push({ ...n, t: n.t + base });
  });
  F.len = C.sections[0]?.len ?? 8;
  return { notes: fitMelody(out, F), phrases };
}
