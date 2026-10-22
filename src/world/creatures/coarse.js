// @ts-check
// The creatures step of the hourly tick (docs 11, 12): frogs arriving, settling, growing in number
// and leaving, on the island the player shaped. Pure and worker-safe: seeded randomness only
// (core/rng.js streams keyed by day and frog), det math, so an hour watched and an hour simulated
// while away (S7) give the same frogs. Reads state.ecology (the frog habitat score, the pond's edge,
// the midges) and state.seasons (dormancy); skips until they exist.
//
// The arc (recipes/species/frog.json ecology.arrival):
//   waiting   the pond is right once its best edge scores well enough to hold a frog, for some hours;
//             then at dusk a scout may come: `creature:arrived` (the journal's sign, never "a frog")
//   visiting  after a day, a content scout stays (`creature:settled`, a second frog the next dusk)
//             or moves on (`creature:left`) and none tries again for a while
//   settled   at dusk, while frogs are content and the edge has room, another comes now and then
//             (`creature:joined`); an unhappy frog, or one too many for the edge, moves on, at most
//             one a day (`creature:left`); a big content group is happy once (`species:happy`)
// In winter frogs sleep in the pond mud (`creature:dormant`, then `creature:woke`): mood is held and
// nothing changes. Positions are each frog's home on the bank; S6b animates them from there.
// Each hour also applies the trust live play recorded (trust.js; `creature:trusted` when a frog's
// word moves up).
//
// State contract: coarseStep never mutates its input; it returns a shallow copy of `state` with a
// fresh `state.creatures`.

import { stream, subSeed, hash32, det } from '../../core/rng.js';
import { HOURS_PER_DAY } from '../../core/clock.js';
import { moodOf, companyOf, foodAt, goodEdge, cellCenter } from '../ecology/habitat.js';
import { ecologyNow } from '../ecology/coarse.js';
import { applyTrust } from './trust.js';

/**
 * @typedef {Object} Frog
 * @property {number} id
 * @property {number} k      home square on the habitat grid
 * @property {number} x @property {number} z  world meters, at the water's edge of the home square
 * @property {number} yaw    radians, 0 faces +z; facing the water, give or take
 * @property {number} since  hour it came
 * @property {number} mood   0..1, easing toward the habitat's answer
 * @property {number} low    hours in a row under leaveMood
 * @property {string[]} near the cover plants within its shelter reach (for the journal's web)
 * @property {number} [trust] how well it knows you, 0..1, only ever growing (trust.js; absent is 0)
 * @property {number} [fedAt] the hour it last ate food you offered (S6c-2; absent: never)
 * @property {string} [name] the name you gave it (S6c-3); named frogs are the last to leave
 * @property {number} [namedAt] the hour you named it
 */

/**
 * @typedef {Object} FrogsState
 * @property {'waiting'|'visiting'|'settled'} phase
 * @property {number} rightFor   hours in a row the pond has been right
 * @property {boolean} right     the pond has been right at least once (the journal's hint)
 * @property {number} waited     dusks a scout could have come and did not
 * @property {number} cooldownUntil  no scout before this hour
 * @property {number} lastJoin @property {number} lastLeft  hours, -1 before
 * @property {boolean} joinDue   a second frog comes at the next dusk
 * @property {number} happyFor @property {boolean} happy
 * @property {boolean} dormant
 * @property {number} arrivals   frogs that have ever come
 * @property {number} nextId
 * @property {Frog[]} frogs
 * @property {{ metres: number, capacity: number, bestScore: number }} edge  the good edge now
 * @property {import('./trust.js').TrustEvent[]} [pending]  trust earned in live play, for the next hour
 */

/** @returns {{ frogs: FrogsState }} */
export function initialCreatures() {
  return {
    frogs: { phase: 'waiting', rightFor: 0, right: false, waited: 0, cooldownUntil: -1, lastJoin: -1, lastLeft: -1, joinDue: false,
      happyFor: 0, happy: false, dormant: false, arrivals: 0, nextId: 1, frogs: [], edge: { metres: 0, capacity: 0, bestScore: 0 } },
  };
}

/** The four sides of a square, in a fixed order. @param {number} k @param {number} n */
const sides = (k, n) => [k - 1, k + 1, k - n, k + n];

/**
 * Where a frog sits in its home square: at the water's edge, a little off the middle, facing the
 * water give or take. @param {number} k @param {number} id @param {any} hab @param {number} seed
 */
function seat(k, id, hab, seed) {
  const n = hab.n;
  const [cx, cz] = cellCenter(k, n);
  let wx = cx, wz = cz;
  for (const q of sides(k, n)) {
    if (q >= 0 && q < n * n && hab.still[q] && !hab.sea[q]) { [wx, wz] = cellCenter(q, n); break; }
  }
  const h = hash32(seed, id, k);
  const u = ((h & 1023) / 1023 - 0.5) * 0.3, v = (((h >>> 10) & 1023) / 1023 - 0.5) * 0.3;
  const turn = (((h >>> 20) & 1023) / 1023 - 0.5) * 1.2;
  return { x: cx + (wx - cx) * 0.35 + u, z: cz + (wz - cz) * 0.35 + v, yaw: det.atan2(wx - cx, wz - cz) + turn };
}

/**
 * The cover plants within reach of a home, by name (reeds, rushes, iris, lilies, grass).
 * @param {number} k @param {any} hab @param {any} growth @param {any} shelter the recipe's shelter need
 */
function nearCover(k, hab, growth, shelter) {
  const n = hab.n, r = Math.round(shelter.radiusM);
  const i = k % n, j = Math.floor(k / n);
  const [cx, cz] = cellCenter(k, n);
  /** @type {string[]} */ const out = [];
  for (const sp of Object.keys(shelter.cover)) {
    let found = false;
    if (sp === 'grass' || growth?.cover?.[sp]) {
      for (let b = Math.max(0, j - r); b <= Math.min(n - 1, j + r) && !found; b++) {
        for (let a = Math.max(0, i - r); a <= Math.min(n - 1, i + r) && !found; a++) {
          const q = b * n + a;
          const share = sp === 'grass' ? (growth?.grass ? (hab.grass[q] * growth.grass[q]) / (255 * 255) : 0) : growth.cover[sp][q] / 255;
          if (share > 0.25 && !hab.sea[q]) found = true;
        }
      }
    } else {
      for (const p of growth?.plants ?? []) {
        if (p.sp === sp && Math.abs(p.x - cx) <= r + 0.5 && Math.abs(p.z - cz) <= r + 0.5) { found = true; break; }
      }
    }
    if (found) out.push(sp);
  }
  return out;
}

/**
 * What a frog's home gives it now: the five needs with the frogs around it, as a mood target.
 * @param {Frog} f @param {Frog[]} all @param {any} eco state.ecology @param {any} hab @param {any} N the recipe's needs
 */
function targetMood(f, all, eco, hab, N) {
  const n = hab.n;
  const reach2 = N.company.reachM * N.company.reachM, food2 = N.food.radiusM * N.food.radiusM;
  let company = 0, eating = 0;
  for (const g of all) {
    const d2 = (g.x - f.x) * (g.x - f.x) + (g.z - f.z) * (g.z - f.z);
    if (d2 <= reach2) company++;
    if (d2 <= food2) eating++;
  }
  const F = eco.frogs;
  const s = {
    water: F.water[f.k] / 255,
    food: foodAt(eco.midges, n, f.k % n, Math.floor(f.k / n), N.food, Math.max(1, eating)),
    shelter: F.shelter[f.k] / 255,
    quiet: 1,
    company: companyOf(company, N.company),
  };
  return F.score[f.k] === 0 ? 0 : moodOf(s, N);
}

/**
 * Bank squares free for a new frog, best first: scoring at least `min`, not too close to a frog
 * already there; ties go to the seeded hash, so the same island picks the same spot.
 * @param {any} eco @param {Frog[]} frogs @param {number} min 0..1 @param {number} apart m @param {number} seed
 */
function freeHomes(eco, frogs, min, apart, seed) {
  const { cells } = eco.frogs.edge;
  const score = eco.frogs.score;
  const n = Math.round(Math.sqrt(score.length));
  /** @type {{ k: number, s: number, h: number }[]} */ const out = [];
  for (const k of cells) {
    const s = score[k];
    if (s < 255 * min) continue;
    const [x, z] = cellCenter(k, n);
    if (frogs.some((f) => (f.x - x) * (f.x - x) + (f.z - z) * (f.z - z) < apart * apart)) continue;
    out.push({ k, s, h: hash32(seed, k) });
  }
  out.sort((a, b) => b.s - a.s || a.h - b.h);
  return out;
}

/**
 * A test shortcut for click-testing (`?frogs=N`, src/app.js), never used by the game itself: frogs
 * come now instead of over days. The pond is marked right; one frog comes as a scout (the sign,
 * then settling a day later as usual), or with N of 2 or more, N frogs are already settled. They
 * take the best free bank squares. Pure; returns the same events the hourly tick would.
 * @param {any} state @param {number} hourIndex @param {any} env @param {number} count
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function bringFrogs(state, hourIndex, env, count) {
  const hab = env.habitat?.();
  const rec = env.recipes?.species?.frog;
  if (!hab || !rec || count < 1) return { state, events: [] };
  if (!state.ecology?.frogs) state = { ...state, ecology: ecologyNow(state, env, true) };
  const eco = state.ecology;
  const E = rec.ecology, A = E.arrival, N = E.needs;
  const prev = state.creatures?.frogs ?? initialCreatures().frogs;
  /** @type {FrogsState} */
  const fr = { ...prev, frogs: prev.frogs.map((f) => ({ ...f })) };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const seed = subSeed(env.seed, 'frogs');
  if (!fr.right) {
    fr.right = true;
    const edge = goodEdge(eco.frogs.edge, eco.frogs.score, E);
    const [x, z] = cellCenter(edge.best, hab.n);
    events.push({ name: 'creature:habitat-right', payload: { species: 'frogs', x, z } });
  }
  fr.rightFor = Math.max(fr.rightFor, A.scoutAfterH);
  // The good edge; on a brand-new world the midges have not gathered yet, so any bank square will do.
  let homes = freeHomes(eco, fr.frogs, E.edge.goodScore, A.homeApartM, seed);
  if (homes.length < count) homes = freeHomes(eco, fr.frogs, 0.01, A.homeApartM, seed);
  for (let i = 0; i < count && i < homes.length; i++) {
    const k = homes[i].k, id = fr.nextId++;
    /** @type {Frog} */ const f = { id, k, ...seat(k, id, hab, seed), since: hourIndex, mood: 1, low: 0, near: nearCover(k, hab, state.growth, N.shelter) };
    fr.frogs.push(f);
    fr.arrivals++;
    const first = fr.frogs.length === 1;
    events.push({ name: first ? 'creature:arrived' : 'creature:joined', payload: { species: 'frogs', id, x: f.x, z: f.z, scout: first, count: fr.frogs.length } });
  }
  if (fr.frogs.length >= 2 && fr.phase !== 'settled') {
    fr.phase = 'settled';
    fr.lastJoin = hourIndex;
    events.push({ name: 'creature:settled', payload: { species: 'frogs', id: fr.frogs[0].id, x: fr.frogs[0].x, z: fr.frogs[0].z } });
  } else if (fr.frogs.length === 1) fr.phase = 'visiting';
  events.push(...applyTrust(fr, rec.presence, env.testTrust ?? 0, rec.feed?.fullH));
  return { state: { ...state, creatures: { ...(state.creatures ?? {}), frogs: fr } }, events };
}

/** The hour of the day dusk falls (an hour after sunset by default). @param {any} seasons @param {any} A */
function duskHour(seasons, A) {
  const dayLength = seasons?.dayLengthH ?? 12;
  return Math.floor(12 + dayLength / 2 + A.duskOffsetH) % HOURS_PER_DAY;
}

/**
 * One game hour of creatures.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  const hab = env.habitat?.();
  const rec = env.recipes?.species?.frog;
  const eco = state.ecology;
  if (!hab || !rec || !eco?.frogs || !eco.midges) return { state, events: [] };
  const E = rec.ecology, A = E.arrival, N = E.needs;
  // Other species may be in state.creatures before the frogs are (minnows, dragonflies).
  const prev = state.creatures?.frogs ?? initialCreatures().frogs;
  /** @type {FrogsState} */
  const fr = { ...prev, frogs: prev.frogs.map((f) => ({ ...f })) };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const seed = subSeed(env.seed, 'frogs');
  const day = Math.floor(hourIndex / HOURS_PER_DAY);
  const atDusk = hourIndex % HOURS_PER_DAY === duskHour(state.seasons, A);
  const pay = (/** @type {any} */ p) => ({ species: 'frogs', ...p });

  // How good the pond's edge is now, and whether it is right for frogs.
  const edge = goodEdge(eco.frogs.edge, eco.frogs.score, E);
  fr.edge = { metres: Math.round(edge.metres * 10) / 10, capacity: edge.capacity, bestScore: Math.round(edge.bestScore * 1000) / 1000 };
  const right = edge.bestScore >= A.rightScore && edge.capacity >= 1;
  fr.rightFor = right ? fr.rightFor + 1 : 0;
  if (!fr.right && fr.rightFor >= A.rightHoldH) {
    fr.right = true;
    const [x, z] = cellCenter(edge.best, hab.n);
    events.push({ name: 'creature:habitat-right', payload: pay({ x, z }) });
  }

  // Standing presence (docs/future/13 CP-13): only in catch-up, once a game day, a frog that already
  // tolerates you and lives near the camp knows it a little better for the camp being there.
  const S = /** @type {any} */ (env).awayCamp;
  if (S && hourIndex % HOURS_PER_DAY === 0) {
    for (const f of fr.frogs) {
      if ((f.trust ?? 0) < rec.presence.bands[0] || (f.x - S.x) * (f.x - S.x) + (f.z - S.z) * (f.z - S.z) > S.reachM * S.reachM) continue;
      fr.pending = [...(fr.pending ?? []), { kind: 'camp', id: f.id, hour: hourIndex, gain: S.trust }];
    }
  }
  // Trust earned since the last hour (watching, feeding, the camp), and `?trust=` when testing.
  events.push(...applyTrust(fr, rec.presence, env.testTrust ?? 0, rec.feed?.fullH));

  // Winter: asleep in the pond mud, mood held, nothing comes or goes.
  const dormant = !!state.seasons?.dormant?.[E.dormancy];
  if (dormant !== fr.dormant) {
    fr.dormant = dormant;
    if (fr.frogs.length) events.push({ name: dormant ? 'creature:dormant' : 'creature:woke', payload: pay({ count: fr.frogs.length }) });
  }
  if (dormant) return done();

  // Each frog: a home that is still a bank square (else the nearest good one within reach), then
  // its mood eases toward what the home gives it.
  const edgeSet = new Set(eco.frogs.edge.cells);
  for (const f of fr.frogs) {
    if (!edgeSet.has(f.k) || eco.frogs.score[f.k] === 0) {
      const others = fr.frogs.filter((g) => g !== f);
      const near = freeHomes(eco, others, 0.01, A.homeApartM, seed)
        .filter((c) => { const [x, z] = cellCenter(c.k, hab.n); return (x - f.x) * (x - f.x) + (z - f.z) * (z - f.z) <= 64; });
      if (near.length) Object.assign(f, { k: near[0].k }, seat(near[0].k, f.id, hab, seed));
    }
  }
  for (const f of fr.frogs) {
    const t = targetMood(f, fr.frogs, eco, hab, N);
    f.mood = Math.round((f.mood + A.moodEase * (t - f.mood)) * 10000) / 10000;
    f.low = f.mood < A.leaveMood ? f.low + 1 : 0;
    f.near = nearCover(f.k, hab, state.growth, N.shelter);
  }
  const mean = fr.frogs.length ? fr.frogs.reduce((s, f) => s + f.mood, 0) / fr.frogs.length : 0;

  /** A new frog at a home square. @param {number} k */
  const newFrog = (k) => {
    const id = fr.nextId++;
    /** @type {Frog} */ const f = { id, k, ...seat(k, id, hab, seed), since: hourIndex, mood: 0, low: 0, near: [] };
    f.mood = Math.round(targetMood(f, [...fr.frogs, f], eco, hab, N) * 10000) / 10000;
    f.near = nearCover(k, hab, state.growth, N.shelter);
    fr.frogs.push(f);
    fr.arrivals++;
    return f;
  };
  /** A frog moves on. @param {Frog} f @param {string} why */
  const leave = (f, why) => {
    fr.frogs = fr.frogs.filter((g) => g !== f);
    fr.lastLeft = hourIndex;
    events.push({ name: 'creature:left', payload: pay({ id: f.id, x: f.x, z: f.z, why, count: fr.frogs.length, ...(f.name ? { frogName: f.name } : {}) }) });
    if (!fr.frogs.length) { fr.phase = 'waiting'; fr.cooldownUntil = hourIndex + A.rescoutAfterH; fr.happyFor = 0; }
  };

  if (fr.phase === 'waiting') {
    // A scout, at dusk, once the pond has been right a while: seeded by the day, surely by the last wait.
    if (atDusk && fr.rightFor >= A.scoutAfterH && hourIndex >= fr.cooldownUntil) {
      const roll = stream(seed, 1, day).next();
      if (roll < A.scoutChance || fr.waited + 1 >= A.maxWaitDusks) {
        const homes = freeHomes(eco, fr.frogs, A.rightScore, A.homeApartM, seed);
        if (homes.length) {
          // One of the few best squares, by the day's roll.
          const pick = homes[stream(seed, 2, day).int(Math.min(5, homes.length))];
          const f = newFrog(pick.k);
          fr.phase = 'visiting';
          fr.waited = 0;
          events.push({ name: 'creature:arrived', payload: pay({ id: f.id, x: f.x, z: f.z, scout: true }) });
        }
      } else fr.waited++;
    }
  } else if (fr.phase === 'visiting') {
    const scout = fr.frogs[0];
    if (scout && hourIndex - scout.since >= A.settleAfterH) {
      if (scout.mood >= A.settleMood) {
        fr.phase = 'settled';
        fr.joinDue = true;
        events.push({ name: 'creature:settled', payload: pay({ id: scout.id, x: scout.x, z: scout.z }) });
      } else leave(scout, 'scout');
    }
  } else {
    // Another comes at dusk now and then, while they are content and the edge has room.
    if (atDusk && fr.frogs.length < edge.capacity && mean >= A.joinMood && (fr.joinDue || hourIndex - fr.lastJoin >= HOURS_PER_DAY - 4)) {
      const roll = stream(seed, 3, day).next();
      if (fr.joinDue || roll < A.joinChance) {
        // The best free square, nearest the others among the best few.
        const homes = freeHomes(eco, fr.frogs, E.edge.goodScore, A.homeApartM, seed).slice(0, 8);
        if (homes.length) {
          const cx = fr.frogs.reduce((s, f) => s + f.x, 0) / fr.frogs.length, cz = fr.frogs.reduce((s, f) => s + f.z, 0) / fr.frogs.length;
          let best = homes[0], bestD = Infinity;
          for (const c of homes) {
            const [x, z] = cellCenter(c.k, hab.n);
            const d = Math.round(((x - cx) * (x - cx) + (z - cz) * (z - cz)) * 100);
            if (d < bestD) { bestD = d; best = c; }
          }
          const f = newFrog(best.k);
          fr.joinDue = false;
          fr.lastJoin = hourIndex;
          events.push({ name: 'creature:joined', payload: pay({ id: f.id, x: f.x, z: f.z, count: fr.frogs.length }) });
        }
      }
      if (!fr.joinDue) fr.lastJoin = hourIndex;
    }
    // One moves on at most once a day: a frog unhappy too long, or one too many for the edge. Frogs
    // you have named are the last to go (S6c-3): an unnamed one goes first while there is one.
    if (fr.frogs.length && (fr.lastLeft < 0 || hourIndex - fr.lastLeft >= A.leaveEveryH)) {
      const crowded = fr.frogs.length > edge.capacity;
      const unhappy = fr.frogs.filter((f) => f.low >= A.leaveAfterH);
      const pool = unhappy.length ? unhappy : crowded ? fr.frogs : [];
      if (pool.length) {
        const unnamed = pool.filter((f) => !f.name);
        const from = unnamed.length ? unnamed : pool;
        let worst = from[0];
        for (const f of from) if (f.mood < worst.mood || (f.mood === worst.mood && f.id > worst.id)) worst = f;
        leave(worst, unhappy.length ? 'habitat' : 'crowded');
      }
    }
    // Happy once: a big content group for a day.
    const meanNow = fr.frogs.length ? fr.frogs.reduce((s, f) => s + f.mood, 0) / fr.frogs.length : 0;
    fr.happyFor = fr.frogs.length >= A.happyMin && meanNow >= A.happyMood ? fr.happyFor + 1 : 0;
    if (!fr.happy && fr.happyFor >= A.happyHoldH) {
      fr.happy = true;
      events.push({ name: 'species:happy', payload: pay({ gift: E.gift }) });
    }
  }
  return done();

  function done() {
    return { state: { ...state, creatures: { ...(state.creatures ?? {}), frogs: fr } }, events };
  }
}
