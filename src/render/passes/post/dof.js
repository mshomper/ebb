// @ts-check
// Depth of field for photo mode (B2 P1; src/shaders/dof.wgsl): a thin lens on the linear HDR image,
// run after the scene and before exposure, bloom and the tonemap, only while photo mode is open.
// Focus follows a point on the screen (a click); the aperture is an f-number on a full-frame
// sensor, the focal length from the camera's field of view. The blurred image is drawn into a
// target of its own and copied back over the HDR target, so every later pass reads it as before.
// Numbers: recipes/world/photo.json dof.

import { makeBuffer, makeShaderModule } from '../../../core/gpu.js';

/** @typedef {import('../../frame-graph.js').PassContext} PassContext */

const DOF_BYTES = 48;

/**
 * The lens for a vertical field of view and f-number (pure, for tests): focal length and aperture
 * diameter in meters, and image pixels per meter on the sensor.
 * @param {number} fovYDeg @param {number} fStop @param {number} sensorHeightMm @param {number} imageHeightPx
 */
export function lensOf(fovYDeg, fStop, sensorHeightMm, imageHeightPx) {
  const h = sensorHeightMm / 1000;
  const focalM = h / 2 / Math.tan((fovYDeg * Math.PI) / 360);
  return { focalM, apertureM: focalM / Math.max(0.5, fStop), pxPerSensorM: imageHeightPx / h };
}

/**
 * Blur circle radius in pixels for a thing z meters away when focused at zf (pure, as the shader).
 * @param {{ focalM: number, apertureM: number, pxPerSensorM: number }} lens @param {number} z @param {number} zf
 */
export function cocRadiusPx(lens, z, zf) {
  const f = lens.focalM;
  return 0.5 * (lens.apertureM * f * Math.abs(z - zf)) / (z * Math.max(zf - f, 1e-4)) * lens.pxPerSensorM;
}

/**
 * @param {{ recipe: any, fovYDeg: number }} opts recipe: recipes/world/photo.json
 */
export function createDofPass(opts) {
  const R = opts.recipe.dof;
  /** @type {GPURenderPipeline} */ let pipeline;
  /** @type {GPUComputePipeline} */ let focusPipeline;
  /** @type {GPUBindGroupLayout} */ let layout;
  /** @type {GPUSampler} */ let sampler;
  /** @type {GPUBuffer} */ let uniforms;
  /** @type {GPUBuffer} */ let focusBuffer;
  /** @type {GPUTexture | null} */ let out = null;
  /** @type {GPUBindGroup | null} */ let group = null;
  const data = new Float32Array(DOF_BYTES / 4);
  const state = { on: false, fStop: R.fStops[R.startStop] ?? 4, focusUv: [0.5, 0.5], snap: true, last: 0 };

  return {
    name: 'dof',
    reads: ['hdr', 'depth'],
    writes: ['hdr'],
    enabled: () => state.on,

    /**
     * Photo mode's lens: on or off, the f-number, and the screen point focus follows (0..1).
     * snap jumps straight to it (opening photo mode) instead of easing.
     * @param {{ on?: boolean, fStop?: number, focusUv?: number[], snap?: boolean }} v
     */
    set(v) {
      if (v.on && !state.on) state.snap = true;
      if (v.on !== undefined) state.on = v.on;
      if (v.fStop !== undefined) state.fStop = v.fStop;
      if (v.focusUv) state.focusUv = [v.focusUv[0], v.focusUv[1]];
      if (v.snap) state.snap = true;
    },
    get on() { return state.on; },

    /** @param {PassContext} ctx */
    async setup(ctx) {
      const { device } = ctx;
      const module = await makeShaderModule(device, 'dof');
      const FC = GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
      layout = device.createBindGroupLayout({
        label: 'dof-input',
        entries: [
          { binding: 0, visibility: FC, buffer: {} },
          { binding: 1, visibility: FC, texture: { sampleType: 'float' } },
          { binding: 2, visibility: FC, texture: { sampleType: 'depth' } },
          { binding: 3, visibility: FC, sampler: { type: 'filtering' } },
          { binding: 4, visibility: FC, buffer: { type: 'storage' } },
        ],
      });
      sampler = device.createSampler({ label: 'dof-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      uniforms = makeBuffer(device, { label: 'dof-uniforms', size: DOF_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      focusBuffer = makeBuffer(device, { label: 'dof-focus', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(focusBuffer, 0, new Float32Array([R.startFocusM ?? 3, 0, 0, 0]));
      const pl = device.createPipelineLayout({ bindGroupLayouts: [ctx.layouts.frame, layout] });
      [pipeline, focusPipeline] = await Promise.all([
        device.createRenderPipelineAsync({
          label: 'dof-blur', layout: pl,
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'blur', targets: [{ format: 'rgba16float' }] },
          primitive: { topology: 'triangle-list' },
        }),
        device.createComputePipelineAsync({ label: 'dof-focus', layout: pl, compute: { module, entryPoint: 'focus' } }),
      ]);
    },

    /** @param {PassContext} ctx */
    resize(ctx) {
      out?.destroy();
      out = ctx.device.createTexture({
        label: 'dof-out', size: [ctx.size[0], ctx.size[1]], format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      group = ctx.device.createBindGroup({
        label: 'dof-input', layout,
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          { binding: 1, resource: ctx.targets.hdr.createView() },
          { binding: 2, resource: ctx.targets.depth.createView() },
          { binding: 3, resource: sampler },
          { binding: 4, resource: { buffer: focusBuffer } },
        ],
      });
    },

    /** @param {GPUCommandEncoder} encoder @param {PassContext} ctx */
    record(encoder, ctx) {
      if (!out || !group) return;
      const now = performance.now() / 1000;
      const dt = state.last ? Math.min(0.25, now - state.last) : 0;
      state.last = now;
      const h = ctx.size[1], k = h / 1440;
      const lens = lensOf(opts.fovYDeg, state.fStop, R.sensorHeightMm, h);
      data[0] = state.focusUv[0]; data[1] = state.focusUv[1]; data[2] = lens.focalM; data[3] = lens.apertureM;
      data[4] = lens.pxPerSensorM; data[5] = Math.max(1, R.maxRadiusPxAt1440 * k); data[6] = Math.max(0.5, R.stepPxAt1440 * k); data[7] = dt;
      data[8] = R.focusHalfLifeS; data[9] = state.snap ? 1 : 0; data[10] = 0; data[11] = 0;
      state.snap = false;
      ctx.device.queue.writeBuffer(uniforms, 0, data);

      const cp = encoder.beginComputePass({ label: 'dof-focus' });
      cp.setPipeline(focusPipeline);
      cp.setBindGroup(0, ctx.groups.frame);
      cp.setBindGroup(1, group);
      cp.dispatchWorkgroups(1);
      cp.end();

      const pass = encoder.beginRenderPass({
        label: 'dof',
        colorAttachments: [{ view: out.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        timestampWrites: ctx.timestampWrites('dof'),
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ctx.groups.frame);
      pass.setBindGroup(1, group);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToTexture({ texture: out }, { texture: ctx.targets.hdr }, [ctx.size[0], ctx.size[1]]);
    },
  };
}
