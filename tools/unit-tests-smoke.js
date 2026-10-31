// @ts-check
// The determinism smoke, in the core set that runs on every partial run
// (tools/affected-tests.mjs). Moved from the test page on October 31, 2026, so it runs in workers
// and in Node (tools/run-tests.mjs).

import { initialWorldState, makeEnv, runHour, hashWorldState } from '../src/sim/tick.js';
import { loadSeasons } from './unit-tests-fixtures.js';

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addSmokeTests(test, assert, eq) {
  test('smoke', 'two days of hourly ticks are the same twice, and the same split in two', async () => {
    const recipe = await loadSeasons();
    const env = makeEnv(7, { seasons: recipe });
    /** @param {any} st @param {number} from @param {number} to */
    const runRange = (st, from, to) => { for (let h = from; h <= to; h++) st = runHour(st, h, env).state; return st; };
    const a = hashWorldState(runRange(initialWorldState(7), 0, 47));
    eq(hashWorldState(runRange(initialWorldState(7), 0, 47)), a, 'second run');
    eq(hashWorldState(runRange(runRange(initialWorldState(7), 0, 23), 24, 47)), a, 'split run');
    return `hash ${a.toString(16).toUpperCase().padStart(8, '0')}`;
  });
}
