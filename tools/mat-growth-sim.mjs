// Mat growth projection (B3a): how the meadow islet's thyme, clover and trefoil spread from one
// planted clump each, season by season, on a test patch of machair (open sandy turf on one side, a
// grassy patch on the other). Prints square meters covered at the end of each season. Run:
//   node tools/mat-growth-sim.mjs
// Uses the real recipes and the real hourly rule (src/world/growth/cover.js); nothing is drawn.

import { readFileSync } from 'node:fs';
import { testMachair, grow } from './mat-machair.js';
import { HABITAT_CELLS } from '../src/world/growth/habitat.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../recipes/${p}.json`, import.meta.url), 'utf8'));

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('mat-growth-sim.mjs')) {
  const growth = load('world/growth');
  const covers = Object.fromEntries(growth.cover.map((sp) => [sp, load(`flora/${sp}`)]));
  const env = { seed: 7, recipes: { growth: { ...growth, cover: growth.cover.filter((s) => s !== 'rushes') }, covers } };
  const hab = testMachair();
  const N = HABITAT_CELLS;
  /** @type {Record<string, Uint8Array>} */ let maps = {};
  const plant = (sp, i, j) => { const m = new Uint8Array(N * N); for (const [di, dj] of [[0, 0], [1, 0], [0, 1]]) m[(j + dj) * N + i + di] = covers[sp].spread.plantStart; maps[sp] = m; };
  plant('thyme', 50, 66); plant('trefoil', 55, 84); plant('clover', 85, 75);
  const area = (m) => m.reduce((a, v) => a + (v > 64 ? 1 : 0), 0);
  // The islet rises at the end of summer (day 27); then a year.
  let day = 27;
  const rows = [['from day 27 (planted)', maps]];
  for (const [label, to] of [['end of autumn (day 42)', 42], ['end of winter (day 56)', 56], ['end of spring (day 70)', 70], ['end of summer (day 84)', 84], ['end of autumn (day 98)', 98]]) {
    maps = grow(hab, env, maps, day, to - day); day = to;
    rows.push([label, maps]);
  }
  console.log('square meters covered (share above 1/4); test patch: 30 x 31 m sandy turf, 31 x 31 m grassy patch');
  for (const [label, m] of rows) console.log(label.padEnd(26), ['thyme', 'clover', 'trefoil'].map((sp) => `${sp} ${String(area(m[sp])).padStart(4)}`).join('   '));
}
