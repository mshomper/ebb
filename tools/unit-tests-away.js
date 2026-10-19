// @ts-check
// Time-away tests for tools/unit-tests.html (S7b, docs 02 and 18): the clock rules, and an hour away
// giving the same island and the same journal as an hour watched.

import { awayHours, catchUpJob, CAP_HOURS } from '../src/sim/catchup.js';
import { runHour, hashWorldState } from '../src/sim/tick.js';
import { journalLook } from '../src/world/journal/look.js';
import { initialJournal } from '../src/world/journal/observe.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

const AWAY = 'time away';
const MIN = 60000, DAY = 24 * 3600 * 1000;
const T = 1_760_000_000_000;

/** @param {string} path */
async function get(path) {
  const r = await fetch(`../recipes/${path}.json`);
  if (!r.ok) throw new Error(`recipes/${path}.json: HTTP ${r.status}`);
  return r.json();
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addAwayTests(test, assert, eq) {
  test(AWAY, 'one real minute away is one game hour, and minutes carry over', () => {
    const a = awayHours({ now: T + 10 * MIN, savedAt: T, wallHighWater: T, flow: 1 });
    eq(a.hours, 10, '10 minutes');
    eq(a.wallHighWater, T + 10 * MIN, 'high-water mark moves on');
    const b = awayHours({ now: T + 90 * 1000, savedAt: T, wallHighWater: T, carryMinutes: 0.75, flow: 1 });
    eq(b.hours, 2, '90 s plus 0.75 carried');
    assert(Math.abs(b.carryMinutes - 0.25) < 1e-9, `carry ${b.carryMinutes}`);
    const c = awayHours({ now: T + 30 * 1000, savedAt: T, wallHighWater: T, flow: 4 });
    eq(c.hours, 0, 'away is 1x whatever the time flow');
  });

  test(AWAY, 'at most 14 game days, and nothing for a paused island', () => {
    const a = awayHours({ now: T + 30 * DAY, savedAt: T, wallHighWater: T, flow: 1 });
    eq(a.hours, CAP_HOURS, 'a month away');
    eq(a.why, 'capped', 'capped');
    eq(a.carryMinutes, 0, 'time beyond the cap is dropped');
    const p = awayHours({ now: T + 60 * MIN, savedAt: T, wallHighWater: T, carryMinutes: 0.5, flow: 0 });
    eq(p.hours, 0, 'paused');
    eq(p.carryMinutes, 0.5, 'paused keeps what was carried');
    eq(awayHours({ now: T + 60 * MIN, savedAt: T, wallHighWater: T, flow: 1, keepGrowing: false }).hours, 0, 'keep growing off');
  });

  test(AWAY, 'a clock set back earns nothing; a long way back resets the guard', () => {
    const back = awayHours({ now: T - 3600 * 1000, savedAt: T, wallHighWater: T, flow: 1 });
    eq(back.hours, 0, 'an hour back');
    eq(back.wallHighWater, T, 'the mark stays');
    const reset = awayHours({ now: T - 3 * DAY, savedAt: T, wallHighWater: T, flow: 1 });
    eq(reset.hours, 0, 'three days back');
    eq(reset.wallHighWater, T - 3 * DAY, 'the mark resets to now');
    // After a small step back the clock earns again only past the mark (less the 5 minute grace).
    const later = awayHours({ now: T + 20 * MIN, savedAt: T - 60 * MIN, wallHighWater: T, flow: 1 });
    eq(later.hours, 25, 'from the mark less the grace');
  });

  test(AWAY, '48 hours away give the same island and journal as 48 hours watched', async () => {
    const R = await loadEcologyRecipes();
    const [words, island, web] = await Promise.all([get('world/journal'), get('world/journal-island'), get('world/journal-web')]);
    const w = islandWorld(R, 'starter-island', 1, 3);
    const hab = w.model.habitat, material = w.model.material;
    // Watched: the tick, then the journal's look, hour by hour, as live play does.
    let state = w.state, journal = initialJournal(w.h0);
    for (let h = w.h0 + 1; h <= w.h0 + 48; h++) {
      const t = runHour(state, h, w.env);
      state = t.state;
      journal = journalLook(journal, { state, events: t.events, hour: h, habitat: hab, material, words, island, web }).journal;
    }
    const args = { seed: w.env.seed, recipes: w.env.recipes, habitat: hab, material, jr: { words, island, web } };
    const away = catchUpJob({ ...args, state: w.state, journal: initialJournal(w.h0), fromHour: w.h0 + 1, hours: 48 });
    eq(hashWorldState(away.state), hashWorldState(state), 'island');
    eq(hashWorldState(away.journal), hashWorldState(journal), 'journal');
    // Two days one at a time, the same.
    const d1 = catchUpJob({ ...args, state: w.state, journal: initialJournal(w.h0), fromHour: w.h0 + 1, hours: 24 });
    const d2 = catchUpJob({ ...args, state: d1.state, journal: d1.journal, fromHour: w.h0 + 25, hours: 24 });
    eq(hashWorldState(d2.state), hashWorldState(state), 'island, a day at a time');
    eq(hashWorldState(d2.journal), hashWorldState(journal), 'journal, a day at a time');
    return `${away.notes.length} notes, ${away.events.length} notable events`;
  });
}
