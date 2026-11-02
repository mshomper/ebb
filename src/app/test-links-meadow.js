// @ts-check
// The marker stone's and the rye's test links (F20, testing, unsaved). Run in order from
// src/app/systems.js. Each needs the islet up, so each goes with `?islet` (risen now), and with a
// `?day=` for the time of year it shows:
//
//   ?islet&stone                       you by the marker stone, facing it (its card before the pot)
//   ?islet&day=14&hour=11.5&stone=noon you and the shovel by the stone half an hour before midsummer
//                                      noon: the light comes at 12:00; Dig on the spot gives the pot
//   ?islet&stone=pot                   the pot already found: the blade in the pack (make the sickle
//                                      with `&camp=bench`), and the stone's calendar card
//   ?islet&day=24&rye                  a gold strip of rye beside the stone and the sickle: Cut the rye
//   ?islet&day=24&rye=stooks           a cut strip's stooks, one dry to take up, the rest drying
//   ?islet&day=30&rye=sow              two handfuls of rye seed in the pack, in autumn, to sow a strip

import * as clock from '../core/clock.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { stripSpots } from '../world/meadow/rye.js';

/** @param {import('./context.js').AppContext} ctx */
export function meadow(ctx) {
  const { back, camera, campRecipe, growth, pack, params, sim, terrain, walk, world } = ctx;
  const which = params.has('stone') ? 'stone' : params.has('rye') ? 'rye' : null;
  if (!which || back || !ctx.meadow) return;
  const kind = params.get(which) ?? '';
  const m = ctx.meadow;
  const hour = () => clock.worldT() / 3600;
  const tool = (/** @type {string} */ t) => updateStore('cook', (c) => (c?.tools?.includes(t) ? c : { ...(c ?? {}), tools: [...(c?.tools ?? []), t] }));
  let done = false, wait = 0;
  sim.addSystem({ id: 'meadow-test', tick() {
    if (done || (wait = (wait + 1) % 30) !== 1) return;
    if (getStore('islet')?.phase !== 'risen' || !growth.habitat?.()) return;
    m.debug.keepWild();
    const st = m.stone;
    // Stand south-east of the stone (or of the spot), facing it.
    const stand = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ d) => {
      for (let i = 0; i < 16; i++) {
        const a = 2.4 + (i / 16) * 2 * Math.PI, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d, yaw = a + Math.PI;
        if (terrain.sampleHeight(px, pz) < 0.6 || !walk.placeAt(px, pz, yaw, 'stand')) continue;
        camera.setPose({ ...camera.pose(), target: [x, terrain.sampleHeight(x, z) + 0.8, z], yaw: yaw + Math.PI, distance: campRecipe.rest.viewDistanceM + 2, pitch: (campRecipe.rest.viewPitchDeg * Math.PI) / 180 });
        walk.downHere();
        return true;
      }
      return false;
    };
    if (which === 'stone') {
      if (kind === 'noon') tool('shovel');
      if (kind === 'pot') {
        updateStore('islet', (s) => ({ ...s, meadow: { ...(s?.meadow ?? { version: 1, lightH: null, stooks: [] }), version: 1, potH: Math.floor(hour()) } }));
        updateStore('unlocks', (u) => ({ ...u, sickle: true }));
        pack.add('sickle-blade', 1);
      }
      done = kind === 'noon' ? stand(m.spot.x, m.spot.z, 1.6) : stand(st.x, st.z, 2.4);
      return;
    }
    tool('sickle');
    if (kind === 'sow') { pack.add('rye.seed', 2); done = stand(st.x, st.z, 6); return; }
    // A strip a few meters off the stone, grown and ripe.
    const ax = st.x + 5, az = st.z + 1;
    let n = 0;
    for (const [x, z] of stripSpots([ax - 2, az], [ax, az], { lengthM: 6, widthM: 2, rows: 4, perRow: 14, jitterM: 0.12 }, 77)) n += growth.plant('rye', x, z, { size: 0.9, minSuit: 0.01 }).ok ? 1 : 0;
    updateStore('world', () => world.state);
    if (kind === 'stooks') {
      // The next hour's step sets their stage; cut them now with the clock's help.
      const plants = (world.state?.growth?.plants ?? []).filter((/** @type {any} */ p) => p.sp === 'rye' && Math.hypot(p.x - ax, p.z - az) < 4);
      for (const p of plants) growth.lift(p.id);
      updateStore('world', () => world.state);
      const h = Math.floor(hour());
      const stooks = [0, 1, 2, 3].map((i) => ({ x: ax - 2.2 + i * 1.5, z: az, yaw: i * 1.3, cutH: i === 0 ? h - 80 : h - 24, straw: 2, seed: i === 0 ? 1 : 0, wetH: 0 }));
      updateStore('islet', (s) => ({ ...s, meadow: { ...(s?.meadow ?? { version: 1, potH: null, lightH: null }), version: 1, stooks } }));
    }
    done = n > 0 ? stand(ax, az, 3.2) : stand(st.x, st.z, 3);
  } });
}
