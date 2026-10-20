// @ts-check
// The development engine (doc 24, "The development engine"): grows a piece from a season's
// authored material by rules. Phase 4a grows the harmony: a form template, then a walk through the
// season's chord grammar, judged across many candidates. The result is an ordinary piece file
// (develop/piece.js) that the realizer plays like any anchor, and its name comes from the composer
// (names.js), and since phase 4b most pieces also sing a melody grown from the season's motifs
// (song.js). The same material, rules, season, slot, weather and seed always give the same piece
// and the same name, so a grown piece can be found again (and later hearted).
//
//   grow(seed) ─→ template (plan.js) ─→ 24 candidates: phrases + harmony walk (harmony.js)
//              ─→ judge each (judge.js) ─→ best few, one chosen by the seed ─→ piece (piece.js)

import { stream, hash32 } from '../../../core/rng.js';
import { pieceName } from '../names.js';
import { fittingTemplates, planPhrases, pickWeighted } from './plan.js';
import { walk, changes } from './harmony.js';
import { judgeHarmony } from './judge.js';
import { writePiece } from './piece.js';
import { growSong } from './song.js';

/** @param {string} s */
function strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = hash32(h, s.charCodeAt(i));
  return h;
}

/**
 * @typedef {Object} GrowWhere
 * @property {string} slot     'morning' | 'interlude' | 'evening' | 'nocturne'
 * @property {string} [weather]  'clear' | 'cloud' | 'rain' | 'mist'
 * @property {number} seed
 * @property {boolean} [melody]  sing (true) or not (false) whatever the chance (the lab)
 */

/**
 * Grow one piece.
 * @param {any} material recipes/music/material/<season>.json
 * @param {any} rules recipes/music/develop.json
 * @param {GrowWhere} where
 * @param {any} [names] recipes/music/names.json (for the title)
 * @returns {{piece: any, candidates: {seed: number, total: number, banned: boolean, terms: Record<string, number>, chords: string[]}[], chosen: number}}
 */
export function grow(material, rules, where, names) {
  const seed = where.seed >>> 0;
  const weather = where.weather ?? 'clear';
  const r = stream(seed, 0x6476, strHash(`${material.season}:${where.slot}:${weather}`));
  const templates = fittingTemplates(material, { slot: where.slot, weather });
  const template = pickWeighted(templates, r) ?? Object.keys(material.templates)[0];
  const meter = pickWeighted(material.meters, r) ?? '4/4';
  // Tempo from the season's band, scaled by the template (rain and mist go slower).
  // A season may give each slot its own band (summer's mornings lift, its evenings settle).
  const band = Array.isArray(material.tempo) ? material.tempo : (material.tempo[where.slot] ?? material.tempo.default);
  const [t0, t1] = band;
  const ts = material.templates[template]?.tempoScale ?? 1;
  const lo = Math.round((t0 + (t1 - t0) * r.next() * 0.6) * ts);
  /** @type {[number, number]} */
  const tempo = [lo, Math.round(Math.min(t1 * ts, lo + 6))];

  const n = Math.max(1, rules.candidates ?? 24);
  const cands = [];
  for (let k = 0; k < n; k++) {
    const cr = stream(seed, 0x6376, k, strHash(`${material.season}:${where.slot}:${weather}:${template}`));
    const plan = planPhrases(material, rules, template, cr);
    const walked = walk(material, rules, plan, cr, { meter });
    const judged = judgeHarmony(material, rules, walked);
    cands.push({ k, plan, walked, judged });
  }
  // Best first; ties keep candidate order, so the ranking is the same everywhere.
  const ranked = [...cands].sort((a, b) => (b.judged.total - a.judged.total) || (a.k - b.k));
  const pool = ranked.filter((c) => c.judged.total > -Infinity).slice(0, Math.max(1, rules.keepBest ?? 4));
  const chosen = (pool.length ? pool : ranked)[r.int(Math.max(1, pool.length))];

  // The ending: weighted, and unlikely to repeat the last phrase's cadence type.
  const lastCad = chosen.plan[chosen.plan.length - 1].cadence;
  const E = rules.endings ?? {};
  /** @type {Record<string, number>} */
  const ew = {};
  for (const [id, e] of Object.entries(material.endings ?? {})) {
    ew[id] = /** @type {any} */ (e).weight * (E.weights?.[id] ?? 1) * (/** @type {any} */ (e).type === lastCad ? (E.sameAsCadence ?? 0.25) : 1)
      * (/** @type {any} */ (e).borrowed ? (rules.harmony?.borrowedAmount ?? 1) : 1);
  }
  const endingId = pickWeighted(ew, r) ?? Object.keys(material.endings ?? {})[0];
  const ending = { id: endingId, ...material.endings[endingId] };

  // The instruments: the material's palette for this weather or slot, one of its weighted choices
  // (summer's electric piano takes some mornings); a material without palettes keeps the default.
  const P = material.palettes;
  const choices = P ? (P[weather !== 'clear' && weather !== 'cloud' ? weather : ''] ?? P[where.slot] ?? P.default) : null;
  /** @type {any} */
  let palette = undefined;
  if (Array.isArray(choices) && choices.length) {
    /** @type {Record<string, number>} */
    const pw = {};
    choices.forEach((c, i) => { pw[String(i)] = c.weight ?? 1; });
    const { weight: _w, ...pick } = choices[Number(pickWeighted(pw, r) ?? 0)];
    palette = pick;
  }

  const title = names ? pieceName(seed, { season: material.season, slot: where.slot }, names) : `Grown ${where.slot} ${seed}`;
  const span = material.harmonicBars?.[meter] ?? 1;
  const report = {
    span,
    plan: chosen.plan,
    bars: chosen.walked.bars.map((b) => ({ phrase: b.phrase, target: b.target, held: b.held, cadence: b.cadence, kept: !!b.kept, figure: b.figure ?? null,
      chords: b.chords.map((c) => ({ place: c.place, symbol: c.symbol, at: c.at, color: c.color, tension: material.chords[c.place].tension })) })),
    judged: chosen.judged,
    ending,
    rank: ranked.indexOf(chosen) + 1,
  };
  // The melody (phase 4b), from its own streams, so everything above is the same with or without it.
  const song = growSong(material, rules, {
    walked: chosen.walked, plan: chosen.plan, meter, ending, slot: where.slot, weather, seed, palette,
    salt: strHash(`melody:${material.season}:${where.slot}:${weather}`), force: where.melody,
  });
  if (song) /** @type {any} */ (report).melody = song.report;
  const piece = writePiece(material, chosen.walked, chosen.plan, {
    id: `grown-${material.season}-${where.slot}-${seed}`, title, slot: where.slot, weather, meter, tempo, template, seed, report, ending,
    palette: song ? song.palette : palette, abc: song?.abc,
  });
  return {
    piece,
    candidates: ranked.map((c) => ({ seed: c.k, total: c.judged.total, banned: c.judged.banned, terms: c.judged.terms, chords: changes(c.walked.bars) })),
    chosen: ranked.indexOf(chosen),
  };
}
