// @ts-check
// Physical sky resources (docs/06): Hillaire 2020 LUTs, aerial perspective froxels and sky SH9.
//
// LUT and unit conventions (mirrored in src/shaders/lib-atmosphere.wgsl):
//   transmittance  256x64 rgba16float, unitless. Bruneton (h, mu) mapping over rays that miss the ground.
//                  Rebuilt with multi-scatter when the atmosphere changes noticeably, at most once a second.
//   multiScatter   32x32 rgba16float, per unit illuminance (nits per lux): multiply by the light's lux.
//   skyView        192x108 (96x54 on low) rgba16float, clear-sky radiance in nits * SKY_LUT_SCALE (1/32),
//                  sun + moon + airglow together. u = world azimuth atan2(z, x) (repeat), v = Hillaire's
//                  horizon-packed latitude. The 1/32 scale keeps the bright aureole under fp16 max and the
//                  moonless floor (about 1e-4 nits) above fp16's subnormal steps.
//   aerial         N^3 3D rgba16float (32, or 16 on low) over the current frustum: xy = screen uv (0,0
//                  top-left), slice k = integral from the camera to maxDist * ((k + 0.5) / N)^2 meters.
//                  rgb = in-scatter nits * SKY_LUT_SCALE, a = mean transmittance.
//   sh             GPUBuffer, 9 x vec4f: sky + ground irradiance SH9 pre-convolved with the cosine lobe and
//                  divided by pi, so lib-sky skyAmbient(n) is nits for albedo 1 (not pre-exposed).
//   state          GPUBuffer, SkyState (64 bytes): overcast dome, sky irradiance, ground radiance, sun at ground.
//   probe          cube (2d, 6 layers +X -X +Y -Y +Z -Z) rgba16float, 64² (32² on medium and low), full mip
//                  chain, nits * SKY_LUT_SCALE. Sky-view LUT plus overcast dome plus ground hemisphere, no
//                  sun, moon or stars; mip m is GGX-prefiltered for perceptual roughness m / (mips - 1).
//                  Rebuilt every frame after sh-project. Sampling rules: src/shaders/lib-probe.wgsl.
// Nothing here is pre-exposed; the sky draw and applyAerial multiply by frame.exposure.

import { makeShaderModule, makeBuffer, makeTexture, untrack } from '../../core/gpu.js';
import { emit } from '../../core/events.js';
import { DAYS_PER_SEASON, SEASONS_PER_YEAR } from '../../core/clock.js';
import { aerosolScaleFor, atmosphereCoefficients } from './atmosphere-cpu.js';

const DEG = Math.PI / 180;
const PARAM_BYTES = 112;
const SKY_UNIFORM_BYTES = 288;
const SH_BYTES = 9 * 16;
const STATE_BYTES = 64;
const REBUILD_MS = 1000;
/** One ProbeParams (16 bytes) per probe mip, each at a uniform-offset-aligned slot. */
const PROBE_PARAM_STRIDE = 256;
/** Radiance landing on mid-gray at the EV100 -1 night floor (docs/05): 0.18 * 1.2 * 2^-1 nits. */
const NIGHT_FLOOR_MID_NITS = 0.108;

const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @typedef {Object} AtmosphereFrame
 * @property {ArrayLike<number>} sunDir            unit vector toward the sun
 * @property {ArrayLike<number>} moonDir           unit vector toward the moon
 * @property {ArrayLike<number>} [sunIlluminanceTOA]  lux rgb at the top of the atmosphere (default recipe)
 * @property {ArrayLike<number>} moonIlluminanceTOA   lux rgb at the top of the atmosphere, phase included
 * @property {ArrayLike<number>} cameraPos         meters, y above sea level
 * @property {Float32Array} invViewProj
 * @property {Float32Array} [view]                 unused, accepted for symmetry with FrameUniforms
 * @property {{ querySet: GPUQuerySet, beginIndex: number, endIndex: number }} [timestamps]  whole sky compute work
 * @property {{ querySet: GPUQuerySet, base: number }} [stageTimestamps]  debug: one pass per stage, 2 queries each
 *   in run order (transmittance, multiscatter when rebuilding, then sky-view, sh-project, sky-probe with all
 *   its mips in one pass, aerial)
 */

/** @param {any} tier 'high'|'medium'|'low' or a quality-tiers.json tier object */
function tierSettings(tier) {
  if (tier && typeof tier === 'object') {
    return { skyViewScale: tier.skyViewLut === 'half' ? 0.5 : 1, aerialSlices: tier.aerialVolume ?? 32, probeSize: tier.skyProbeSize ?? 64 };
  }
  if (tier === 'low') return { skyViewScale: 0.5, aerialSlices: 16, probeSize: 32 };
  return { skyViewScale: 1, aerialSlices: 32, probeSize: tier === 'medium' ? 32 : 64 };
}

/**
 * @param {GPUDevice} device
 * @param {any} recipe   parsed recipes/world/sky.json
 * @param {any} tier     'high'|'medium'|'low' (or a tier object from quality-tiers.json)
 */
export async function createAtmosphere(device, recipe, tier) {
  const ts = tierSettings(tier);
  const svW = Math.round(192 * ts.skyViewScale);
  const svH = Math.round(108 * ts.skyViewScale);
  const slices = ts.aerialSlices;
  const storageTex = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;

  const transmittance = makeTexture(device, { label: 'sky-transmittance', size: [256, 64], format: 'rgba16float', usage: storageTex });
  const multiScatter = makeTexture(device, { label: 'sky-multiscatter', size: [32, 32], format: 'rgba16float', usage: storageTex });
  const skyView = makeTexture(device, { label: 'sky-view', size: [svW, svH], format: 'rgba16float', usage: storageTex });
  const aerial = makeTexture(device, {
    label: 'sky-aerial', size: [slices, slices, slices], dimension: '3d', format: 'rgba16float', usage: storageTex,
  });
  const paramBuf = makeBuffer(device, { label: 'sky-atmosphere-params', size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const skyBuf = makeBuffer(device, { label: 'sky-uniforms', size: SKY_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sh = makeBuffer(device, { label: 'sky-sh9', size: SH_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const state = makeBuffer(device, { label: 'sky-state', size: STATE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  // Sky probe: full mip chain down to 1 px, one params slot per mip.
  const probeSize = ts.probeSize;
  const probeMips = Math.floor(Math.log2(probeSize)) + 1;
  const probe = makeTexture(device, {
    label: 'sky-probe', size: [probeSize, probeSize, 6], dimension: '2d', mipLevelCount: probeMips, format: 'rgba16float', usage: storageTex,
  });
  const probeParamBuf = makeBuffer(device, { label: 'sky-probe-params', size: probeMips * PROBE_PARAM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const lutSampler = device.createSampler({ label: 'sky-lut', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const skySampler = device.createSampler({ label: 'sky-view', magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
  const probeSampler = device.createSampler({
    label: 'sky-probe', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge',
  });

  const C = GPUShaderStage.COMPUTE;
  const uni = (/** @type {number} */ binding) => ({ binding, visibility: C, buffer: { type: /** @type {const} */ ('uniform') } });
  const tex = (/** @type {number} */ binding) => ({ binding, visibility: C, texture: { sampleType: /** @type {const} */ ('float') } });
  const smp = (/** @type {number} */ binding) => ({ binding, visibility: C, sampler: { type: /** @type {const} */ ('filtering') } });
  const out2d = (/** @type {number} */ binding) => ({ binding, visibility: C, storageTexture: { access: /** @type {const} */ ('write-only'), format: /** @type {const} */ ('rgba16float') } });
  const probeOut = { binding: 4, visibility: C, storageTexture: { access: /** @type {const} */ ('write-only'), format: /** @type {const} */ ('rgba16float'), viewDimension: /** @type {const} */ ('2d-array') } };

  const layouts = {
    trans: device.createBindGroupLayout({ label: 'sky-transmittance', entries: [uni(0), out2d(1)] }),
    ms: device.createBindGroupLayout({ label: 'sky-multiscatter', entries: [uni(0), tex(1), smp(2), out2d(3)] }),
    view: device.createBindGroupLayout({ label: 'sky-view', entries: [uni(0), uni(1), tex(2), tex(3), smp(4), out2d(5)] }),
    sh: device.createBindGroupLayout({
      label: 'sky-sh', entries: [uni(0), uni(1), tex(2), tex(3), smp(4), smp(5),
        { binding: 6, visibility: C, buffer: { type: 'storage' } }, { binding: 7, visibility: C, buffer: { type: 'storage' } }],
    }),
    aerial: device.createBindGroupLayout({
      label: 'sky-aerial', entries: [uni(0), uni(1), tex(2), tex(3), smp(4),
        { binding: 5, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } }],
    }),
    // sky-probe.wgsl: probeBase reads bindings 0-5, probePrefilter reads 4-7.
    probeBase: device.createBindGroupLayout({
      label: 'sky-probe-base', entries: [uni(0), tex(1), smp(2), { binding: 3, visibility: C, buffer: { type: 'read-only-storage' } }, probeOut, uni(5)],
    }),
    probeMip: device.createBindGroupLayout({
      label: 'sky-probe-mip', entries: [probeOut, uni(5),
        { binding: 6, visibility: C, texture: { sampleType: 'float', viewDimension: 'cube' } }, smp(7)],
    }),
  };

  /**
   * @param {string} name @param {GPUBindGroupLayout} layout
   * @param {string} [entryPoint] @param {Promise<GPUShaderModule>} [modulePromise]  share one module between entry points
   */
  async function pipeline(name, layout, entryPoint = 'main', modulePromise) {
    const module = await (modulePromise ?? makeShaderModule(device, name));
    return device.createComputePipelineAsync({
      label: entryPoint === 'main' ? name : `${name}-${entryPoint}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint },
    });
  }
  const probeModule = makeShaderModule(device, 'sky-probe');
  const [pTrans, pMs, pView, pSh, pAerial, pProbeBase, pProbeMip] = await Promise.all([
    pipeline('sky-transmittance', layouts.trans), pipeline('sky-multiscatter', layouts.ms),
    pipeline('sky-view', layouts.view), pipeline('sh-project', layouts.sh), pipeline('sky-aerial', layouts.aerial),
    pipeline('sky-probe', layouts.probeBase, 'probeBase', probeModule), pipeline('sky-probe', layouts.probeMip, 'probePrefilter', probeModule),
  ]);

  const tv = transmittance.createView();
  const mv = multiScatter.createView();
  const sv = skyView.createView();
  const groups = {
    trans: device.createBindGroup({ label: 'sky-transmittance', layout: layouts.trans, entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: tv }] }),
    ms: device.createBindGroup({ label: 'sky-multiscatter', layout: layouts.ms, entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: tv }, { binding: 2, resource: lutSampler },
      { binding: 3, resource: mv }] }),
    view: device.createBindGroup({ label: 'sky-view', layout: layouts.view, entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: { buffer: skyBuf } },
      { binding: 2, resource: tv }, { binding: 3, resource: mv }, { binding: 4, resource: lutSampler }, { binding: 5, resource: sv }] }),
    sh: device.createBindGroup({ label: 'sky-sh', layout: layouts.sh, entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: { buffer: skyBuf } },
      { binding: 2, resource: tv }, { binding: 3, resource: sv }, { binding: 4, resource: lutSampler },
      { binding: 5, resource: skySampler }, { binding: 6, resource: { buffer: sh } }, { binding: 7, resource: { buffer: state } }] }),
    aerial: device.createBindGroup({ label: 'sky-aerial', layout: layouts.aerial, entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: { buffer: skyBuf } },
      { binding: 2, resource: tv }, { binding: 3, resource: mv }, { binding: 4, resource: lutSampler },
      { binding: 5, resource: { buffer: state } }, { binding: 6, resource: aerial.createView({ dimension: '3d' }) }] }),
  };

  // Probe: mip 0 from the sky, then mip m from a cube view of mip m - 1 alone, one bind group each.
  const probeView = probe.createView({ label: 'sky-probe-cube', dimension: 'cube' });
  const probeStore = (/** @type {number} */ m) => probe.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 });
  const probeSlot = (/** @type {number} */ m) => ({ buffer: probeParamBuf, offset: m * PROBE_PARAM_STRIDE, size: 16 });
  const probeFace = (/** @type {number} */ m) => Math.max(1, probeSize >> m);
  /** @type {[GPUComputePipeline, GPUBindGroup, number, number, number][]} */
  const probeSteps = [[pProbeBase, device.createBindGroup({ label: 'sky-probe-base', layout: layouts.probeBase, entries: [
    { binding: 0, resource: { buffer: skyBuf } }, { binding: 1, resource: sv }, { binding: 2, resource: skySampler },
    { binding: 3, resource: { buffer: state } }, { binding: 4, resource: probeStore(0) }, { binding: 5, resource: probeSlot(0) }] }),
  Math.ceil(probeSize / 8), Math.ceil(probeSize / 8), 6]];
  for (let m = 1; m < probeMips; m++) {
    const g = device.createBindGroup({ label: `sky-probe-mip${m}`, layout: layouts.probeMip, entries: [
      { binding: 4, resource: probeStore(m) }, { binding: 5, resource: probeSlot(m) },
      { binding: 6, resource: probe.createView({ dimension: 'cube', baseMipLevel: m - 1, mipLevelCount: 1 }) },
      { binding: 7, resource: probeSampler }] });
    probeSteps.push([pProbeMip, g, Math.ceil(probeFace(m) / 8), Math.ceil(probeFace(m) / 8), 6]);
  }

  // Per-mip ProbeParams (alpha, samples, faceSize, horizonSin), rewritten only when the recipe changes.
  const probeBytes = new ArrayBuffer(probeMips * PROBE_PARAM_STRIDE);
  const probeF32 = new Float32Array(probeBytes);
  const probeU32 = new Uint32Array(probeBytes);
  let probeKey = '';
  function writeProbeParams() {
    const pr = recipe.probe ?? {};
    const samples = Math.max(1, Math.round(pr.prefilterSamples ?? 32));
    const blendDeg = Math.max(0.1, pr.horizonBlendDeg ?? 3);
    const key = `${samples}|${blendDeg}`;
    if (key === probeKey) return;
    probeKey = key;
    // Perceptual roughness r = m / (mips - 1), GGX alpha = r^2; mip m adds the alpha^2 that mip m - 1 lacks.
    const alpha = (/** @type {number} */ k) => (k / Math.max(1, probeMips - 1)) ** 2;
    for (let m = 0; m < probeMips; m++) {
      const o = (m * PROBE_PARAM_STRIDE) / 4;
      probeF32[o] = m === 0 ? 0 : Math.sqrt(Math.max(alpha(m) ** 2 - alpha(m - 1) ** 2, 0));
      probeU32[o + 1] = samples;
      probeU32[o + 2] = probeFace(m);
      probeF32[o + 3] = Math.sin(blendDeg * DEG);
    }
    device.queue.writeBuffer(probeParamBuf, 0, probeBytes);
  }

  // Lets tools/sky-lab.html draw the probe faces on the same device (debug only; nothing in the game listens).
  emit('sky:probe-ready', {
    device, probe, probeView, probeSampler, probeMips, probeSize, skyView, skySampler, uniforms: skyBuf, state,
  });

  // ---- Weather and rebuild throttling ----
  const weather = { cloud: 0, mist: 0, rain: 0, frost: 0 };
  let builtScale = NaN;
  let lastBuild = -Infinity;

  /**
   * Weather-driven inputs, 0..1 each. Mist and rain thicken the ground aerosol (LUT rebuild, throttled);
   * cloud blends the sky toward the overcast dome every frame; frost brightens the probe's ground.
   * @param {{ cloud?: number, mist?: number, rain?: number, frost?: number }} params
   */
  function setAtmosphere(params) {
    for (const k of /** @type {const} */ (['cloud', 'mist', 'rain', 'frost'])) {
      const v = params[k];
      if (typeof v === 'number') weather[k] = Math.min(1, Math.max(0, v));
    }
  }

  const pf = new Float32Array(PARAM_BYTES / 4);
  /** @param {number} scale */
  function writeParams(scale) {
    const c = atmosphereCoefficients(recipe, scale);
    pf.set(c.rayleighScattering, 0); pf[3] = 1 / c.rayleighScaleKm;
    pf.set(c.mieScattering, 4); pf[7] = 1 / c.mieScaleKm;
    pf.set(c.mieExtinction, 8); pf[11] = c.mieG;
    pf.set(c.ozoneAbsorption, 12); pf[15] = c.ozoneCenterKm;
    pf.set(c.aerosolScattering, 16); pf[19] = 1 / c.aerosolScaleKm;
    pf.set(c.aerosolExtinction, 20); pf[23] = c.aerosolG;
    pf.set(c.groundAlbedo, 24); pf[27] = c.ozoneHalfWidthKm;
    device.queue.writeBuffer(paramBuf, 0, pf);
  }

  // ---- Per-frame sky uniforms ----
  const sf = new Float32Array(SKY_UNIFORM_BYTES / 4);
  const sunR = (recipe.sun.angularDiameterDeg / 2) * DEG;
  const moonR = (recipe.moon.angularDiameterDeg / 2) * DEG;
  const st = recipe.stars;
  const cellsPerEdge = Math.max(40, Math.ceil(Math.sqrt(st.count / (6 * 0.5))));
  const yearDays = DAYS_PER_SEASON * SEASONS_PER_YEAR;
  const a = recipe.atmosphere;

  /**
   * Which lights the sky integrates (bit 0 sun, bit 1 moon): a light is skipped when its weight is under
   * 1e-4 of the other's, e.g. the moon by day or the sun more than about 20 degrees below the horizon.
   * @param {AtmosphereFrame} f
   */
  function lightMask(f) {
    const w = (/** @type {ArrayLike<number>} */ e, /** @type {ArrayLike<number>} */ d) =>
      (0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2]) * smooth(-0.35, 0.05, d[1]);
    const ws = w(f.sunIlluminanceTOA ?? recipe.sun.illuminanceTOA, f.sunDir);
    const wm = w(f.moonIlluminanceTOA, f.moonDir);
    const sun = ws > 0 && ws >= 1e-4 * wm;
    const moon = wm > 0 && wm >= 1e-4 * ws;
    return sun && moon ? 3 : moon ? 2 : 1;
  }

  /** @param {AtmosphereFrame} f */
  function writeSkyUniforms(f) {
    sf.set(f.invViewProj, 0);
    sf[16] = f.cameraPos[0]; sf[17] = f.cameraPos[1]; sf[18] = f.cameraPos[2];
    sf[19] = Math.max(f.cameraPos[1], 0.5) / 1000;
    sf.set(Array.from(f.sunDir).slice(0, 3), 20); sf[23] = Math.sin(sunR);
    sf.set(Array.from(f.sunIlluminanceTOA ?? recipe.sun.illuminanceTOA).slice(0, 3), 24); sf[27] = Math.cos(sunR);
    sf.set(Array.from(f.moonDir).slice(0, 3), 28); sf[31] = Math.sin(moonR);
    sf.set(Array.from(f.moonIlluminanceTOA).slice(0, 3), 32); sf[35] = Math.cos(moonR);
    // Airglow plus the art-directed starlight glow (sky.json `starlight`), both from the same shell.
    const glow = recipe.starlight?.radianceNits ?? [0, 0, 0];
    sf.set(recipe.airglow.radianceNits.map((/** @type {number} */ v, /** @type {number} */ i) => v + glow[i]), 36);
    sf[39] = recipe.airglow.heightKm;
    sf[40] = weather.cloud; sf[41] = recipe.overcast.sunToDome; sf[42] = recipe.overcast.sunOcclusion; sf[43] = recipe.overcast.diskOcclusion;
    const fr = weather.frost;
    for (let i = 0; i < 3; i++) sf[44 + i] = a.probeGroundAlbedo[i] + (a.frostGroundAlbedo[i] - a.probeGroundAlbedo[i]) * fr;
    sf[47] = recipe.aerial.maxDistance;
    sf.set(recipe.sun.limbDarkening, 48); sf[51] = recipe.sun.maxPreExposed;
    sf[52] = recipe.moon.illuminanceFull / (Math.PI * Math.sin(moonR) ** 2);
    sf[53] = recipe.moon.earthshine; sf[54] = recipe.moon.albedo.highlands; sf[55] = recipe.moon.albedo.maria;
    // Art-directed: star and Milky Way radiance in EV above the EV100 -1 night floor (docs/05, 06).
    sf[56] = NIGHT_FLOOR_MID_NITS * 2 ** st.brightnessAboveFloorEV; sf[57] = st.twinkle; sf[58] = st.twinkleHz; sf[59] = st.magnitudeLimit;
    sf[60] = Math.min(0.9, st.count / (6 * cellsPerEdge * cellsPerEdge)); sf[61] = cellsPerEdge; sf[62] = st.colorAmount; sf[63] = st.fadeSkyNits;
    sf[64] = NIGHT_FLOOR_MID_NITS * 2 ** st.milkyWayAboveFloorEV; sf[65] = (st.milkyWayWidthDeg / 2) * DEG;
    sf[66] = (1 + 1 / yearDays) / 24; sf[67] = recipe.orbit.latitudeDeg * DEG;
    sf[68] = svW; sf[69] = svH; sf[70] = slices; sf[71] = lightMask(f);
    device.queue.writeBuffer(skyBuf, 0, sf);
  }

  /**
   * Record this frame's sky compute work: LUT rebuild if due, then sky-view, SH9 and aerial froxels.
   * @param {GPUCommandEncoder} encoder
   * @param {AtmosphereFrame} frame
   */
  function update(encoder, frame) {
    const now = performance.now();
    const scale = aerosolScaleFor(recipe, weather, frame.sunDir);
    const changed = !(Math.abs(Math.log(scale / builtScale)) <= 0.02);
    const rebuild = Number.isNaN(builtScale) || (changed && now - lastBuild >= REBUILD_MS);
    if (rebuild) {
      writeParams(scale);
      builtScale = scale;
      lastBuild = now;
    }
    writeSkyUniforms(frame);
    writeProbeParams();

    // Each stage is one or more dispatches [pipeline, group, x, y, z]; the probe is one stage of all its mips.
    /** @typedef {[GPUComputePipeline, GPUBindGroup, number, number, number]} Step */
    /** @type {{ label: string, steps: Step[] }[]} */
    const stages = [];
    if (rebuild) {
      stages.push({ label: 'sky-transmittance', steps: [[pTrans, groups.trans, 32, 8, 1]] },
        { label: 'sky-multiscatter', steps: [[pMs, groups.ms, 32, 32, 1]] });
    }
    stages.push(
      { label: 'sky-view', steps: [[pView, groups.view, Math.ceil(svW / 8), Math.ceil(svH / 8), 1]] },
      { label: 'sh-project', steps: [[pSh, groups.sh, 1, 1, 1]] },
      { label: 'sky-probe', steps: probeSteps },
      { label: 'sky-aerial', steps: [[pAerial, groups.aerial, (slices * slices * slices) / 64, 1, 1]] },
    );
    /** @param {GPUComputePassEncoder} pass @param {Step[]} steps */
    const run = (pass, steps) => {
      for (const [p, g, x, y, z] of steps) { pass.setPipeline(p); pass.setBindGroup(0, g); pass.dispatchWorkgroups(x, y, z); }
    };
    const t = frame.timestamps;
    const per = frame.stageTimestamps;
    if (per) {
      // Debug timing: one compute pass per stage, queries at base + 2 * stage index in run order.
      stages.forEach(({ label, steps }, i) => {
        const pass = encoder.beginComputePass({
          label: `sky-${label}`,
          timestampWrites: { querySet: per.querySet, beginningOfPassWriteIndex: per.base + 2 * i, endOfPassWriteIndex: per.base + 2 * i + 1 },
        });
        run(pass, steps); pass.end();
      });
      return;
    }
    const pass = encoder.beginComputePass({
      label: 'sky-luts',
      timestampWrites: t ? { querySet: t.querySet, beginningOfPassWriteIndex: t.beginIndex, endOfPassWriteIndex: t.endIndex } : undefined,
    });
    for (const { steps } of stages) run(pass, steps);
    pass.end();
  }

  function dispose() {
    for (const t of [transmittance, multiScatter, skyView, aerial, probe]) t.destroy();
    for (const b of [paramBuf, skyBuf, sh, state, probeParamBuf]) b.destroy();
    for (const l of ['sky-transmittance', 'sky-multiscatter', 'sky-view', 'sky-aerial', 'sky-probe', 'sky-atmosphere-params',
      'sky-uniforms', 'sky-sh9', 'sky-state', 'sky-probe-params']) untrack(l);
  }

  return {
    setAtmosphere, update, dispose,
    get transmittance() { return transmittance; },
    get multiScatter() { return multiScatter; },
    get skyView() { return skyView; },
    get aerial() { return aerial; },
    get sh() { return sh; },
    /** SkyState buffer (overcast dome etc.), read by the sky pass. */
    get state() { return state; },
    /** SkyUniforms buffer, shared with the sky pass. */
    get uniforms() { return skyBuf; },
    get skySampler() { return skySampler; },
    get lutSampler() { return lutSampler; },
    get aerialMaxDistance() { return recipe.aerial.maxDistance; },
    get aerialSlices() { return slices; },
    get skyViewSize() { return /** @type {[number, number]} */ ([svW, svH]); },
    /** Sky probe cube texture (6 layers, probeMips mips); sample through probeView (lib-probe.wgsl). */
    get probe() { return probe; },
    /** Cube view over all probe mips: texture_cube<f32>, sampleType 'float', viewDimension 'cube'. */
    get probeView() { return probeView; },
    /** Linear min, mag and mip filtering, clamp to edge ('filtering' sampler). */
    get probeSampler() { return probeSampler; },
    /** Mip count; mip m is perceptual roughness m / (probeMips - 1), see probeLod in lib-probe.wgsl. */
    get probeMips() { return probeMips; },
    /** Ground aerosol multiplier the current LUTs were built with; pass it to transmittanceToLight. */
    get aerosolScale() { return Number.isNaN(builtScale) ? aerosolScaleFor(recipe, weather, [0, 1, 0]) : builtScale; },
    get weather() { return { ...weather }; },
  };
}

/** @typedef {Awaited<ReturnType<typeof createAtmosphere>>} Atmosphere */
