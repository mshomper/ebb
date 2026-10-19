// @ts-check
// Time away in the game (docs 02, 18; S7b): when the island catches up, and the swap afterwards.
//   On opening the game: the time since the last save.
//   Back to a hidden tab: the time it was out of sight, at 1x whatever the time flow (doc 02).
//   Pretend I was away (the badge's Saves menu): that many hours now, for testing.
// While it runs, world time and saving both wait (a save then would stamp the old island with the
// time now), and the catching-up screen covers the island if it takes a while. Then the new island
// and journal go in at once, the clock moves on by the hours run, and `world:caught-up` says what
// was written; the notes are not posted, so they wait in the journal as "You may have missed".

import * as clock from '../core/clock.js';
import { get, update } from '../core/store.js';
import { emit, emitDeferred } from '../core/events.js';
import { loadRecipe } from '../core/recipes.js';
import { awayHours, catchUp } from './catchup.js';
import { showCatchingUp } from '../ui/catching-up.js';

/**
 * @param {{ app: any, jr: { words: any, island: any, web: any } }} opts
 *   app: startApp's result (world, save); jr: the journal's recipes
 */
export async function mountAway(opts) {
  const { app, jr } = opts;
  const save = app.save ?? null;
  const saveRecipe = await loadRecipe('world/save');
  const recipe = saveRecipe.catchUp, reveal = saveRecipe.reveal;
  let busy = false;

  /** Game hours earned since `since` (UTC ms), with the carried minutes, by doc 18's rules. @param {number} since @param {number} [highWater] */
  function earned(since, highWater = since) {
    const meta = get('meta') ?? {};
    const a = awayHours({ now: Date.now(), savedAt: since, wallHighWater: highWater, carryMinutes: meta.carryMinutes ?? 0,
      flow: clock.flow(), keepGrowing: meta.keepGrowing ?? true });
    update('meta', (m) => { m.carryMinutes = a.carryMinutes; });
    return a;
  }

  /** Run `hours` game hours now and swap the result in. @param {number} hours @param {string} why */
  async function run(hours, why) {
    if (busy || hours <= 0) return;
    busy = true;
    save?.hold(true);
    clock.hold(true);
    // Long enough away for the reveal (src/ui/reveal.js): it opens from cream, so the screen is up at once.
    const revealing = hours >= reveal.thresholdHours;
    const screen = showCatchingUp({ afterS: revealing ? 0 : recipe.screenAfterS });
    const t0 = performance.now();
    try {
      const world = app.world;
      const before = { growth: world.state?.growth ?? null };
      const r = await catchUp({
        seed: world.env.seed, recipes: world.env.recipes, habitat: world.env.habitat?.() ?? null,
        material: get('terrainLive')?.mirror?.material ?? null, state: world.state, journal: get('journal') ?? null, jr,
        fromHour: clock.hourIndex() + 1, hours, block: recipe.blockHours, onProgress: (d, n) => screen.progress(d / n),
      });
      world.state = r.state;
      update('world', () => world.state);
      if (r.journal) emit('journal:replaced', { journal: r.journal });
      clock.skip(hours * clock.SECONDS_PER_HOUR);
      // The water starts again at the new tide rather than draining or filling for minutes.
      app.water?.reseed?.(clock.display() / clock.SECONDS_PER_HOUR);
      console.info(`caught up ${hours} game hours (${why}) in ${Math.round(performance.now() - t0)} ms; ${r.notes.length} notes`);
      emitDeferred('world:caught-up', { hours, why, notes: r.notes, events: r.events, before, reveal: revealing });
    } catch (err) {
      console.error('catch-up failed; the island carries on from where it was', err);
    } finally {
      clock.hold(false);
      screen.done(revealing ? reveal.creamFadeS : undefined);
      save?.hold(false);
      save?.saveSoon('event');
      busy = false;
    }
  }

  // On opening the game: the time since the last save.
  if (save?.status === 'loaded' && save.lastSeen) {
    const a = earned(save.lastSeen.savedAt, save.lastSeen.wallHighWater);
    save.setHighWater(a.wallHighWater);
    if (a.hours > 0) run(a.hours, 'away');
    else save.hold(false);
  }

  // Back to a hidden tab: the time it was out of sight (short spells add up in the carried minutes).
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!hiddenAt) return;
    const since = hiddenAt;
    hiddenAt = 0;
    const a = earned(since);
    if (a.hours > 0) run(a.hours, 'hidden');
  });

  return {
    /** Hours to offer in the badge's Pretend I was away. */
    pretendHours: /** @type {number[]} */ (recipe.pretendHours),
    /**
     * Pretend you were away this many game hours (one real minute each): the same rules as a real
     * absence, so 30 days gives 14, and a paused island gets nothing.
     * @param {number} hours
     * @returns {Promise<ReturnType<typeof awayHours>>}
     */
    async pretend(hours) {
      const since = Date.now() - hours * 60000;
      const a = earned(since);
      await run(a.hours, 'pretend');
      return a;
    },
  };
}
