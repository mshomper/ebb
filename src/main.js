// @ts-check
// Entry point for index.html: start the island, or show the calm card when WebGPU is missing.

import { startApp } from './app.js';
import { showNoWebGPU, showRebuildingNote } from './ui/no-webgpu.js';
import { buildInfo, showBuildTag } from './ui/build-badge.js';
import { mountSettings } from './ui/settings.js';
import { applyDisplayPrefs } from './ui/motion.js';
import { mountTools } from './ui/tools.js';
import { mountTimeFlow } from './ui/time-flow.js';
import { mountLook } from './ui/look.js';
import { mountJournal } from './ui/journal.js';
import { mountIslandNotes } from './ui/island-notes.js';
import { mountHaulTray } from './ui/haul-tray.js';
import { registerCatchSketches } from './ui/sketches/catch.js';
import { setDriftwoodRecipe, noteLog } from './ui/sketches/driftwood.js';
import { mountFrogScale } from './ui/frog-scale.js';
import { createJournal } from './world/journal/index.js';
import { createProgress } from './world/expansion.js';
import { keyOf } from './world/species.js';
import { loadRecipe } from './core/recipes.js';
import { on } from './core/events.js';
import { get as getStore, subscribe as subscribeStore, defaultStore } from './core/store.js';
import { startAudio } from './audio/index.js';
import { mountNowPlaying } from './ui/now-playing.js';
import { showElsewhere } from './ui/elsewhere.js';
import { mountAway } from './sim/away.js';
import { mountReveal } from './ui/reveal.js';
import { showDamaged, noticeRecovered } from './ui/damaged.js';
import { mountHud } from './ui/hud.js';
import { mountClockDial } from './ui/clock-dial.js';
import { mountWalk } from './ui/walk.js';

/** Shown in the corner badge when no build.json or local server info is available. */
export const BUILD = 'm1-s3-palette';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));

// ?debug keeps the first distinct console errors on window.ebbErrors, for tools and testing.
if (new URLSearchParams(location.search).has('debug')) {
  /** @type {string[]} */ const errors = [];
  /** @type {any} */ (window).ebbErrors = errors;
  const original = console.error.bind(console);
  console.error = (...args) => {
    const text = args.map(String).join(' ');
    if (errors.length < 40 && !errors.includes(text)) errors.push(text);
    original(...args);
  };
}
// Text size and motion from this device's settings (src/ui/motion.js), on the page from the start.
applyDisplayPrefs();
/** Which build this is: a line for Settings, and a tag under the dial on previews and local builds. */
const build = buildInfo(BUILD);
let toolsMounted = false;
/** The island this world started from, for Settings' island switch. @type {any} */
let islandInfo = null;
/** This island's save, for Settings > Saves (kept, or a test island; start again). @type {any} */
let saveInfo = null;
/** The HUD layer (src/ui/hud.js) that holds every corner button, the build tag included. @type {HTMLElement | null} */
let hudLayer = null;

// The game keeps your island (src/save); tool pages that start the app do not.
startApp(canvas, { onDeviceLost: (rebuilding) => showRebuildingNote(rebuilding), save: true, build: BUILD })
  .then(async (r) => {
    if (r.ok) { islandInfo = /** @type {any} */ (r).island ?? null; saveInfo = /** @type {any} */ (r).save ?? null; }
    if (!r.ok && r.reason === 'elsewhere') { showElsewhere(r.takeOver, false); return; }
    if (!r.ok && r.reason === 'damaged') { showDamaged(r.save, r.islands); return; }
    if (!r.ok) showNoWebGPU(r.reason);
    else if (new URLSearchParams(location.search).has('debug')) /** @type {any} */ (window).ebb = r;
    // Another window took the island over: say so, and offer it back.
    if (r.ok && saveInfo) on('save:moved-away', () => showElsewhere(saveInfo.takeOver, true));
    if (r.ok && !toolsMounted) {
      toolsMounted = true;
      // The island's sound (src/audio, docs 17 and 25): silent until the first touch or key.
      startAudio(defaultStore)
        .then((a) => { if (new URLSearchParams(location.search).has('debug')) /** @type {any} */ (window).ebbAudio = a; })
        .catch((err) => console.warn('ebb audio: the sound did not start', err));
      // The HUD (docs/15): corners and the bottom edge, dimming when idle, H to hide.
      const hud = await mountHud(document.body);
      hudLayer = hud.layer;
      await mountClockDial(hud.layer);
      mountTools(hud.layer);
      // The piece playing, its name softly near the bottom, halfway through (src/ui/now-playing.js).
      mountNowPlaying().catch((err) => console.warn('ebb: the now-playing line did not mount', err));
      mountTimeFlow(hud.layer);
      mountLook(hud.layer, r.palette.list());
      // Go down and Go up (doc 23, the walker): the edge button between the view above and you on foot.
      mountWalk(hud.layer, (await loadRecipe('world/walker')).words);
      // The field journal (docs 13, 15): watches the world, writes notes, names what you tap.
      const [words, island, web, wash, list, naturalist] = await Promise.all([loadRecipe('world/journal'), loadRecipe('world/journal-island'),
        loadRecipe('world/journal-web'), loadRecipe('world/journal-wash'), loadRecipe('world/journal-list'), loadRecipe('world/naturalist')]);
      const journal = createJournal({ world: r.world, words, island, web, wash, list, creatures: /** @type {any} */ (r).creatures ?? null,
        finds: /** @type {any} */ (r).finds ?? null, keepsakes: /** @type {any} */ (r).keepsakes ?? null, pieces: /** @type {any} */ (r).pieces ?? null, nets: /** @type {any} */ (r).nets ?? null, shore: /** @type {any} */ (r).shorePresence ?? null,
        schools: /** @type {any} */ (r).schools ?? [] });
      mountIslandNotes(document.body, words, naturalist);
      // The haul tray (docs/future/12): what a lifted net brought up; living things go back from it.
      const netsApp = /** @type {any} */ (r).nets;
      if (netsApp) {
        mountHaulTray(document.body, { NR: netsApp.recipe, K: netsApp.keepsakesRecipe, words });
        // Each living kind's page is traced from the first one you let go (src/ui/sketches/catch.js).
        registerCatchSketches(netsApp.recipe, () => getStore('nets')?.released ?? []);
      }
      // The Driftwood page's sketch is traced from the log you last tapped (src/ui/sketches/driftwood.js).
      setDriftwoodRecipe(await loadRecipe('world/pieces'));
      subscribeStore('identify', (/** @type {any} */ c) => { if (c?.log) noteLog(c.log); });
      // Progress (src/world/expansion.js): the naturalist's rewards and species gifts, read from the
      // journal. A species recipe's gift goes under its journal page (frog.json's under frogs).
      /** @type {Record<string, any>} */ const gifts = {};
      for (const rec of Object.values(r.world.env.recipes?.species ?? {})) {
        const g = /** @type {any} */ (rec)?.ecology?.gift;
        if (g) gifts[keyOf(/** @type {any} */ (rec))] = g;
      }
      // The beachcomber's and shaper's trails (recipes/world/beachcomber.json, shaper.json; doc 13
      // "Trails"): the general net at four families kept; the rest drawn on the journal's Trails page.
      const [beachcomber, shaper] = await Promise.all([loadRecipe('world/beachcomber'), loadRecipe('world/shaper')]);
      const progress = createProgress({ words, recipe: naturalist, gifts, beachcomber, shaper });
      // The Shelf section draws kept keepsakes from their numbers (docs/future/12).
      const [keepsakesRecipe, bottleMessages] = await Promise.all([loadRecipe('world/keepsakes'), loadRecipe('world/bottle-messages')]);
      mountJournal(document.body, { ...journal, naturalist, beachcomber, shaper, progress, shelf: { K: keepsakesRecipe, messages: bottleMessages } }, hud.layer);
      // A save that came back from earlier copies says so, calmly (src/ui/damaged.js).
      noticeRecovered(saveInfo);
      // Time away (src/sim/away.js): catch up now on the time since the last save, and later on a
      // hidden tab's time; Settings > Tests' Pretend I was away runs through it too.
      // The reveal on return (src/ui/reveal.js) listens first, so the catch-up on opening gets one.
      await mountReveal({ app: r, words });
      const away = await mountAway({ app: r, jr: { words, island, web } });
      if (saveInfo) saveInfo.pretend = away;
      // Settings (docs/15): the button in the top right corner. Quality appears once the app can
      // switch tiers live; a tier chosen there is kept on this device and applied here.
      const quality = /** @type {any} */ (r).quality ?? null;
      const autoTier = quality?.tier() ?? 'medium';
      const choice = getStore('settings')?.qualityChoice;
      if (quality && choice && choice !== 'auto' && choice !== autoTier) quality.set(choice);
      mountSettings({ hudLayer: hud.layer, palettes: r.palette.list(), save: saveInfo, island: islandInfo,
        build: await build, quality, autoTier });
      // `?frogscale`: real-size frogs around the pond to judge creature size (ahead of S6).
      if (r.frogScale) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'src/ui/frog-scale.css';
        document.head.appendChild(css);
        mountFrogScale(document.body, r.frogScale);
      }
      if (new URLSearchParams(location.search).has('debug')) /** @type {any} */ (window).ebbJournal = journal;
    }
  })
  .catch((err) => {
    console.error(err);
    showNoWebGPU('device-failed');
  })
  .finally(async () => showBuildTag(await build, hudLayer));
