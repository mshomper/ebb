// @ts-check
// The turnstones in the game (B3 wave 2): the flock the hourly tick keeps (src/world/creatures/flock.js,
// state.creatures.turnstones), alive on the strand (live.js), and a visit's few birds before their
// home exists (visit:start, src/world/ecology/visits.js). The bird is R1's turnstone, made in code
// (recipes/birds/turnstone.json; baked on the worker pool, the flock bake) and posed by the
// small-bird rig, drawn by its own creatures pass. It offers what the live schools offer
// (src/world/creatures/schools.js: id, pass, at, reveal, heard, feed, setBudget), so the journal's
// taps and Show me, the reveal on return and the sound find it among them.
//
// Presence is the walker's only: the camera above is never felt. Quiet watching earns the flock's
// trust (recorded for the next hourly tick, swarms.js addSwarmEvent); watching from close by, or a
// tap, finds them for the journal (`creature:found`). Away north (dormant) or with no flock, only a
// visit draws any.

import { emitDeferred } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { animT, hourIndex } from '../../core/clock.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { run } from '../../core/workers.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { createWatching } from '../creatures/watching.js';
import { addSwarmEvent } from '../creatures/swarms.js';
import { trustWord } from '../creatures/trust.js';
import { birdRig } from '../creatures/bird-rig.js';
import { poseSkeleton } from '../creatures/pose.js';
import { createReturn } from '../creatures/reveal-return.js';
import { tapRay } from '../creatures/schools.js';
import { createFlockLife } from './live.js';
import { plumageOf } from './home.js';

const BAKE_JOB = { module: './world/creatures/bird-model.js', fn: 'bakeBird' };
/** Bones a bird uses (the rig's 15 of the pass's 16). */
const BONES = 16;
/** How often the wrack on the strand is looked at again (real seconds). */
const SPOTS_EVERY_S = 3;
/** How near the walker must be to see what they do, for their page (m). */
const LEARN_NEAR_M = 20;

/** The trust word as a band number: 0 Wary, 1 Tolerant, 2 Curious, 3 Familiar. */
const BAND = /** @type {Record<string, number>} */ ({ wary: 0, tolerant: 1, curious: 2, familiar: 3, bonded: 4 });

/**
 * @param {{ recipe: any, bird: any, seed: number, world: { state: any, env: any }, camera: { target: ArrayLike<number>, eye: ArrayLike<number>, distance: number },
 *   presence: import('../creatures/presence.js').Presence, ground: (x: number, z: number) => number, tide: () => number,
 *   hours: () => number, wrack: () => { x: number, z: number }[], you: () => number[] | null, record: () => void, sounds?: any }} o
 *   recipe: recipes/species/turnstone.json; bird: recipes/birds/turnstone.json; hours: display time in
 *   game hours; wrack: the wrack lying on the strand now; you: where you stand on foot, or null above;
 *   record: after a trust event is written (the store's world slice follows); sounds:
 *   recipes/audio/turnstone.json (when they call)
 */
export function createTurnstones(o) {
  const R = o.recipe, B = o.bird, L = R.life, P = R.presence, find = R.find, key = R.key;
  const k = R.body.displayScale;
  const pass = createCreaturePass({ recipe: R, name: key });
  const rig = birdRig(B.shape);
  const life = createFlockLife({ L, P, M: B.motion, k, seed: subSeed(o.seed, key), ground: o.ground, tide: o.tide });
  const watching = createWatching(P.watch);
  const comeBack = createReturn(R.reveal?.growS ?? 0.6);
  let ready = false, budget = 128, spotsIn = 0, watched = 0;
  /** What their page was taught this session. @type {Set<string>} */ const taught = new Set();
  /** Their sounds said lately, numbered, for the sound to play (src/audio/creatures-game.js). @type {{ n: number, kind: 'chatter'|'tuk'|'murmur', pos: number[] }[]} */
  const heard = [];
  let heardN = 0, tukIn = 3, murmurIn = 8, rn = 0;
  const V = o.sounds;
  /** A small stream for when they call (live only). */
  const rnd = () => (hash32(o.seed, 0x7a50 + rn++) >>> 8) / 16777216;
  /** Say one of their sounds from (x, z). @param {'chatter'|'tuk'|'murmur'} kind @param {number} x @param {number} z */
  const say = (kind, x, z) => { heard.push({ n: ++heardN, kind, pos: [x, o.ground(x, z) + 0.2, z] }); if (heard.length > 8) heard.shift(); };
  /** @type {{ x: number, z: number }[]} */ let spots = [];
  /** A visit now (visit:start): where, until which game hour, and whether it is ending. @type {{ x: number, z: number, until: number, leaving: boolean } | null} */
  let visit = null;
  /** `?turnstones` (testing): the flock is placed here, not at its home. @type {{ x: number, z: number } | null} */
  let testAt = null;
  /** Bones per bird, kept by id. @type {Map<number, Float32Array>} */ const bones = new Map();
  const B0 = B.bake;
  // Both plumages, the flock bake each: each bird wears one by the time of year (home.js plumageOf).
  for (const plumage of /** @type {const} */ (['winter', 'breeding'])) {
    run(BAKE_JOB, { shape: B.shape, plumage: B.plumage[plumage], wingPattern: B.wingPattern, cellM: B0.cellM, wingCellM: B0.wingCellM,
      blendM: B0.blendM, maxTris: B0.flockTris, wingShare: B0.wingShare, attrWeight: B0.attrWeight })
      .then((/** @type {any} */ m) => { pass.setMesh(plumage, m); ready = true; })
      .catch((/** @type {any} */ err) => console.error(`The turnstones (${plumage}) did not bake:`, err));
  }

  /** The flock's state now. */
  const flock = () => o.world.state?.creatures?.[key] ?? null;
  /** How many live here now (none while they are away north). */
  const count = () => { const S = flock(); return !S || (S.dormant && !testAt) ? 0 : (S.groups ?? []).reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0); };
  /** Where they live: the group's home, or the test spot. */
  const homeAt = () => testAt ?? (flock()?.groups?.[0] ? { x: flock().groups[0].x, z: flock().groups[0].z } : null);

  /** The walker as presence gives it, or null. */
  const walker = () => o.presence.sources().find((s) => s.kind === 'walker' && s.body) ?? null;

  /** Draw the birds. */
  function draw() {
    if (!ready) { pass.setBeings([]); return; }
    const now = animT();
    const se = o.world.state?.seasons, pos = (se?.index ?? 2) + (se?.phase ?? 0);
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const list = [];
    for (const b of life.birds().slice(0, budget)) {
      const c = comeBack.at(b.id, now);
      if (c.k <= 0) continue;
      let m = bones.get(b.id);
      if (!m) { m = new Float32Array(BONES * 16); bones.set(b.id, m); }
      poseSkeleton(rig.skeleton, life.moves(rig, b), m, 0);
      list.push({ x: b.x, y: o.ground(b.x, b.z) + b.y, z: b.z, yaw: b.yaw, size: k * c.k, mesh: plumageOf(pos, (hash32(b.id, 0x9e3) >>> 8) / 16777216, R.body.plumageTurn), bones: m });
    }
    pass.setBeings(list);
  }

  return {
    id: key,
    pass,

    /** A visit begins (visit:start): a few birds run the strand at (x, z) for show.lastsH game hours. @param {{ sp: string, show: any, x: number, z: number }} v */
    visit(v) {
      if (v.sp !== key || count() > 0) return;
      visit = { x: v.x, z: v.z, until: o.hours() + (v.show?.lastsH ?? 1), leaving: false };
    },

    /** `?turnstones` (testing): the flock lives at (x, z) from now. @param {number} x @param {number} z */
    placeTest(x, z) { testAt = { x, z }; },

    /** The live flock's birds (tools and tests). */
    birds: () => life.birds(),

    /** Each frame. @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      const dt = Math.min(0.1, f.realDt);
      spotsIn -= dt;
      if (spotsIn <= 0) { spotsIn = SPOTS_EVERY_S; spots = o.wrack(); }
      const S = flock(), n = count(), hours = o.hours(), h = ((hours % 24) + 24) % 24;
      const NH = L.nightH, night = h >= NH[0] || h < NH[1];
      const trust = S?.trust ?? 0, band = BAND[trustWord(trust, P.bands)] ?? 0;
      const w = walker();
      // A visit's birds: until its hour is over, or the flock itself is here.
      if (visit && (hours >= visit.until || n > 0)) visit.leaving = true;
      const home = n > 0 ? homeAt() : visit ? { x: visit.x, z: visit.z } : null;
      const want = n > 0 ? n : visit && !visit.leaving ? L.visitBirds : 0;
      // Around you: once they know you, while you stand still near them.
      const mid = life.middle();
      const around = S?.known && w && w.stillS >= P.around.stillS && Math.hypot(w.pos[0] - mid.x, w.pos[2] - mid.z) <= P.joinM ? { x: w.pos[0], z: w.pos[2] } : null;
      const said = life.step(dt, { count: want, home, spots: n > 0 || visit ? spots : [], roost: n > 0 && (night || o.tide() > L.roostTideM),
        walker: w, trust, band, known: !!S?.known, leave: !!visit?.leaving && n === 0, around });
      if (said.includes('flushed')) { emitDeferred('creature:startled', { species: key, id: 1 }); say('chatter', mid.x, mid.z); }
      // A feeding bird's tuk now and then; a few soft twitters at the roost.
      const grounded = life.birds().filter((b) => b.mode !== 'fly' && b.mode !== 'takeoff' && b.mode !== 'land');
      if (V && grounded.length) {
        if (n > 0 && (night || o.tide() > L.roostTideM)) {
          if ((murmurIn -= dt) <= 0) { murmurIn = V.murmurEveryS[0] + rnd() * (V.murmurEveryS[1] - V.murmurEveryS[0]); say('murmur', mid.x, mid.z); }
        } else if (!night && (tukIn -= dt) <= 0) {
          tukIn = V.tukEveryS[0] + rnd() * (V.tukEveryS[1] - V.tukEveryS[0]);
          const b = grounded[Math.floor(rnd() * grounded.length)];
          say('tuk', b.x, b.z);
        }
      }
      // Their page learns what you saw them do: the flush, and the roost at high tide (once a session each).
      const seen = !!getStore('journal')?.species?.[key]?.ever && w && Math.hypot(w.pos[0] - mid.x, w.pos[2] - mid.z) <= LEARN_NEAR_M;
      if (seen && said.includes('flushed') && !taught.has('flush')) { taught.add('flush'); emitDeferred('creature:learned', { species: key, trigger: 'flush' }); }
      if (seen && n > 0 && (night || o.tide() > L.roostTideM) && !taught.has('roost')) { taught.add('roost'); emitDeferred('creature:learned', { species: key, trigger: 'roost' }); }
      if (visit?.leaving && !life.birds().length) visit = null;
      // Quiet watching earns trust (the flock's, the next hourly tick).
      if (S && n > 0) {
        const c = life.middle();
        const looked = watching.step([{ id: 1, x: c.x, y: o.ground(c.x, c.z), z: c.z, mode: 'here' }], w ? [w] : [], dt);
        if (looked.length) {
          for (const lk of looked) o.world.state = addSwarmEvent(o.world.state, key, { kind: 'watched', minutes: lk.minutes, hour: hourIndex() });
          o.record();
        }
      }
      draw();
      // Watching them closely finds them: on foot within reach, or the view low over them.
      if (getStore('journal')?.species?.[key]?.ever || !life.birds().length) { watched = 0; return; }
      const me = o.you();
      const c = life.middle();
      const near = me ? Math.hypot(c.x - me[0], c.z - me[2]) <= find.lookDistM + find.lookM
        : o.camera.distance <= find.lookDistM && (c.x - o.camera.target[0]) ** 2 + (c.z - o.camera.target[2]) ** 2 <= find.lookM * find.lookM;
      watched = near ? watched + dt : 0;
      if (watched >= find.holdS) { watched = 0; emitDeferred('creature:found', { species: key, how: 'watched' }); }
    },

    /**
     * What a tap lands on, or null: the bird nearest the line from the eye through the tapped
     * point, within tapM plus tapPerM a metre. @param {number} x @param {number} z @param {number} [y]
     */
    at(x, z, y) {
      const ray = y === undefined ? null : tapRay(o.camera.eye, [x, y, z]);
      let best = null, bestK = 1;
      for (const b of life.birds()) {
        const by = o.ground(b.x, b.z) + b.y + 0.1 * k;
        const hit = ray ? ray({ x: b.x, y: by, z: b.z }) : { d: Math.hypot(b.x - x, b.z - z), far: 0 };
        const kk = hit.d / (find.tapM + find.tapPerM * hit.far);
        if (kk < bestK) { bestK = kk; best = b; }
      }
      if (!best) return null;
      if (!getStore('journal')?.species?.[key]?.ever) emitDeferred('creature:found', { species: key, how: 'tapped' });
      return { sp: key, id: 1, x: best.x, z: best.z };
    },

    /** Food set down for them: they find their own. Returns the calm line. */
    feed: () => R.feed?.none ?? 'none',
    /** The quality tier's budget of live creatures. @param {number} n */
    setBudget(n) { budget = Math.max(1, Math.min(128, n)); },
    /** Their sounds said lately (the store slice creatureSound.turnstones). */
    voiced: () => heard,
    /** What the schools' sound reads (none: their calls go through voiced). */
    heard: () => [],
    /** Schools' shape for tools that list them. */
    schools: () => [],

    reveal: {
      species: key,
      style: R.reveal?.return ?? 'thicken',
      spots: () => life.birds().map((b) => ({ id: b.id, x: b.x, z: b.z })),
      hide: () => comeBack.hide(),
      back: (/** @type {{ windowS: number, effects: Set<number> }} */ r) => comeBack.back(animT(), life.birds().map((b) => b.id), r.windowS, r.effects),
      end: () => comeBack.end(),
    },
  };
}

/** @typedef {ReturnType<typeof createTurnstones>} Turnstones */
