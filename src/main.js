// @ts-check
// Entry point for index.html: start the island, or show the calm card when WebGPU is missing.

import { startApp } from './app.js';
import { showNoWebGPU, showRebuildingNote } from './ui/no-webgpu.js';
import { showBuildBadge } from './ui/build-badge.js';

/** Shown in the corner badge when no build.json or local server info is available. */
export const BUILD = 'm0-foundations';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));

startApp(canvas, { onDeviceLost: (rebuilding) => showRebuildingNote(rebuilding) })
  .then((r) => {
    if (!r.ok) showNoWebGPU(r.reason);
  })
  .catch((err) => {
    console.error(err);
    showNoWebGPU('device-failed');
  })
  .finally(() => showBuildBadge(BUILD));
