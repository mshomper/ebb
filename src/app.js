// @ts-check
// Starts ebb on a canvas: GPU, tier, camera, terrain, sky and light, the hourly tick, frame graph,
// input, history and the frame loop.
// Shared by index.html (through main.js) and the tools pages, so they measure the same code.
//
// Each system starts in its own file under src/app/, in the order listed in src/app/systems.js, on
// one start-up context (src/app/context.js). What startApp gives back is built in src/app/api.js.

import { initGpu, onDeviceLost } from './core/gpu.js';
import { SYSTEMS } from './app/systems.js';
import { result as appResult } from './app/api.js';

/**
 * @typedef {{ ok: true, tier: string, tierReasons: string[], adapterInfo: GPUAdapterInfo | null, features: string[], stop: () => void,
 *   terrain: import('./world/terrain/index.js').Terrain,
 *   water: import('./world/water/index.js').Water,
 *   growth: import('./world/growth/index.js').Growth, world: { state: any, env: any },
 *   palette: { list: () => { id: string, name: string }[], current: () => any, apply: (json: any, fadeS?: number) => void },
 *   quality: { set: (tier: string) => boolean, tier: () => string, renderScale: () => number, pinScale: (s: number | null) => void, info: () => any },
 *   pickColor: (cssX: number, cssY: number) => Promise<string> }
 *   | { ok: false, reason: 'missing'|'no-adapter'|'device-failed' }
 *   | { ok: false, reason: 'elsewhere', takeOver: () => void }
 *   | { ok: false, reason: 'damaged', save: any, islands: { id: string, name: string }[] }} StartResult
 */

/**
 * @typedef {{ onDeviceLost?: (rebuilding: boolean) => void, save?: boolean, build?: string, labCamera?: boolean }} StartHooks
 *   save: keep this island in the device's save (only the game asks; tool pages run unsaved);
 *   labCamera: the camera may come close and its own eye startles creatures (the frog lab)
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {StartHooks} [hooks]
 * @returns {Promise<StartResult>}
 */
export async function startApp(canvas, hooks = {}) {
  const result = await initGpu(canvas);
  if (!result.ok) return result;

  /** @type {import('./app/context.js').AppContext} */
  const ctx = { canvas, hooks, gpu: result.gpu };
  for (const step of SYSTEMS) {
    // A step that does not wait on anything runs straight on, as the code did before it was split.
    const ran = step(ctx);
    const early = ran instanceof Promise ? await ran : ran;
    // The save is open in another tab, or damaged: the start ends here (src/main.js shows why).
    if (early) return /** @type {StartResult} */ (early);
  }

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    ctx.stopFrames();
    ctx.observer.disconnect();
    ctx.unAction();
    ctx.walkControls.dispose();
    ctx.photo.dispose();
    ctx.walk.dispose();
    ctx.sowOverlay.dispose();
    ctx.fishingOverlay.dispose();
    ctx.unHistory();
    ctx.unHour();
    ctx.unWash();
    ctx.ww.dispose();
    ctx.unProbe();
    ctx.live.dispose();
    ctx.detachDesktop();
    ctx.graph.dispose();
    ctx.sim.dispose();
    ctx.atmosphere.dispose();
    ctx.groundDetail.dispose();
  }

  onDeviceLost((info) => {
    if (stopped) return;
    console.warn('GPU device lost:', info.reason, info.message);
    stop();
    hooks.onDeviceLost?.(true);
    // Rebuild everything from the store and recipes on a fresh device.
    startApp(canvas, hooks).then(() => hooks.onDeviceLost?.(false));
  });

  return appResult(ctx, stop);
}
