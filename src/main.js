// @ts-check
// Entry point for index.html: start the island, or show the calm card when WebGPU is missing.

import { startApp } from './app.js';
import { showNoWebGPU, showRebuildingNote } from './ui/no-webgpu.js';
import { showBuildBadge } from './ui/build-badge.js';
import { mountTools } from './ui/tools.js';

/** Shown in the corner badge when no build.json or local server info is available. */
export const BUILD = 'm1-s1-terrain';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
let toolsMounted = false;

startApp(canvas, { onDeviceLost: (rebuilding) => showRebuildingNote(rebuilding) })
  .then((r) => {
    if (!r.ok) showNoWebGPU(r.reason);
    else if (new URLSearchParams(location.search).has('debug')) /** @type {any} */ (window).ebb = r;
    if (r.ok && !toolsMounted) {
      toolsMounted = true;
      mountTools(document.body);
    }
  })
  .catch((err) => {
    console.error(err);
    showNoWebGPU('device-failed');
  })
  .finally(() => showBuildBadge(BUILD));
