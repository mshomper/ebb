// @ts-check
// The camp's fire, run for tools/determinism.html (docs/future/13 sections 3.5 and 3.6, CP-11): the
// fire is worked out from the clock, so a fire watched hour by hour (settled on every hourly tick,
// as live play does) and the same fire read straight from its saved numbers after a catch-up (a
// night's rest, a week away) must agree at every hour, on the page and in a worker. Pure; runs as a
// worker job (src/core/workers.js) with plain-data arguments.
//   timeline  a seeded month of laying, lighting, feeding and banking, the fire's word every hour
//   ticked    the same month settled on every hour, against the same month read only at the end

import { stream, subSeed } from '../../core/rng.js';
import { noFire, layFire, lightFire, feedFire, bankFire, settleFire, fireAt } from './fire.js';

/** A small text hash (FNV-1a), for comparing whole results. @param {string} s */
function textHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * @param {{ worldSeed: number, camp: any }} a camp: recipes/world/camp.json
 * @returns {{ timeline: number, ticked: number, read: number, lightings: number, litDays: number, hours: number }}
 */
export function campCheckJob(a) {
  const F = a.camp.fire;
  const rnd = stream(subSeed(a.worldSeed >>> 0, 'camp-check'));
  const HOURS = 24 * 30;
  /** What the player did, at fractional hours: seeded, a month of evenings. @type {{ at: number, op: string }[]} */
  const ops = [{ at: 2.5, op: 'lay' }];
  for (let day = 0; day < 30; day++) {
    if (rnd.next() < 0.7) ops.push({ at: day * 24 + 18 + rnd.next() * 2, op: 'light' });
    if (rnd.next() < 0.5) ops.push({ at: day * 24 + 20.5 + rnd.next(), op: 'feed' });
    if (rnd.next() < 0.6) ops.push({ at: day * 24 + 22 + rnd.next(), op: 'bank' });
  }
  ops.sort((x, y) => x.at - y.at);
  /** @param {import('./fire.js').Fire} f @param {string} op @param {number} h */
  const apply = (f, op, h) => op === 'lay' ? layFire(f, h) : op === 'light' ? lightFire(f, h, F) ?? f : op === 'feed' ? feedFire(f, h, F) ?? f : bankFire(f, h, F);

  // Watched: every action as it comes, and the fire settled on each hourly tick between.
  let watched = noFire(), next = 0;
  const words = [];
  for (let h = 0; h < HOURS; h++) {
    while (next < ops.length && ops[next].at < h + 1) { watched = apply(settleFire(watched, ops[next].at, F), ops[next].op, ops[next].at); next++; }
    watched = settleFire(watched, h + 1, F);
    words.push(fireAt(watched, h + 1, F).word);
  }
  // Away: the same actions with no ticks between, read only at each hour afterwards.
  let away = noFire();
  for (const o of ops) away = apply(away, o.op, o.at);
  const readWords = [];
  for (let h = 0; h < HOURS; h++) {
    // Before the last action, read the fire as it then stood.
    let f = noFire();
    for (const o of ops) { if (o.at >= h + 1) break; f = apply(f, o.op, o.at); }
    readWords.push(fireAt(f, h + 1, F).word);
  }
  return { timeline: textHash(words.join(',')), ticked: textHash(JSON.stringify(watched)), read: textHash(readWords.join(',')),
    lightings: away.lightings, litDays: away.litDays, hours: HOURS };
}
