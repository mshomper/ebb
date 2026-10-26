// @ts-check
// The camp's fire, run for tools/determinism.html (docs/future/13 sections 3.5 and 3.6, CP-11): the
// fire is worked out from the clock, so a fire watched hour by hour (settled on every hourly tick,
// as live play does) and the same fire read straight from its saved numbers after a catch-up (a
// night's rest, a week away) must agree at every hour, on the page and in a worker. Pure; runs as a
// worker job (src/core/workers.js) with plain-data arguments.
//   timeline  a seeded month of laying, lighting, feeding and banking, the fire's word every hour
//   ticked    the same month settled on every hour, against the same month read only at the end
//   rack, hamper  the keeps (S2, P2j): a month of bunches hung and handfuls stored, the rack's
//             drying words watched hourly against read from the save
//   nights, work  fire products (P2i): the dawns that leave charcoal and ash, and willow charcoal's
//             done hours, watched hourly against the same month with no ticks between
//   clay, star  clay firing (S5): each piece's done hour and where the fired pieces stand at the
//             end, and the star's burnt logs (S4), watched hourly against catch-up

import { stream, subSeed } from '../../core/rng.js';
import { noFire, layFire, lightFire, feedFire, bankFire, settleFire, fireAt, fireNights } from './fire.js';
import { cleanWork, layWork, workDone, withFire } from './work.js';
import { hang, takeBunch, dryShare, rackWord, cleanBunches } from '../pack/piles.js';
import { put, take, takeSlot, slotsOf, capOf, cleanHolds } from '../pack/store.js';
import { cleanCamp, layRing } from './model.js';
import { setHearth, placeFired, potOnHearth } from './pots.js';
import { burntM } from './star.js';

/** A small text hash (FNV-1a), for comparing whole results. @param {string} s */
function textHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * @param {{ worldSeed: number, camp: any, pack?: any }} a camp: recipes/world/camp.json; pack: recipes/world/pack.json (the keeps)
 * @returns {{ timeline: number, ticked: number, read: number, lightings: number, litDays: number, hours: number,
 *   rack?: number, rackRead?: number, hamper?: number, bunches?: number, kinds?: number }}
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
    lightings: away.lightings, litDays: away.litDays, hours: HOURS, ...(a.pack ? keepsCheck(a, HOURS) : {}), ...productsCheck(ops, apply, F, HOURS, a.worldSeed),
    ...(a.camp.hearth && a.camp.star ? clayCheck(ops, apply, F, a.camp, HOURS, a.worldSeed) : {}) };
}

/**
 * Fire products (P2i): the same month's fire-nights, and willow charcoal laid at the fire every few
 * evenings, watched hour by hour (every change and every hourly settle going through withFire) against
 * the same month with no ticks between (catch-up). The dawns that leave charcoal and the hour each
 * piece of work is done must match. @param {{ at: number, op: string }[]} ops
 * @param {(f: any, op: string, h: number) => any} apply @param {any} F @param {number} HOURS @param {number} worldSeed
 */
function productsCheck(ops, apply, F, HOURS, worldSeed) {
  const rnd = stream(subSeed(worldSeed >>> 0, 'work-check'));
  const make = { id: 'willow-charcoal', needH: 8, gives: 'charcoal-sticks', count: 3 };
  const lays = [];
  for (let day = 0; day < 30; day++) if (rnd.next() < 0.3) lays.push(day * 24 + 17 + rnd.next());
  /** Every hour's dawn charcoal and each piece's done hour, for one camp run. @param {boolean} ticked */
  const run = (ticked) => {
    let c = { fire: noFire(), work: /** @type {any[]} */ ([]) };
    const events = [...ops.map((o) => ({ ...o })), ...lays.map((at) => ({ at, op: 'work' }))].sort((x, y) => x.at - y.at);
    const dawns = [], done = new Map();
    let next = 0;
    for (let h = 0; h < HOURS; h++) {
      while (next < events.length && events[next].at < h + 1) {
        const e = events[next++];
        c = e.op === 'work' ? { ...c, work: layWork(cleanWork(c.work), make, e.at) } : withFire(c, apply(c.fire, e.op, e.at), e.at, F);
      }
      if (ticked) c = withFire(c, settleFire(c.fire, h + 1, F), h + 1, F);
      if ((h + 1) % 24 === 6) dawns.push(fireNights(c.fire, h + 1, F).includes(Math.floor((h + 1) / 24)) ? 1 : 0);
      c.work.forEach((p, i) => { if (!done.has(i) && workDone(p, c.fire, h + 1, F)) done.set(i, h + 1); });
    }
    return { dawns: dawns.join(''), done: [...done.entries()].sort((x, y) => x[0] - y[0]).map(([, h]) => h).join(',') };
  };
  const watched = run(true), read = run(false);
  return { nights: textHash(watched.dawns), nightsRead: textHash(read.dawns), fireNights: [...watched.dawns].filter((d) => d === '1').length,
    work: textHash(watched.done), workRead: textHash(read.done), workDone: watched.done ? watched.done.split(',').length : 0 };
}

/**
 * Clay firing and the star (S4, S5): the cooking pot, the tea pot, the cup and a bowl laid at the
 * fire on seeded evenings, each fired after needH hours of fire, lit or banked. Watched hour by hour
 * (every change through withFire, the clock settling the fire each hour, fired pieces leaving for
 * their slots as soon as they are done, as hearth.js does) against the same month with no ticks
 * between and everything done settled once at the end (a return from time away). The hour each piece
 * is done, the camp's slots and hearth pot at the end, and the star's burnt length each hour must
 * match. @param {{ at: number, op: string }[]} ops @param {(f: any, op: string, h: number) => any} apply
 * @param {any} F @param {any} A recipes/world/camp.json @param {number} HOURS @param {number} worldSeed
 */
function clayCheck(ops, apply, F, A, HOURS, worldSeed) {
  const rnd = stream(subSeed(worldSeed >>> 0, 'clay-check'));
  const kinds = ['cooking-pot', 'tea-pot', 'cup', 'bowl'], H = A.hearth;
  const lays = kinds.map((kind, i) => ({ at: (3 + i * 5) * 24 + 16 + rnd.next() * 3, op: 'clay', kind }));
  /** @param {boolean} ticked */
  const run = (ticked) => {
    /** @type {any} */ let c = setHearth(layRing(cleanCamp(null), 2, 7), 2.4, 11, H);
    const events = [...ops.map((o) => ({ ...o, kind: '' })), ...lays].sort((x, y) => x.at - y.at);
    const done = new Map(), burnt = [];
    /** Done pieces off the list, pots and the cup to their slots (a bowl waits to be taken up). @param {number} h */
    const settle = (h) => {
      for (const p of c.work.filter((/** @type {any} */ q) => workDone(q, c.fire, h, F))) {
        if (H.slots[p.gives]) c = placeFired({ ...c, work: c.work.filter((/** @type {any} */ q) => q !== p) }, p.gives, h, 50 + kinds.indexOf(p.gives), H);
      }
    };
    let next = 0;
    for (let h = 0; h < HOURS; h++) {
      while (next < events.length && events[next].at < h + 1) {
        const e = events[next++];
        c = e.op === 'clay' ? { ...c, work: layWork(cleanWork(c.work), { id: `fire-${e.kind}`, needH: 8, gives: e.kind, count: 1 }, e.at) } : withFire(c, apply(c.fire, e.op, e.at), e.at, F);
      }
      if (ticked) c = withFire(c, settleFire(c.fire, h + 1, F), h + 1, F);
      // Each piece's done hour as it stands now (no tick needed: worked out from the clock).
      for (const p of c.work) if (!done.has(p.gives) && workDone(p, c.fire, h + 1, F)) done.set(p.gives, h + 1);
      if (ticked) settle(h + 1);
      burnt.push(burntM(fireAt(c.fire, h + 1, F), c.fire, h + 1, F, A.star).toFixed(6));
    }
    // Catch-up comes back to the camp: whatever is done goes to its place now.
    if (!ticked) settle(HOURS);
    const slots = c.slots.map((/** @type {any} */ s) => `${s.slot}:${s.kind}`).sort().join('|');
    return { done: [...done.entries()].sort().map(([k, h]) => `${k}@${h}`).join(','), end: `${slots}#${potOnHearth(c)}`, burnt: burnt.join(',') };
  };
  const watched = run(true), read = run(false);
  return { clay: textHash(watched.done), clayRead: textHash(read.done), clayEnd: textHash(watched.end), clayEndRead: textHash(read.end),
    star: textHash(watched.burnt), starRead: textHash(read.burnt), clayDone: watched.done ? watched.done.split(',').length : 0 };
}

/**
 * The keeps (S2, P2j): a seeded month of herbs hung on the rack and taken down, and handfuls put in
 * the hamper and taken out (two hampers from day 10). The rack's words every hour as play watches
 * them must match the same rack read from its saved bunches afterwards: drying is worked out from
 * the hour each bunch was hung. @param {{ worldSeed: number, camp: any, pack: any }} a @param {number} HOURS
 */
function keepsCheck(a, HOURS) {
  const P = a.pack, R = a.camp.rack;
  const rnd = stream(subSeed(a.worldSeed >>> 0, 'keeps-check'));
  const herbs = ['watermint.leaves', 'chamomile.flowers', 'nettle.tops'], things = ['kelp', 'shells', 'sand', 'rushes.stems', 'clay', 'wrack', 'crushed-shell'];
  /** @type {import('../pack/piles.js').Bunches} */ let bunches = [];
  /** @type {import('../pack/store.js').Holds} */ let holds = [];
  /** @type {{ at: number, bunches: import('../pack/piles.js').Bunches }[]} */ const saved = [];
  const words = [];
  for (let h = 0; h < HOURS; h++) {
    if (rnd.next() < 0.08) bunches = hang(bunches, herbs[Math.floor(rnd.next() * herbs.length)], 1 + Math.floor(rnd.next() * 3), h + rnd.next(), P.piles.rackHandfuls, P.piles.rackBunches).bunches;
    if (rnd.next() < 0.03 && bunches.length) bunches = takeBunch(bunches, Math.floor(rnd.next() * bunches.length), P.handfulsPerPouch).bunches;
    const slots = slotsOf(h >= 240 ? 2 : 1, P);
    if (rnd.next() < 0.1) holds = put(holds, things[Math.floor(rnd.next() * things.length)], 1 + Math.floor(rnd.next() * 3), capOf(P), slots).holds;
    if (rnd.next() < 0.05 && holds.length) holds = takeSlot(holds, Math.floor(rnd.next() * holds.length), P.handfulsPerPouch).holds;
    if (rnd.next() < 0.05) holds = take(holds, things[Math.floor(rnd.next() * things.length)], 1).holds;
    words.push(bunches.map(([, , at]) => rackWord(dryShare(at, h + 1, R.dryDays), P.words.rack)).join('|'));
    saved.push({ at: h + 1, bunches: cleanBunches(JSON.parse(JSON.stringify(bunches))) });
  }
  // Read later: each hour's saved rack, read only from its numbers.
  const read = saved.map((s) => s.bunches.map(([, , at]) => rackWord(dryShare(at, s.at, R.dryDays), P.words.rack)).join('|'));
  return { rack: textHash(words.join(',')), rackRead: textHash(read.join(',')), hamper: textHash(JSON.stringify(cleanHolds(holds))),
    bunches: bunches.length, kinds: holds.length };
}
