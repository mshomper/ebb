// @ts-check
// Brushes (docs/08): turn a stroke's cursor path into evenly spaced stamps, apply each on the
// GPU over its bounding rect, and nudge the CPU mirror the same way so the cursor keeps
// hugging the ground. Raise and lower share one mode with a signed amount.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { CELL, WORLD_CELLS as N, WORLD_ORIGIN } from './grid.js';
import { toCell } from './heightfield.js';
import { cliffMask, cliffHeight } from './cliff.js';
import { padMask } from '../camp/layout.js';

const STAMP_STRIDE = 256;
const STAMP_BYTES = 96;

/**
 * Where a brush may reach: the open land (faded over edgeFade meters before unopened land) and,
 * when there is one, the keeper's camp pad, which no brush moves (docs/future/13 CP-01).
 * @typedef {{ openMin: number[], openMax: number[], edgeFade: number, pad?: import('../camp/layout.js').Pad | null }} Edge
 */

/**
 * Pack the camp lock into a stamp uniform at float index o: center x, z, radius, fade. With no pad
 * the radius is -1 and the shader's campFade is 1 everywhere. @param {Float32Array} f @param {number} o @param {Edge} edge
 */
function packCamp(f, o, edge) {
  const p = edge.pad;
  f[o] = p ? p.x : 0; f[o + 1] = p ? p.z : 0; f[o + 2] = p ? p.r : -1; f[o + 3] = p ? Math.max(1e-3, p.lockFadeM) : 1;
}

/** @typedef {'raise'|'lower'|'flatten'|'smooth'|'paint'|'terrace'|'cut'} BrushKind */
/** @typedef {'grass'|'sand'|'rock'|'soil'} PaintLayer */

/**
 * @typedef {Object} Brush
 * @property {BrushKind} kind
 * @property {number} radius     meters
 * @property {number} strength   0..1 (slider value; the recipe curve shapes it)
 * @property {PaintLayer} [layer]
 * @property {number} [height]   Terrace and Cut: the Height slider (m)
 * @property {boolean} [sea]     Terrace and Cut: level at mean sea level (Shift)
 */

/**
 * @typedef {Object} Stamp
 * @property {number} x @property {number} z   world center
 * @property {number} radius @property {number} hardness
 * @property {number} amount @property {number} target
 * @property {number} mode @property {number} layer
 * @property {number} span   smooth tap spacing in cells
 * @property {import('./heightfield.js').CellRect} rect
 */

export const LAYER_INDEX = { grass: 0, sand: 1, rock: 2, soil: 3 };
// Mode 4 is the Cliff shelf (Terrace and Cut, by the sign of amount); 5 paints its faces rock.
const MODE = { raise: 0, lower: 0, smooth: 1, flatten: 2, paint: 3, terrace: 4, cut: 4 };
export const CLIFF_MODE = 4;
export const CLIFF_ROCK_MODE = 5;

/**
 * Cell rect covered by a circle, clamped to a bounding cell rect.
 * @param {number} x @param {number} z @param {number} r
 * @param {import('./heightfield.js').CellRect} clampTo
 */
export function circleRect(x, z, r, clampTo) {
  const x0 = Math.max(clampTo.x, Math.floor(toCell(x - r)));
  const z0 = Math.max(clampTo.y, Math.floor(toCell(z - r)));
  const x1 = Math.min(clampTo.x + clampTo.w, Math.ceil(toCell(x + r)) + 1);
  const z1 = Math.min(clampTo.y + clampTo.h, Math.ceil(toCell(z + r)) + 1);
  return { x: x0, y: z0, w: Math.max(0, x1 - x0), h: Math.max(0, z1 - z0) };
}

/**
 * Per-frame amount for a brush (before splitting across the frame's stamps).
 * Raise and lower are capped so one frame cannot make a neighbor step over stepCap.
 * @param {Brush} brush @param {number} pressure @param {number} dt @param {any} rb recipe.brush
 */
export function frameAmount(brush, pressure, dt, rb) {
  // The Cliff shelf sets the ground to its level, so its amount is not a rate: its sign is the side
  // (up or down) and its size how far the rim falls, the stroke's Height (cliff.js cliffHeight).
  if (brush.kind === 'terrace') return brush.height ?? 1;
  if (brush.kind === 'cut') return -(brush.height ?? 1);
  const s = Math.pow(Math.max(0, Math.min(1, brush.strength)), rb.strengthCurve) * pressure;
  if (brush.kind === 'raise' || brush.kind === 'lower') {
    // Steepest slope of the falloff is 1.5 / ((1 - hardness) r) per meter.
    const cap = (rb.stepCap * (1 - rb.hardness) * brush.radius) / (1.5 * CELL);
    const a = Math.min(rb.raiseMetersPerSecond * s * dt, cap);
    return brush.kind === 'raise' ? a : -a;
  }
  const rate = brush.kind === 'smooth' ? rb.smoothRatePerSecond : brush.kind === 'flatten' ? rb.flattenRatePerSecond : rb.paintRatePerSecond;
  return rate * s * dt;
}

/**
 * The CPU twin of csHeight for raise, lower and flatten (approximate: smoothing and paint skip it).
 * The camp pad's mask multiplies the falloff as the open-land edge fade does.
 * @param {Float32Array} hf @param {Stamp} st @param {Edge} edge
 */
export function applyStampCpu(hf, st, edge) {
  if (st.mode === CLIFF_MODE) { applyCliffCpu(hf, st, edge); return; }
  if (st.mode !== 0 && st.mode !== 2) return;
  const r = st.rect;
  const inner = st.hardness * st.radius;
  for (let j = r.y; j < r.y + r.h; j++) {
    const z = WORLD_ORIGIN + (j + 0.5) * CELL;
    for (let i = r.x; i < r.x + r.w; i++) {
      const x = WORLD_ORIGIN + (i + 0.5) * CELL;
      const d = Math.hypot(x - st.x, z - st.z);
      if (d >= st.radius) continue;
      const u = Math.min(1, Math.max(0, (d - inner) / (st.radius - inner)));
      const inside = Math.min(x - edge.openMin[0], edge.openMax[0] - x, z - edge.openMin[1], edge.openMax[1] - z);
      const f = (1 - u * u * (3 - 2 * u)) * Math.min(1, Math.max(0, inside / edge.edgeFade)) * padMask(edge.pad ?? null, x, z);
      const k = j * N + i;
      if (st.mode === 0) hf[k] = Math.min(12, Math.max(-4, hf[k] + st.amount * f));
      else hf[k] += (st.target - hf[k]) * (1 - Math.pow(2, -st.amount * f));
    }
  }
}

/**
 * The CPU twin of the Cliff shelf (exact: the stamp sets heights, it does not integrate them).
 * For mode 4 the stamp's `hardness` holds the rim's width in meters and `span` how far the shelf
 * falls across the fade before unopened land (m). The camp pad keeps its ground: the change fades
 * from nothing on the pad to all of it lockFadeM outside.
 * @param {Float32Array} hf @param {Stamp} st @param {Edge} edge
 */
function applyCliffCpu(hf, st, edge) {
  const r = st.rect;
  for (let j = r.y; j < r.y + r.h; j++) {
    const z = WORLD_ORIGIN + (j + 0.5) * CELL;
    for (let i = r.x; i < r.x + r.w; i++) {
      const x = WORLD_ORIGIN + (i + 0.5) * CELL;
      const d = Math.hypot(x - st.x, z - st.z);
      if (d >= st.radius) continue;
      const inside = Math.min(x - edge.openMin[0], edge.openMax[0] - x, z - edge.openMin[1], edge.openMax[1] - z);
      const fade = Math.min(1, Math.max(0, inside / edge.edgeFade));
      const k = j * N + i;
      const goal = cliffHeight(hf[k], st.target, cliffMask(d, st.radius, st.hardness), st.amount, fade, st.span);
      hf[k] = Math.min(12, Math.max(-4, hf[k] + (goal - hf[k]) * padMask(edge.pad ?? null, x, z)));
    }
  }
}

/**
 * GPU side of the brushes: pipelines, the stamp uniform ring and pass encoding.
 * @param {GPUDevice} device
 * @param {import('./heightfield.js').TerrainTextures} tex
 * @param {number} maxStamps
 */
export async function createBrushGpu(device, tex, maxStamps) {
  const module = await makeShaderModule(device, 'terrain-brush');
  const layout = device.createBindGroupLayout({
    label: 'terrain-brush',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { hasDynamicOffset: true, minBindingSize: STAMP_BYTES } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
    ],
  });
  const pipeLayout = device.createPipelineLayout({ label: 'terrain-brush', bindGroupLayouts: [layout] });
  const [heightPipe, paintPipe, rockPipe] = await Promise.all([
    device.createComputePipelineAsync({ label: 'terrain-brush-height', layout: pipeLayout, compute: { module, entryPoint: 'csHeight' } }),
    device.createComputePipelineAsync({ label: 'terrain-brush-paint', layout: pipeLayout, compute: { module, entryPoint: 'csPaint' } }),
    device.createComputePipelineAsync({ label: 'terrain-cliff-rock', layout: pipeLayout, compute: { module, entryPoint: 'csCliffRock' } }),
  ]);
  const uniforms = makeBuffer(device, {
    label: 'terrain-stamps', size: STAMP_STRIDE * maxStamps, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const group = device.createBindGroup({
    label: 'terrain-brush',
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniforms, size: STAMP_BYTES } },
      { binding: 1, resource: tex.height.createView() },
      { binding: 2, resource: tex.heightScratch.createView() },
      { binding: 3, resource: tex.material.createView() },
      { binding: 4, resource: tex.materialScratch.createView() },
      { binding: 5, resource: tex.guard.createView() },
    ],
  });
  const data = new ArrayBuffer(STAMP_STRIDE * maxStamps);
  const f32 = new Float32Array(data);
  const u32 = new Uint32Array(data);
  // The rock pass has its own uniform, since queued writes all land before the frame's commands run.
  const rockUniform = makeBuffer(device, { label: 'terrain-cliff-rock', size: STAMP_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const rockGroup = device.createBindGroup({
    label: 'terrain-cliff-rock',
    layout,
    entries: [
      { binding: 0, resource: { buffer: rockUniform, size: STAMP_BYTES } },
      { binding: 1, resource: tex.height.createView() },
      { binding: 2, resource: tex.heightScratch.createView() },
      { binding: 3, resource: tex.material.createView() },
      { binding: 4, resource: tex.materialScratch.createView() },
      { binding: 5, resource: tex.guard.createView() },
    ],
  });

  /**
   * After a Cliff stroke, before erosion: paint every cell on a sheer face rock (docs/08), so it
   * draws as stone and erosion holds it at the rock talus. `share` is how far toward rock it goes.
   * @param {GPUCommandEncoder} encoder @param {import('./heightfield.js').CellRect} rect
   * @param {{ faceDeg: number, rockShare: number }} rc recipe.cliff
   * @param {Edge} [edge]  its pad keeps the camp ground unpainted
   */
  function encodeCliffRock(encoder, rect, rc, edge) {
    if (rect.w <= 0 || rect.h <= 0) return;
    const b = new ArrayBuffer(STAMP_BYTES);
    const f = new Float32Array(b);
    const u = new Uint32Array(b);
    f[4] = Math.tan((rc.faceDeg * Math.PI) / 180) * CELL; f[5] = rc.rockShare; u[6] = CLIFF_ROCK_MODE;
    u[8] = rect.x; u[9] = rect.y; u[10] = rect.w; u[11] = rect.h;
    f[17] = WORLD_ORIGIN; f[18] = CELL;
    packCamp(f, 20, edge ?? { openMin: [0, 0], openMax: [0, 0], edgeFade: 1, pad: null });
    device.queue.writeBuffer(rockUniform, 0, b);
    const pass = encoder.beginComputePass({ label: 'terrain-cliff-rock' });
    pass.setPipeline(rockPipe);
    pass.setBindGroup(0, rockGroup, [0]);
    pass.dispatchWorkgroups(Math.ceil(rect.w / 8), Math.ceil(rect.h / 8));
    pass.end();
    encoder.copyTextureToTexture({ texture: tex.materialScratch, origin: [rect.x, rect.y] }, { texture: tex.material, origin: [rect.x, rect.y] }, [rect.w, rect.h]);
  }

  /**
   * Record stamps in order; each reads the result of the one before.
   * @param {GPUCommandEncoder} encoder
   * @param {Stamp[]} stamps
   * @param {Edge} edge
   */
  function encode(encoder, stamps, edge) {
    const list = stamps.slice(0, maxStamps).filter((s) => s.rect.w > 0 && s.rect.h > 0);
    if (list.length === 0) return;
    list.forEach((st, i) => {
      const o = (i * STAMP_STRIDE) / 4;
      f32[o] = st.x; f32[o + 1] = st.z; f32[o + 2] = st.radius; f32[o + 3] = st.hardness;
      f32[o + 4] = st.amount; f32[o + 5] = st.target; u32[o + 6] = st.mode; u32[o + 7] = st.layer;
      u32[o + 8] = st.rect.x; u32[o + 9] = st.rect.y; u32[o + 10] = st.rect.w; u32[o + 11] = st.rect.h;
      f32[o + 12] = edge.openMin[0]; f32[o + 13] = edge.openMin[1]; f32[o + 14] = edge.openMax[0]; f32[o + 15] = edge.openMax[1];
      f32[o + 16] = edge.edgeFade; f32[o + 17] = WORLD_ORIGIN; f32[o + 18] = CELL; f32[o + 19] = st.span;
      packCamp(f32, o + 20, edge);
    });
    device.queue.writeBuffer(uniforms, 0, data, 0, list.length * STAMP_STRIDE);
    list.forEach((st, i) => {
      const paint = st.mode === 3;
      const pass = encoder.beginComputePass({ label: 'terrain-stamp' });
      pass.setPipeline(paint ? paintPipe : heightPipe);
      pass.setBindGroup(0, group, [i * STAMP_STRIDE]);
      pass.dispatchWorkgroups(Math.ceil(st.rect.w / 8), Math.ceil(st.rect.h / 8));
      pass.end();
      const origin = [st.rect.x, st.rect.y];
      const size = [st.rect.w, st.rect.h];
      if (paint) encoder.copyTextureToTexture({ texture: tex.materialScratch, origin }, { texture: tex.material, origin }, size);
      else encoder.copyTextureToTexture({ texture: tex.heightScratch, origin }, { texture: tex.height, origin }, size);
    });
  }

  return { encode, encodeCliffRock, modeOf:(/** @type {BrushKind} */ k) => MODE[k] };
}
