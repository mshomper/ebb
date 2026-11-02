// @ts-check
// The grey seals in the game (B3 wave 3): the group the hourly tick keeps (src/world/creatures/flock.js,
// state.creatures.seals, with the pup from pup.js), alive on the home bar (live.js), and a visit's
// seal bottling offshore before their home exists (visit:start, src/world/ecology/visits.js). The
// body is Matt's model rigged in code (model.js), posed by the clips in motion.js and drawn by its
// own creatures pass with the coat painted in seal-draw.wgsl. It offers what the live schools offer
// (src/world/creatures/schools.js: id, pass, at, reveal, heard, feed, setBudget), so the journal's
// taps and Show me, the reveal on return and the sound find it among them.
//
// Presence is the walker's only: the camera above is never felt. Quiet watching earns the group's
// trust (recorded for the next hourly tick, swarms.js addSwarmEvent); watching from close by, or a
// tap, finds them for the journal (`creature:found`). Away at sea (dormant) or with no seals, only a
// visit draws any.

import { emitDeferred } from '../../core/events.js';
import { get as getStore } from '../../core/store.js';
import { animT, hourIndex } from '../../core/clock.js';
import { subSeed, hash32 } from '../../core/rng.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { createWatching } from '../creatures/watching.js';
import { addSwarmEvent } from '../creatures/swarms.js';
import { trustWord } from '../creatures/trust.js';
import { poseSkeleton } from '../creatures/pose.js';
import { createReturn } from '../creatures/reveal-return.js';
import { tapRay } from '../creatures/schools.js';
import { buildSeal, SEAL_BONES } from './model.js';
import { createSealLife } from './live.js';
import { pupWhite } from './pup.js';

/** How near the walker must be to see what they do, for their page (m). */
const LEARN_NEAR_M = 25;
/** The trust word as a band number: 0 Wary, 1 Tolerant, 2 Curious, 3 Familiar. */
const BAND = /** @type {Record<string, number>} */ ({ wary: 0, tolerant: 1, curious: 2, familiar: 3, bonded: 4 });

/** Fetch the model's three OBJ files named by the recipe (paths from the repo root). @param {any} R */
export async function loadSealModel(R) {
  const get = async (/** @type {string} */ p) => {
    const res = await fetch(new URL(`../../../${p}`, import.meta.url));
    if (!res.ok) throw new Error(`seal model ${p}: ${res.status}`);
    return res.text();
  };
  const M = R.body.model;
  const [body, eyes, jaw] = await Promise.all([get(M.body), get(M.eyes), get(M.jaw)]);
  return buildSeal({ body, eyes, jaw }, R);
}

/**
 * The coat's numbers as seal-draw.wgsl packs them for one seal: its number (its blotches), how white
 * and how dry. @param {number} id @param {number} white 0..1 @param {number} dry 0..1
 */
export const coatOf = (id, white, dry) => (hash32(id, 0x5ea) % 16) * 1000 + Math.round(Math.max(0, Math.min(1, white)) * 100) * 2 + Math.max(0, Math.min(0.999, dry));

/**
 * @param {{ recipe: any, seed: number, world: { state: any, env: any }, camera: { target: ArrayLike<number>, eye: ArrayLike<number>, distance: number },
 *   presence: import('../creatures/presence.js').Presence, ground: (x: number, z: number) => number, tide: () => number,
 *   hours: () => number, you: () => number[] | null, record: () => void, sounds?: any }} o
 *   recipe: recipes/species/seal.json; hours: display time in game hours; you: where you stand on foot,
 *   or null above; record: after a trust event is written (the store's world slice follows); sounds:
 *   recipes/audio/seal.json (when they call)
 */
export function createSeals(o) {
  const R = o.recipe, L = R.life, P = R.presence, find = R.find, key = R.key, C = R.body.coat;
  const pupK = R.body.pup.lengthM / R.body.lengthM;
  const pass = createCreaturePass({ recipe: R, name: key, shader: 'seal-draw', maxBones: SEAL_BONES.length, extraFloats: 24 });
  pass.setExtra([...C.grey, C.mottle.sizeM, ...C.back, C.mottle.cut, ...C.belly, C.mottle.strength,
    ...C.mottle.dark, C.wetDarken, ...R.body.pup.white, R.body.dryRoughness, ...C.eye, R.body.dryStrength]);
  const life = createSealLife({ L, P, M: R.motion, seed: subSeed(o.seed, key), pupK, ground: o.ground, tide: o.tide });
  const watching = createWatching(P.watch);
  const comeBack = createReturn(R.reveal?.growS ?? 0.6);
  /** @type {{ skeleton: { name: string, parent: number, pivot: number[] }[] } | null} */ let model = null;
  let budget = 128, watched = 0;
  /** What their page was taught this session. @type {Set<string>} */ const taught = new Set();
  /** Their sounds said lately, numbered, for the sound to play (src/audio/creatures-game.js). @type {{ n: number, kind: 'moan'|'snort'|'pup', pos: number[] }[]} */
  const heard = [];
  let heardN = 0, moanIn = 10, pupIn = 6, rn = 0;
  const V = o.sounds;
  const rnd = () => (hash32(o.seed, 0x5ea5, rn++) >>> 8) / 16777216;
  /** @param {'moan'|'snort'|'pup'} kind @param {number} x @param {number} z */
  const say = (kind, x, z) => { heard.push({ n: ++heardN, kind, pos: [x, o.ground(x, z) + 0.3, z] }); if (heard.length > 8) heard.shift(); };
  /** A visit now (visit:start): where, until which game hour, and whether it is ending. @type {{ x: number, z: number, until: number, leaving: boolean } | null} */
  let visit = null;
  /** `?seals` (testing): the group lives here, not at its home. @type {{ x: number, z: number } | null} */
  let testAt = null;
  let place = false;
  /** Bones per seal, kept by id. @type {Map<number, Float32Array>} */ const bones = new Map();
  loadSealModel(R).then((m) => { model = m; pass.setMesh('seal', m); }).catch((err) => console.error('The seals did not load:', err));

  /** The group's state now. */
  const group = () => o.world.state?.creatures?.[key] ?? null;
  /** How many adults live here now (none while they are away at sea). */
  const count = () => { const S = group(); return !S || (S.dormant && !testAt) ? 0 : (S.groups ?? []).reduce((/** @type {number} */ s, /** @type {any} */ g) => s + g.count, 0); };
  /** Where they live: the test spot, the group's home, or the pup's. */
  const homeAt = () => testAt ?? (group()?.groups?.[0] ? { x: group().groups[0].x, z: group().groups[0].z } : group()?.pup ? { x: group().pup.x, z: group().pup.z } : null);
  /** The walker as presence gives it, or null. */
  const walker = () => o.presence.sources().find((s) => s.kind === 'walker' && s.body) ?? null;

  /** Draw the seals. */
  function draw() {
    if (!model) { pass.setBeings([]); return; }
    const now = animT(), S = group();
    const white = S?.pup ? pupWhite(hourIndex() - S.pup.bornH, R.ecology.pup) : 0;
    const ageK = S?.pup ? 1 + R.body.pup.growth * Math.min(1, (hourIndex() - S.pup.bornH) / (R.ecology.pup.stayDays * 24)) : 1;
    /** @type {import('../../render/passes/creatures.js').Being[]} */ const list = [];
    for (const s of life.seals().slice(0, budget)) {
      const c = comeBack.at(s.id, now);
      if (c.k <= 0) continue;
      let m = bones.get(s.id);
      if (!m) { m = new Float32Array(SEAL_BONES.length * 16); bones.set(s.id, m); }
      poseSkeleton(model.skeleton, s.pose ?? [], m, 0);
      const k = s.pup ? pupK * ageK : 1;
      list.push({ x: s.x, y: life.heightOf(s, k), z: s.z, yaw: s.yaw, size: k * c.k, mesh: 'seal', bones: m,
        dry: coatOf(s.id, s.pup ? white : 0, 1 - life.wetOf(s, C.dryS)) });
    }
    pass.setBeings(list);
  }

  return {
    id: key,
    pass,

    /** A visit begins (visit:start): one seal bottles at (x, z) for show.lastsH game hours. @param {{ sp: string, show: any, x: number, z: number }} v */
    visit(v) {
      if (v.sp !== key || count() > 0) return;
      visit = { x: v.x, z: v.z, until: o.hours() + (v.show?.lastsH ?? 1), leaving: false };
    },

    /** `?seals` (testing): the group lives at (x, z) from now, set there at once. @param {number} x @param {number} z */
    placeTest(x, z) { testAt = { x, z }; place = true; },

    /** The live seals (tools and tests). */
    seals: () => life.seals(),

    /** Each frame. @param {import('../../sim/live-sim.js').FrameInfo} f */
    tick(f) {
      const dt = Math.min(0.1, f.realDt);
      const S = group(), n = count(), hours = o.hours();
      const trust = S?.trust ?? 0, band = BAND[trustWord(trust, P.bands)] ?? 0;
      const w = walker();
      if (visit && (hours >= visit.until || n > 0)) visit.leaving = true;
      const home = n > 0 || S?.pup ? homeAt() : null;
      // The group moment: once they know you, you standing still at the water's edge near them.
      const mid = life.middle();
      const edge = w && Math.abs(o.ground(w.pos[0], w.pos[2]) - o.tide()) < 0.6;
      const around = S?.known && w && edge && w.stillS >= P.around.stillS && home && Math.hypot(w.pos[0] - home.x, w.pos[2] - home.z) <= P.ringM * 3 ? { x: w.pos[0], z: w.pos[2] } : null;
      const pup = S?.pup && (!S.dormant || testAt) ? { white: pupWhite(hourIndex() - S.pup.bornH, R.ecology.pup) } : null;
      const said = life.step(dt, { count: n, pup, home, walker: w, band, trust, visit: visit ? { x: visit.x, z: visit.z, leaving: visit.leaving } : null, around,
        leave: !!visit?.leaving && n === 0 && !pup, place });
      place = false;
      if (said.includes('flushed')) { emitDeferred('creature:startled', { species: key, id: 1 }); say('snort', mid.x, mid.z); }
      if (said.includes('came') && !taught.has('came')) { taught.add('came'); emitDeferred('creature:learned', { species: key, trigger: 'came' }); }
      // A soft moan now and then from those hauled out; the pup's thin call.
      const out = life.seals().filter((s) => s.mode === 'lie' && !s.pup);
      if (V && out.length && (moanIn -= dt) <= 0) {
        moanIn = V.moanEveryS[0] + rnd() * (V.moanEveryS[1] - V.moanEveryS[0]);
        const s = out[Math.floor(rnd() * out.length)];
        say('moan', s.x, s.z);
      }
      const pupSeal = life.seals().find((s) => s.pup);
      if (V && pupSeal && (pupIn -= dt) <= 0) { pupIn = V.pupEveryS[0] + rnd() * (V.pupEveryS[1] - V.pupEveryS[0]); say('pup', pupSeal.x, pupSeal.z); }
      // Their page learns what you saw them do (once a session each).
      const seen = !!getStore('journal')?.species?.[key]?.ever && w && Math.hypot(w.pos[0] - mid.x, w.pos[2] - mid.z) <= LEARN_NEAR_M;
      if (seen) {
        const learn = (/** @type {string} */ t) => { if (!taught.has(t)) { taught.add(t); emitDeferred('creature:learned', { species: key, trigger: t }); } };
        if (said.includes('flushed')) learn('flush');
        if (life.seals().some((s) => s.mode === 'bottle')) learn('bottle');
        if (life.seals().some((s) => s.mode === 'lie' && !s.pup && s.banana > 0.7)) learn('banana');
        if (pupSeal) learn('pup');
      }
      if (visit?.leaving && !life.seals().length) visit = null;
      // Quiet watching earns trust (the group's, the next hourly tick).
      if (S && n > 0) {
        const looked = watching.step([{ id: 1, x: mid.x, y: o.ground(mid.x, mid.z), z: mid.z, mode: 'here' }], w ? [w] : [], dt);
        if (looked.length) {
          for (const lk of looked) o.world.state = addSwarmEvent(o.world.state, key, { kind: 'watched', minutes: lk.minutes, hour: hourIndex() });
          o.record();
        }
      }
      draw();
      // Watching them closely finds them: on foot within reach, or the view low over them.
      if (getStore('journal')?.species?.[key]?.ever || !life.seals().length) { watched = 0; return; }
      const me = o.you();
      const near = me ? Math.hypot(mid.x - me[0], mid.z - me[2]) <= find.lookDistM + find.lookM
        : o.camera.distance <= find.lookDistM && (mid.x - o.camera.target[0]) ** 2 + (mid.z - o.camera.target[2]) ** 2 <= find.lookM * find.lookM;
      watched = near ? watched + dt : 0;
      if (watched >= find.holdS) { watched = 0; emitDeferred('creature:found', { species: key, how: 'watched' }); }
    },

    /**
     * What a tap lands on, or null: the seal nearest the line from the eye through the tapped
     * point, within tapM plus tapPerM a metre. @param {number} x @param {number} z @param {number} [y]
     */
    at(x, z, y) {
      const ray = y === undefined ? null : tapRay(o.camera.eye, [x, y, z]);
      let best = null, bestK = 1;
      for (const s of life.seals()) {
        const k = s.pup ? pupK : 1;
        const sy = life.heightOf(s, k) + 0.3 * k;
        const hit = ray ? ray({ x: s.x, y: sy, z: s.z }) : { d: Math.hypot(s.x - x, s.z - z), far: 0 };
        const kk = hit.d / ((find.tapM + find.tapPerM * hit.far) * (s.pup ? 0.7 : 1));
        if (kk < bestK) { bestK = kk; best = s; }
      }
      if (!best) return null;
      if (!getStore('journal')?.species?.[key]?.ever) emitDeferred('creature:found', { species: key, how: 'tapped' });
      return { sp: key, id: 1, x: best.x, z: best.z };
    },

    /** Food set down for them: they fish for themselves. Returns the calm line. */
    feed: () => R.feed?.none ?? 'none',
    /** The quality tier's budget of live creatures. @param {number} n */
    setBudget(n) { budget = Math.max(1, Math.min(128, n)); },
    /** Their sounds said lately (the store slice creatureSound.seals). */
    voiced: () => heard,
    /** What the schools' sound reads (none: their calls go through voiced). */
    heard: () => [],
    /** Schools' shape for tools that list them. */
    schools: () => [],

    reveal: {
      species: key,
      style: R.reveal?.return ?? 'thicken',
      spots: () => life.seals().map((s) => ({ id: s.id, x: s.x, z: s.z })),
      hide: () => comeBack.hide(),
      back: (/** @type {{ windowS: number, effects: Set<number> }} */ r) => comeBack.back(animT(), life.seals().map((s) => s.id), r.windowS, r.effects),
      end: () => comeBack.end(),
    },
  };
}

/** @typedef {ReturnType<typeof createSeals>} Seals */
