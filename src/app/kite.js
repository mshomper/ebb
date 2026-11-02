// @ts-check
// The kite (docs/future/20, 'The kite'; src/world/kite): washed in on the islet's strandline after a
// gale, mended at the workbench, flown from the islet's top with Fly on its own card, and the view
// rising with it. Run in order from src/app/systems.js, after the kit (the sketchbook's recipe);
// reads and adds to the start-up context (src/app/context.js).
//
// Test links (unsaved; the islet must stand, so with `?islet`), the wind forced up:
//   `?islet&kite`         the torn kite lies on the strand now, you a step from it
//   `?islet&kite=mended`  the mended kite on the belt, you on the islet's top (open the Keeper book's Kit)
//   `?islet&kite=fly`     the same, and the kite goes up (Rise with it on its card)

import * as clock from '../core/clock.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { dispatch } from '../input/actions.js';
import { weatherAt } from '../world/weather.js';
import { cleanCook, recordMade } from '../world/camp/making.js';
import { createKite } from '../world/kite/index.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { camRecipe, camera, camp, islet, landRecipe, pack, params, pieces, seasonsRecipe, sim, sketchRecipe, terrain, walk, waterRecipe, world } = ctx;
  if (!islet) return;
  const R = await loadRecipe('world/kite');
  const test = params.has('kite') && !ctx.back ? params.get('kite') ?? '' : null;
  const T = waterRecipe.tide ?? {};
  const center = camRecipe.worldCenter ?? [landRecipe.center?.x ?? 0, landRecipe.center?.z ?? 0];
  const kite = createKite({ recipe: R, islet, terrain, world, weather: seasonsRecipe.weather, pieces, walk, camera, fovYDeg: camRecipe.fovYDeg, pack, camp, sketchRecipe,
    highTideM: (T.amplitudeM ?? 0.6) * (1 + (T.springNeap ?? 0)), hours: () => clock.display() / clock.SECONDS_PER_HOUR,
    wind: () => {
      const w = weatherAt(world.state?.weather, clock.display(), seasonsRecipe).wind ?? 0;
      return { wind: test !== null ? Math.max(w, 0.8) : w, dir: world.state?.weather?.today?.windDir ?? seasonsRecipe.weather.wind.prevailingDir };
    },
    // The view frames the island, the islet and the stack offshore (F19's store slice `stack`, once it stands).
    things: () => {
      const L = islet.layout, st = getStore('stack');
      const out = [{ x: center[0], z: center[1], r: camRecipe.worldRadius + camRecipe.targetMargin }, { x: L.x, z: L.z, r: L.A }];
      if (st && Number.isFinite(st.x) && Number.isFinite(st.z)) out.push({ x: st.x, z: st.z, r: 10 });
      return out;
    },
    photoOpen: () => !!getStore('photo')?.open });
  sim.addSystem(kite);
  Object.assign(ctx, { kite });
  if (test === null) return;

  if (test === 'mended' || test === 'fly') updateStore('cook', (c) => recordMade(cleanCook(c), 'kite', clock.worldT() / 3600, true));
  let done = false, wait = 0, flyAt = -1;
  sim.addSystem({ id: 'kite-test', tick(/** @type {any} */ f) {
    if (flyAt > 0 && (flyAt -= f.realDt) <= 0) kite.fly();
    if (done || getStore('islet')?.phase !== 'risen' || getStore('testGrow')?.done === false) return;
    // After the islet's own glide and its note have played.
    if ((wait += f.realDt) < (test === '' ? 6 : 1.5)) return;
    if (test === 'mended' || test === 'fly') {
      const t = kite.top();
      if (!t || !walk.placeAt(t.x, t.z, Math.atan2(islet.layout.ux, islet.layout.uz), 'stand')) return;
      walk.downHere();
      done = true;
      if (test === 'fly') flyAt = 1.5;
      return;
    }
    if (!getStore('journal')) return;
    dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: 'setpiece:kite:washed' }));
    // You stand a step inland of it, facing it, ready to take it up.
    const s = kite.spot(), L = islet.layout;
    if (s) {
      const x = s.x + L.ux * 1.3, z = s.z + L.uz * 1.3;
      if (walk.placeAt(x, z, Math.atan2(s.x - x, s.z - z), 'stand')) walk.downHere();
      else camera.focus(s.x, s.z, 9, 38);
    }
    done = true;
  } });
}
