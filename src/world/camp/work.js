// @ts-check
// The camp's overnight work (docs/future/13 section 3.12; P2i I4): pieces laid at the fire that need
// hours of fire to be done, lit or banked, so they are ready by morning. Willow withies laid in the
// ashes become charcoal sticks (X-15); clay firing (S5) lays its pots here the same way.
//
// Like the fire (fire.js), nothing ticks: a piece's progress is the fire hours it has banked plus
// what the burn going now has given since, worked out from the clock. Before anything changes the
// fire (a lighting, a feed, a banking, the clock settling it), the camp writes the progress in
// (withFire), so a later burn adds to it and live play, a save and catch-up all agree. The list rides
// in the save's camp section as `work`. Pure.

import { hotHours } from './fire.js';

/**
 * @typedef {{ id: string, laidHour: number, needH: number, firedH: number, fromHour: number, gives: string, count: number }} WorkPiece
 *   id: the make that laid it (cook.json makes); laidHour: when; needH: hours of fire it needs;
 *   firedH: fire hours banked so far, counted up to fromHour; gives, count: what it becomes, in handfuls
 */

/** A saved work list made safe: pieces with a make id, numbers that read. @param {any} v @returns {WorkPiece[]} */
export function cleanWork(v) {
  const n = (/** @type {any} */ x, /** @type {number} */ d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return (Array.isArray(v) ? v : []).filter((p) => p && typeof p.id === 'string' && typeof p.gives === 'string')
    .map((p) => ({ id: p.id, laidHour: n(p.laidHour, 0), needH: Math.max(0, n(p.needH, 0)), firedH: Math.max(0, n(p.firedH, 0)),
      fromHour: n(p.fromHour, n(p.laidHour, 0)), gives: p.gives, count: Math.max(1, Math.round(n(p.count, 1))) }));
}

/**
 * A piece laid at the fire now. @param {WorkPiece[]} work @param {{ id: string, needH: number, gives: string, count: number }} make
 * @param {number} hour @returns {WorkPiece[]}
 */
export const layWork = (work, make, hour) => [...work, { id: make.id, laidHour: hour, needH: make.needH, firedH: 0, fromHour: hour, gives: make.gives, count: make.count }];

/**
 * The fire hours a piece has had by `hour`. @param {WorkPiece} p @param {import('./fire.js').Fire} fire
 * @param {number} hour @param {import('./fire.js').FireRecipe} F
 */
export const fired = (p, fire, hour, F) => p.firedH + hotHours(fire, p.fromHour, hour, F);

/** Is a piece done by `hour`? @param {WorkPiece} p @param {import('./fire.js').Fire} fire @param {number} hour @param {import('./fire.js').FireRecipe} F */
export const workDone = (p, fire, hour, F) => fired(p, fire, hour, F) >= p.needH - 1e-9;

/**
 * Every piece's progress written in up to `hour`, before the fire changes. @param {WorkPiece[]} work
 * @param {import('./fire.js').Fire} fire @param {number} hour @param {import('./fire.js').FireRecipe} F @returns {WorkPiece[]}
 */
export const writeWork = (work, fire, hour, F) => work.map((p) => ({ ...p, firedH: Math.min(p.needH, fired(p, fire, hour, F)), fromHour: Math.max(p.fromHour, hour) }));

/**
 * The camp with a new fire, the work's progress written in first. Every change to the fire goes
 * through this. @template {{ fire: import('./fire.js').Fire, work?: any }} C @param {C} c
 * @param {import('./fire.js').Fire} next @param {number} hour @param {import('./fire.js').FireRecipe} F @returns {C}
 */
export const withFire = (c, next, hour, F) => ({ ...c, work: writeWork(cleanWork(c.work), c.fire, hour, F), fire: next });

/**
 * Take the first done piece off the list. @param {WorkPiece[]} work @param {import('./fire.js').Fire} fire
 * @param {number} hour @param {import('./fire.js').FireRecipe} F @returns {{ work: WorkPiece[], piece: WorkPiece | null }}
 */
export function takeDone(work, fire, hour, F) {
  const i = work.findIndex((p) => workDone(p, fire, hour, F));
  return i < 0 ? { work, piece: null } : { work: work.filter((_, j) => j !== i), piece: work[i] };
}
