// @ts-check
// The hen (docs/future/15): she is made with the creatures; her feather, perch and eggs are drawn with
// the camp's models once the camp is made.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { on } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { onPad } from '../world/camp/layout.js';
import { weatherAt } from '../world/weather.js';
import { createHen } from '../world/hen/index.js';
import { featherMesh } from '../world/hen/feather.js';
import { perchMesh } from '../world/hen/perch.js';
import { eggMesh, scrapeMesh, nestBoxMesh, bedMesh, eggSpots } from '../world/hen/nest.js';
import { wearsBand } from '../world/kit/model.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camera, params, presence, seasonsRecipe, seed, speciesRecipes, terrain, water, world } = ctx;
  // The hen (docs/future/15, slices 1 and 2; src/world/hen): a hen who lives about the scrub once the
  // island has some, and comes to know you (her trust, saved; Fond and her tail feather). `?hen`
  // (testing, unsaved) puts her under the view at once; `&trust=0.5` starts her knowing you that
  // well (0.2 Tolerant, 0.45 Curious, 0.65 Familiar); `&fond` makes her Fond with her feather laid.
  /** The hen's sounds said lately, numbered, for the sound to play (src/audio/creatures-game.js). @type {{ n: number, kind: 'murmur'|'alarm'|'crow'|'song', pos: number[] }[]} */
  const henHeard = [];
  /** Where the nest box stands (slice 4), set once the camp is made (props below). @type {(() => { x: number, z: number, yaw: number } | null) | null} */
  ctx.nestBoxAt = null;
  let henHeardN = 0;
  const henSoundRecipe = await loadRecipe('audio/hen');
  /** `?weather=` previews count for the hen too (a test link can show her shelter or bathe). @type {Record<string, { rain: number, cloud: number }>} */
  const HEN_PREVIEW_WEATHER = { clear: { rain: 0, cloud: 0.1 }, cloud: { rain: 0, cloud: 0.95 }, rain: { rain: 0.8, cloud: 1 }, mist: { rain: 0, cloud: 0.8 } };
  const hen = createHen({ recipe: speciesRecipes.hen, seed, world, terrain, water, camera, presence,
    hours: () => clock.display() / clock.SECONDS_PER_HOUR, hourIndex: () => clock.hourIndex(), test: params.has('hen'),
    testFond: params.has('hen') && params.has('fond'), testEggs: params.has('hen') && params.has('eggs'), ring: () => ctx.ringPlace?.() ?? null, record: () => updateStore('world', () => world.state),
    // Slice 3, her day: the weather sends her under a bush; her perch stands off the camp pad; her
    // murmur, alarm and the distant crow go to the sound (src/audio reads creatureSound.hens).
    weather: () => HEN_PREVIEW_WEATHER[getStore('preview')?.weather] ?? weatherAt(world.state?.weather, clock.display(), seasonsRecipe), onPad: (x, z) => onPad(getStore('campPad') ?? null, x, z),
    sounds: henSoundRecipe, voice: (kind, at) => { henHeard.push({ n: ++henHeardN, kind, pos: [at.x, at.y, at.z] }); if (henHeard.length > 8) henHeard.shift(); },
    nestBox: () => ctx.nestBoxAt?.() ?? null });
  updateStore('creatureSound', (c) => ({ ...(c ?? {}), hens: () => henHeard }));
  on('dig:dug', (/** @type {{ x: number, z: number }} */ p) => hen.dug(p.x, p.z));
  on('world:ticked', () => hen.ticked());
  Object.assign(ctx, { hen });
}

/** @param {import('./context.js').AppContext} ctx */
export function props(ctx) {
  const { camp, hen, speciesRecipes, terrain, walk, world } = ctx;
  // The hen's tail feather (docs/future/15 slice 2b): drawn with the camp's models where it lies,
  // and once taken up, tucked into the hat's band, carried by the hat's bone (as a carrier rides the
  // back, src/world/camp/carriers.js) through every walk and roll.
  const featherR = speciesRecipes.hen.fond?.feather;
  if (featherR) {
    camp.props.addMesh('hen-feather', featherMesh(featherR), featherR.srgb, featherR.rough);
    camp.addProps(() => {
      const f = hen.featherAt();
      /** @type {import('../render/passes/props.js').Prop[]} */
      const out = f ? [{ key: 'hen-feather', x: f.x, y: terrain.sampleHeight(f.x, f.z), z: f.z, yaw: f.yaw, scale: featherR.scale }] : [];
      const H = featherR.onHat;
      const on = H && wearsBand(getStore('kit'), 'hen-feather') ? walk.figure?.()?.carried(H.bone, H.at, H.turnDeg) : null;
      if (on) out.push({ key: 'hen-feather', x: on.x, y: on.y, z: on.z, yaw: on.yaw, pitch: on.pitch, roll: on.roll, scale: H.scale });
      return out;
    });
  }
  // The hen's perch (docs/future/15 slice 3): two forked sticks and a bar off the pad by the fire
  // ring, once she is Familiar; she roosts on it at night.
  const perchR = speciesRecipes.hen.perch;
  if (perchR) {
    camp.props.addMesh('hen-perch', perchMesh(perchR), perchR.srgb, perchR.rough);
    camp.addProps(() => {
      const p = hen.perchAt();
      return p ? [{ key: 'hen-perch', x: p.x, y: terrain.sampleHeight(p.x, p.z), z: p.z, yaw: p.yaw, scale: 1 }] : [];
    });
  }
  // Her eggs (docs/future/15 slice 4): the nest box in the camp's nest slot once made, her scrape
  // under the scrub, the eggs waiting in either, and her moulted feather by the roost in autumn.
  const eggsR = speciesRecipes.hen.eggs;
  const nestBoxAt = () => {
    const s = /** @type {any} */ (getStore('camp'))?.slots?.find((/** @type {any} */ r) => r.slot === 'nest');
    const at = s ? camp.slotAt('nest') : null;
    return at ? { x: at.x, z: at.z, yaw: at.yaw ?? 0 } : null;
  };
  ctx.nestBoxAt = nestBoxAt;
  if (eggsR) {
    const ED = eggsR.draw;
    camp.props.addMesh('hen-egg', eggMesh(ED.eggM), ED.srgb, ED.rough);
    camp.props.addMesh('hen-scrape', scrapeMesh(ED.scrapeR), ED.scrapeSrgb, 0.95);
    camp.props.addMesh('hen-nestbox', nestBoxMesh(), perchR?.srgb ?? [118, 92, 66], 0.85);
    camp.props.addMesh('hen-nestbed', bedMesh(), ED.bedSrgb, 0.9);
    camp.addProps(() => {
      /** @type {import('../render/passes/props.js').Prop[]} */ const out = [];
      const box = nestBoxAt?.();
      if (box) {
        const y = terrain.sampleHeight(box.x, box.z);
        out.push({ key: 'hen-nestbox', x: box.x, y, z: box.z, yaw: box.yaw, scale: 1 }, { key: 'hen-nestbed', x: box.x, y, z: box.z, yaw: box.yaw, scale: 1 });
      }
      const H = /** @type {any} */ (world.state?.creatures?.hens);
      const sc = H?.nest?.scrape;
      if (sc && hen.out) out.push({ key: 'hen-scrape', x: sc[0], y: terrain.sampleHeight(sc[0], sc[1]), z: sc[1], yaw: 0, scale: 1 });
      const n = hen.nestAt();
      if (n) for (const e of eggSpots(n.eggs, n, 0.05)) out.push({ key: 'hen-egg', x: e.x, y: terrain.sampleHeight(e.x, e.z) + (n.where === 'box' ? 0.04 : 0), z: e.z, yaw: e.yaw, scale: ED.eggScale });
      const m = hen.moultAt();
      if (m && featherR) out.push({ key: 'hen-feather', x: m.x, y: terrain.sampleHeight(m.x, m.z), z: m.z, yaw: 1.1, scale: featherR.scale });
      return out;
    });
  }
}
