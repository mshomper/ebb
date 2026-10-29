// @ts-check
// The hen in the game (docs/future/15, slices 1 and 2): a feral hen in the scrub who comes to know
// the walker. She shows once the island has scrub (a few grown gorse or grey willow bushes together)
// and lives about it; `?hen` (testing, unsaved) puts her under the view at once. Loads Matt's
// supplied model (rig.js), lives her day (life.js) at the band her trust has reached (trust.js,
// bands.js), is posed by her code clips over the file's Idle (motion.js) and drawn by a creature pass
// with her own shader (hen-draw.wgsl).
//
// Slice 2: her trust is saved with the island (state.creatures.hens) and grows as other creatures'
// does: quiet watching near her and treats (worms, seedheads) are recorded here as events for the
// hourly tick, and so are the game hours you spend near her (Fond's days together). Her tail
// feather, once laid, lies by the fire ring (feather.js) until you take it up. Numbers:
// recipes/species/hen.json.

import { readGlb } from '../../render/gltf.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { subSeed } from '../../core/rng.js';
import { HOURS_PER_DAY } from '../../core/clock.js';
import { createWatching } from '../creatures/watching.js';
import { buildHen } from './rig.js';
import { createHenPoser } from './motion.js';
import { createHenLife, scrubHome } from './life.js';
import { addHenEvent, ensureHen, henBand, henSeenAt, featherLying, applyHen } from './trust.js';
import { featherSpot, featherCard } from './feather.js';
import { registerCardAction } from '../../ui/card-actions.js';

/** How often the scrub is looked for again (real seconds). */
const HOME_EVERY_S = 2;
/** Game hours near her gathered before they are recorded (and at each new day). */
const NEAR_FLUSH_H = 0.25;

/** Fetch the model named by the recipe (a path from the repo root). @param {any} R */
export async function loadHenModel(R) {
  const res = await fetch(new URL(`../../../${R.model}`, import.meta.url));
  if (!res.ok) throw new Error(`hen model ${R.model}: ${res.status}`);
  return readGlb(await res.arrayBuffer());
}

/**
 * @param {{ recipe: any, seed: number, world: { state: any, env?: any }, terrain: { sampleHeight: (x: number, z: number) => number },
 *   water: { tide: number, sampleLive: (x: number, z: number) => { depth: number } }, camera: { target: ArrayLike<number>, eye: ArrayLike<number> },
 *   presence: import('../creatures/presence.js').Presence, hours: () => number, hourIndex: () => number, test?: boolean,
 *   ring?: () => { x: number, z: number } | null, record?: () => void, testFond?: boolean }} o
 *   hours: display time in game hours; hourIndex: the game hour the tick is on; test: `?hen`, under the
 *   view at once; ring: the laid fire ring (camp.ringPlace), or null; record: after an event is
 *   recorded (the store's world slice follows); testFond: `?hen&fond`, Fond and her feather at once
 */
export function createHen(o) {
  const R = o.recipe;
  const pass = createCreaturePass({ recipe: R, name: 'hen', shader: 'hen-draw', maxBones: R.bones.length, extraFloats: 4, maps: true });
  pass.setExtra([R.body.alphaCut, 0, 0, 0]);
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const wet = (/** @type {number} */ x, /** @type {number} */ z) => ground(x, z) < o.water.tide + 0.03 || o.water.sampleLive(x, z).depth > 0.005;
  const life = createHenLife({ R, seed: subSeed(o.seed, 'hen'), ground, wet });
  const watching = R.presence?.watch ? createWatching(R.presence.watch) : null;
  // Her feather's card: Take it up gives the hat band (src/app.js hen.feather).
  registerCardAction({ id: 'hen-feather', icon: 'feather', order: 10, main: true, label: R.fond?.feather?.words?.take ?? 'Take it up',
    when: (c) => !!c.feather, action: () => ({ type: 'hen.feather' }) });
  /** @type {ReturnType<typeof createHenPoser> | null} */ let poser = null;
  /** @type {Float32Array | null} */ let bones = null;
  let placed = false, homeIn = 0;
  /** Game hours near her not yet recorded, the day they belong to, and the clock last frame. */
  let nearH = 0, nearDay = -1, lastHours = NaN;
  /** The gift stone's spot for her feather, once one stands (B1 C1). @type {(() => { x: number, z: number } | null) | null} */
  let giftPlace = null;
  loadHenModel(R).then((glb) => {
    const built = buildHen(glb, R);
    pass.setMesh('hen', { data: built.data, indices: built.indices });
    pass.setMaps(glb).catch((err) => console.error('The hen maps did not load:', err));
    poser = createHenPoser(built.skeleton, R.motion, built.idle);
    bones = new Float32Array(built.skeleton.length * 16);
  }).catch((err) => console.error('The hen did not load:', err));

  /** Her saved state now. */
  const saved = () => o.world.state?.creatures?.hens ?? null;

  /** Record an event for the hourly tick. @param {import('./trust.js').HenEvent} ev */
  function record(ev) {
    o.world.state = addHenEvent(o.world.state, ev);
    o.record?.();
  }

  /** A dry spot near (x, z), searched in rings, or null. @param {number} x @param {number} z */
  function dryNear(x, z) {
    for (let r = 0; r <= 12; r += 1.5) {
      for (let a = 0; a < 8; a++) {
        const px = x + Math.sin((a / 8) * Math.PI * 2) * r, pz = z + Math.cos((a / 8) * Math.PI * 2) * r;
        if (!wet(px, pz)) return { x: px, z: pz };
        if (r === 0) break;
      }
    }
    return null;
  }

  /** She is out: the island keeps her from now on, and a test link's trust applies at once. */
  function cameOut() {
    const hour = o.hourIndex();
    o.world.state = ensureHen(o.world.state, hour);
    const env = o.world.env ?? {};
    if ((env.testTrust ?? 0) > 0 || o.testFond) {
      const H0 = o.world.state.creatures.hens;
      const H = { ...H0, pending: [...(H0.pending ?? [])] };
      applyHen(H, R, hour, { testTrust: env.testTrust ?? 0, testFond: !!o.testFond });
      o.world.state = { ...o.world.state, creatures: { ...o.world.state.creatures, hens: H } };
    }
    o.world.state = henSeenAt(o.world.state, life.hen.x, life.hen.z);
    o.record?.();
  }

  /** Look for her scrub; with `?hen` and none, under the view. Puts her down the first time. */
  function findHome() {
    const plants = o.world.state?.growth?.plants ?? [];
    const scrub = scrubHome(plants, R.home);
    if (scrub) {
      if (!placed) { const at = dryNear(scrub.x, scrub.z); if (at) { life.setHome(at, R.home.rangeM, true); placed = true; cameOut(); } }
      else life.setHome(scrub, R.home.rangeM);
      return;
    }
    if (o.test && !placed) {
      // Ahead of the view, past her ring, so she is first seen foraging rather than running.
      const t = o.camera.target, e = o.camera.eye, fx = t[0] - e[0], fz = t[2] - e[2], fl = Math.hypot(fx, fz) || 1;
      const at = dryNear(t[0] + (fx / fl) * R.home.testAheadM, t[2] + (fz / fl) * R.home.testAheadM);
      if (at) { life.setHome(at, R.home.testRangeM, true); placed = true; cameOut(); }
    }
  }

  /** Where the feather lies now, or null while none does. */
  function featherAt() {
    if (!placed || !featherLying(saved()) || !R.fond?.feather) return null;
    return featherSpot(R.fond.feather, o.ring?.() ?? null, life.home, giftPlace?.() ?? null);
  }

  return {
    pass,
    life,
    /** Is she out on the island? */
    get out() { return placed; },
    /** Her band now, 0 Wary .. 4 Fond. */
    band: () => (R.presence ? henBand(saved(), R.presence) : 0),
    /**
     * A tap: is it on her? Her spot, or null. @param {number} x @param {number} z
     * @returns {{ x: number, z: number } | null}
     */
    henAt(x, z) {
      if (!placed) return null;
      const h = life.hen;
      return Math.hypot(h.x - x, h.z - z) <= (R.treat?.tapM ?? 0.45) * R.body.displayScale ? { x: h.x, z: h.z } : null;
    },
    /** A tap on her feather lying at camp: its card, or null. @param {number} x @param {number} z */
    featherCard(x, z) {
      const f = featherAt();
      const F = R.fond?.feather;
      return f && F && Math.hypot(f.x - x, f.z - z) <= F.tapM ? featherCard(f, F.words) : null;
    },
    /** Where her feather lies (the camp draws it), or null. */
    featherAt,
    /**
     * The gift stone's hook (B1 C1): a spot where gifts are laid. Once it names one, her feather lies
     * there instead of by the ring. @param {(() => { x: number, z: number } | null) | null} f
     */
    useGiftPlace(f) { giftPlace = f; },
    /**
     * A treat set out (treats.js): her answer, and when she has pecked it up a treat event and
     * `eaten` (treat:taken). @param {number} x @param {number} z @param {{ treat: string, tid: number, reachM: number }} t
     * @param {(tid: number) => void} eaten
     */
    treat(x, z, t, eaten) {
      if (!placed) return 'none';
      return life.treatAt(x, z, t, (tid, treat) => { record({ kind: 'treat', hour: o.hourIndex(), treat }); eaten(tid); });
    },
    /** A treat gone before she came (eaten by another, faded). @param {number} tid */
    treatGone: (/** @type {number} */ tid) => life.treatGone(tid),
    /** A hole just dug (dig:dug): Curious on, she comes to wait by it. @param {number} x @param {number} z */
    dug: (/** @type {number} */ x, /** @type {number} */ z) => { if (placed) life.dugAt(x, z); },
    /** After each hourly tick: where she was seen, for her page's Show me. */
    ticked() {
      if (!placed || !saved()) return;
      const next = henSeenAt(o.world.state, life.hen.x, life.hen.z);
      if (next !== o.world.state) { o.world.state = next; o.record?.(); }
    },
    /** Each frame, after presence. @param {number} dt real seconds */
    update(dt) {
      homeIn -= dt;
      if (homeIn <= 0) { homeIn = HOME_EVERY_S; findHome(); }
      if (!placed || !poser || !bones) { pass.setBeings([]); return; }
      const hours = o.hours(), h = ((hours % 24) + 24) % 24, day = Math.floor(hours / HOURS_PER_DAY);
      const sources = o.presence.sources();
      const band = R.presence ? henBand(saved(), R.presence) : 0;
      life.step(Math.min(dt, 0.1), { night: h < R.hours[0] || h >= R.hours[1], sources, band, ring: o.ring?.() ?? null, hourOfDay: h, day });
      const s = life.hen;
      // Quiet watching near her (the walker only: the camera above is never felt).
      const felt = sources.filter((x) => x.kind === 'walker' && x.body);
      if (watching) {
        for (const w of watching.step([{ id: 1, x: s.x, y: s.y, z: s.z, mode: s.mode }], felt, Math.min(dt, 0.1))) record({ kind: 'watched', minutes: w.minutes, hour: o.hourIndex() });
      }
      // Time near her (Fond): game hours with the walker within fond.nearM, gathered and recorded.
      const dh = Number.isFinite(lastHours) ? Math.max(0, Math.min(0.5, hours - lastHours)) : 0;
      lastHours = hours;
      if (R.fond) {
        if (nearDay !== day && nearH > 0) { record({ kind: 'near', h: Math.round(nearH * 1000) / 1000, hour: nearDay * HOURS_PER_DAY + 23 }); nearH = 0; }
        nearDay = day;
        const w = felt[0];
        if (w && Math.hypot(w.pos[0] - s.x, w.pos[2] - s.z) <= R.fond.nearM) nearH += dh;
        if (nearH >= NEAR_FLUSH_H) { record({ kind: 'near', h: Math.round(nearH * 1000) / 1000, hour: o.hourIndex() }); nearH = 0; }
      }
      poser.pose(life.poseInput(), bones);
      pass.setBeings([{ x: s.x, y: s.y, z: s.z, yaw: s.yaw, size: R.body.displayScale, mesh: 'hen', bones }]);
    },
  };
}
