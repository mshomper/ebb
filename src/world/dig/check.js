// @ts-check
// Digging, run for tools/determinism.html (docs/future/13 10.10.8, P2c): a keeper digs ten holes a
// day for a season on a made-up island of soil and a damp bank, two layers each where the spot has
// rested; everything a dig gives is worked out, written as dug events and hole records, saved and
// read back, and then three game days of catch-up later every hole's stage is worked out from its
// record alone. Run twice (and on the page and in a worker), it must come out the same. Pure; runs
// as a worker job (src/core/workers.js) with plain-data arguments.
// Digging deeper (B1 D1): the made-up island has an old hearth and a pond; the keeper digs three
// layers with the blade, sherds come once a pot is fired (from the season's second week), a winter
// fortnight of topsoil digs turns up sleeping toads, and the land's story spots are placed twice.

import { subSeed, hash32 } from '../../core/rng.js';
import { HABITAT_CELLS } from '../growth/habitat.js';
import { groundClass, nextLayer, cellCenter, cellOf } from './layers.js';
import { storySpots, storyAt } from './story.js';
import { sleeperAt, yearOf } from './sleepers.js';
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
  // A pond, for the winter's sleepers.
  for (let j = 84; j < 92; j++) for (let i = 100; i < 106; i++) { h.depthCm[j * HABITAT_CELLS + i] = 40; h.still[j * HABITAT_CELLS + i] = 1; }
  return h;
}

/**
 * One season of digging, then three days later. @param {{ worldSeed: number, dig: any, keepsakes: any, land?: any }} a
 * @returns {{ finds: number, events: number, holes: number, keepsakes: number, worms: number, clay: number, sleepers: number, story: number, storyAgain: number }}
 */
function season(a) {
  const R = a.dig, K = a.keepsakes, seed = subSeed(a.worldSeed, 'dig'), hab = bankHabitat();
  let dig = emptyDig();
  /** @type {any[]} */ let holes = [];
  let nextId = 1, finds = '', keepsakes = 0, worms = 0, clay = 0, sherds = 0;
  const day0 = 28;
  // The old hearth, in the middle of where the keeper digs.
  const [hx, hz] = cellCenter(90 + 90 * HABITAT_CELLS);
  const story = { hearths: [{ x: hx, z: hz }], cache: null };
  for (let day = day0; day < day0 + 14; day++) {
    for (let n = 0; n < 30; n++) {
      // Where the keeper digs today: ten seeded spots near the bank, pressed three times each (three layers, with the blade).
      const m = Math.floor(n / 3);
      const k = (80 + (hash32(seed, day, m, 1) % 20)) + (80 + (hash32(seed, day, m, 2) % 20)) * HABITAT_CELLS;
      const [x, z] = cellCenter(k);
      const hour = day * 24 + 9 + n * 0.5;
      const isOpen = (/** @type {any} */ h) => holeNow(h, hour, h.wetH, R).stage < 3;
      const g = groundClass(x, z, { hab }, R);
      if (!g.cls) continue;
      const hole = holeAt(holes, x, z, isOpen, R);
      const st = storyAt(x, z, story, R.story);
      const nl = nextLayer(g.cls, hole?.depth ?? 0, R, { hearth: st.hearth, blade: true });
      if ('bottom' in nl) continue;
      const ev = seasonEvents(dig.events, day);
      if (rested(ev, k, day, nl.depth)) continue;
      const th = thinning(ev, k, R);
      const f = digFinds({ seed, cell: k, day, layer: nl.layer, depth: nl.depth, season: 2, moisture: hab.moisture[k] / 255,
        rainBefore: day % 5 === 0, frost: false, thin: th.share, budgetLeft: budgetLeft(ev, seed, day, R),
        hearth: st.hearth, nearHearth: st.nearHearth, potFired: day >= day0 + 7 }, R, K);
      dig = { ...dig, events: addEvent(dig.events, { c: k, d: day, l: nl.depth, k: f.keepsake ? 1 : 0 }, R) };
      if (f.keepsake) keepsakes++;
      if (f.worm) worms++;
      if (f.clay === 'yes') clay++;
      finds += `${k}:${day}:${nl.layer}:${f.worm}:${f.clay}:${f.keepsake ? JSON.stringify(f.keepsake) : '-'};`;
      if (f.keepsake?.family === 'sherd') sherds++;
      if (hole) holes = holes.map((h) => (h.id === hole.id ? { ...h, depth: nl.depth, layer: nl.layer } : h));
      else {
        holes.push({ id: `p${nextId}`, kind: 'hole', x, z, yaw: 0, seed: hash32(seed, nextId), size: R.hole.sizeM, placedHour: hour,
          depth: nl.depth, layer: nl.layer, cls: g.cls, dugHour: hour, closedHour: -1, wetH: day % 5 === 0 ? 2 : 0, seep: f.seep, side: 1 });
        nextId++;
        holes = capHoles(holes, isOpen, hour, R).holes;
      }
    }
  }
  // A winter fortnight of topsoil digs round the pond: which find a sleeping toad, and none twice.
  /** @type {{ c: number, y: number }[]} */ let sleepers = [];
  for (let day = 42; day < 56; day++) {
    for (let n = 0; n < 40; n++) {
      const k = (92 + (hash32(seed, day, n, 3) % 22)) + (78 + (hash32(seed, day, n, 4) % 22)) * HABITAT_CELLS;
      const [x, z] = cellCenter(k);
      if (groundClass(x, z, { hab }, R).cls !== 'soil') continue;
      if (sleeperAt(seed, day, k, hab, sleepers, R.sleeper)) { sleepers = [...sleepers, { c: k, y: yearOf(day) }]; finds += `sleeper:${k}:${day};`; }
    }
  }
  dig = { ...dig, sleepers };
  // Saved and read back, then three game days of catch-up: each hole's stage from its record alone.
  const saved = JSON.parse(JSON.stringify({ dig, pieces: { version: 1, list: holes, nextId, arrived: false } }));
  const back = { dig: cleanDig(saved.dig), pieces: cleanPieces(saved.pieces) };
  const later = (day0 + 14) * 24 + 72;
  const stages = back.pieces.list.map((h) => { const s = holeNow(h, later, h.wetH ?? 0, R); return `${h.id}:${s.stage}:${s.dark.toFixed(4)}:${s.gone}`; }).join(';');
  // The land's story spots, placed from its base land and the seed (story.js), twice.
  const spots = a.land ? JSON.stringify(storySpots(a.land, subSeed(a.worldSeed, 'terrain'), a.worldSeed, R.story)) : '';
  const spots2 = a.land ? JSON.stringify(storySpots(a.land, subSeed(a.worldSeed, 'terrain'), a.worldSeed, R.story)) : '';
  return { finds: textHash(finds), events: textHash(JSON.stringify(back.dig)), holes: textHash(stages), keepsakes, worms, clay,
    sleepers: sleepers.length, sherds, story: textHash(spots), storyAgain: textHash(spots2) };
}

/**
 * The check: a season run twice. @param {{ worldSeed: number, dig: any, keepsakes: any, land?: any }} a
 */
export function digCheckJob(a) {
  const one = season(a), two = season(a);
  return { ...one, again: textHash(`${two.finds}:${two.events}:${two.holes}`), first: textHash(`${one.finds}:${one.events}:${one.holes}`) };
}
