// @ts-check
// One whole game hour (docs 02, 18): the island's hourly tick, then the journal's look at the result.
// Live play runs the same two steps (app.js on `clock:hour`, then the journal on `world:ticked`);
// catch-up runs this back to back. Pure and worker-safe.

import { runHour } from './tick.js';
import { journalLook } from '../world/journal/look.js';

/** Tick events kept for the reveal on return (S7c): arrivals, settling, contentment, seasons. */
const NOTABLE = /^(creature:|species:|season:)/;

/**
 * @param {any} state @param {any} journal @param {number} hour
 * @param {import('./tick.js').Env} env  the tick's env (its habitat is the island's while away)
 * @param {Omit<import('../world/journal/look.js').LookContext, 'state' | 'events' | 'hour' | 'habitat'>} jc
 *   the journal's recipes and the painted materials
 * @returns {{ state: any, journal: any, notes: any[], events: any[] }} events: the notable ones only
 */
export function hourStep(state, journal, hour, env, jc) {
  const t = runHour(state, hour, env);
  const habitat = env.habitat?.() ?? null;
  const j = journal ? journalLook(journal, { ...jc, state: t.state, events: t.events, hour, habitat }) : { journal, notes: [] };
  return { state: t.state, journal: j.journal, notes: j.notes, events: t.events.filter((e) => NOTABLE.test(e.name)) };
}
