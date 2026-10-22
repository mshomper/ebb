// @ts-check
// Erosion-lite after a stroke (docs/08): thermal erosion over the stroke's rect plus a margin,
// then a readback of that rect so the quantized CPU mirror becomes the exact result.

import { makeBuffer, makeShaderModule } from '../../core/gpu.js';
import { CELL, WORLD_ORIGIN } from './grid.js';

const DEG = Math.PI / 180;
const UNIFORM_BYTES = 64;

/**
 * @param {GPUDevice} device
 * @param {import('./heightfield.js').TerrainTextures} tex
 * @param {any} recipe  recipe.erosion
 */
export async function createErosionGpu(device, tex, recipe) {
  const module = await makeShaderModule(device, 'terrain-erosion');
  const pipeline = await device.createComputePipelineAsync({ label: 'terrain-erosion', layout: 'auto', compute: { module, entryPoint: 'csErode' } });
  const uniforms = makeBuffer(device, { label: 'terrain-erosion', size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  /** @param {GPUTexture} from @param {GPUTexture} to */
  const groupFor = (from, to) => device.createBindGroup({
    label: 'terrain-erosion',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: from.createView() },
      { binding: 2, resource: to.createView() },
      { binding: 3, resource: tex.material.createView() },
    ],
  });
  // Ping-pong: odd steps read the live height and write scratch, even steps the other way.
  const groups = [groupFor(tex.height, tex.heightScratch), groupFor(tex.heightScratch, tex.height)];

  /**
   * Record the erosion iterations over a rect.
   * @param {GPUCommandEncoder} encoder
   * @param {import('./heightfield.js').CellRect} r
   * @param {GPUComputePassTimestampWrites} [timestampWrites]  for tools pages that time the pass
   * @param {import('../camp/layout.js').Pad | null} [pad]  the camp pad, whose cells erosion never moves
   */
  function encode(encoder, r, timestampWrites, pad = null) {
    if (r.w <= 0 || r.h <= 0 || recipe.iterations <= 0) return;
    const data = new ArrayBuffer(UNIFORM_BYTES);
    const u = new Uint32Array(data);
    const f = new Float32Array(data);
    u[0] = r.x; u[1] = r.y; u[2] = r.w; u[3] = r.h;
    f[4] = Math.tan(recipe.talusSoilDeg * DEG) * CELL;
    f[5] = Math.tan(recipe.talusRockDeg * DEG) * CELL;
    f[6] = recipe.rate;
    f[8] = pad ? pad.x : 0; f[9] = pad ? pad.z : 0; f[10] = pad ? pad.r : -1; f[11] = pad ? Math.max(1e-3, pad.lockFadeM) : 1;
    f[12] = WORLD_ORIGIN; f[13] = CELL;
    device.queue.writeBuffer(uniforms, 0, data);
    // The gather reads two cells past the rect, so scratch must match the live height there first.
    const n = tex.height.width;
    const x0 = Math.max(0, r.x - 2);
    const y0 = Math.max(0, r.y - 2);
    const x1 = Math.min(n, r.x + r.w + 2);
    const y1 = Math.min(n, r.y + r.h + 2);
    encoder.copyTextureToTexture({ texture: tex.height, origin: [x0, y0] }, { texture: tex.heightScratch, origin: [x0, y0] }, [x1 - x0, y1 - y0]);
    const pass = encoder.beginComputePass({ label: 'terrain-erosion', timestampWrites });
    pass.setPipeline(pipeline);
    for (let i = 0; i < recipe.iterations; i++) {
      pass.setBindGroup(0, groups[i & 1]);
      pass.dispatchWorkgroups(Math.ceil(r.w / 8), Math.ceil(r.h / 8));
    }
    pass.end();
    if (recipe.iterations & 1) {
      encoder.copyTextureToTexture({ texture: tex.heightScratch, origin: [r.x, r.y] }, { texture: tex.height, origin: [r.x, r.y] }, [r.w, r.h]);
    }
  }

  return { encode };
}

/**
 * Record copies of a rect of height and material into mappable buffers.
 * Call `read()` after the encoder has been submitted.
 * @param {GPUDevice} device
 * @param {GPUCommandEncoder} encoder
 * @param {import('./heightfield.js').TerrainTextures} tex
 * @param {import('./heightfield.js').CellRect} r
 */
export function encodeReadback(device, encoder, tex, r) {
  const pitch = Math.ceil((r.w * 4) / 256) * 256;
  const size = pitch * r.h;
  const usage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
  const hBuf = device.createBuffer({ label: 'terrain-readback-height', size, usage });
  const mBuf = device.createBuffer({ label: 'terrain-readback-material', size, usage });
  encoder.copyTextureToBuffer({ texture: tex.height, origin: [r.x, r.y] }, { buffer: hBuf, bytesPerRow: pitch, rowsPerImage: r.h }, [r.w, r.h]);
  encoder.copyTextureToBuffer({ texture: tex.material, origin: [r.x, r.y] }, { buffer: mBuf, bytesPerRow: pitch, rowsPerImage: r.h }, [r.w, r.h]);

  /** @returns {Promise<{ heights: Float32Array, materials: Uint8Array, pitch: number }>} */
  async function read() {
    await Promise.all([hBuf.mapAsync(GPUMapMode.READ), mBuf.mapAsync(GPUMapMode.READ)]);
    const heights = new Float32Array(hBuf.getMappedRange().slice(0));
    const materials = new Uint8Array(mBuf.getMappedRange().slice(0));
    hBuf.destroy();
    mBuf.destroy();
    return { heights, materials, pitch };
  }
  return { read };
}
