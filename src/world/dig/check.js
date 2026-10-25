// @ts-check
// Digging, run for tools/determinism.html (docs/future/13 10.10.8, P2c): a keeper digs ten holes a
// day for a season on a made-up island of soil and a damp bank, two layers each where the spot has
// rested; everything a dig gives is worked out, written as dug events and hole records, saved and
// read back, and then three game days of catch-up later every hole's stage is worked out from its
// record alone. Run twice (and on the page and in a worker), it must come out the same. Pure; runs
// as a worker job (src/core/workers.js) with plain-data arguments.

import { subSeed, hash32 } from '../../core/rng.js';
import { HABITAT_CELLS } from '../growth/habitat.js';
import { groundClass, nextLayer, cellCenter } from './layers.js';
import { rested, thinning, budgetLeft, addEvent, seasonEvents, cleanDig, emptyDig } from './rest.js';
import { digFinds } from './finds.js';
import { holeNow, holeAt, capHoles } from './holes.js';
import { cleanPieces } from '../pieces/model.js';

/** A small text hash (FNV-1a), for comparing whole results. @param {string} s */
function textHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** Soil everywhere, with a damp bank along one band of columns. */
function bankHabitat() {
  const N = HABITAT_CELLS * HABITAT_CELLS, z = () => new Uint8Array(N);
  const h = /** @type {any} */ ({ n: HABITAT_CELLS, open: z().fill(1), depthCm: z(), moisture: z().fill(90), salt: z(), still: z(), sea: z(), grass: z().fill(220), band: z(), sand: z(), rock: z(), soil: z(), clear: z(), hash: 0 });
  for (let j = 0; j < HABITAT_CELLS; j++) for (let i = 90; i < 96; i++) h.moisture[j * HABITAT_CELLS + i] = 200;
  return h;
}

/**
 * One season of digging, then three days later. @param {{ worldSeed: number, dig: any, keepsakes: any }} a
 * @returns {{ finds: number, events: number, holes: number, keepsakes: number, worms: number, clay: number }}
 */
function season(a) {
  const R = a.dig, K = a.keepsakes, seed = subSeed(a.worldSeed, 'dig'), hab = bankHabitat();
  let dig = emptyDig();
  /** @type {any[]} */ let holes = [];
  let nextId = 1, finds = '', keepsakes = 0, worms = 0, clay = 0;
  const day0 = 28;
  for (let day = day0; day < day0 + 14; day++) {
    for (let n = 0; n < 20; n++) {
      // Where the keeper digs today: ten seeded spots near the bank, pressed twice each (two layers).
      const m = n >> 1;
      const k = (80 + (hash32(seed, day, m, 1) % 20)) + (80 + (hash32(seed, day, m, 2) % 20)) * HABITAT_CELLS;
      const [x, z] = cellCenter(k);
      const hour = day * 24 + 9 + n * 0.5;
      const isOpen = (/** @type {any} */ h) => holeNow(h, hour, h.wetH, R).stage < 3;
      const g = groundClass(x, z, { hab }, R);
      if (!g.cls) continue;
      const hole = holeAt(holes, x, z, isOpen, R);
      const nl = nextLayer(g.cls, hole?.depth ?? 0, R);
      if ('bottom' in nl) continue;
      const ev = seasonEvents(dig.events, day);
      if (rested(ev, k, day, nl.depth)) continue;
      const th = thinning(ev, k, R);
      const f = digFinds({ seed, cell: k, day, layer: nl.layer, depth: nl.depth, season: 2, moisture: hab.moisture[k] / 255,
        rainBefore: day % 5 === 0, frost: false, thin: th.share, budgetLeft: budgetLeft(ev, seed, day, R) }, R, K);
      dig = { ...dig, events: addEvent(dig.events, { c: k, d: day, l: nl.depth, k: f.keepsake ? 1 : 0 }, R) };
      if (f.keepsake) keepsakes++;
      if (f.worm) worms++;
      if (f.clay === 'yes') clay++;
      finds += `${k}:${day}:${nl.layer}:${f.worm}:${f.clay}:${f.keepsake ? JSON.stringify(f.keepsake) : '-'};`;
      if (hole) holes = holes.map((h) => (h.id === hole.id ? { ...h, depth: nl.depth, layer: nl.layer } : h));
      else {
        holes.push({ id: `p${nextId}`, kind: 'hole', x, z, yaw: 0, seed: hash32(seed, nextId), size: R.hole.sizeM, placedHour: hour,
          depth: nl.depth, layer: nl.layer, cls: g.cls, dugHour: hour, closedHour: -1, wetH: day % 5 === 0 ? 2 : 0, seep: f.seep, side: 1 });
        nextId++;
        holes = capHoles(holes, isOpen, hour, R).holes;
      }
    }
  }
  // Saved and read back, then three game days of catch-up: each hole's stage from its record alone.
  const saved = JSON.parse(JSON.stringify({ dig, pieces: { version: 1, list: holes, nextId, arrived: false } }));
  const back = { dig: cleanDig(saved.dig), pieces: cleanPieces(saved.pieces) };
  const later = (day0 + 14) * 24 + 72;
  const stages = back.pieces.list.map((h) => { const s = holeNow(h, later, h.wetH ?? 0, R); return `${h.id}:${s.stage}:${s.dark.toFixed(4)}:${s.gone}`; }).join(';');
  return { finds: textHash(finds), events: textHash(JSON.stringify(back.dig)), holes: textHash(stages), keepsakes, worms, clay };
}

/**
 * The check: a season run twice. @param {{ worldSeed: number, dig: any, keepsakes: any }} a
 */
export function digCheckJob(a) {
  const one = season(a), two = season(a);
  return { ...one, again: textHash(`${two.finds}:${two.events}:${two.holes}`), first: textHash(`${one.finds}:${one.events}:${one.holes}`) };
}
