// @ts-check
// The trust-with-treats check for tools/determinism.html (P2h): a seeded month of live play by three
// frogs and a school of minnows (quiet watching, meals, treats, a second treat some days) applied two
// ways, each game hour as the tick does and all at once as one late tick, plus a month of treats set
// out and fading, read hour by hour and only from the save at the end. Run on the page and in a
// worker; every way must give the same numbers. Pure and worker-safe.

import { hash32, stream, subSeed } from '../../core/rng.js';
import { HOURS_PER_DAY } from '../../core/clock.js';
import { applyTrust } from './trust.js';
import { applySwarmTrust } from './swarms.js';
import { lyingAt, paleOf } from './treat-rules.js';

/** A number as a stable integer for hashing (four places, as trust is kept). @param {number} v */
const q = (v) => Math.round(v * 10000) | 0;

/**
 * @param {{ worldSeed: number, frog: any, minnow: any, treats: any, days?: number }} a
 *   frog, minnow: the species recipes; treats: recipes/world/treats.json
 */
export function treatCheckJob(a) {
  const days = a.days ?? 30, P = a.frog.presence, M = a.minnow.presence, T = a.treats;
  const rng = stream(subSeed(a.worldSeed, 'treat-check'), 1);
  /** Each hour's events, frogs then the school. @type {{ f: any[], s: any[] }[]} */
  const hours = [];
  for (let h = 0; h < days * HOURS_PER_DAY; h++) {
    const f = [], s = [];
    const hod = h % HOURS_PER_DAY;
    if (hod >= 8 && hod < 20) {
      for (let id = 1; id <= 3; id++) {
        if (rng.next() < 0.25) f.push({ kind: 'watched', id, minutes: Math.round(rng.next() * 1000) / 100, hour: h });
        if (rng.next() < 0.05) f.push({ kind: 'fed', id, hour: h });
        if (rng.next() < 0.06) f.push({ kind: 'treat', id, hour: h, treat: 'wrack' });
      }
      if (rng.next() < 0.25) s.push({ kind: 'watched', minutes: Math.round(rng.next() * 1000) / 100, hour: h });
      if (rng.next() < 0.05) s.push({ kind: 'fed', hour: h });
      if (rng.next() < 0.06) s.push({ kind: 'treat', hour: h, treat: 'leaf-pack' });
    }
    hours.push({ f, s });
  }
  const frogs = () => ({ frogs: [1, 2, 3].map((id) => ({ id, x: id, z: 0, trust: 0 })), pending: /** @type {any[]} */ ([]) });

  // Each hour, as the tick applies them.
  const fr = frogs(), S = /** @type {any} */ ({ trust: 0 });
  let timeline = 0;
  for (const h of hours) {
    fr.pending = h.f; applyTrust(fr, P, 0, a.frog.feed?.fullH ?? 6);
    S.pending = h.s; applySwarmTrust(S, M, 'minnows');
    timeline = hash32(timeline, ...fr.frogs.map((g) => q(g.trust)), q(S.trust ?? 0));
  }
  const each = hash32(...fr.frogs.map((g) => q(g.trust)), ...fr.frogs.map((g) => g.treatDay ?? -1), q(S.trust ?? 0), S.treatDay ?? -1);
  // The frogs again, all at once, as one late tick would (each event is rounded as it lands, so the
  // cut of the hours cannot matter; a school rounds once an hour, so it is checked hour by hour only).
  const frogsEach = hash32(...fr.frogs.map((g) => q(g.trust)), ...fr.frogs.map((g) => g.treatDay ?? -1));
  const fr2 = frogs();
  fr2.pending = hours.flatMap((h) => h.f); applyTrust(fr2, P, 0, a.frog.feed?.fullH ?? 6);
  const once = hash32(...fr2.frogs.map((g) => q(g.trust)), ...fr2.frogs.map((g) => g.treatDay ?? -1));

  // Treats set out and fading: one set out each morning, some days two; what lies and how pale,
  // hour by hour as you watch, against the same hours read afterwards from the saved list alone.
  const rng2 = stream(subSeed(a.worldSeed, 'treat-check'), 2);
  /** @type {any[]} */ const saved = [];
  let watched = 0, read = 0, tid = 0;
  /** @param {number} h */
  const lying = (h) => lyingAt(saved, h + 0.5, T).filter((t) => t[3] <= h + 0.5);
  for (let h = 0; h < days * HOURS_PER_DAY; h++) {
    if (h % HOURS_PER_DAY === 9 || (h % HOURS_PER_DAY === 15 && rng2.next() < 0.4)) saved.push([rng2.next() < 0.5 ? 'wrack' : 'leaf-pack', 1, 2, h + 0.25, ++tid]);
    const now = lying(h);
    watched = hash32(watched, now.length, ...now.map((t) => q(paleOf(t, h + 0.5, T))));
  }
  for (let h = 0; h < days * HOURS_PER_DAY; h++) {
    const later = lying(h);
    read = hash32(read, later.length, ...later.map((t) => q(paleOf(t, h + 0.5, T))));
  }
  return { each, frogsEach, once, timeline, watched, read, trust: fr.frogs.map((g) => g.trust), school: S.trust ?? 0, set: tid };
}
