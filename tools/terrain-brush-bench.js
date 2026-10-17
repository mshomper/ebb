// @ts-check
// Terrain brush bench (docs/08, Performance budget): landform build, brush frames, erosion and
// readback, timed on the real modules. Runs on its own GPU device and terrain, so the game's
// island is never changed.

import { initGpu } from '../src/core/gpu.js';
import { loadRecipe } from '../src/core/recipes.js';
import { subSeed } from '../src/core/rng.js';
import { run, initWorkers } from '../src/core/workers.js';
import { buildBase } from '../src/world/terrain/landform.js';
import { createTerrain } from '../src/world/terrain/index.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const button = /** @type {HTMLButtonElement} */ ($('run'));
const median = (/** @type {number[]} */ a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

/**
 * One labeled bar against a budget.
 * @param {HTMLElement} into @param {string} label @param {number} ms @param {number} budget
 */
function bar(into, label, ms, budget) {
  const scale = Math.max(budget * 1.6, ms * 1.1);
  const el = document.createElement('div');
  el.className = 'bar';
  el.innerHTML = `<div class="label"><span>${label}</span><span>${ms.toFixed(2)} ms (budget ${budget} ms)</span></div>
    <div class="track"><div class="fill${ms > budget ? ' over' : ''}" style="width:${(100 * ms / scale).toFixed(1)}%"></div>
    <div class="budget" style="left:${(100 * budget / scale).toFixed(1)}%"></div></div>`;
  into.appendChild(el);
}

// A short breather between frames (not requestAnimationFrame, which pauses in a hidden tab).
const frame = () => new Promise((r) => setTimeout(r, 4));

async function bench() {
  button.disabled = true;
  for (const id of ['build', 'stamps', 'settle']) $(id).textContent = '';
  const status = $('status');
  status.textContent = 'Building the island';

  const [recipe] = await Promise.all([loadRecipe('world/terrain')]);
  const land = await loadRecipe(recipe.starter.land);
  const seed = subSeed(1, 'terrain');
  const chunks = [];
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) chunks.push({ cx, cz });

  // Island build: main thread, one chunk at a time, then all nine on the worker pool.
  const single = [];
  for (let rep = 0; rep < 3; rep++) {
    for (const c of chunks) {
      const t0 = performance.now();
      buildBase({ land, seed, cx: c.cx, cz: c.cz });
      single.push(performance.now() - t0);
    }
  }
  bar($('build'), 'One chunk, main thread', median(single), 15);
  initWorkers();
  await Promise.all(chunks.map((c) => run({ module: './world/terrain/landform.js', fn: 'buildBase' }, { land, seed, cx: c.cx, cz: c.cz })));
  const pool = [];
  for (let rep = 0; rep < 3; rep++) {
    const t0 = performance.now();
    await Promise.all(chunks.map((c) => run({ module: './world/terrain/landform.js', fn: 'buildBase' }, { land, seed, cx: c.cx, cz: c.cz })));
    pool.push(performance.now() - t0);
  }
  bar($('build'), 'All nine chunks, worker pool', median(pool), 15 * 9 / 4);

  status.textContent = 'Starting the graphics card';
  const g = await initGpu(/** @type {HTMLCanvasElement} */ ($('view')));
  if (!g.ok) { status.textContent = `WebGPU is not available here (${g.reason}).`; button.disabled = false; return; }
  const { device } = g.gpu;
  // GPU timestamps for the settling pass, when the browser allows them.
  const canTime = g.gpu.features.has('timestamp-query');
  const querySet = canTime ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null;
  const resolveBuf = canTime ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const passTimer = (/** @type {string} */ name) => (querySet && name === 'terrain-erosion'
    ? { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined);
  const terrain = await createTerrain(g.gpu, { seed: seed ^ 0x5eed, recipe, land, passTimer });

  // Waiting for the GPU has a fixed delay of its own; measure it with empty submits and take it off.
  const empty = [];
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now();
    device.queue.submit([device.createCommandEncoder().finish()]);
    await device.queue.onSubmittedWorkDone();
    empty.push(performance.now() - t0);
  }
  const latency = median(empty);

  const FRAMES = 40;
  const STEP = 0.6; // meters the cursor moves per frame
  const erosionMs = [];
  const settleRead = [];
  const kinds = /** @type {const} */ (['raise', 'smooth', 'paint']);
  for (const radius of [1, 4, 8]) {
    for (const kind of kinds) {
      status.textContent = `Stroking: ${kind}, ${radius} m brush`;
      const brush = { kind, radius, strength: 1, layer: /** @type {'sand'} */ ('sand') };
      const z = -6 + radius;
      const stampsPerFrame = Math.max(1, Math.ceil(STEP / Math.max(recipe.brush.spacing * radius, 0.25)));
      terrain.beginStroke(brush, [-16, 1, z], 1);
      // Submit a batch of frames and wait once, so the fixed delay is shared by the whole batch.
      const t0 = performance.now();
      for (let i = 0; i < FRAMES; i++) {
        terrain.strokeTo([-16 + i * STEP, 1, z], 1);
        const enc = device.createCommandEncoder();
        terrain.encode(enc, { realDt: 1 / 60 });
        device.queue.submit([enc.finish()]);
      }
      await device.queue.onSubmittedWorkDone();
      const perStamp = Math.max(0, performance.now() - t0 - latency) / (FRAMES * stampsPerFrame);
      bar($('stamps'), `${kind[0].toUpperCase()}${kind.slice(1)}, ${radius} m brush, per stamp`, perStamp, 0.2);

      // End: erosion and readback are recorded in the next encode.
      const done = terrain.endStroke();
      const enc = device.createCommandEncoder();
      const t1 = performance.now();
      terrain.encode(enc, { realDt: 1 / 60 });
      /** @type {GPUBuffer | null} */
      let readTs = null;
      if (querySet && resolveBuf && kind !== 'paint') {
        readTs = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        enc.resolveQuerySet(querySet, 0, 2, resolveBuf, 0);
        enc.copyBufferToBuffer(resolveBuf, 0, readTs, 0, 16);
      }
      device.queue.submit([enc.finish()]);
      terrain.afterSubmit();
      await device.queue.onSubmittedWorkDone();
      const t2 = performance.now();
      await done;
      if (readTs) {
        await readTs.mapAsync(GPUMapMode.READ);
        const ts = new BigInt64Array(readTs.getMappedRange());
        erosionMs.push(Math.max(0, Number(ts[1] - ts[0])) / 1e6);
        readTs.destroy();
      } else if (kind !== 'paint') {
        erosionMs.push(Math.max(0, t2 - t1 - latency));
      }
      settleRead.push(performance.now() - t2);
      await frame();
    }
  }
  bar($('settle'), 'Settling (erosion-lite), once per stroke', median(erosionMs), 2);
  bar($('settle'), 'Read back and fold into the saved heights', median(settleRead), 5);

  terrain.dispose();
  device.destroy();
  status.textContent = 'Done. Run it again any time; numbers wobble a little from run to run.';
  button.disabled = false;
}

button.addEventListener('click', () => {
  bench().catch((err) => {
    console.error(err);
    $('status').textContent = `The bench stopped: ${err.message}`;
    button.disabled = false;
  });
});
