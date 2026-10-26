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
  if (rec.kind === 'school') {
    // A school or swarm with needs (minnows, dragonflies): counted in all, each group a spot.
    const S = state?.creatures?.[sp];
    const groups = S?.groups ?? [];
    const count = groups.reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
    return { count, value: count, flowering: 0, dormant: S?.dormant ? count : 0, mature: count, plants: groups, spots: [] };
  }
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
  // A place already right for an animal in the island's first day (the pond a new island starts
  // with) is not news: its flag is set silently, so a line comes only when the place becomes right later.
  const quiet = hour - (j.born ?? 0) <= (words.quietStartHours ?? words.arrivedHours ?? 0);
  /** @param {any} rec @param {string} kind @param {string} sp */
  const note = (rec, kind, sp) => {
    if (kind === 'right' && quiet) return;
    const t = rec.notes?.[kind];
    if (t) out.push({ hour, date: at.date, text: t, sp, kind });
  };

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
        // A frog you named leaves by its name (S6c-3).
        const named = e.payload.frogName && rec.notes?.leftNamed;
        if (k.ever && named) { out.push({ hour, date: at.date, text: rec.notes.leftNamed.replace('{name}', e.payload.frogName), sp: 'frogs', kind: 'left' }); learnOnce(k, 'left'); }
        else if (k.ever) { note(rec, e.payload.count ? 'left' : 'gone', 'frogs'); learnOnce(k, 'left'); }
        else if (e.payload.why === 'scout') note(rec, 'scoutLeftUnseen', 'frogs');
      } else if (e.name === 'creature:dormant' || e.name === 'creature:woke') {
        if (k.ever) { note(rec, e.name === 'creature:dormant' ? 'dormant' : 'woke', 'frogs'); learnOnce(k, e.name === 'creature:dormant' ? 'dormant' : 'woke'); }
      } else if (e.name === 'species:happy') {
        setFlag(j, 'frogs:happy');
        if (k.ever) note(rec, 'happy', 'frogs');
      } else if (e.name === 'creature:ate' && e.payload.treat) {
        // A frog took a treat (P2h): the first time teaches its Likes line, and says so.
        if (learnOnce(k, `likes:${e.payload.treat}`)) note(rec, 'treat', 'frogs');
      } else if (e.name === 'creature:ate') {
        // A frog ate what you offered (S6c-2): noted the first time, and the web's "you" link inks.
        if (setFlag(j, 'you:fed') && k.ever) note(rec, 'fed', 'frogs');
        learnOnce(k, 'fed');
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

  // Schools and swarms with needs (minnows, dragonflies): the same arc in their own words.
  for (const [sp, srec] of Object.entries(words.species)) if (/** @type {any} */ (srec).kind === 'school') observeSchool(j, out, ctx, at, sp, srec, note);

  // Spring at the pond (src/world/creatures/spring.js): frogspawn laid, hatched, leaving as froglets,
  // and the toad's night walk. Each note offers Show me (kind sign), so a young player can find them.
  observeSpring(j, out, ctx, at);

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
 * Spring's events, as notes: frogspawn (laid, more laid, hatched, froglets) and the toad walking.
 * The page learns each stage as it comes, seen or not, so its field notes fill in once found.
 * @param {Journal} j @param {Note[]} out @param {{ events?: { name: string, payload: any }[], hour: number, words: any }} ctx
 * @param {{ date: string, know: (j: Journal, sp: string) => SpeciesKnowledge }} at
 */
function observeSpring(j, out, ctx, at) {
  const { hour, words } = ctx;
  // Several clumps hatch at the same dusk: one note for them all.
  /** @type {Set<string>} */ const said = new Set();
  const say = (/** @type {string} */ sp, /** @type {string} */ key) => {
    const t = words.species[sp]?.notes?.[key];
    if (t && !said.has(key)) { said.add(key); out.push({ hour, date: at.date, text: t, sp, kind: 'sign' }); }
  };
  for (const e of ctx.events ?? []) {
    const sp = e.payload?.species;
    if (sp === 'frogspawn' && words.species.frogspawn) {
      const k = at.know(j, 'frogspawn');
      if (e.name === 'creature:spawned') say(sp, e.payload.first ? 'spawned' : 'spawnedMore');
      else if (e.name === 'creature:hatched') { say(sp, 'hatched'); learnOnce(k, 'hatched'); }
      else if (e.name === 'creature:froglets') { say(sp, 'froglets'); learnOnce(k, 'froglets'); }
    } else if (sp === 'toads' && e.name === 'creature:walking' && words.species.toads) say(sp, 'walking');
  }
}

/**
 * One school species' hour (minnows, dragonflies; kind school). Like the frogs: unseen, the notes
 * speak of a sign; found, they name them. Their count grows by the day, so a growing school is
 * written down only when its amount word changes.
 * @param {Journal} j @param {Note[]} out @param {{ state: any, events?: { name: string, payload: any }[], hour: number, words: any }} ctx
 * @param {{ date: string, newHour: boolean, season: number, know: (j: Journal, sp: string) => SpeciesKnowledge }} at
 * @param {string} sp @param {any} rec words.species[sp] @param {(rec: any, kind: string, sp: string) => void} note
 */
function observeSchool(j, out, ctx, at, sp, rec, note) {
  const { state, hour, words } = ctx;
  const k = at.know(j, sp);
  const S = state?.creatures?.[sp];
  if (S?.right && setFlag(j, `${sp}:right`) && !k.ever) note(rec, 'right', sp);
  const word = (/** @type {number} */ n) => { let w = ''; for (const [at0, t] of rec.amount ?? []) if (n >= at0) w = t; return w; };
  for (const e of ctx.events ?? []) {
    if (e.payload?.species !== sp) continue;
    if (e.name === 'creature:arrived') {
      if (setFlag(j, `${sp}:sign`)) note(rec, 'sign', sp);
      else note(rec, k.ever ? 'back' : 'signAgain', sp);
    } else if (e.name === 'creature:settled') {
      learnOnce(k, 'settled');
      note(rec, k.ever ? 'settled' : 'settledUnseen', sp);
    } else if (e.name === 'creature:joined') {
      const now = e.payload.total ?? e.payload.count;
      if (k.ever) { if (word(now) !== word(now - (e.payload.added ?? 1))) note(rec, 'joined', sp); }
      else if (learnOnce(k, 'joined:unseen')) note(rec, 'joinedUnseen', sp);
      learnOnce(k, 'joined');
    } else if (e.name === 'creature:uneasy') {
      // A9: their pool is failing them and they will go in a few days unless it comes right. The
      // note says why (summer's own words in summer) and its Show me rings their pool.
      const U = rec.uneasy ?? {};
      const text = (at.season === 1 && U[`${e.payload.why}Summer`]) || U[e.payload.why] || U.habitat;
      if (k.ever && text) out.push({ hour, date: at.date, text, sp, kind: 'uneasy', at: { x: e.payload.x, z: e.payload.z } });
    } else if (e.name === 'creature:eased') {
      if (k.ever) note(rec, 'eased', sp);
    } else if (e.name === 'creature:thinned') {
      if (k.ever) note(rec, 'thinned', sp);
    } else if (e.name === 'creature:left') {
      if (k.ever) { note(rec, e.payload.count ? 'left' : 'gone', sp); learnOnce(k, 'left'); }
      else if (e.payload.why === 'scout') note(rec, 'scoutLeftUnseen', sp);
    } else if (e.name === 'creature:dormant' || e.name === 'creature:woke') {
      if (k.ever) { note(rec, e.name === 'creature:dormant' ? 'dormant' : 'woke', sp); learnOnce(k, e.name === 'creature:dormant' ? 'dormant' : 'woke'); }
    } else if (e.name === 'species:happy') {
      setFlag(j, `${sp}:happy`);
      if (k.ever) note(rec, 'happy', sp);
    } else if (e.name === 'creature:ate' && e.payload.treat) {
      // They took a treat (P2h): the first time teaches its Likes line, and says so.
      if (learnOnce(k, `likes:${e.payload.treat}`)) note(rec, 'treat', sp);
    } else if (e.name === 'creature:ate') {
      // They ate what you offered: noted the first time, and the web's "you" link inks.
      if (learnOnce(k, 'fed') && k.ever) note(rec, 'fed', sp);
      setFlag(j, `you:fed:${sp}`);
    } else if (e.name === 'creature:trusted' && k.ever) {
      const t = rec.trust?.notes?.[e.payload.word];
      if (t) out.push({ hour, date: at.date, text: t, sp, kind: 'trusted' });
      learnOnce(k, `trust:${e.payload.word}`);
      if (e.payload.word !== 'tolerant') learnOnce(k, 'trust:tolerant');
    }
  }
  if (k.ever) {
    schoolKnown(j, k, sp, S, at.season, hour);
    track(k, measureAnimal(sp, state, rec).count, hour, at.newHour, words);
  }
}

/**
 * Keep a known school's page current: present or not, its seasons, settled, and winter learned.
 * @param {Journal} j @param {SpeciesKnowledge} k @param {string} sp @param {any} S state.creatures[sp] @param {number} season @param {number} hour
 */
function schoolKnown(j, k, sp, S, season, hour) {
  const n = (S?.groups ?? []).reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0);
  k.seen = n > 0;
  k.dormant = !!S?.dormant;
  if (n) k.seasons[season] |= S.dormant ? DORMANT | GROW : GROW;
  if (n && season === 3) learnOnce(k, 'winter');
  if (S?.phase === 'settled' && n) setFlag(j, `${sp}:settled`);
  if (n > k.peak) { k.peak = n; k.peakAt = hour; }
}

/**
 * You found a school (tapped it, or watched it closely): its page inks, the moment is written down.
 * A no-op once it is known.
 * @param {Journal} journal @param {string} sp
 * @param {{ state: any, hour: number, words: any, date: string, know: (j: Journal, sp: string) => SpeciesKnowledge, copy: (j: Journal) => Journal }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function foundSchool(journal, sp, ctx) {
  const rec = ctx.words.species[sp];
  if (!rec || journal.species[sp]?.ever) return { journal, notes: [] };
  const j = ctx.copy(journal);
  const k = ctx.know(j, sp);
  k.ever = true; k.first = ctx.hour;
  learnOnce(k, 'seen');
  setFlag(j, `${sp}:seen`);
  const season = Math.min(3, Math.max(0, ctx.state?.seasons?.index ?? 0));
  schoolKnown(j, k, sp, ctx.state?.creatures?.[sp], season, ctx.hour);
  /** @type {Note[]} */ const notes = [{ hour: ctx.hour, date: ctx.date, text: rec.notes.found, sp }];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
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
 * You named a frog (S6c-3): the moment is written down.
 * @param {Journal} journal @param {string} name
 * @param {{ hour: number, words: any, date: string, copy: (j: Journal) => Journal }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function namedFrog(journal, name, ctx) {
  const rec = ctx.words.species.frogs;
  const t = rec?.notes?.named;
  if (!t || !name) return { journal, notes: [] };
  const j = ctx.copy(journal);
  /** @type {Note[]} */ const notes = [{ hour: ctx.hour, date: ctx.date, text: t.replace('{name}', name), sp: 'frogs', kind: 'named' }];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
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
