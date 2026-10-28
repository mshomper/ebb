// @ts-check
// The hen in the game (docs/future/15, slice 1): a wary hen in the scrub. She shows once the island
// has scrub (a few grown gorse or grey willow bushes together) and lives about it; `?hen` (testing,
// unsaved) puts her under the view at once. Loads Matt's supplied model (rig.js), lives her day
// (life.js), is posed by her code clips over the file's Idle (motion.js) and drawn by a creature pass
// with her own shader (hen-draw.wgsl). Nothing is saved yet: her life is live, from her seed.
// Numbers: recipes/species/hen.json.

import { readGlb } from '../../render/gltf.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { subSeed } from '../../core/rng.js';
import { buildHen } from './rig.js';
import { createHenPoser } from './motion.js';
import { createHenLife, scrubHome } from './life.js';

/** How often the scrub is looked for again (real seconds). */
const HOME_EVERY_S = 2;

/** Fetch the model named by the recipe (a path from the repo root). @param {any} R */
export async function loadHenModel(R) {
  const res = await fetch(new URL(`../../../${R.model}`, import.meta.url));
  if (!res.ok) throw new Error(`hen model ${R.model}: ${res.status}`);
  return readGlb(await res.arrayBuffer());
}

/**
 * @param {{ recipe: any, seed: number, world: { state: any }, terrain: { sampleHeight: (x: number, z: number) => number },
 *   water: { tide: number, sampleLive: (x: number, z: number) => { depth: number } }, camera: { target: ArrayLike<number>, eye: ArrayLike<number> },
 *   presence: import('../creatures/presence.js').Presence, hours: () => number, test?: boolean }} o
 *   hours: display time in game hours; test: `?hen`, under the view at once
 */
export function createHen(o) {
  const R = o.recipe;
  const pass = createCreaturePass({ recipe: R, name: 'hen', shader: 'hen-draw', maxBones: R.bones.length, extraFloats: 4, maps: true });
  pass.setExtra([R.body.alphaCut, 0, 0, 0]);
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const wet = (/** @type {number} */ x, /** @type {number} */ z) => ground(x, z) < o.water.tide + 0.03 || o.water.sampleLive(x, z).depth > 0.005;
  const life = createHenLife({ R, seed: subSeed(o.seed, 'hen'), ground, wet });
  /** @type {ReturnType<typeof createHenPoser> | null} */ let poser = null;
  /** @type {Float32Array | null} */ let bones = null;
  let placed = false, homeIn = 0;
  loadHenModel(R).then((glb) => {
    const built = buildHen(glb, R);
    pass.setMesh('hen', { data: built.data, indices: built.indices });
    pass.setMaps(glb).catch((err) => console.error('The hen maps did not load:', err));
    poser = createHenPoser(built.skeleton, R.motion, built.idle);
    bones = new Float32Array(built.skeleton.length * 16);
  }).catch((err) => console.error('The hen did not load:', err));

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

  /** Look for her scrub; with `?hen` and none, under the view. Puts her down the first time. */
  function findHome() {
    const plants = o.world.state?.growth?.plants ?? [];
    const scrub = scrubHome(plants, R.home);
    if (scrub) {
      if (!placed) { const at = dryNear(scrub.x, scrub.z); if (at) { life.setHome(at, R.home.rangeM, true); placed = true; } }
      else life.setHome(scrub, R.home.rangeM);
      return;
    }
    if (o.test && !placed) {
      // Ahead of the view, past her ring, so she is first seen foraging rather than running.
      const t = o.camera.target, e = o.camera.eye, fx = t[0] - e[0], fz = t[2] - e[2], fl = Math.hypot(fx, fz) || 1;
      const at = dryNear(t[0] + (fx / fl) * R.home.testAheadM, t[2] + (fz / fl) * R.home.testAheadM);
      if (at) { life.setHome(at, R.home.testRangeM, true); placed = true; }
    }
  }

  return {
    pass,
    life,
    /** Is she out on the island? */
    get out() { return placed; },
    /** Each frame, after presence. @param {number} dt real seconds */
    update(dt) {
      homeIn -= dt;
      if (homeIn <= 0) { homeIn = HOME_EVERY_S; findHome(); }
      if (!placed || !poser || !bones) { pass.setBeings([]); return; }
      const h = ((o.hours() % 24) + 24) % 24;
      life.step(Math.min(dt, 0.1), { night: h < R.hours[0] || h >= R.hours[1], sources: o.presence.sources() });
      const s = life.hen;
      poser.pose(life.poseInput(), bones);
      pass.setBeings([{ x: s.x, y: s.y, z: s.z, yaw: s.yaw, size: R.body.displayScale, mesh: 'hen', bones }]);
    },
  };
}
