// @ts-check
// The field journal's model (docs 13, 15): what the player has come to know about each living
// thing and each kind of ground, and the notes the island writes. Pure, with no DOM, store or
// events, so live play and a later catch-up (S7) build the same journal from the same hours.
//
// observe() looks at the world after each game hour (and after edits) together with that hour's
// tick events: a species is seen once it grows on the island, likes and field notes are learned
// when something shows them (it spreads, flowers, rests for winter, drowns, the Plant tool refuses
// a spot, or the player catches it at a moment), season boxes fill as the year turns, its story is
// kept (when it came, what you planted, its best showing), and short notes mark firsts.
// Page words are in describe.js, the ground in ground.js, the almanac in almanac.js. All words come
// from recipes/world/journal.json ("words") and recipes/world/journal-island.json ("island").

import { STAGE } from '../growth/coarse.js';
import { HABITAT_ORIGIN } from '../growth/habitat.js';
import { openBox } from '../ecology/fields.js';
import { seasonOf, SECONDS_PER_HOUR } from '../../core/clock.js';
import { observeAnimals, measureAnimal, foundFrog, foundSchool, namedFrog } from './creatures.js';

/** Season box bits. */
export const GROW = 1, FLOWER = 2, DORMANT = 4;

/**
 * @typedef {Object} SpeciesKnowledge
 * @property {boolean} seen       growing on the island at the last look
 * @property {boolean} ever       seen at least once
 * @property {string[]} learned   triggers that have happened (seen, spread, dormant, lost:drown, refused:dry, moment:rain, ...)
 * @property {number[]} seasons   per season (spring .. winter): GROW | FLOWER | DORMANT bits seen
 * @property {number[]} counts    plants (or grass share x 1000, or square meters of rushes) at each observed hour, newest last
 * @property {number} flowerYear  the year it last flowered, -1 before
 * @property {boolean} dormant    mostly dormant at the last look
 * @property {number} first       hour first seen, -1 before
 * @property {boolean} arrived    it was here when the journal started
 * @property {number} planted     seeds of it the player has planted
 * @property {number} plantedAt   hour of the first planting, -1 before
 * @property {number} peak        the most there have been (as counts)
 * @property {number} peakAt      hour of that best showing
 * @property {Record<string, number>} moments  moment id to the hour it was caught
 */

/**
 * @typedef {{ hour: number, date: string, text: string, sp: string | null, kind?: string }} Note
 *   kind: what the note is about, shared by every species (arrived, settled, flower, spread,
 *   season, ...); the reveal ranks notes by it (journal.json `reveal.rank`). Older notes have none.
 */

/**
 * @typedef {Object} Journal
 * @property {number} v
 * @property {number} born   hour the journal started
 * @property {number} last   last hour observed
 * @property {Record<string, SpeciesKnowledge>} species  living things and grounds, by id
 * @property {string[]} flags  island-wide things learned (e.g. frogs:settled)
 * @property {Note[]} notes   newest first
 */

/** @param {number} hour @returns {Journal} */
export function initialJournal(hour) {
  return { v: 1, born: hour, last: hour - 1, species: {}, flags: [], notes: [] };
}

/** @returns {SpeciesKnowledge} */
export function blank() {
  return { seen: false, ever: false, learned: [], seasons: [0, 0, 0, 0], counts: [], flowerYear: -1, dormant: false,
    first: -1, arrived: false, planted: 0, plantedAt: -1, peak: 0, peakAt: -1, moments: {} };
}

/** Knowledge of one species, with any fields older journals lack. @param {Journal} j @param {string} sp */
function know(j, sp) {
  const k = j.species[sp];
  if (!k) return (j.species[sp] = blank());
  if (k.moments === undefined) Object.assign(k, { ...blank(), ...k });
  return k;
}

/**
 * "Summer, day 3" (and ", year 2" after the first year) from the seasons state.
 * @param {any} seasons world state.seasons @param {any} words
 */
export function dateText(seasons, words) {
  const s = seasons ?? { index: 0, day: 0, year: 0 };
  const base = `${words.seasonNames[s.index] ?? ''}, day ${s.day + 1}`;
  return s.year > 0 ? `${base}, year ${s.year + 1}` : base;
}

/** The date of a game hour, in words. @param {number} hour @param {any} words */
export const dateOfHour = (hour, words) => dateText(seasonOf(hour * SECONDS_PER_HOUR), words);

/** A square holds a cover plant once its share is above this (a tap names it, it counts toward the page). */
export const COVER_HAS = 0.25;
/** A square is full of a cover plant above this (the wash and Show me go there). */
export const COVER_FULL = 0.5;

/** Does the growth state hold this cover plant's map yet? @param {string} sp @param {any} state */
export const hasCover = (sp, state) => !!(sp === 'grass' ? state?.growth?.grass : state?.growth?.cover?.[sp]);

/**
 * A cover plant's share of one habitat square, 0..1 (0 off the opened island and at sea). Grass is
 * its painted share times its cover (state.growth.grass); the other cover plants (rushes) have
 * their own cover per square (state.growth.cover), which follows the ground alone.
 * @param {string} sp @param {any} state @param {any} hab @param {number} k
 */
export function coverShare(sp, state, hab, k) {
  if (!hab.open[k] || hab.sea[k]) return 0;
  if (sp === 'grass') {
    const g = state?.growth?.grass;
    return g ? (hab.grass[k] * g[k]) / (255 * 255) : 0;
  }
  const c = state?.growth?.cover?.[sp];
  return c ? c[k] / 255 : 0;
}

/**
 * What one species looks like on the island now.
 * @param {string} sp @param {any} state @param {any} hab the habitat (or null) @param {any} rec words.species[sp]
 * @returns {{ count: number, value: number, flowering: number, dormant: number, mature: number, plants: any[], spots?: { x: number, z: number }[] }}
 *   for a cover plant measured by area, spots are the middles of the squares it covers
 */
export function measure(sp, state, hab, rec) {
  if (isAnimal(rec)) return measureAnimal(sp, state, rec);
  if (rec.kind === 'cover') {
    if (!hab || !hasCover(sp, state)) return { count: 0, value: 0, flowering: 0, dormant: 0, mature: 0, plants: [], spots: [] };
    if (rec.amountBy === 'area') {
      // Square meters covered (rushes stand in shallow water, so wet squares count too).
      /** @type {{ x: number, z: number }[]} */ const spots = [];
      // Cover counts only on open squares (coverShare): the opened island's box, in grid order.
      const B = openBox(hab);
      for (let j = B.j0; j <= B.j1; j++) for (let k = j * hab.n + B.i0; k <= j * hab.n + B.i1; k++) {
        if (coverShare(sp, state, hab, k) > COVER_HAS) spots.push({ x: HABITAT_ORIGIN + (k % hab.n) + 0.5, z: HABITAT_ORIGIN + Math.floor(k / hab.n) + 0.5 });
      }
      return { count: spots.length, value: spots.length, flowering: 0, dormant: 0, mature: 0, plants: [], spots };
    }
    let land = 0, covered = 0;
    const B = openBox(hab);
    for (let j = B.j0; j <= B.j1; j++) for (let k = j * hab.n + B.i0; k <= j * hab.n + B.i1; k++) {
      if (!hab.open[k] || hab.sea[k] || hab.depthCm[k] > 0) continue;
      land++;
      if (coverShare(sp, state, hab, k) > COVER_HAS) covered++;
    }
    const share = land ? covered / land : 0;
    return { count: share, value: Math.round(share * 1000), flowering: 0, dormant: 0, mature: 0, plants: [], spots: [] };
  }
  const plants = (state?.growth?.plants ?? []).filter((/** @type {any} */ p) => p.sp === sp);
  let flowering = 0, dormant = 0, mature = 0;
  for (const p of plants) {
    if (p.stage === STAGE.flowering) flowering++;
    if (p.stage === STAGE.dormant) dormant++;
    if (p.stage >= STAGE.mature) mature++;
  }
  return { count: plants.length, value: plants.length, flowering, dormant, mature, plants };
}

/** Is a measured species on the island? @param {any} rec @param {{ count: number }} m */
export const present = (rec, m) => (rec.kind === 'cover' || rec.kind === 'swarm' ? m.count >= rec.amount[0][0] : m.count > 0);

/** Is a page an animal's (frogs, a creature; midges, a swarm)? @param {any} rec words.species[sp] */
export const isAnimal = (rec) => rec?.kind === 'creature' || rec?.kind === 'swarm' || rec?.kind === 'school';

/**
 * Note `kind` for a species, if its words have one.
 * @param {Note[]} out @param {any} rec @param {string} kind @param {string} sp @param {number} hour @param {string} date
 */
function note(out, rec, kind, sp, hour, date) {
  const text = rec.notes?.[kind];
  if (text) out.push({ hour, date, text, sp, kind });
}

/**
 * Learn a trigger for a species. Returns true if it was new.
 * @param {SpeciesKnowledge} k @param {string} trigger
 */
function learnTrigger(k, trigger) {
  if (k.learned.includes(trigger)) return false;
  k.learned.push(trigger);
  return true;
}

/** Copy a journal deep enough to change it. @param {Journal} j @returns {Journal} */
function copy(j) {
  /** @type {Record<string, SpeciesKnowledge>} */ const species = {};
  for (const [sp, k] of Object.entries(j.species)) {
    species[sp] = { ...k, learned: k.learned.slice(), seasons: k.seasons.slice(), counts: k.counts.slice(), moments: { ...(k.moments ?? {}) } };
  }
  return { ...j, species, flags: j.flags.slice(), notes: j.notes.slice() };
}

/**
 * Add new notes to the journal, newest first, keeping words.notesKept.
 * @param {Journal} j @param {Note[]} notes @param {any} words
 */
function keep(j, notes, words) {
  if (!notes.length) return;
  j.notes = [...notes.slice().reverse(), ...j.notes].slice(0, words.notesKept);
}

/**
 * Look at the island after an hour (or an edit) and update the journal.
 * @param {Journal} journal
 * @param {{ state: any, events?: { name: string, payload: any }[], hour: number, habitat: any, words: any }} ctx
 * @returns {{ journal: Journal, notes: Note[] }} the new journal and the notes written now (oldest first)
 */
export function observe(journal, ctx) {
  const { state, hour, habitat: hab, words } = ctx;
  const j = copy(journal);
  /** @type {Note[]} */ const out = [];
  const date = dateText(state?.seasons, words);
  const newHour = hour > j.last;
  const season = Math.min(3, Math.max(0, state?.seasons?.index ?? 0));
  const year = state?.seasons?.year ?? 0;

  for (const sp of words.order) {
    const rec = words.species[sp];
    if (!rec || isAnimal(rec)) continue;   // animals are looked at below (creatures.js)
    const k = know(j, sp);
    const m = measure(sp, state, hab, rec);
    const here = present(rec, m);
    const appeared = here && !k.seen;
    if (appeared) {
      const arrived = !k.ever && hour - j.born <= words.arrivedHours;
      // Here when you arrived: recorded silently (the page's story says "already here"), not a note.
      if (!arrived) note(out, rec, 'seen', sp, hour, date);
      // A plant that came by itself (src/world/growth/volunteers.js): the Plant tool offers it now.
      const came = state?.growth?.arrived?.[sp];
      if (!arrived && !k.ever && words.plantable && came !== undefined && came > (state.growth.since ?? came)) {
        out.push({ hour, date, text: words.plantable.replace('{name}', rec.name), sp, kind: 'plantable' });
      }
      if (!k.ever) { k.first = hour; k.arrived = arrived; }
      k.seen = true;
      k.ever = true;
      learnTrigger(k, 'seen');
    } else if (!here && k.seen) {
      note(out, rec, 'gone', sp, hour, date);
      k.seen = false;
    }
    if (here) {
      const isDormant = m.dormant > 0 && m.dormant * 2 >= m.count;
      k.seasons[season] |= GROW;
      if (m.flowering > 0) k.seasons[season] |= FLOWER;
      if (isDormant) k.seasons[season] |= DORMANT;
      if (m.flowering > 0 && k.flowerYear !== year) {
        note(out, rec, 'flower', sp, hour, date);
        k.flowerYear = year;
        learnTrigger(k, 'flower');
      }
      // Resting already when first seen (a new island on spring day 0): no note that it sank for winter.
      if (isDormant && !k.dormant) { if (!appeared) note(out, rec, 'dormant', sp, hour, date); learnTrigger(k, 'dormant'); }
      else if (!isDormant && k.dormant) { note(out, rec, 'woke', sp, hour, date); learnTrigger(k, 'woke'); }
      k.dormant = isDormant;
      if (m.value > k.peak) { k.peak = m.value; k.peakAt = hour; }
    }
    if (newHour) {
      k.counts.push(m.value);
      if (k.counts.length > words.trend.hours + 1) k.counts.splice(0, k.counts.length - words.trend.hours - 1);
    }
    // Grass learns that it drowns once water comes to stand over growing grass (cover still high
    // where the water now is; a new island's cover starts at none under its ponds).
    const cover = state?.growth?.grass;
    if (sp === 'grass' && hab && cover && !k.learned.includes('grass:flooded')) {
      let flooded = 0;
      for (let c = 0; c < hab.n * hab.n && flooded < 4; c++) if (hab.depthCm[c] > 0 && hab.grass[c] > 128 && cover[c] > 128 && hab.open[c]) flooded++;
      if (flooded >= 4) { learnTrigger(k, 'grass:flooded'); note(out, rec, 'flooded', sp, hour, date); }
    }
  }

  for (const e of ctx.events ?? []) {
    if (e.name === 'growth:spread') {
      for (const sp of Object.keys(e.payload?.bySpecies ?? {})) {
        const rec = words.species[sp], k = j.species[sp];
        if (rec && k && learnTrigger(k, 'spread')) note(out, rec, 'spread', sp, hour, date);
      }
    } else if (e.name === 'growth:lost') {
      const sp = e.payload?.species, why = e.payload?.why;
      const rec = words.species[sp], k = j.species[sp];
      if (rec && k && (why === 'drown' || why === 'seed') && learnTrigger(k, `lost:${why}`)) note(out, rec, why, sp, hour, date);
    } else if (e.name === 'season:changed') {
      const text = words.seasonNotes?.[e.payload?.index];
      if (text) out.push({ hour, date, text, sp: null, kind: 'season' });
    }
  }
  observeAnimals(j, out, ctx, { date, newHour, season, know });

  if (newHour) j.last = hour;
  keep(j, out, words);
  return { journal: j, notes: out };
}

/** Which lines of a list ({ learn: string[] }[]) are known. @param {SpeciesKnowledge | undefined} k @param {any[] | undefined} lines */
export function knownLines(k, lines) {
  return (lines ?? []).map((l) => !!k && l.learn.some((/** @type {string} */ t) => k.learned.includes(t)));
}

/**
 * What a page's field sketch shows (J1.6): stage 0 pencil before it is known, 1 ink once known, 2
 * washed once it has flowered or been caught at a moment; and the labels learned so far.
 * @param {{ learned: string[] } | undefined} k @param {boolean} known
 * @param {{ scale?: string, labels?: Record<string, { text: string[], learn: string[] }> } | undefined} sketch the recipe's sketch block
 * @returns {{ stage: 0|1|2, labels: Record<string, string[]>, scale?: string }}
 */
export function sketchOf(k, known, sketch) {
  const learned = k?.learned ?? [];
  const stage = !known ? 0 : learned.some((t) => t === 'flower' || t.startsWith('moment:')) ? 2 : 1;
  /** @type {Record<string, string[]>} */ const labels = {};
  for (const [key, l] of Object.entries(sketch?.labels ?? {})) if (l.learn.some((t) => learned.includes(t))) labels[key] = l.text;
  return { stage, labels, scale: sketch?.scale };
}

/** @param {string} s */
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Learn something outside the hourly look, such as a Plant tool refusal ('refused:dry'). Writes a
 * note only when it teaches a like line the page did not show yet.
 * @param {Journal} journal @param {string} sp @param {string} trigger
 * @param {{ state: any, hour: number, words: any }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function learn(journal, sp, trigger, ctx) {
  const rec = ctx.words.species[sp];
  if (!rec) return { journal, notes: [] };
  const before = knownLines(journal.species[sp], rec.likes);
  const j = copy(journal);
  const k = know(j, sp);
  if (!learnTrigger(k, trigger)) return { journal, notes: [] };
  /** @type {Note[]} */ const out = [];
  const after = knownLines(k, rec.likes);
  for (let i = 0; i < after.length; i++) {
    if (after[i] && !before[i]) out.push({ hour: ctx.hour, date: dateText(ctx.state?.seasons, ctx.words), text: `${rec.name}: ${lower(rec.likes[i].text)}.`, sp, kind: 'learned' });
  }
  keep(j, out, ctx.words);
  return { journal: j, notes: out };
}

/**
 * You found a frog yourself (a tap on it, or watching it from close by): its page inks and the
 * journal writes the moment (creatures.js).
 * @param {Journal} journal @param {{ state: any, hour: number, words: any }} ctx
 * @param {string} [sp] the page: frogs, or a school (minnows, dragonflies)
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function foundAnimal(journal, ctx, sp = 'frogs') {
  const c = { ...ctx, date: dateText(ctx.state?.seasons, ctx.words), know, copy };
  return sp === 'frogs' ? foundFrog(journal, c) : foundSchool(journal, sp, c);
}

/**
 * You found a find (docs/future/11), a small shore life, by tapping it: its page inks once, and the
 * moment is written down. A no-op once it is known.
 * A find with a collection (shells) is found one item at a time: each new one is learned as
 * `item:<id>` and gets its own note.
 * @param {Journal} journal @param {string} sp @param {{ state: any, hour: number, words: any }} ctx
 * @param {string | null} [item] which item of a collection
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function foundFind(journal, sp, ctx, item = null) {
  const rec = ctx.words.species[sp];
  if (!rec || rec.kind !== 'find') return { journal, notes: [] };
  const it = item ? rec.collection?.find((/** @type {any} */ c) => c.id === item) : null;
  if (item ? !it || journal.species[sp]?.learned.includes(`item:${item}`) : journal.species[sp]?.ever) return { journal, notes: [] };
  const j = copy(journal);
  const k = know(j, sp);
  if (!k.ever) { k.ever = true; k.first = ctx.hour; }
  if (!k.learned.includes('seen')) k.learned.push('seen');
  if (it) learnTrigger(k, `item:${it.id}`);
  if (!j.flags.includes(`${sp}:seen`)) j.flags.push(`${sp}:seen`);
  /** @type {Note[]} */ const notes = [{ hour: ctx.hour, date: dateText(ctx.state?.seasons, ctx.words), text: it ? it.found : rec.notes.found, sp, kind: 'found' }];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
}

/**
 * You found a shell that a winter storm tide left (world/finds/strand.js): the first time, the
 * journal writes it down, keeps the flag shells:storm, and the shells page learns `storm`. A no-op
 * after that.
 * @param {Journal} journal @param {{ state: any, hour: number, words: any }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function stormShells(journal, ctx) {
  const rec = ctx.words.species.shells;
  const text = rec?.notes?.storm;
  if (!text || journal.flags.includes('shells:storm')) return { journal, notes: [] };
  const j = copy(journal);
  j.flags.push('shells:storm');
  learnTrigger(know(j, 'shells'), 'storm');
  /** @type {Note[]} */ const notes = [{ hour: ctx.hour, date: dateText(ctx.state?.seasons, ctx.words), text, sp: 'shells', kind: 'storm' }];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
}

/**
 * You lifted a loose stone, or rolled a driftwood log (docs/future/10): the first time, the journal
 * writes it down and keeps the flag stones:lifted (driftwood:lifted for a log). A no-op after that.
 * @param {Journal} journal @param {{ state: any, hour: number, words: any }} ctx
 * @param {string} [kind] the piece's kind ('stone' or 'log')
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function liftedStone(journal, ctx, kind = 'stone') {
  const text = ctx.words.pieces?.[kind]?.lifted;
  const fl = kind === 'log' ? 'driftwood:lifted' : 'stones:lifted';
  if (journal.flags.includes(fl) || !text) return { journal, notes: [] };
  const j = copy(journal);
  j.flags.push(fl);
  /** @type {Note[]} */ const notes = [{ hour: ctx.hour, date: dateText(ctx.state?.seasons, ctx.words), text, sp: null, kind: 'lifted' }];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
}

/**
 * The island gave you something (world/expansion.js): a naturalist's reward or a species' gift.
 * Written once, as a note of kind 'gift' that carries its title and icon, so the island can show
 * it as a card.
 * @param {Journal} journal @param {{ id: string, title: string, line: string, icon: string, page: string | null }} g
 * @param {{ state: any, hour: number, words: any }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function noteGift(journal, g, ctx) {
  const j = copy(journal);
  // A trail's reward (the shaper's pond stones and Steps) carries its trail, whose page it opens.
  /** @type {any} */ const note = { hour: ctx.hour, date: dateText(ctx.state?.seasons, ctx.words), text: `${g.title}. ${g.line}`, sp: g.page ?? undefined, kind: 'gift', title: g.title, line: g.line, icon: g.icon,
    ...(g.trail ? { trail: g.trail } : {}) };
  /** @type {Note[]} */ const notes = [note];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
}

/**
 * You named a frog (S6c-3): the journal writes the moment (creatures.js).
 * @param {Journal} journal @param {string} name @param {{ state: any, hour: number, words: any }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function namedAnimal(journal, name, ctx) {
  return namedFrog(journal, name, { ...ctx, date: dateText(ctx.state?.seasons, ctx.words), copy });
}

/**
 * The player planted a seed of `sp` (the Plant tool): part of its story on the island.
 * @param {Journal} journal @param {string} sp @param {number} hour
 */
export function notePlanted(journal, sp, hour) {
  const j = copy(journal);
  const k = know(j, sp);
  k.planted += 1;
  if (k.plantedAt < 0) k.plantedAt = hour;
  return j;
}

/**
 * Which of a page's moments are happening now for something tapped.
 * @param {{ id: string }[]} list the page's moments
 * @param {{ stage?: number, season: number, hourOfDay: number, rain: number, mist: number }} now
 * @param {any} M words.moments
 * @returns {string[]} moment ids
 */
export function momentsNow(list, now, M) {
  const inHours = (/** @type {number[]} */ h) => now.hourOfDay >= h[0] && now.hourOfDay < h[1];
  /** @type {Record<string, boolean>} */
  const is = {
    flower: now.stage === STAGE.flowering,
    summer: now.season === 1,
    winter: now.season === 3,
    rain: now.rain >= M.rainAt,
    mist: now.mist >= M.mistAt,
    dawn: inHours(M.hours.dawn),
    dusk: inHours(M.hours.dusk),
    frost: now.season === 3 && inHours(M.hours.dawn),
  };
  return list.filter((m) => is[m.id]).map((m) => m.id);
}

/**
 * Record the moments just caught for a species or ground (tapped while they hold). Each moment is
 * kept once, with a note, and teaches its field notes (`moment:<id>`).
 * @param {Journal} journal @param {string} id species or ground id @param {string[]} ids moment ids happening now
 * @param {{ state: any, hour: number, words: any, name: string, list: { id: string, label: string }[] }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function catchMoments(journal, id, ids, ctx) {
  const fresh = ids.filter((m) => journal.species[id]?.moments?.[m] === undefined);
  if (!fresh.length) return { journal, notes: [] };
  const j = copy(journal);
  const k = know(j, id);
  /** @type {Note[]} */ const out = [];
  const date = dateText(ctx.state?.seasons, ctx.words);
  for (const m of fresh) {
    k.moments[m] = ctx.hour;
    learnTrigger(k, `moment:${m}`);
    const label = ctx.list.find((x) => x.id === m)?.label ?? m;
    out.push({ hour: ctx.hour, date, text: ctx.words.moments.note.replace('{name}', ctx.name).replace('{label}', label), sp: id, kind: 'moment' });
  }
  keep(j, out, ctx.words);
  return { journal: j, notes: out };
}

/**
 * Mark an island-wide happening (e.g. 'frogs:settled') so give lines can ink in.
 * @param {Journal} journal @param {string} flag
 */
export function flag(journal, flag) {
  if (journal.flags.includes(flag)) return journal;
  return { ...journal, flags: [...journal.flags, flag] };
}
