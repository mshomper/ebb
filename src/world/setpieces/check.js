// @ts-check
// The set pieces' determinism check (docs/future/14; tools/determinism.html and the unit tests):
// two seeded years of seasons and set pieces, with the choices a player would make written in as
// notes at fixed moments (the trail planned, a stone added, the letter read, a parcel every time the
// boat lies at anchor and its gift taken up the next morning), and nights away now and then, when
// beats that need you wait. Run straight through, then again with the island saved and read back
// every game day (the save's own packing), it must play the same beats in the same order and end
// the same. Pure and worker-safe.

import { makeEnv, hashWorldState } from '../../sim/tick.js';
import * as seasons from '../seasons.js';
import { coarseStep, addNote, setpiecesOf } from './runner.js';
import { packValue, unpackValue } from '../../save/world-file.js';

/** A fixed trail for the check (the live game plans it from the ground). */
const TRAIL = [[0, 10], [6, 16], [12, 22], [18, 28], [24, 34], [30, 40], [36, 46]];

/**
 * One scenario run. @param {{ worldSeed: number, recipes: { seasons: any, sky: any, setpieces: any }, days: number,
 *   save?: boolean }} a save: write and read the world back through the save's packing every game day
 * @returns {{ timeline: number, end: number, beats: string[], counts: Record<string, number> }}
 */
export function setpieceRun(a) {
  const env = makeEnv(a.worldSeed, a.recipes);
  /** @type {any} */ let state = { seasons: seasons.initialSeasons() };
  /** @type {string[]} */ const beats = [];
  let h32 = 0x811c9dc5;
  const mix = (/** @type {string} */ s) => { for (let i = 0; i < s.length; i++) h32 = Math.imul(h32 ^ s.charCodeAt(i), 0x01000193) >>> 0; };
  for (let hour = 0; hour < a.days * 24; hour++) {
    const day = Math.floor(hour / 24), hod = hour % 24;
    // Away some nights (every third, 22:00 to 08:00): beats that need you wait.
    /** @type {any} */ (env).away = day % 3 === 1 && (hod >= 22 || hod < 8);
    const sp = setpiecesOf(state), cairns = sp.runs?.cairns, boat = sp.runs?.boat;
    // What a player does, live only.
    if (!env.away) {
      if (day === 3 && hod === 9) state = addNote(state, { id: '', kind: 'cond', name: 'stores', value: true, hour });
      if (cairns && cairns.done === undefined && !cairns.data.trail && !(sp.pending ?? []).some((/** @type {any} */ n) => n.kind === 'trail')) state = addNote(state, { id: 'cairns', kind: 'trail', points: TRAIL, hour });
      const list = cairns?.data?.cairns ?? [];
      if (list.length === 1 && list[0].added === 0 && hod === 12) state = addNote(state, { id: 'cairns', kind: 'stone', cairn: 0, hour });
      if (list.length === 7 && cairns.data.read === undefined && hod === 15) state = addNote(state, { id: 'cairns', kind: 'read', hour });
      if (boat && boat.done === undefined && boat.fell.length === 1 && !boat.data.parcel && !(sp.pending ?? []).some((/** @type {any} */ n) => n.kind === 'parcel')) {
        state = addNote(state, { id: 'boat', kind: 'parcel', what: 'chamomile.flowers', hour });
      }
      if (boat?.data?.gift && boat.data.gift.taken === undefined && hod === 10) state = addNote(state, { id: 'boat', kind: 'taken', hour });
    }
    state = seasons.coarseStep(state, hour, env).state;
    const r = coarseStep(state, hour, env);
    state = r.state;
    for (const e of r.events) {
      const line = `${hour}:${e.name}:${e.payload.id}:${e.payload.beat ?? e.payload.kind ?? ''}:${e.payload.rep ?? ''}`;
      mix(line);
      if (e.name === 'setpiece:beat' || e.name === 'setpiece:end') beats.push(line);
    }
    if (a.save && hod === 23) state = unpackValue(packValue(state));
  }
  return { timeline: h32 >>> 0, end: hashWorldState(state.setpieces), beats, counts: { ...setpiecesOf(state).count } };
}

/**
 * The check: straight, with a save and read every day, and straight again. @param {any} a as setpieceRun
 */
export function setpieceCheckJob(a) {
  const first = setpieceRun({ ...a, save: false });
  const saved = setpieceRun({ ...a, save: true });
  const again = setpieceRun({ ...a, save: false });
  return { first, saved, again };
}
