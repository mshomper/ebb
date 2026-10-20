// @ts-check
// The field journal's animals (S6a, docs 11, 13, 23): frogs and midges. Pure, like observe.js, and
// called from it, so live play and a later catch-up write the same journal.
//
// Frogs (kind creature) are known only once you find one yourself (found(), from a tap or from
// watching close by); being on the island is not enough. Until then the page shows a riddle and
// then hints, and the notes speak of something: a sign, rings on the water. Once found, the notes
// name them, the web's frog links ink from the cover around each frog's home (flags frogs:reeds,
// frogs:rushes, frogs:iris, frogs:lilies, frogs:grass), and plant pages' gives lines ink
// (frogs:settled). When a frog comes to know you better (S6c, `creature:trusted`) the notes say so
// and the page learns that frogs let you close if you come slowly. Midges (kind swarm) are known by
// themselves at the first dusk they gather.
// Words from recipes/world/journal.json.

import { HABITAT_ORIGIN } from '../growth/habitat.js';
import { GROW, DORMANT } from './observe.js';

/** @typedef {import('./observe.js').Journal} Journal @typedef {import('./observe.js').Note} Note */
/** @typedef {import('./observe.js').SpeciesKnowledge} SpeciesKnowledge */

/** Add a flag once. Returns true if it was new. @param {Journal} j @param {string} f */
function setFlag(j, f) {
  if (j.flags.includes(f)) return false;
  j.flags.push(f);
  return true;
}

/** Learn a trigger once. @param {SpeciesKnowledge} k @param {string} t */
function learnOnce(k, t) {
  if (k.learned.includes(t)) return false;
  k.learned.push(t);
  return true;
}

/**
 * What an animal looks like on the island now, as measure() gives a plant: frogs by count (their
 * positions as `plants`, for where words), midges by the square meters holding a cloud.
 * @param {string} sp @param {any} state @param {any} rec words.species[sp]
 */
export function measureAnimal(sp, state, rec) {
  if (rec.kind === 'swarm') {
    const m = state?.ecology?.midges;
    /** @type {{ x: number, z: number }[]} */ const spots = [];
    if (m) {
      const n = Math.round(Math.sqrt(m.length)), at = 255 * rec.seenAt.share;
      for (let k = 0; k < m.length; k++) if (m[k] >= at) spots.push({ x: HABITAT_ORIGIN + (k % n) + 0.5, z: HABITAT_ORIGIN + Math.floor(k / n) + 0.5 });
    }
    return { count: spots.length, value: spots.length, flowering: 0, dormant: 0, mature: 0, plants: [], spots };
  }
  const F = state?.creatures?.[sp];
  const frogs = F?.frogs ?? [];
  return { count: frogs.length, value: frogs.length, flowering: 0, dormant: F?.dormant ? frogs.length : 0, mature: frogs.length, plants: frogs, spots: [] };
}

/**
 * Look at the island's animals after an hour (or an edit), on a journal observe() has copied.
 * @param {Journal} j the journal, already copied (changed in place)
 * @param {Note[]} out notes written now
 * @param {{ state: any, events?: { name: string, payload: any }[], hour: number, words: any }} ctx
 * @param {{ date: string, newHour: boolean, season: number, know: (j: Journal, sp: string) => SpeciesKnowledge }} at
 */
export function observeAnimals(j, out, ctx, at) {
  const { state, hour, words } = ctx;
  /** @param {any} rec @param {string} kind @param {string} sp */
  const note = (rec, kind, sp) => { const t = rec.notes?.[kind]; if (t) out.push({ hour, date: at.date, text: t, sp, kind }); };

  // Frogs.
  const rec = words.species.frogs;
  if (rec) {
    const k = at.know(j, 'frogs');
    const F = state?.creatures?.frogs;
    if (F?.right && setFlag(j, 'frogs:right') && !k.ever) note(rec, 'right', 'frogs');
    for (const e of ctx.events ?? []) {
      if (e.payload?.species !== 'frogs') continue;
      if (e.name === 'creature:arrived') {
        if (setFlag(j, 'frogs:sign')) note(rec, 'sign', 'frogs');
        else note(rec, k.ever ? 'back' : 'signAgain', 'frogs');
      } else if (e.name === 'creature:settled') {
        learnOnce(k, 'settled');
        note(rec, k.ever ? 'settled' : 'settledUnseen', 'frogs');
      } else if (e.name === 'creature:joined') {
        // Unseen, only the first one is told; seen, each one.
        if (k.ever) note(rec, 'joined', 'frogs');
        else if (learnOnce(k, 'joined:unseen')) note(rec, 'joinedUnseen', 'frogs');
        learnOnce(k, 'joined');
      } else if (e.name === 'creature:left') {
        if (k.ever) { note(rec, e.payload.count ? 'left' : 'gone', 'frogs'); learnOnce(k, 'left'); }
        else if (e.payload.why === 'scout') note(rec, 'scoutLeftUnseen', 'frogs');
      } else if (e.name === 'creature:dormant' || e.name === 'creature:woke') {
        if (k.ever) { note(rec, e.name === 'creature:dormant' ? 'dormant' : 'woke', 'frogs'); learnOnce(k, e.name === 'creature:dormant' ? 'dormant' : 'woke'); }
      } else if (e.name === 'species:happy') {
        setFlag(j, 'frogs:happy');
        if (k.ever) note(rec, 'happy', 'frogs');
      } else if (e.name === 'creature:trusted' && k.ever) {
        // A frog's word moved up (S6c): a note, and what it teaches the page.
        const t = rec.trust?.notes?.[e.payload.word];
        if (t) out.push({ hour, date: at.date, text: t, sp: 'frogs', kind: 'trusted' });
        learnOnce(k, `trust:${e.payload.word}`);
        if (e.payload.word !== 'tolerant') learnOnce(k, 'trust:tolerant');
      }
    }
    if (k.ever) frogsKnown(j, k, F, at.season, hour);
    if (k.ever) track(k, F?.frogs?.length ?? 0, hour, at.newHour, words);
  }

  // Midges: known by themselves at the first dusk they gather, once the island draws them (S6b).
  const mrec = words.species.midges;
  if (mrec && mrec.seenAt.drawn) {
    const k = at.know(j, 'midges');
    const m = measureAnimal('midges', state, mrec);
    const S = mrec.seenAt;
    const hourOfDay = hour % 24;
    const here = m.count >= S.m2;
    if (!k.ever && here && hourOfDay >= S.hours[0] && hourOfDay < S.hours[1]) {
      k.ever = true; k.seen = true; k.first = hour;
      learnOnce(k, 'seen');
      setFlag(j, 'midges:seen');
      note(mrec, 'seen', 'midges');
    } else if (k.ever) {
      if (here && !k.seen) { k.seen = true; note(mrec, 'back', 'midges'); }
      else if (!here && k.seen && m.count === 0) { k.seen = false; note(mrec, 'gone', 'midges'); }
    }
    if (k.ever) {
      if (here) k.seasons[at.season] |= GROW;
      if (at.season === 3) learnOnce(k, 'winter');
      track(k, m.value, hour, at.newHour, words);
    }
  }
}

/**
 * Keep a known frog page current: present or not, seasons, numbers, and the web's frog links.
 * @param {Journal} j @param {SpeciesKnowledge} k @param {any} F state.creatures.frogs @param {number} season @param {number} hour
 */
function frogsKnown(j, k, F, season, hour) {
  const frogs = F?.frogs ?? [];
  k.seen = frogs.length > 0;
  k.dormant = !!F?.dormant && frogs.length > 0;
  if (frogs.length) k.seasons[season] |= F.dormant ? DORMANT | GROW : GROW;
  if (F?.phase === 'settled' && frogs.length) setFlag(j, 'frogs:settled');
  for (const f of frogs) for (const sp of f.near ?? []) setFlag(j, `frogs:${sp}`);
  if (frogs.length > k.peak) { k.peak = frogs.length; k.peakAt = hour; }
}

/**
 * Count history for the trend words, as observe() keeps it for plants.
 * @param {SpeciesKnowledge} k @param {number} value @param {number} hour @param {boolean} newHour @param {any} words
 */
function track(k, value, hour, newHour, words) {
  if (value > k.peak) { k.peak = value; k.peakAt = hour; }
  if (!newHour) return;
  k.counts.push(value);
  if (k.counts.length > words.trend.hours + 1) k.counts.splice(0, k.counts.length - words.trend.hours - 1);
}

/**
 * You found a frog (tapped one, or watched one from close by): the page inks, the moment is written
 * down, and its links in the web follow. A no-op once frogs are known.
 * @param {Journal} journal
 * @param {{ state: any, hour: number, words: any, date: string, know: (j: Journal, sp: string) => SpeciesKnowledge, copy: (j: Journal) => Journal }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function foundFrog(journal, ctx) {
  const rec = ctx.words.species.frogs;
  if (!rec || journal.species.frogs?.ever) return { journal, notes: [] };
  const j = ctx.copy(journal);
  const k = ctx.know(j, 'frogs');
  k.ever = true; k.first = ctx.hour;
  learnOnce(k, 'seen');
  setFlag(j, 'frogs:seen');
  const season = Math.min(3, Math.max(0, ctx.state?.seasons?.index ?? 0));
  frogsKnown(j, k, ctx.state?.creatures?.frogs, season, ctx.hour);
  /** @type {Note[]} */ const notes = [{ hour: ctx.hour, date: ctx.date, text: rec.notes.found, sp: 'frogs' }];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
}
