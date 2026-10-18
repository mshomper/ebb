// @ts-check
// Entry point for index.html: start the island, or show the calm card when WebGPU is missing.

import { startApp } from './app.js';
import { showNoWebGPU, showRebuildingNote } from './ui/no-webgpu.js';
import { showBuildBadge } from './ui/build-badge.js';
import { mountTools } from './ui/tools.js';
import { mountTimeFlow } from './ui/time-flow.js';
import { mountLook } from './ui/look.js';
import { mountJournal } from './ui/journal.js';
import { mountIslandNotes } from './ui/island-notes.js';
import { mountFrogScale } from './ui/frog-scale.js';
import { createJournal } from './world/journal/index.js';
import { loadRecipe } from './core/recipes.js';

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
let toolsMounted = false;

startApp(canvas, { onDeviceLost: (rebuilding) => showRebuildingNote(rebuilding) })
  .then(async (r) => {
    if (!r.ok) showNoWebGPU(r.reason);
    else if (new URLSearchParams(location.search).has('debug')) /** @type {any} */ (window).ebb = r;
    if (r.ok && !toolsMounted) {
      toolsMounted = true;
      mountTools(document.body);
      mountTimeFlow(document.body);
      mountLook(document.body, r.palette.list());
      // The field journal (docs 13, 15): watches the world, writes notes, names what you tap.
      const [words, island] = await Promise.all([loadRecipe('world/journal'), loadRecipe('world/journal-island')]);
      const journal = createJournal({ world: r.world, words, island });
      mountJournal(document.body, journal);
      mountIslandNotes(document.body, words);
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
  .finally(() => showBuildBadge(BUILD));
