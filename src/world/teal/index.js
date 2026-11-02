// @ts-check
// The teal in the game (B3 wave 3): the flock the hourly tick keeps (src/world/creatures/flock.js,
// state.creatures.teals), alive on their pond (live.js), and a visit's few birds before their home
// exists (visit:start, src/world/ecology/visits.js). The bird is Matt's model on the small-bird rig
// (model.js; the flock file for every bird), drawn by its own creatures pass with the hen's
// textured draw. It offers what the live schools offer (src/world/creatures/schools.js: id, pass,
// at, reveal, heard, feed, setBudget), so the journal's taps and Show me, the reveal on return and
// the sound find it among them.
//
// Presence is the walker's only: the camera above is never felt. Quiet watching earns the flock's
// trust (recorded for the next hourly tick, swarms.js addSwarmEvent); watching from close by, or a
// tap, finds them for the journal (`creature:found`). Away to breed (dormant) or with no flock,
// only a visit draws any.

import { emitDeferred } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { animT, hourIndex } from '../../core/clock.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { readGlb } from '../../render/gltf.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { createWatching } from '../creatures/watching.js';
import { addSwarmEvent } from '../creatures/swarms.js';
import { trustWord } from '../creatures/trust.js';
import { poseSkeleton } from '../creatures/pose.js';
import { createReturn } from '../creatures/reveal-return.js';
import { tapRay } from '../creatures/schools.js';
import { buildTeal } from './model.js';
import { createTealLife } from './live.js';

/** Bones a bird uses (the rig's 15 of the pass's 16). */
const BONES = 16;
/** How near the walker must be to see what they do, for their page (m). */
const LEARN_NEAR_M = 24;
/** The trust word as a band number: 0 Wary, 1 Tolerant, 2 Curious, 3 Familiar. */
const BAND = /** @type {Record<string, number>} */ ({ wary: 0, tolerant: 1, curious: 2, familiar: 3, bonded: 4 });

/** Load a GLB from the repo. @param {string} path */
async function loadGlb(path) {
  const res = await fetch(new URL(`../../../${path}`, import.meta.url));
  if (!res.ok) throw new Error(`teal model ${path}: ${res.status}`);
  return readGlb(await res.arrayBuffer());
}

/**
 * How far a pond's water reaches from (x, z): the mean of how far each of 12 rays stays on water
 * at least minDepth deep, out to maxM (drawn metres). Pure but for the water it reads.
 * @param {(x: number, z: number) => { depth: number }} water @param {number} x @param {number} z @param {number} minDepth @param {number} [maxM]
 */
export function pondReach(water, x, z, minDepth, maxM = 16) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    let r = 0;
    while (r < maxM && water(x + Math.sin(a) * (r + 0.25), z + Math.cos(a) * (r + 0.25)).depth >= minDepth) r += 0.25;
    sum += r;
  }
  return Math.max(1, sum / 12);
}

/**
 * @param {{ recipe: any, bird: any, seed: number, world: { state: any, env: any }, camera: { target: ArrayLike<number>, eye: ArrayLike<number>, distance: number },
 *   presence: import('../creatures/presence.js').Presence, water: (x: number, z: number) => { surface: number, depth: number },
 *   hours: () => number, you: () => number[] | null, record: () => void, sounds?: any, testFlushS?: number }} o
 *   recipe: recipes/species/teal.json; bird: recipes/birds/teal.json; hours: display time in game
 *   hours; you: where you stand on foot, or null above; record: after a trust event is written;
 *   sounds: recipes/audio/teal.json (when they call); testFlushS: `?tealflush` (testing), a pretend
 *   walker beside the flock flushes it this often, so the rise and the lap can be watched from above
 */
export function createTeals(o) {
  const R = o.recipe, B = o.bird, L = R.life, P = R.presence, find = R.find, key = R.key;
  const k = R.body.displayScale;
  const pass = createCreaturePass({ recipe: R, name: key, shader: 'hen-draw', maxBones: BONES, extraFloats: 4, maps: true });
  pass.setExtra([0, 0, 0, 0]);
  const life = createTealLife({ L, P, M: B.motion, k, seed: subSeed(o.seed, key), water: o.water });
  const watching = createWatching(P.watch);
  const comeBack = createReturn(R.reveal?.growS ?? 0.6);
  /** @type {import('../creatures/bird-rig.js').BirdRig | null} */ let rig = null;
  let budget = 128, watched = 0, sinceS = 0;
  /** What their page was taught this session. @type {Set<string>} */ const taught = new Set();
  /** Their sounds said lately, numbered, for the sound to play (src/audio/creatures-game.js). @type {{ n: number, kind: 'krik'|'murmur'|'whirr', pos: number[] }[]} */
  const heard = [];
  let heardN = 0, krikIn = 4, murmurIn = 10, rn = 0, flushIn = 4;
  const V = o.sounds;
  const rnd = () => (hash32(o.seed, 0x7ea5 + rn++) >>> 8) / 16777216;
  /** @param {'krik'|'murmur'|'whirr'} kind @param {number} x @param {number} z */
  const say = (kind, x, z) => { heard.push({ n: ++heardN, kind, pos: [x, o.water(x, z).surface + 0.2, z] }); if (heard.length > 8) heard.shift(); };
  /** A visit now: its pond, until which game hour, whether it is ending. @type {{ x: number, z: number, r: number, until: number, leaving: boolean } | null} */
  let visit = null;
  /** `?teals` (testing): the flock lives on this pond, not its home. @type {{ x: number, z: number, r: number } | null} */
  let testAt = null;
  /** The home pond's reach, measured once per home. @type {{ x: number, z: number, r: number } | null} */
  let homePond = null;
  /** Bones per bird, kept by id. @type {Map<number, Float32Array>} */ const bones = new Map();

  loadGlb(B.model.flock).then((glb) => {
    const built = buildTeal(glb, B);
    rig = built.rig;
    pass.setMesh('teal', { data: built.data, indices: built.indices });
    pass.setMaps(glb).catch((/** @type {any} */ err) => console.error('The teal maps did not load:', err));
  }).catch((err) => console.error('The teal did not load:', err));

  /** The flock's state now. */
  const flock = () => o.world.state?.creatures?.[key] ?? null;
  /** How many live here now (none while they are away). */
  const count = () => { const S = flock(); return !S || (S.dormant && !testAt) ? 0 : (S.groups ?? []).reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0); };
  /** Their pond: the test's, else the home's (its reach measured on the live water). */
  function pondNow() {
    if (testAt) return testAt;
    const h = flock()?.home;
    if (!h) return null;
    if (!homePond || Math.hypot(homePond.x - h.x, homePond.z - h.z) > 1) {
      const r = Math.sqrt(Math.max(1, h.m) / Math.PI) * L.pondReachK;
      homePond = { x: h.x, z: h.z, r: Math.max(r, pondReach(o.water, h.x, h.z, L.minDepthM) * 0.9) };
    }
    return homePond;
  }
  /** The walker as presence gives it, or null. */
  const walker = () => o.presence.sources().find((s) => s.kind === 'walker' && s.body) ?? null;

  /** Draw the birds: on the water riding floatM deep, or in the air. */
  function draw() {
    if (!rig) { pass.setBeings([]); return; }
    const now = animT();
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const list = [];
    for (const b of life.birds().slice(0, budget)) {
      const c = comeBack.at(b.id, now);
      if (c.k <= 0) continue;
      let m = bones.get(b.id);
      if (!m) { m = new Float32Array(BONES * 16); bones.set(b.id, m); }
      poseSkeleton(rig.skeleton, life.moves(rig, b), m, 0);
      const s = o.water(b.x, b.z).surface;
      list.push({ x: b.x, y: s - L.floatM * k + b.y, z: b.z, yaw: b.yaw, size: k * c.k, mesh: 'teal', bones: m });
    }
    pass.setBeings(list);
  }

  return {
    id: key,
    pass,

    /** A visit begins (visit:start): a few birds on the pond at (x, z) for show.lastsH game hours. @param {{ sp: string, show: any, x: number, z: number }} v */
    visit(v) {
      if (v.sp !== key || count() > 0) return;
      visit = { x: v.x, z: v.z, r: pondReach(o.water, v.x, v.z, L.minDepthM) * 0.9, until: o.hours() + (v.show?.lastsH ?? 1), leaving: false };
    },

    /** `?teals` (testing): the flock lives on the pond at (x, z) from now. @param {number} x @param {number} z */
    placeTest(x, z) { testAt = { x, z, r: pondReach(o.water, x, z, L.minDepthM) * 0.9 }; },

    /** The live flock's birds (tools and tests). */
    birds: () => life.birds(),

    /** Each frame. @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      const dt = Math.min(0.1, f.realDt);
      const S = flock(), n = count(), hours = o.hours(), h = ((hours % 24) + 24) % 24;
      const NH = L.nightH, night = h >= NH[0] || h < NH[1];
      const trust = S?.trust ?? 0, band = BAND[trustWord(trust, P.bands)] ?? 0;
      const w = walker();
      if (visit && (hours >= visit.until || n > 0)) visit.leaving = true;
      const pond = n > 0 ? pondNow() : visit ? { x: visit.x, z: visit.z, r: visit.r } : null;
      const want = n > 0 ? n : visit && !visit.leaving ? L.visitBirds : 0;
      // Around you: once they know you, while you stand still near their pond.
      const mid = life.middle();
      const around = S?.known && w && w.stillS >= P.around.stillS && Math.hypot(w.pos[0] - mid.x, w.pos[2] - mid.z) <= P.joinM ? { x: w.pos[0], z: w.pos[2] } : null;
      // A flock already here when the island opens is on the water; later ones fly in.
      sinceS += dt;
      const placeNow = n > 0 && !testAt && sinceS < 6;
      // `?tealflush`: a pretend walker 1.5 m from the flock's middle, every testFlushS, until it rises.
      /** @type {import('../creatures/presence.js').PresenceSource | null} */ let scare = null;
      if (o.testFlushS && (flushIn -= dt) <= 0 && life.birds().some((b) => !life.flying(b))) {
        scare = { id: 'walker', kind: 'walker', pos: [mid.x + 1.5, 0, mid.z], speed: 1, editing: false, edits: [], stillS: 0, body: true };
      }
      const said = life.step(dt, { count: want, pond, night, walker: scare ?? w, trust, band: scare ? 0 : band, leave: !!visit?.leaving && n === 0, around, placeNow });
      if (scare && said.includes('flushed')) flushIn = o.testFlushS ?? 20;
      if (said.includes('flushed')) { emitDeferred('creature:startled', { species: key, id: 1 }); say('whirr', mid.x, mid.z); }
      const swimming = life.birds().filter((b) => !life.flying(b));
      if (V && swimming.length) {
        if (night) {
          if ((murmurIn -= dt) <= 0) { murmurIn = V.murmurEveryS[0] + rnd() * (V.murmurEveryS[1] - V.murmurEveryS[0]); say('murmur', mid.x, mid.z); }
        } else if ((krikIn -= dt) <= 0) {
          krikIn = V.krikEveryS[0] + rnd() * (V.krikEveryS[1] - V.krikEveryS[0]);
          const b = swimming[Math.floor(rnd() * swimming.length)];
          say('krik', b.x, b.z);
        }
      }
      // Their page learns what you saw them do: the spring off the water, up-ending (once a session each).
      const seen = !!getStore('journal')?.species?.[key]?.ever && w && Math.hypot(w.pos[0] - mid.x, w.pos[2] - mid.z) <= LEARN_NEAR_M;
      if (seen && said.includes('flushed') && !taught.has('flush')) { taught.add('flush'); emitDeferred('creature:learned', { species: key, trigger: 'flush' }); }
      if (seen && !taught.has('upend') && life.birds().some((b) => b.mode === 'upend')) { taught.add('upend'); emitDeferred('creature:learned', { species: key, trigger: 'upend' }); }
      if (visit?.leaving && !life.birds().length) visit = null;
      // Quiet watching earns trust (the flock's, the next hourly tick).
      if (S && n > 0) {
        const looked = watching.step([{ id: 1, x: mid.x, y: o.water(mid.x, mid.z).surface, z: mid.z, mode: 'here' }], w ? [w] : [], dt);
        if (looked.length) {
          for (const lk of looked) o.world.state = addSwarmEvent(o.world.state, key, { kind: 'watched', minutes: lk.minutes, hour: hourIndex() });
          o.record();
        }
      }
      draw();
      // Watching them closely finds them: on foot within reach, or the view low over them.
      if (getStore('journal')?.species?.[key]?.ever || !life.birds().length) { watched = 0; return; }
      const me = o.you();
      const near = me ? Math.hypot(mid.x - me[0], mid.z - me[2]) <= find.lookDistM + find.lookM
        : o.camera.distance <= find.lookDistM && (mid.x - o.camera.target[0]) ** 2 + (mid.z - o.camera.target[2]) ** 2 <= find.lookM * find.lookM;
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
        const by = o.water(b.x, b.z).surface + b.y + 0.08 * k;
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
    /** Their sounds said lately (the store slice creatureSound.teals). */
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

/** @typedef {ReturnType<typeof createTeals>} Teals */
