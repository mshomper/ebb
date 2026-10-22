// @ts-check
// Schools and swarms in the hourly tick (docs 11, 12; M2): minnows, then dragonflies. One model for
// every species whose recipe says ecology.kind 'swarm': no single animals with homes and names, but
// a group per pool that suits them, a count that grows toward what the pool holds and shrinks when
// it fails. Pure and worker-safe: seeded randomness only (core/rng.js streams keyed by the species
// and the day), so an hour watched and an hour simulated while away give the same groups. Reads
// state.ecology[key] (the habitat score and the pools, src/world/ecology/coarse.js) and
// state.seasons (dormancy); skips until they exist.
//
// The arc (the recipe's ecology.arrival), told in the same events as the frogs':
//   waiting   a pool is right once its best square scores rightScore and it has room, for
//             rightHoldH hours (`creature:habitat-right`); then at comeAtH o'clock a few may come,
//             with scoutChance a day and surely by maxWaitDays (`creature:arrived`, the sign)
//   visiting  after settleAfterH, a content group stays (`creature:settled`) or moves on
//   settled   each day at comeAtH a content group grows by growShare of the room left
//             (`creature:joined` with the new count), in the seasons growSeasons allows; another
//             right pool may get its own group (newPoolChance a day); a group under leaveMood for
//             leaveAfterH loses shrinkShare a day, and one whose pool is gone moves on at once
//             (`creature:left`); enough of them content for a day is happy, once (`species:happy`)
//   grace     (A9, leaveGraceDays) when a settled group's pool starts failing it (unhappy, no longer
//             suitable, its margin dried), it is uneasy (`creature:uneasy` with why) and waits that
//             many days before it thins or moves on; if the pool comes right again it settles
//             (`creature:eased`). Only a pool that is gone (filled or drained) sends it away at once.
// In a dormancy window (dragonflies' nymph months) mood is held and nothing comes or goes.
//
// State (state.creatures[key]): see SwarmState. A group's pool is found again each hour from its
// home square (the ecology step lists, per pool, the groups whose home lies in it).

import { stream, subSeed, det } from '../../core/rng.js';
import { HOURS_PER_DAY } from '../../core/clock.js';
import { cellCenter } from '../ecology/habitat.js';
import { ecologyNow } from '../ecology/coarse.js';
import { trustWord, maxTrust } from './trust.js';
import { swarmSpecies, keyOf } from '../species.js';

/**
 * @typedef {Object} Group
 * @property {number} id
 * @property {number} k      home square (its pool's best)
 * @property {number} x @property {number} z  world meters, the middle of the home square
 * @property {number} count  how many
 * @property {number} mood   0..1, easing toward what the pool gives
 * @property {number} low    hours in a row under leaveMood
 * @property {number} since  hour it came
 * @property {number} [uneasy] hour its pool started failing it (absent while all is well)
 * @property {string} [why]    what is failing: fish, margin, shallow, water, food, shelter or habitat
 */

/**
 * @typedef {Object} SwarmState
 * @property {'waiting'|'visiting'|'settled'} phase
 * @property {number} rightFor  hours in a row some pool has been right
 * @property {boolean} right    a pool has been right at least once (the journal's hint)
 * @property {number} waited    days they could have come and did not
 * @property {number} cooldownUntil @property {number} lastLeft
 * @property {number} happyFor @property {boolean} happy @property {boolean} dormant
 * @property {number} arrivals  groups that have ever come
 * @property {number} nextId
 * @property {Group[]} groups
 * @property {number} [trust]  how well the species here knows you, 0..1, only ever growing (doc 23; absent is 0)
 * @property {number} [fedAt] the hour they last ate food you offered
 * @property {{ kind: 'watched'|'fed', minutes?: number, hour: number }[]} [pending]  trust earned in live play, for the next hour
 */

/** @returns {SwarmState} */
export function initialSwarm() {
  return { phase: 'waiting', rightFor: 0, right: false, waited: 0, cooldownUntil: -1, lastLeft: -1, happyFor: 0, happy: false, dormant: false,
    arrivals: 0, nextId: 1, groups: [] };
}

/**
 * How many a pool holds: one per m2PerOne of good depth, up to the biggest group (company n[2]);
 * plants that make room (pondweed for minnows: pool.weed) add weedM2 square meters each and raise
 * that cap by perWeed each, up to weedExtra more. @param {any} pool @param {any} rec
 */
export function roomOf(pool, rec) {
  if (!pool) return 0;
  const A = rec.ecology.arrival, C = rec.ecology.needs.company;
  const weed = pool.weed ?? 0;
  const cap = C.n[2] + Math.min(A.weedExtra ?? 0, Math.floor(weed * (A.perWeed ?? 0)));
  return Math.min(cap, Math.floor((pool.room + weed * (A.weedM2 ?? 0)) / A.m2PerOne));
}

/**
 * What a group's pool gives it: the pool's best score (all needs at the ideal group) with the
 * company of its own count instead.
 * @param {any} pool @param {number} count @param {any} N the recipe's needs
 */
export function groupMood(pool, count, N) {
  // A pond that no longer suits them (dragonflies: fish have moved in) gives no mood: they thin
  // and move on as from any unhappy pond.
  if (!pool || pool.bestScore <= 0 || pool.fit === false) return 0;
  const C = N.company;
  const [lo, , hi] = C.n;
  let c = 1;
  if (count < lo) c = C.alone + ((1 - C.alone) * Math.max(0, count - 1)) / Math.max(1, lo - 1);
  else if (count > hi) c = Math.max(C.crowded, 1 - ((1 - C.crowded) * (count - hi)) / hi);
  return Math.min(1, pool.bestScore * det.exp(C.w * det.log(Math.max(c, 0.01))));
}

/**
 * What is failing a group's pool, in one word for the journal: fish moved in, the shaped margin
 * gone (dried, or filled), too little shallow water (the dragonflies' pond rule), else the weakest
 * of its needs at the pool's best square (pool.low, ecology/coarse.js). Pure.
 * @param {any} pool @param {any} E the recipe's ecology
 */
export function whyFailing(pool, E) {
  if (pool.fit === false) {
    if (pool.fish) return 'fish';
    if (E.pond && pool.margin < E.pond.marginM2) return 'margin';
    return 'shallow';
  }
  return pool.low ?? 'habitat';
}

/** Rounded to 4 places, as the frogs' moods are. @param {number} v */
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Pools that are right: the best square scores rightScore, there is room for at least a few, and
 * (a species with a pond rule) it is a pond of the kind it wants (fit, ecology/coarse.js pondFit).
 * @param {any[]} pools @param {any} rec
 */
const rightPools = (pools, rec) => pools.filter((p) => p.fit !== false && p.bestScore >= rec.ecology.arrival.rightScore && roomOf(p, rec) >= rec.ecology.arrival.startCount);

/**
 * One species' hour. @param {any} state @param {number} hourIndex @param {any} env @param {any} rec
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function swarmStep(state, hourIndex, env, rec) {
  const key = keyOf(rec);
  const eco = state.ecology?.[key];
  if (!eco || !rec.ecology.arrival) return { state, events: [] };
  const E = rec.ecology, A = E.arrival, N = E.needs;
  const prev = state.creatures?.[key] ?? initialSwarm();
  /** @type {SwarmState} */
  const S = { ...prev, groups: prev.groups.map((g) => ({ ...g })) };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const seed = subSeed(env.seed, key);
  const day = Math.floor(hourIndex / HOURS_PER_DAY);
  const atHour = hourIndex % HOURS_PER_DAY === A.comeAtH;
  const pay = (/** @type {any} */ p) => ({ species: key, ...p });
  const n = Math.round(Math.sqrt(eco.score.length));
  /** @type {any[]} */ const pools = eco.pools ?? [];

  // Is some pool right for them now?
  const right = rightPools(pools, rec);
  S.rightFor = right.length ? S.rightFor + 1 : 0;
  if (!S.right && S.rightFor >= A.rightHoldH) {
    S.right = true;
    const best = right.slice().sort((a, b) => b.bestScore - a.bestScore || a.best - b.best)[0];
    const [x, z] = cellCenter(best.best, n);
    events.push({ name: 'creature:habitat-right', payload: pay({ x, z }) });
  }

  // Trust earned in live play since the last hour (watching quietly, feeding): one for the species
  // here, never lower (doc 23), up to its ceiling.
  events.push(...applySwarmTrust(S, rec.presence, key));

  const dormant = !!(E.dormancy && state.seasons?.dormant?.[E.dormancy]);
  if (dormant !== S.dormant) {
    S.dormant = dormant;
    if (S.groups.length) events.push({ name: dormant ? 'creature:dormant' : 'creature:woke', payload: pay({ count: total(S) }) });
  }
  if (dormant) return done();

  // Each group: its pool (by its home), re-homed to the pool's best square, its mood eased.
  /** @type {Map<number, any>} */ const poolOf = new Map();
  for (const p of pools) for (const id of p.groups ?? []) if (!poolOf.has(id)) poolOf.set(id, p);
  for (const g of S.groups) {
    const p = poolOf.get(g.id);
    if (p && p.best >= 0 && p.best !== g.k) { g.k = p.best; [g.x, g.z] = cellCenter(p.best, n); }
    const t = groupMood(p, g.count, N);
    g.mood = r4(g.mood + A.moodEase * (t - g.mood));
    g.low = g.mood < A.leaveMood ? g.low + 1 : 0;
  }

  /** A group moves on. @param {Group} g @param {string} why */
  const leave = (g, why) => {
    S.groups = S.groups.filter((h) => h !== g);
    S.lastLeft = hourIndex;
    events.push({ name: 'creature:left', payload: pay({ id: g.id, x: g.x, z: g.z, why, count: total(S), gone: g.count }) });
    if (!S.groups.length) { S.phase = 'waiting'; S.cooldownUntil = hourIndex + A.rescoutAfterH; S.happyFor = 0; }
  };
  // Grace (A9): a settled group whose pool starts failing it waits leaveGraceDays before it goes,
  // and says why, so the player can put it right. Without a grace, as before.
  const graceH = (A.leaveGraceDays ?? 0) * HOURS_PER_DAY;
  const graceOver = (/** @type {Group} */ g) => graceH <= 0 || (g.uneasy !== undefined && hourIndex - g.uneasy >= graceH);
  if (graceH > 0 && S.phase === 'settled') {
    for (const g of S.groups) {
      const p = poolOf.get(g.id);
      if (!p) continue;
      const failing = p.bestScore <= 0 || p.fit === false || g.mood < A.leaveMood;
      if (failing && g.uneasy === undefined) {
        g.uneasy = hourIndex;
        g.why = whyFailing(p, E);
        events.push({ name: 'creature:uneasy', payload: pay({ id: g.id, x: g.x, z: g.z, why: g.why, pool: p.id, leaveAt: hourIndex + graceH }) });
      } else if (!failing && g.uneasy !== undefined) {
        delete g.uneasy;
        delete g.why;
        events.push({ name: 'creature:eased', payload: pay({ id: g.id, x: g.x, z: g.z }) });
      }
    }
  }
  // A pool gone (filled in, drained) sends its group away at once; one grown unsuitable, once the
  // grace is over (they leave, they never die).
  for (const g of S.groups.slice()) {
    const p = poolOf.get(g.id);
    if (!p || (p.bestScore <= 0 && graceOver(g))) leave(g, g.why ?? 'habitat');
  }

  /** A new group in a pool. @param {any} p */
  const newGroup = (p) => {
    const id = S.nextId++;
    const [x, z] = cellCenter(p.best, n);
    /** @type {Group} */ const g = { id, k: p.best, x, z, count: A.startCount, mood: 0, low: 0, since: hourIndex };
    g.mood = r4(groupMood(p, g.count, N));
    S.groups.push(g);
    S.arrivals++;
    return g;
  };
  /** Right pools with no group in them, best first (ties to the lower square). */
  const freePools = () => right.filter((p) => !(p.groups ?? []).some((/** @type {number} */ id) => S.groups.some((g) => g.id === id)))
    .filter((p) => !S.groups.some((g) => g.k === p.best))
    .sort((a, b) => b.bestScore - a.bestScore || a.best - b.best);

  if (S.phase === 'waiting') {
    if (atHour && S.rightFor >= A.scoutAfterH && hourIndex >= S.cooldownUntil) {
      if (stream(seed, 1, day).next() < A.scoutChance || S.waited + 1 >= A.maxWaitDays) {
        const free = freePools();
        if (free.length) {
          const g = newGroup(free[0]);
          S.phase = 'visiting';
          S.waited = 0;
          events.push({ name: 'creature:arrived', payload: pay({ id: g.id, x: g.x, z: g.z, scout: true, count: g.count }) });
        }
      } else S.waited++;
    }
  } else if (S.phase === 'visiting') {
    const g = S.groups[0];
    if (g && hourIndex - g.since >= A.settleAfterH) {
      if (g.mood >= A.settleMood) {
        S.phase = 'settled';
        events.push({ name: 'creature:settled', payload: pay({ id: g.id, x: g.x, z: g.z, count: g.count }) });
      } else leave(g, 'scout');
    }
  } else {
    const season = Math.min(3, Math.max(0, state.seasons?.index ?? 0));
    if (atHour && A.growSeasons[season]) {
      // Each content group grows toward what its pool holds.
      for (const g of S.groups) {
        const room = roomOf(poolOf.get(g.id), rec);
        if (g.mood < A.growMood || g.count >= room) continue;
        const added = Math.max(1, Math.ceil(A.growShare * (room - g.count)));
        g.count += added;
        events.push({ name: 'creature:joined', payload: pay({ id: g.id, x: g.x, z: g.z, count: g.count, total: total(S), added }) });
      }
      // Now and then a group starts in another pool that suits them.
      const free = freePools();
      if (free.length && stream(seed, 3, day).next() < A.newPoolChance) {
        const g = newGroup(free[0]);
        events.push({ name: 'creature:joined', payload: pay({ id: g.id, x: g.x, z: g.z, count: g.count, total: total(S), added: g.count, pool: true }) });
      }
      // A group unhappy too long thins out, a share a day; too few left and it has moved on.
      for (const g of S.groups.slice()) {
        if (g.low < A.leaveAfterH || !graceOver(g)) continue;
        const lose = Math.max(1, Math.ceil(A.shrinkShare * g.count));
        if (g.count - lose < A.startCount) leave(g, g.why ?? 'habitat');
        else { g.count -= lose; events.push({ name: 'creature:thinned', payload: pay({ id: g.id, count: g.count, total: total(S) }) }); }
      }
    }
    const content = S.groups.filter((g) => g.mood >= A.happyMood).reduce((s, g) => s + g.count, 0);
    S.happyFor = content >= A.happyMin ? S.happyFor + 1 : 0;
    if (!S.happy && S.happyFor >= A.happyHoldH) {
      S.happy = true;
      events.push({ name: 'species:happy', payload: pay({ gift: E.gift }) });
    }
  }
  return done();

  function done() {
    return { state: { ...state, creatures: { ...(state.creatures ?? {}), [key]: S } }, events };
  }
}

/**
 * A species recipe for a test link: its pools need no deep spot and no pond of the player's
 * making, so a new island can be tested before anything is dug. @param {any} rec
 */
export function testRecipe(rec) {
  const W = rec.ecology.needs.water;
  // No pond rule either (dragonflies: a fish-free pond the player shaped), so any pond will do.
  const { pond, ...ecology } = rec.ecology;
  void pond;
  if (!W.body) return { ...rec, ecology };
  return { ...rec, ecology: { ...ecology, needs: { ...ecology.needs, water: { ...W, body: { ...W.body, deepM: 0 } } } } };
}

/**
 * Trust live play recorded for a school species (watching it quietly, feeding it), for the next
 * hourly tick to apply (doc 23). Pure: a new state.
 * @param {any} state @param {string} key @param {{ kind: 'watched'|'fed', minutes?: number, hour: number }} ev
 */
export function addSwarmEvent(state, key, ev) {
  const S = state?.creatures?.[key];
  if (!S || !S.groups.length) return state;
  return { ...state, creatures: { ...state.creatures, [key]: { ...S, pending: [...(S.pending ?? []), ev] } } };
}

/**
 * Apply the recorded trust (changes S in place): watching earns trustPerMin a minute, a meal
 * feedTrust (less if they ate within feed fullH hours), never past the ceiling; `creature:trusted`
 * when the word moves up. @param {any} S @param {any} P the recipe's presence @param {string} key
 */
export function applySwarmTrust(S, P, key) {
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const list = S.pending ?? [];
  if (!list.length || !P?.bands) { if (S.pending) delete S.pending; return events; }
  const before = S.trust ?? 0;
  let t = before;
  for (const ev of list) {
    if (ev.kind === 'watched') t += (P.watch?.trustPerMin ?? 0) * (ev.minutes ?? 0);
    else if (ev.kind === 'fed') {
      const full = P.fullH ?? 6;
      const hungry = S.fedAt === undefined ? 1 : Math.max(0, Math.min(1, (ev.hour - S.fedAt) / full));
      t += (P.feedTrust ?? 0) * (0.25 + 0.75 * hungry);
      S.fedAt = ev.hour;
      events.push({ name: 'creature:ate', payload: { species: key } });
    }
  }
  delete S.pending;
  S.trust = r4(Math.min(maxTrust(P), Math.max(before, t)));
  const w0 = trustWord(before, P.bands), w1 = trustWord(S.trust, P.bands);
  if (w1 !== w0) events.push({ name: 'creature:trusted', payload: { species: key, word: w1 } });
  return events;
}

/** How many in all. @param {SwarmState} S */
export const total = (S) => S.groups.reduce((s, g) => s + g.count, 0);

/**
 * Every school and swarm species' hour, in the species list's order.
 * @param {any} state @param {number} hourIndex @param {any} env
 * @returns {{ state: any, events: { name: string, payload: any }[] }}
 */
export function coarseStep(state, hourIndex, env) {
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  for (const rec of swarmSpecies(env.recipes?.species)) {
    const r = swarmStep(state, hourIndex, env, rec);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/**
 * A test shortcut for click-testing (`?minnows=N`, `?dragonflies=N`, src/app.js), never used by the
 * game itself: a group of `count` comes now and is settled, in the biggest pool there is. (Under the
 * test link the app also lets the biggest still water count without its deep spot, testRecipe.)
 * Pure; returns the events the tick would.
 * @param {any} state @param {number} hourIndex @param {any} env @param {any} rec @param {number} count
 */
export function bringSwarm(state, hourIndex, env, rec, count) {
  const key = keyOf(rec);
  if (!state.ecology?.[key]) state = { ...state, ecology: ecologyNow(state, env, true) };
  let eco = state.ecology?.[key];
  if (!eco) return { state, events: [] };
  const big = eco.pools.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => b.area - a.area)[0];
  if (!big) return { state, events: [] };
  const pool = { ...big };
  eco = { ...eco, pools: eco.pools.map((/** @type {any} */ p) => (p === big ? pool : p)) };
  state = { ...state, ecology: { ...state.ecology, [key]: eco } };
  const n = Math.round(Math.sqrt(eco.score.length));
  const prev = state.creatures?.[key] ?? initialSwarm();
  /** @type {SwarmState} */ const S = { ...prev, groups: prev.groups.map((g) => ({ ...g })) };
  /** @type {{ name: string, payload: any }[]} */ const events = [];
  const [x, z] = cellCenter(pool.best, n);
  if (!S.right) { S.right = true; events.push({ name: 'creature:habitat-right', payload: { species: key, x, z } }); }
  S.rightFor = Math.max(S.rightFor, rec.ecology.arrival.scoutAfterH);
  const id = S.nextId++;
  S.groups.push({ id, k: pool.best, x, z, count: Math.max(1, count), mood: 1, low: 0, since: hourIndex });
  S.arrivals++;
  events.push({ name: 'creature:arrived', payload: { species: key, id, x, z, scout: true, count } });
  S.phase = 'settled';
  events.push({ name: 'creature:settled', payload: { species: key, id, x, z, count } });
  // The pool lists this group from the next hour; for now, say so here too.
  pool.groups = [...(pool.groups ?? []), id];
  return { state: { ...state, creatures: { ...(state.creatures ?? {}), [key]: S } }, events };
}
