// @ts-check
// Waterfall tests for tools/unit-tests.html (M2 Cliff tool): the real lip finder (csDetect in
// water-falls.wgsl) run on the GPU over a made-up terrace, water on its shelf. Lips are found all
// along the edge only when the water flows toward it, never over a small step, the edge lands where
// the ground falls away, and the end lips know they have no neighbor. Both waterfall shaders compile.

import { loadShader } from '../src/core/gpu.js';

const FALLS = 'waterfalls';
const NO_GPU = 'skipped: WebGPU is not available in this browser';
const T = 768, W = 384, ORIGIN = -80;

/** @type {Promise<GPUDevice | null> | null} */
let devicePromise = null;
function device() {
  devicePromise ??= (async () => {
    if (!('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? adapter.requestDevice() : null;
  })();
  return devicePromise;
}

/** @param {number} x world x or z @param {number} cell */
const index = (x, cell) => Math.floor((x - ORIGIN) / cell);

/**
 * Run csDetect once over a terrace whose shelf (x < 0) stands `shelf` m above ground at 1 m, with
 * `depth` m of water on the shelf flowing at `vx` m/s.
 * @param {GPUDevice} dev @param {{ shelf: number, depth: number, vx: number }} s
 */
async function detect(dev, s) {
  const recipe = (await (await fetch('../recipes/world/water.json')).json()).falls;
  const code = await loadShader('water-falls');
  const module = dev.createShaderModule({ code });
  const pipe = await dev.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'csDetect' } });
  const height = new Float32Array(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) height[j * T + i] = ORIGIN + (i + 0.5) * 0.25 < 0 ? 1 + s.shelf : 1;
  const depth = new Float32Array(W * W);
  const vel = new Float32Array(W * W * 2);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    if (ORIGIN + (i + 0.5) * 0.5 < 0) { depth[j * W + i] = s.depth; vel[(j * W + i) * 2] = s.vx; }
  }
  /** @param {GPUTextureFormat} format @param {number} n @param {Float32Array} data @param {number} bpp */
  const tex = (format, n, data, bpp) => {
    const t = dev.createTexture({ size: [n, n], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    dev.queue.writeTexture({ texture: t }, data, { bytesPerRow: n * bpp }, [n, n]);
    return t;
  };
  const hT = tex('r32float', T, height, 4), dT = tex('r32float', W, depth, 4), vT = tex('rg32float', W, vel, 8);
  const rect = { x: index(-4, 0.5), y: index(-2, 0.5), w: 16, h: 8 };
  const ub = new ArrayBuffer(112), f = new Float32Array(ub), u = new Uint32Array(ub);
  u[0] = rect.x; u[1] = rect.y; u[2] = rect.w; u[3] = rect.h;
  f[4] = recipe.minDropM; f[5] = recipe.minDepthM; f[6] = recipe.minSpeedMs; u[7] = 256;
  f[21] = recipe.lipStepM; f[22] = recipe.lipReachM;
  const uniform = dev.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(uniform, 0, ub);
  const lips = dev.createBuffer({ size: 256 * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const counter = dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const group = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: hT.createView() },
    { binding: 2, resource: dT.createView() }, { binding: 3, resource: vT.createView() },
    { binding: 4, resource: { buffer: lips } }, { binding: 5, resource: { buffer: counter } },
  ] });
  const readLips = dev.createBuffer({ size: 256 * 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const readCount = dev.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipe);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(rect.w / 8), Math.ceil(rect.h / 8));
  pass.end();
  enc.copyBufferToBuffer(lips, 0, readLips, 0, 256 * 48);
  enc.copyBufferToBuffer(counter, 0, readCount, 0, 16);
  dev.queue.submit([enc.finish()]);
  await Promise.all([readLips.mapAsync(GPUMapMode.READ), readCount.mapAsync(GPUMapMode.READ)]);
  const n = new Uint32Array(readCount.getMappedRange())[0];
  const all = new Float32Array(readLips.getMappedRange().slice(0));
  const out = [];
  for (let k = 0; k < Math.min(n, 256); k++) {
    const o = k * 12;
    out.push({ x: all[o], top: all[o + 1], z: all[o + 2], foot: all[o + 3], dx: all[o + 4], dz: all[o + 5], speed: all[o + 6], q: all[o + 7], left: all[o + 8], right: all[o + 9] });
  }
  for (const b of [hT, dT, vT]) b.destroy();
  for (const b of [uniform, lips, counter, readLips, readCount]) b.destroy();
  return out;
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addFallsTests(test, assert, eq) {
  test(FALLS, 'both waterfall shaders compile', async () => {
    const dev = await device();
    if (!dev) return NO_GPU;
    for (const name of ['water-falls', 'water-falls-draw']) {
      const m = dev.createShaderModule({ code: await loadShader(name) });
      const errors = (await m.getCompilationInfo()).messages.filter((x) => x.type === 'error');
      eq(errors.length, 0, `${name}: ${errors.map((x) => x.message).join('; ')}`);
    }
  });

  test(FALLS, 'water flowing over a 1.5 m terrace edge makes a lip in every cell along it', async () => {
    const dev = await device();
    if (!dev) return NO_GPU;
    const lips = await detect(dev, { shelf: 1.5, depth: 0.02, vx: 0.3 });
    eq(lips.length, 6, 'lips along the 6 interior cells of the edge');
    for (const l of lips) {
      eq(l.dx, 1, 'falls toward +x');
      assert(Math.abs(l.x) < 0.15, `the edge is at ${l.x.toFixed(3)} m, not at the step (0 m)`);
      assert(Math.abs(l.top - 2.52) < 0.01, `top ${l.top.toFixed(3)} m, not the shelf water at 2.52`);
      assert(Math.abs(l.foot - 1) < 0.01, `foot ${l.foot.toFixed(3)} m, not the ground at 1`);
      assert(Math.abs(l.q - 0.006) < 1e-4, `flow ${l.q} m2/s, not depth x speed (0.006)`);
    }
    const inner = lips.filter((l) => l.left && l.right).length;
    eq(inner, 4, 'lips with a neighbor on both ends (the two end lips have one)');
    return `edge at ${lips[0].x.toFixed(3)} m`;
  });

  test(FALLS, 'no lips when the water flows away from the edge, or over a small step', async () => {
    const dev = await device();
    if (!dev) return NO_GPU;
    eq((await detect(dev, { shelf: 1.5, depth: 0.02, vx: -0.3 })).length, 0, 'lips with the water flowing back from the edge');
    eq((await detect(dev, { shelf: 0.3, depth: 0.02, vx: 0.3 })).length, 0, 'lips over a 0.3 m step');
    eq((await detect(dev, { shelf: 1.5, depth: 0.0005, vx: 0.3 })).length, 0, 'lips from a film too thin to fall');
  });
}
