// @ts-check
// What startApp gives back (src/app.js): the systems main.js, the journal, the UI and the tool pages
// reach, and the testing helpers on window.ebb with `?debug`.

import * as clock from '../core/clock.js';
import { get as getStore } from '../core/store.js';
import { settingsFor, isTier } from '../render/quality.js';
import { mistyAutumnMorning } from '../world/finds/autumn.js';
import { shorePresence } from '../world/journal/shore-presence.js';
import { fingerprint } from '../save/backup.js';
import { PALETTES } from './recipes.js';

/**
 * @param {import('./context.js').AppContext} ctx
 * @param {() => void} stop
 */
export function result(ctx, stop) {
  const { applyTier, autumn, autumnMoods, autumnRecipe, baker, cairns, camera, camp, canvas, creatures, dig, figureRecipe, finds, fishing, fishingRecipe, frogScale, gather, glints, gpu, growth, hen, intro, island, islands, keepTestLog, keepsakesApi, keepsakesRecipe, kit, lanterns, lift, live, midges, nets, netsRecipe, pack, passingBoat, perchSticks, photo, pieces, piles, planting, presence, reasons, save, schools, setpieces, sowing, speciesRecipes, springCave, stores, terrain, testSwarms, tickHour, tonemap, walk, water, world, ww, zones } = ctx;
  return {
    ok: /** @type {const} */ (true), get tier() { return ctx.tier; }, tierReasons: reasons,
    adapterInfo: gpu.adapter.info ?? null,
    features: [...gpu.features],
    stop,
    /**
     * Hand in what a ground point holds (the journal's cardAt) and its species words, so one click
     * below can walk and use (src/world/walk/click.js). main.js calls it once the journal exists.
     * @param {(x: number, z: number, y?: number) => any} cardAt @param {Record<string, any>} species
     */
    setCards(cardAt, species) { ctx.cards = { cardAt, species }; },
    /**
     * The walker's pack (src/world/pack/index.js): add, take, has, holds({ fuel: 1, stones: 2 }),
     * room; it emits pack:changed { pouches, size } after every change.
     */
    pack,
    /** Gathering (src/world/gather/index.js): the journal's cards gain their Gather buttons from it. */
    gather,
    /** The piles at camp (src/world/pack/piles-live.js): a pile's card reads its words from them. */
    piles,
    /** The camp's stores (src/world/pack/stores.js): the journal's cards ask them first at camp. */
    stores,
    terrain,
    water,
    /** The live growth (habitat, plants) and the world the hourly tick runs on (tools/growth-lab.html). */
    growth,
    world,
    /** The frog size preview (`?frogscale`), or null. */
    frogScale,
    /** The live frogs (the journal asks it what a tap landed on). */
    creatures,
    /** The finds near the view (the journal asks it what a tap landed on). */
    finds,
    /** The keepsakes on the strandline (the journal asks it what a tap landed on). */
    keepsakes: keepsakesApi,
    /** Beach glints (tools, tests): the pass, how many are set now. */
    glints,
    /** The nets (the journal asks which one a tap landed on; the haul tray reads the recipe). */
    nets: { ...nets, recipe: netsRecipe, keepsakesRecipe },
    /** Fishing (the line's tray reads its recipe; the journal and the chart read the island's fish). */
    fishing: { ...fishing, recipe: fishingRecipe },
    /** The placed loose stones (the journal asks which one a tap landed on). */
    pieces,
    /** Lift on foot (L3a): the journal asks whether a piece is in reach to lift. */
    lift,
    /** Autumn's fungi and webs (counts() for tools). */
    autumn,
    /** Zones (src/world/zones) and the spring's cave (src/world/spring), for tools and testing. */
    zones, springCave,
    /** The walker: the walk grid, your feet, Go down and Go up (tools and testing). */
    walk,
    /** The walker's kit (src/world/kit): the Walker page reads and wears through it. */
    kit,
    /** The GPU device, for the Walker page's portrait (its own small view, src/render/portrait.js). */
    device: gpu.device,
    /** The figure recipe, for the portrait. */
    figureRecipe,
    /** The first evening: its start, the boat's mooring, and the director once main.js starts it. */
    intro,
    /** The keeper's camp: the journal asks it what a click at camp lands on; tools read the fire. */
    camp,
    /** The hen (docs/future/15): taps on her and her feather, her band, the test pages. */
    hen,
    /** Digging: the journal asks it whether a tap landed on an open hole. */
    dig,
    /** Perch sticks (B1 P1): the journal asks whether a tap landed on one; tests stand and take them up. */
    perchSticks,
    /** The lanterns (B2 L1): the journal asks whether a tap landed on one; tests set and take them up. */
    lanterns,
    /** Set pieces (docs/future/14): the runner's live core, and the cairns' and the boat's taps and cards. */
    setpieces, cairns, passingBoat,
    /**
     * Testing helpers, on window.ebb with `?debug`: autumn's misty morning and kept logs, skipping to
     * a time of year, and bringing a settled school or swarm. They change this island's time and
     * pieces, so use them on a test link (such as `?debug&autumn`, unsaved) to leave your own island alone.
     */
    debug: {
      /**
       * Jump to the next misty autumn morning on which fungi have grown in (autumn.js
       * mistyAutumnMorning), at the webs' test hour, and run that hour so its weather is the day's.
       * @returns {number | null} the game day, or null if none was found
       */
      autumnMorning() {
        const lean = world.state?.weather?.lean ?? 0;
        const day = mistyAutumnMorning({ fromDay: Math.floor(clock.hourIndex() / 24) + 1, moodOf: autumnMoods(lean), F: autumnRecipe.fungi });
        if (day === null) return null;
        clock.skip((autumnRecipe.webs.testHour + 24 * day) * clock.SECONDS_PER_HOUR - clock.worldT());
        tickHour(clock.hourIndex());
        return day;
      },
      /**
       * Keep a log at a ground point (or near the view's middle) as if carried there before this
       * autumn, so it fruits in autumn. @param {number} [x] @param {number} [z] @returns {string | null} its id
       */
      keptLog: (x, z) => keepTestLog(x, z),
      /** How many fungi and webs are drawn now, and the webs' dew. */
      autumn: () => autumn.counts(),
      /**
       * Skip to the next day `day` of the year (0..55; 13 is the last day of spring) at `hour`,
       * every hour between run by the hourly tick as usual (it may take a few seconds).
       * @param {number} day @param {number} [hour]
       */
      skipTo(day, hour = 10) {
        const year = clock.SECONDS_PER_YEAR, at = clock.worldT() % year;
        const want = (day * clock.HOURS_PER_DAY + hour) * clock.SECONDS_PER_HOUR;
        clock.skip(want > at ? want - at : want + year - at);
        return clock.season();
      },
      /** A settled group of `count` comes now (species id: minnow, dragonfly, damselfly), as its test link does. @param {string} id @param {number} [count] */
      summon(id, count = 8) {
        const rec = speciesRecipes[id];
        if (rec?.ecology?.kind !== 'swarm') return false;
        testSwarms.push({ rec, count: Math.max(1, Math.min(30, count)) });
        return true;
      },
      /** Late spring, if they are not flying now, and a few damselflies at the pond. @param {number} [count] */
      damselflies(count = 8) {
        if (world.state?.seasons?.dormant?.damselflies) this.skipTo(13, 10);
        return this.summon('damselfly', count);
      },
    },
    /** Planting on foot (D1a, P2g; tests and the test links). */
    sowing,
    planting,
    /** The shore zones and rock pools now (the journal's Web shows which are on the island). */
    shorePresence: () => shorePresence(ww.shore.zones(), water.getSummary(), getStore('terrainLive')?.mirror?.material ?? null),
    /** Every live animal system's hooks for the reveal on return (src/ui/reveal.js). */
    animals: [creatures.reveal, midges.reveal, ...schools.map((s) => s.reveal)],
    /** The live schools (minnows), the journal asks them what a tap landed on. */
    schools,
    /** The live midge swarms (tools). */
    midges,
    presence,
    /** The orbit camera, for tools and checks (eye, target, distance). */
    camera,
    /** Photo mode (src/render/photo-mode.js), for tools and checks. */
    photo,
    /** The island this world started from, and the islands there are (the badge's switch). */
    island: { current: island, list: islands },
    /** This island's save (the badge says whether it is kept, and can start it again). */
    save: Object.assign(save, { fingerprint: () => fingerprint(world.state) }),
    /** Palette access for the palette lab (tools/palette-lab.html). */
    palette: {
      list: () => PALETTES.slice(),
      current: () => structuredClone(baker.current()),
      /** @param {any} json @param {number} [fadeS] */
      apply: (json, fadeS = 0) => baker.setPalette(json, { fadeS }),
    },
    /** The quality tier and render scale, switched live with no reload (S8b's Settings, tools). */
    quality: {
      /** Switch to a tier now; a chosen tier ends automatic step downs this session. @param {string} t */
      set(t) {
        if (!isTier(t) || !settingsFor(t)) return false;
        if (ctx.probe) { ctx.probe = null; ctx.unProbe(); }   // the player's pick outranks the startup probe
        live.chosen();
        applyTier(t, false);
        return true;
      },
      tier: () => ctx.tier,
      renderScale: () => live.scale,
      /** Hold the render scale, or release it with null (a tool page's sweep). @param {number | null} s */
      pinScale: (s) => live.pinScale(s),
      /** Scale range, GPU time measure, scale changes, the automatic step (tools). */
      info: () => live.info(),
    },
    /**
     * Final on-screen color at a point given in CSS pixels from the canvas's top-left.
     * @param {number} cssX @param {number} cssY
     */
    pickColor: (cssX, cssY) => tonemap.pick((cssX * canvas.width) / Math.max(1, ctx.size.cssW), (cssY * canvas.height) / Math.max(1, ctx.size.cssH)),
  };
}
