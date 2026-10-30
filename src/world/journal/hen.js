// @ts-check
// The field journal's hen (docs/future/15, slice 2): her page knows her once you find her yourself (a
// tap on her), as the frogs'. Each word she reaches (trust.js: Wary to Familiar, then Fond) writes a
// note and teaches the page what it means; a treat she took teaches its Likes line; her tail
// feather laid at camp is written down; her first eggs (in the scrape, then the nest box) and her
// moult too (slice 4). Her card names her word, and a name once she knows you well
// enough. Pure, like observe.js and creatures.js, so live play and a catch-up write the same journal.
// Words: recipes/world/journal.json species.hens.

import { henWord } from '../hen/trust.js';
import { dateOfHour } from './observe.js';

/** @typedef {import('./observe.js').Journal} Journal @typedef {import('./observe.js').Note} Note */
/** @typedef {import('./observe.js').SpeciesKnowledge} SpeciesKnowledge */

/** Learn a trigger once. @param {SpeciesKnowledge} k @param {string} t */
function learnOnce(k, t) {
  if (k.learned.includes(t)) return false;
  k.learned.push(t);
  return true;
}

/**
 * Her count and spot for her page and its Show me: one hen, where she was last seen, once she is out.
 * @param {any} state
 */
export function measureHen(state) {
  const H = state?.creatures?.hens;
  const plants = H?.at ? [{ x: H.at[0], z: H.at[1] }] : [];
  return { count: plants.length, value: plants.length, flowering: 0, dormant: 0, mature: plants.length, plants, spots: [] };
}

/**
 * Her hour's events, on a journal observe() copied (changed in place).
 * @param {Journal} j @param {Note[]} out @param {{ state: any, events?: { name: string, payload: any }[], hour: number, words: any }} ctx
 * @param {{ date: string, season: number, know: (j: Journal, sp: string) => SpeciesKnowledge }} at
 */
export function observeHen(j, out, ctx, at) {
  const rec = ctx.words.species.hens;
  if (!rec) return;
  const k = at.know(j, 'hens');
  const say = (/** @type {string | undefined} */ t, /** @type {string} */ kind) => { if (t && k.ever) out.push({ hour: ctx.hour, date: at.date, text: t, sp: 'hens', kind }); };
  for (const e of ctx.events ?? []) {
    if (e.payload?.species !== 'hens') continue;
    if (e.name === 'creature:trusted') {
      // Her word moved up: a note, and what it teaches the page (each word below it too).
      say(rec.trust?.notes?.[e.payload.word], 'trusted');
      for (const w of ['tolerant', 'curious', 'familiar', 'fond']) {
        learnOnce(k, `trust:${w}`);
        if (w === e.payload.word) break;
      }
    } else if (e.name === 'creature:ate' && e.payload.treat) {
      if (learnOnce(k, `likes:${e.payload.treat}`)) say(rec.notes?.[`treat:${e.payload.treat}`] ?? rec.notes?.treat, 'treat');
    } else if (e.name === 'creature:fond') {
      if (!j.flags.includes('hens:fond')) j.flags.push('hens:fond');
    } else if (e.name === 'hen:feather') {
      learnOnce(k, 'feather');
      say(rec.notes?.feather, 'sign');
    } else if (e.name === 'hen:laid') {
      // Slice 4: her first egg in the scrape, and her first in the nest box.
      const where = e.payload.where === 'box' ? 'box' : 'scrape';
      if (learnOnce(k, `eggs:${where}`)) say(rec.notes?.[where === 'box' ? 'nestbox' : 'scrape'], 'sign');
    } else if (e.name === 'hen:moult') {
      if (learnOnce(k, 'moult')) say(rec.notes?.moult, 'sign');
    }
  }
  if (k.ever) {
    const H = ctx.state?.creatures?.hens;
    k.seen = !!H?.at;
    if (k.seen) k.seasons[at.season] |= 1;
    if (H?.name && !j.flags.includes('hens:known')) j.flags.push('hens:known');
  }
}

/**
 * You found her (a tap on her): her page inks and the moment is written down. A no-op once known.
 * @param {Journal} journal
 * @param {{ state: any, hour: number, words: any, date: string, know: (j: Journal, sp: string) => SpeciesKnowledge, copy: (j: Journal) => Journal }} ctx
 * @returns {{ journal: Journal, notes: Note[] }}
 */
export function foundHen(journal, ctx) {
  const rec = ctx.words.species.hens;
  if (!rec || journal.species.hens?.ever) return { journal, notes: [] };
  const j = ctx.copy(journal);
  const k = ctx.know(j, 'hens');
  k.ever = true; k.first = ctx.hour; k.seen = true;
  learnOnce(k, 'seen');
  if (!j.flags.includes('hens:seen')) j.flags.push('hens:seen');
  /** @type {Note[]} */ const notes = [{ hour: ctx.hour, date: ctx.date, text: rec.notes.found, sp: 'hens' }];
  j.notes = [...notes, ...j.notes].slice(0, ctx.words.notesKept);
  return { journal: j, notes };
}

/**
 * Her card (a tap on her, or Show me): her word, a line that goes with it, her name once given, and
 * names to suggest once she knows you well enough (presence.namingTrust).
 * @param {{ x: number, z: number }} at @param {any} state @param {any} words @param {any} [presence] recipes/species/hen.json presence
 */
export function henCard(at, state, words, presence) {
  const rec = words.species.hens;
  const H = state?.creatures?.hens;
  const T = rec.trust;
  const w = presence && T ? henWord(H, presence) : null;
  const sub = H?.name ? T?.since?.replace('{card}', rec.card).replace('{date}', dateOfHour(H.namedAt ?? 0, words)) ?? rec.card : null;
  const canName = !!H && !H.name && !!presence?.namingTrust && (H.trust ?? 0) >= presence.namingTrust;
  return { sp: 'hens', name: H?.name ?? rec.card, sub, icon: rec.icon, text: w ? T.lines?.[w] ?? rec.stages[0] : rec.stages[0],
    word: w ? T.words[w] : null, id: 1, canName, suggest: canName ? [...(T?.names ?? [])] : [],
    wx: at.x, wz: at.z, r: 0.45, stage: -1 };
}

/** Her name for her page's named list, or none. @param {any} state */
export const namedHen = (state) => (state?.creatures?.hens?.name ? [{ name: state.creatures.hens.name, at: state.creatures.hens.namedAt ?? 0 }] : []);
