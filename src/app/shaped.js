// @ts-check
// Shaped ground and visits (doc 13 "Shaped, not found"; B3 S0): the watch that measures the homes
// B3's newcomers want (src/world/ecology/shaped.js, shaped-live.js) into the store slice
// `shapedNow`, and the visits (src/world/ecology/visits.js) that send a newcomer to show itself
// before its home exists. A species plugs in with recipe lines only: docs/11 "Visits and shaped homes".
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).
//
// Emits visit:start { sp, show, x, z, hour, day } when a visit begins while you play: the species'
// own module shows it (its show block says how). Visits that fell while the island was away leave
// their flags and the morning's hint, unseen.

import * as clock from '../core/clock.js';
import { emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { dispatch, history } from '../input/actions.js';
import { createShapedWatch, cleanShaped } from '../world/ecology/shaped-live.js';
import { visitorsOf, visitStep, visitSpot } from '../world/ecology/visits.js';
import { buildShapedDemo } from '../world/ecology/shaped-demo.js';

/** @param {import('./context.js').AppContext} ctx */
export async function start(ctx) {
  const { gather, seed, sim, speciesRecipes, walk, world } = ctx;
  const shapedRecipe = await loadRecipe('world/shaped');
  const nowH = () => clock.worldT() / clock.SECONDS_PER_HOUR;
  const visitors = visitorsOf(speciesRecipes);
  /** @type {((report: any) => void)[]} */ const afterLook = [];

  /** The visits since the last look: flags, memory, and the ones to show now. @param {any} report */
  function visitsNow(report) {
    const m = cleanShaped(getStore('shaped')), j = getStore('journal');
    if (!j) return;
    const flags = j.flags ?? [];
    const h = Math.floor(nowH());
    const r = visitStep({ seed, nowH: h, lookedH: m.visits.lookedH, by: m.visits.by, visitors, report, hab: world.env.habitat?.() ?? null,
      flags, ever: (sp) => !!j.species?.[sp]?.ever, awayGapH: shapedRecipe.visits.awayGapH });
    updateStore('shaped', (v) => ({ ...cleanShaped(v), visits: { lookedH: h, by: r.by } }));
    for (const f of r.flags) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: f }));
    for (const v of r.show) emitDeferred('visit:start', v);
  }

  const watch = createShapedWatch({ R: shapedRecipe, world, nowH, you: () => (walk.below ? walk.you() : null),
    wrack: (x, z, r) => gather.near(x, z, r),
    onLook: (report) => { visitsNow(report); for (const f of afterLook) f(report); } });
  sim.addSystem(watch);

  /**
   * Make a visit now (the `?visit=` test link): shown at once where its show block says, and
   * written as yesterday's too, so this morning's hint can come. @param {string} sp
   */
  function visitNow(sp) {
    const v = visitors.find((x) => x.sp === sp);
    if (!v) { console.warn(`?visit=${sp}: no species recipe has ecology.visit for it`); return; }
    const day = clock.dayIndexOf(clock.worldT()), hab = world.env.habitat?.() ?? null;
    const at = visitSpot(hab, v.V.show?.where ?? 'shore', seed, sp, day);
    updateStore('shaped', (s) => { const m = cleanShaped(s); return { ...m, visits: { ...m.visits, by: { ...m.visits.by, [sp]: { last: day - 1, x: at?.x ?? null, z: at?.z ?? null, n: (m.visits.by[sp]?.n ?? 0) + 1 } } } }; });
    dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: `${sp}:visited` }));
    if (at) emitDeferred('visit:start', { sp, show: v.V.show ?? {}, x: at.x, z: at.z, hour: Math.floor(nowH()), day });
  }

  Object.assign(ctx, { shapedRecipe, shapedWatch: watch, shapedAfterLook: afterLook, visitNow });
}

/**
 * Test links (testing, unsaved): `?shape=bar|wall|pond|wrack` (or several joined by commas) shapes
 * that ground with real strokes (src/world/ecology/shaped-demo.js); `?shape=pond` ages the pond to
 * test.pond.ageDays (`&pondAge=N` for another age), `?shape=wrack` thickens the strandline's wrack
 * and says it has lain test.wrack.days. `?visit=<sp>` makes that species' visit now.
 * @param {import('./context.js').AppContext} ctx
 */
export function tests(ctx) {
  const { camera, gather, params, shapedRecipe, shapedAfterLook, shapedWatch, terrain } = ctx;
  const T = shapedRecipe.test;
  const kinds = (params.get('shape') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (kinds.includes('wrack')) {
    // Wrack on every bin of the newest two strandlines, on any tide (the gather recipe, this visit only).
    const W = gather.recipe.kinds.wrack;
    Object.assign(W, { empty: W.empty.map(() => 0), emptyOnshore: 0, cluster: null });
    let aged = false;
    shapedAfterLook.push((r) => {
      if (aged || r.wrack.lyingM < shapedRecipe.wrack.minM) return;
      aged = true;
      updateStore('shaped', (v) => ({ ...cleanShaped(v), wrack: { since: Math.floor(clock.worldT() / clock.SECONDS_PER_HOUR) - T.wrack.days * 24 } }));
      shapedWatch.look();
    });
  }
  if (kinds.includes('pond')) {
    const age = Number.parseFloat(params.get('pondAge') ?? '') || T.pond.ageDays;
    let aged = false;
    shapedAfterLook.push((r) => {
      if (aged || !r.ponds.some((/** @type {any} */ p) => p.dug)) return;
      aged = true;
      const h = clock.worldT() / clock.SECONDS_PER_HOUR;
      updateStore('shaped', (v) => { const m = cleanShaped(v); return { ...m, ponds: m.ponds.map((p) => ({ ...p, born: Math.min(p.born, h - age * 24) })) }; });
      shapedWatch.look();
    });
  }
  const strokes = kinds.filter((k) => k === 'bar' || k === 'wall' || k === 'pond');
  if (strokes.length) {
    buildShapedDemo({ terrain, history, kinds: strokes, T, focus: (x, z, distance, pitchDeg) => camera.focus(x, z, distance, pitchDeg) })
      .then((L) => emitDeferred('shaped:demo-built', { kinds: strokes, layout: L }))
      .catch((err) => console.error('shaped demo failed', err));
  }
  const sp = params.get('visit');
  if (sp) {
    // Once the island is up and its journal is in place.
    const wait = () => (getStore('journal') && ctx.world.env.habitat?.() ? ctx.visitNow(sp) : setTimeout(wait, 500));
    setTimeout(wait, 1500);
  }
}
