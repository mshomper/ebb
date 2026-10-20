// @ts-check
// The development engine, phase 4b: gives a grown piece its melody (doc 24, "How a melody is
// grown"). Most pieces sing (develop.json melody.chance, per slot and weather); the rest stay
// chords and bed, as in 4a. Many melodies are grown over the chosen harmony (melody.js), each is
// judged (critic.js), and the seed chooses among the best few. In summer the nylon guitar may take
// the melody (material melody.guitarLead, its bright ff layer), or, now and then, a counter-line
// under the piano's (melody.counter.chance, counter.js); a strummed piece leaves the guitar to its
// strum.
//
// Everything here draws from its own seeded streams, after the harmony is chosen, so a piece's
// chords, form, ending, instruments and name are the same with or without its melody: a hearted
// piece keeps them and gains (or not) a tune.

import { stream } from '../../../core/rng.js';
import { sectionTimelines, homeScale } from './timeline.js';
import { growMelodyOnce, STRONG } from './melody.js';
import { judgeMelody } from './critic.js';
import { counterLine } from './counter.js';
import { sectionAbc } from './abc-write.js';

const DEFAULT_PALETTE = { melody: ['piano'], accomp: ['piano'], bed: ['strings', 'pad'] };

/** @param {any} table @param {string} slot @param {string} weather @param {any} fallback */
const bySlot = (table, slot, weather, fallback) => table?.[weather] ?? table?.[slot] ?? table?.default ?? fallback;

/**
 * @param {any} material @param {any} rules recipes/music/develop.json
 * @param {{walked: any, plan: import('./plan.js').PhrasePlan[], meter: string, ending: any, slot: string, weather: string, seed: number, salt: number, palette?: any, force?: boolean}} o
 *   salt: a hash of the season, slot and weather (as the harmony's streams use); force: true or
 *   false to sing or not regardless of the chance (the lab)
 * @returns {null | {abc: Record<string, string>, palette: any, report: any}}
 */
export function growSong(material, rules, o) {
  const M = rules.melody ?? {};
  const mr = stream(o.seed, 0x6d6c, o.salt);
  const coin = mr.next(), leadCoin = mr.next(), counterCoin = mr.next();
  const chance = bySlot(M.chance, o.slot, o.weather, 0);
  if (!material.motifs || !Object.keys(material.motifs).length) return null;
  if (!(o.force ?? coin < chance)) return null;

  const sections = sectionTimelines(material, o.walked, o.plan, o.meter, o.ending);
  /** @type {number[]} */
  const offsets = [];
  let at = 0;
  for (const s of sections) { offsets.push(at); at += s.bars * s.len; }
  const events = sections.flatMap((s, i) => s.events.map((e) => ({ ...e, t: e.t + offsets[i] })));
  const scale = homeScale(material.home);
  const night = o.slot === 'evening' || o.slot === 'nocturne';
  /** @type {Record<string, number>} */
  const weights = {};
  const leanS = M.lean?.[o.slot] ?? {}, leanW = M.lean?.[o.weather] ?? {};
  for (const [k, w] of Object.entries(M.techniques ?? { return: 1 })) weights[k] = /** @type {number} */ (w) * (leanS[k] ?? 1) * (leanW[k] ?? 1);
  const C = {
    sections, plan: o.plan, meter: o.meter, span: material.harmonicBars?.[o.meter] ?? 1,
    register: /** @type {[number, number]} */ (bySlot(M.register, o.slot, o.weather, [60, 77])),
    weights, scale, events, offsets,
  };
  const phraseSpans = /** @type {[number, number, [number, number]][]} */ (sections.filter((s) => s.phrase >= 0)
    .map((s) => [offsets[sections.indexOf(s)], offsets[sections.indexOf(s)] + s.bars * s.len, o.plan[s.phrase].tension]));

  const n = Math.max(1, M.candidates ?? 12);
  const cands = [];
  for (let k = 0; k < n; k++) {
    const g = growMelodyOnce(material, M, C, stream(o.seed, 0x6d63, k, o.salt));
    const judged = judgeMelody(g.notes, { scale, events, phraseSpans, night }, M.score ?? {});
    cands.push({ k, g, judged });
  }
  const ranked = [...cands].sort((a, b) => (b.judged.total - a.judged.total) || (a.k - b.k));
  const pool = ranked.slice(0, Math.max(1, M.keepBest ?? 3));
  const chosen = pool[mr.int(pool.length)];
  const mel = chosen.g.notes;

  // The guitar: the melody, or a counter-line under the piano's, never while it strums.
  let palette = o.palette ?? DEFAULT_PALETTE;
  const strum = !!palette.strum?.length;
  const lead = !strum && palette.melody?.[0] === 'piano' && leadCoin < (material.melody?.guitarLead?.[o.slot] ?? 0);
  if (lead) palette = { ...palette, melody: [material.melody.leadInstrument ?? 'guitar'] };
  const counterInst = palette.counter ?? material.melody?.counter ?? null;
  const withCounter = !strum && !lead && !!counterInst?.length && counterCoin < (M.counter?.chance ?? 0);
  if (withCounter) palette = { ...palette, counter: counterInst };
  const counter = withCounter
    ? counterLine(mel, { scale, events, len: sections[0].len, meter: o.meter, phrases: sections.filter((s) => s.phrase >= 0).map((s) => ({ start: offsets[sections.indexOf(s)], end: offsets[sections.indexOf(s)] + s.bars * s.len, role: o.plan[s.phrase].role })) }, M.counter ?? {}, stream(o.seed, 0x6374, o.salt))
    : [];

  const dyn = bySlot(M.dynamics, o.slot, o.weather, 'mp');
  /** @type {Record<string, string>} */
  const abc = {};
  sections.forEach((s, i) => {
    const a = offsets[i], b = a + s.bars * s.len;
    const local = (/** @type {{t: number, d: number}} */ x) => x.t >= a && x.t < b;
    const m = mel.filter(local).map((x) => ({ t: x.t - a, d: Math.min(x.d, b - x.t), midi: scale.midi(x.deg), fermata: x.fermata }));
    const c = counter.filter(local).map((x) => ({ t: x.t - a, d: Math.min(x.d, b - x.t), midi: x.midi }));
    abc[s.name] = sectionAbc(o.meter, material.home, s, m, c, i === 0 ? dyn : null);
  });

  const report = {
    notes: mel.map((x) => ({ t: x.t, d: x.d, midi: scale.midi(x.deg), job: x.job })),
    counter,
    chords: events.map((e) => ({ t: e.t, symbol: e.symbol, pcs: e.pcs })),
    phrases: chosen.g.phrases,
    judged: chosen.judged,
    candidates: ranked.map((c) => ({ k: c.k, total: c.judged.total })),
    chosen: ranked.indexOf(chosen),
    keep: pool.length,
    lead, withCounter, strong: STRONG[o.meter] ?? [0], len: sections[0].len, total: at,
  };
  return { abc, palette, report };
}
