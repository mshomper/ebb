// @ts-check
// Ripples (docs/07): a damped 2D wave equation on a fine window (256² texels of about 0.1 m, 128²
// on the low tier) centered on the camera focus, far finer than the 0.5 m water simulation.
// World-anchored toroidal addressing: world texel c = floor(xz / texelM) lives at index c mod N, so
// moving the window never shifts the rings; each state texel also stores which world texel it
// holds, and one that wraps in from the other side starts at rest. Driven by raindrops and the pour
// brush (hashed on the GPU per substep, no CPU randomness) and by queued impulses (creatures
// hopping in, fish surfacing). Held at rest on dry ground and thin films, so rings stop at the shore.
// The height field (r32float, m) and a small info buffer go to the water drawing (lib-ripples.wgsl).
// Visual only: real seconds, never saved.

import { makeBuffer, makeShaderModule, makeTexture } from '../../core/gpu.js';

/** Bytes of one substep's settings (RippleStep in water-ripples.wgsl), and the slice stride. */
const STEP_BYTES = 592;
const STEP_STRIDE = 768;
export const MAX_IMPULSES = 32;
/** Bytes of RippleInfo in lib-ripples.wgsl. */
const INFO_BYTES = 32;

/**
 * @param {GPUDevice} device
 * @param {{ water: import('./index.js').Water, recipe: any, size?: number }} opts
 *   recipe: water.json `ripples`; size: texels per side (the recipe's size for the tier; 256 or 128)
 */
export async function createRipples(device, opts) {
  const { water, recipe } = opts;
  const N = opts.size ?? recipe.size?.high ?? 256;
  const texelM = recipe.texelM;
  const substepS = recipe.substepS;
  const maxSubsteps = Math.max(1, recipe.maxSubsteps | 0);
  // Courant number, kept well inside the 2D limit 1 / sqrt(2).
  const courant = Math.min(0.5, (recipe.waveSpeed * substepS) / texelM);
  // Amplitude falls to e^-3 (5%) over fadeS, on top of the rings' own spreading.
  const damping = Math.exp((-3 * substepS) / recipe.fadeS);
  const cellM = recipe.dropCellM;

  const T = GPUTextureUsage;
  const state = [0, 1].map((i) => makeTexture(device, {
    label: `ripple-state-${'ab'[i]}`, size: [N, N], format: 'rgba32float', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING,
  }));
  const texture = makeTexture(device, {
    label: 'ripple-height', size: [N, N], format: 'r32float', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING,
  });
  const view = texture.createView();
  const steps = makeBuffer(device, { label: 'ripple-steps', size: STEP_STRIDE * maxSubsteps, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const info = makeBuffer(device, { label: 'ripple-info', size: INFO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const mod = await makeShaderModule(device, 'water-ripples');
  const pipe = await device.createComputePipelineAsync({ label: 'water-ripples', layout: 'auto', compute: { module: mod, entryPoint: 'csRipple' } });
  // Parity p reads state[p] and writes state[1-p]; substep i reads its own slice of `steps`.
  const stateViews = state.map((t) => t.createView());
  const groups = [0, 1].map((p) => Array.from({ length: maxSubsteps }, (_, i) => device.createBindGroup({
    label: `water-ripples-${p}-${i}`, layout: pipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: steps, offset: i * STEP_STRIDE, size: STEP_BYTES } },
      { binding: 1, resource: stateViews[p] },
      { binding: 2, resource: stateViews[1 - p] },
      { binding: 3, resource: view },
    ],
  })));
  // The live water depth ping-pong pair, picked by the water's current parity each frame.
  const depthGroups = water.sim.depthTextures.map((t, p) => device.createBindGroup({
    label: `water-ripples-depth-${p}`, layout: pipe.getBindGroupLayout(1),
    entries: [{ binding: 0, resource: t.createView() }],
  }));

  const data = new ArrayBuffer(STEP_STRIDE * maxSubsteps);
  const u = new Uint32Array(data);
  const s32 = new Int32Array(data);
  const f = new Float32Array(data);
  const infoData = new ArrayBuffer(INFO_BYTES);
  const infoI = new Int32Array(infoData);
  const infoU = new Uint32Array(infoData);
  const infoF = new Float32Array(infoData);

  let cur = 0;           // which state texture holds the latest field
  let acc = 0;
  let count = 0;         // substeps this frame
  let stepIndex = 0;     // substep counter, seeds the drop hash
  let centerX = 0;
  let centerZ = 0;
  let rain = 0;
  /** @type {null | { x: number, z: number, strength: number, radiusM: number }} */
  let pour = null;
  /** @type {[number, number, number, number][]} */
  const impulses = [];
  /** Window origin (world texel index) the field was last stepped with. */
  let origin = [0, 0];

  function writeInfo() {
    infoI[0] = origin[0]; infoI[1] = origin[1];
    infoU[2] = N;
    infoF[3] = texelM; infoF[4] = recipe.normalStrength; infoF[5] = recipe.edgeFadeM;
    infoF[6] = 0; infoF[7] = 0;
    device.queue.writeBuffer(info, 0, infoData);
  }
  origin = [Math.floor(centerX / texelM) - N / 2, Math.floor(centerZ / texelM) - N / 2];
  writeInfo();

  return {
    id: 'ripples',
    /** Height field (r32float, m), indexed by world texel mod N; see lib-ripples.wgsl. */
    texture,
    view,
    /** RippleInfo uniform for lib-ripples.wgsl (window origin, N, texel size, normal strength, edge fade). */
    info,
    /** Texels per side. */
    size: N,
    texelM,

    /** @param {import('../../sim/live-sim.js').FrameInfo} fr */
    tick(fr) {
      acc += fr.realDt;
      count = Math.min(maxSubsteps, Math.floor(acc / substepS));
      acc -= count * substepS;
      if (acc > substepS) acc = 0; // a slow frame drops time rather than piling up substeps
    },

    /** @param {GPUCommandEncoder} encoder */
    encode(encoder) {
      if (count <= 0) return;
      origin = [Math.floor(centerX / texelM) - N / 2, Math.floor(centerZ / texelM) - N / 2];
      const rainP = Math.min(1, recipe.rain.dropsPerM2S * rain * cellM * cellM * substepS);
      let pourP = 0;
      const pr = pour;
      if (pr && pr.strength > 0 && pr.radiusM > 0) {
        const perM2 = (recipe.pour.dropsPerS * pr.strength) / (Math.PI * pr.radiusM * pr.radiusM);
        pourP = Math.min(1, perM2 * cellM * cellM * substepS);
      }
      const nImp = Math.min(impulses.length, MAX_IMPULSES);
      for (let i = 0; i < count; i++) {
        const b = (i * STEP_STRIDE) / 4;
        s32[b] = origin[0]; s32[b + 1] = origin[1];
        u[b + 2] = N; f[b + 3] = texelM;
        f[b + 4] = courant * courant; f[b + 5] = damping; f[b + 6] = recipe.minWaterDepthM;
        u[b + 7] = (stepIndex + i) >>> 0;
        f[b + 8] = rainP; f[b + 9] = cellM;
        f[b + 10] = Math.min(recipe.rain.radiusM, cellM); f[b + 11] = recipe.rain.strengthM;
        f[b + 12] = pr ? pr.x : 0; f[b + 13] = pr ? pr.z : 0; f[b + 14] = pr ? pr.radiusM : 0; f[b + 15] = pourP;
        f[b + 16] = Math.min(recipe.pour.radiusM, cellM); f[b + 17] = recipe.pour.strengthM; f[b + 18] = 0;
        // Queued impulses land on the first substep only.
        u[b + 19] = i === 0 ? nImp : 0;
        if (i === 0) for (let k = 0; k < nImp; k++) f.set(impulses[k], b + 20 + k * 4);
      }
      impulses.splice(0, nImp);
      stepIndex = (stepIndex + count) >>> 0;
      device.queue.writeBuffer(steps, 0, data, 0, count * STEP_STRIDE);
      writeInfo();

      const g = Math.ceil(N / 8);
      const pass = encoder.beginComputePass({ label: 'water-ripples' });
      pass.setPipeline(pipe);
      pass.setBindGroup(1, depthGroups[water.sim.current]);
      for (let i = 0; i < count; i++) {
        pass.setBindGroup(0, groups[cur][i]);
        pass.dispatchWorkgroups(g, g);
        cur = 1 - cur;
      }
      pass.end();
    },

    dispose() {
      for (const t of [...state, texture]) t.destroy();
      steps.destroy(); info.destroy();
    },

    /** Center the window on a world point (the camera's orbit target). @param {number} x @param {number} z */
    setCenter(x, z) { centerX = x; centerZ = z; },
    /** Rain intensity now, 0..1 (the weather's rain). @param {number} r */
    setRain(r) { rain = Math.max(0, Math.min(1, r || 0)); },
    /**
     * The pour brush this frame: a steady stream of small drops inside its radius. Strength 0 (or
     * no call with a strength) when not pouring.
     * @param {number} x @param {number} z @param {number} strength 0..1 @param {number} [radiusM]
     */
    setPour(x, z, strength, radiusM = recipe.pour.brushRadiusM) {
      pour = strength > 0 ? { x, z, strength: Math.min(1, strength), radiusM } : null;
    },
    /**
     * Queue one drop (a frog hopping in, a fish surfacing); it lands on the next substep. Up to 32 a
     * frame; extras wait for the next.
     * @param {number} x @param {number} z @param {number} [strength] dip depth (m)
     * @param {number} [radiusM]
     */
    addImpulse(x, z, strength = recipe.impulse.strengthM, radiusM = recipe.impulse.radiusM) {
      if (impulses.length < MAX_IMPULSES * 4) impulses.push([x, z, strength, Math.max(radiusM, texelM)]);
    },
  };
}

/** @typedef {Awaited<ReturnType<typeof createRipples>>} Ripples */
