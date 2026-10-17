// @ts-check
// Palette LUT baker (docs/05, "Palette baking" and "Palette swap"). Owns two 32^3 rgba16float
// LUTs. The active palette's keys are blended every update(); when the blended parameters move
// past a small threshold the active LUT is rebaked in place (at most 4 times a second). A new
// palette bakes into the spare LUT and the tonemap crossfades to it. encode() records any pending
// bake into the frame's encoder; call it once per submitted encoder, before the tonemap pass is
// recorded (each LUT has one parameter buffer, written with queue.writeBuffer).
// bakeColor() is the same math as src/shaders/lut-bake.wgsl on the CPU (tests, .cube export,
// palette lab previews). The app emits 'palette:changed'; this module emits nothing.

import { makeBuffer, makeShaderModule, makeTexture } from '../../../core/gpu.js';
import { gamutClipOklab, linearToOklab, linearToSrgb, oklabToLinear, srgbToLinear } from '../../color/oklab.js';
import { blendPalette, keyWeights, mixTonemapParams, paramsDistance, MAX_ANCHORS } from './palette-keys.js';

/** @typedef {import('./palette-keys.js').ResolvedPalette} ResolvedPalette */
/** @typedef {import('../../color/oklab.js').Vec3} Vec3 */
/** @typedef {{ sunAltDeg: number, seasonPhase: number, weather?: { cloud?: number, rain?: number, mist?: number } }} PaletteKeys */

/**
 * @typedef {Object} PaletteFrame
 * @property {0|1} from              LUT index to fade from
 * @property {0|1} to                LUT index to fade to (equal to `from` when no fade runs)
 * @property {number} fade           0..1, eased; color = mix(lut[from], lut[to], fade)
 * @property {{ slope: number, power: number, saturation: number }} look
 * @property {number} exposureComp   EV
 * @property {{ amount: number, terrainAmount: number, chroma: number }} outline
 * @property {number} purkinje       multiplier on the Purkinje strength
 */

export const LUT_SIZE = 32;
const WG = 4;
const PARAMS_BYTES = 64;
const ANCHOR_BYTES = 32;
const MIN_BAKE_INTERVAL_S = 0.25;
/** Blended parameters must move this far (largest change, OKLab units or plain numbers) to rebake. */
const REBAKE_THRESHOLD = 0.002;
const DEFAULT_KEYS = /** @type {PaletteKeys} */ ({ sunAltDeg: 30, seasonPhase: 1.5, weather: { cloud: 0, rain: 0, mist: 0 } });

/** The palette that leaves every color where it is. */
export const IDENTITY_PALETTE = Object.freeze({
  id: 'identity', name: 'Identity', version: 1,
  look: { slope: 1, power: 1, saturation: 1 },
  keepLuminance: 1,
  anchors: [],
  grade: { lift: 0, gamma: 1, gain: 1, chroma: 1, shadowTint: '#808080', shadowAmt: 0, highlightTint: '#FFFFFF', highlightAmt: 0 },
  keys: {},
  outline: { amount: 0.35, terrainAmount: 0.1, chroma: 1.1 },
  painterly: { enabled: false, radius: 4, sharpness: 8, strength: 0.6 },
  colorSafe: false,
});

/**
 * @param {GPUDevice} device
 */
export async function createPaletteBaker(device) {
  const module = await makeShaderModule(device, 'lut-bake');
  const layout = device.createBindGroupLayout({
    label: 'lut-bake',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
    ],
  });
  const pipeline = await device.createComputePipelineAsync({
    label: 'lut-bake',
    layout: device.createPipelineLayout({ label: 'lut-bake', bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });

  /** @type {GPUTexture[]} */ const luts = [];
  /** @type {GPUTextureView[]} */ const views = [];
  /** @type {GPUBuffer[]} */ const paramBufs = [];
  /** @type {GPUBuffer[]} */ const anchorBufs = [];
  /** @type {GPUBindGroup[]} */ const groups = [];
  for (let i = 0; i < 2; i++) {
    const tex = makeTexture(device, {
      label: `palette-lut-${i}`,
      size: [LUT_SIZE, LUT_SIZE, LUT_SIZE],
      dimension: '3d',
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    luts.push(tex);
    views.push(tex.createView({ label: `palette-lut-${i}`, dimension: '3d' }));
    paramBufs.push(makeBuffer(device, { label: `lut-bake-params-${i}`, size: PARAMS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    anchorBufs.push(makeBuffer(device, { label: `lut-bake-anchors-${i}`, size: ANCHOR_BYTES * MAX_ANCHORS, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
    groups.push(device.createBindGroup({
      label: `lut-bake-${i}`,
      layout,
      entries: [
        { binding: 0, resource: { buffer: paramBufs[i] } },
        { binding: 1, resource: { buffer: anchorBufs[i] } },
        { binding: 2, resource: views[i] },
      ],
    }));
  }

  // Per-LUT state: the palette JSON baked there and the resolved parameters of its last bake.
  const identity = blendPalette(IDENTITY_PALETTE, keyWeights(DEFAULT_KEYS));
  /** @type {any[]} */ const lutPalette = [IDENTITY_PALETTE, IDENTITY_PALETTE];
  /** @type {ResolvedPalette[]} */ const baked = [identity, identity];
  /** @type {(ResolvedPalette | null)[]} */ const pending = [null, null];
  const sinceBake = [Infinity, Infinity];

  /** @type {0|1} */ let cur = 0;          // the LUT shown when no fade runs, and the fade's source
  /** @type {0|1} */ let target = 0;       // the LUT holding the active palette (== cur when idle)
  let fadeT = 1;                           // fade progress 0..1, linear in time
  let fadeS = 0;
  /** @type {PaletteKeys} */ let lastKeys = DEFAULT_KEYS;
  /** @type {ResolvedPalette} */ let latest = identity;

  /** @param {any} palette @param {PaletteKeys} keys */
  const resolve = (palette, keys) => blendPalette(palette, keyWeights(keys, palette?.keyBlend ?? {}));

  /** @param {GPUCommandEncoder} encoder @param {0|1} i @param {ResolvedPalette} r */
  function recordBake(encoder, i, r) {
    device.queue.writeBuffer(paramBufs[i], 0, packParams(r));
    device.queue.writeBuffer(anchorBufs[i], 0, packAnchors(r));
    const pass = encoder.beginComputePass({ label: `lut-bake-${i}` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, groups[i]);
    const n = LUT_SIZE / WG;
    pass.dispatchWorkgroups(n, n, n);
    pass.end();
    baked[i] = r;
  }

  // Both LUTs start as identity.
  {
    const enc = device.createCommandEncoder({ label: 'lut-bake-init' });
    recordBake(enc, 0, identity);
    recordBake(enc, 1, identity);
    device.queue.submit([enc.finish()]);
  }

  return {
    luts,
    views,

    /**
     * Make a palette active. It bakes into the spare LUT and the tonemap fades to it.
     * @param {any} palette  parsed palette JSON
     * @param {{ fadeS?: number }} [opts]  fadeS 0 swaps at once (palette lab live edits)
     */
    setPalette(palette, { fadeS: f = 0.6 } = {}) {
      const r = resolve(palette, lastKeys);
      if (target === cur) target = cur === 0 ? 1 : 0; // otherwise a fade runs: retarget its spare LUT
      lutPalette[target] = palette;
      pending[target] = r;
      sinceBake[target] = 0;
      latest = r;
      fadeS = Math.max(0, f);
      if (fadeS === 0) {
        cur = target;
        fadeT = 1;
      } else if (fadeT >= 1) {
        fadeT = 0;
      }
    },

    /**
     * Blend the active palette's keys, schedule a rebake when they moved, advance the crossfade.
     * @param {number} dt  real seconds
     * @param {PaletteKeys} keys
     * @returns {PaletteFrame}
     */
    update(dt, keys) {
      lastKeys = keys ?? lastKeys;
      const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
      sinceBake[0] += step;
      sinceBake[1] += step;

      latest = resolve(lutPalette[target], lastKeys);
      const ref = pending[target] ?? baked[target];
      if (sinceBake[target] >= MIN_BAKE_INTERVAL_S && paramsDistance(latest, ref) > REBAKE_THRESHOLD) {
        pending[target] = latest;
        sinceBake[target] = 0;
      }

      if (target !== cur) {
        fadeT = fadeS > 0 ? Math.min(1, fadeT + step / fadeS) : 1;
        if (fadeT >= 1) { cur = target; fadeT = 1; }
      }
      const fading = target !== cur;
      const fade = fading ? smooth(fadeT) : 1;
      const tm = fading ? mixTonemapParams(pending[cur] ?? baked[cur], latest, fade) : mixTonemapParams(latest, latest, 1);
      return { from: cur, to: target, fade, ...tm };
    },

    /**
     * Record any pending bake into this frame's encoder.
     * @param {GPUCommandEncoder} encoder
     * @returns {boolean} true when a bake was recorded
     */
    encode(encoder) {
      let any = false;
      for (const i of /** @type {(0|1)[]} */ ([0, 1])) {
        const r = pending[i];
        if (!r) continue;
        pending[i] = null;
        recordBake(encoder, i, r);
        any = true;
      }
      return any;
    },

    /** Force a rebake of the active LUT at the next encode() (tuning panel). */
    bakeNow() {
      pending[target] = resolve(lutPalette[target], lastKeys);
      sinceBake[target] = 0;
    },

    /** The active palette JSON, as last set. */
    current: () => lutPalette[target],
    /** The active palette's id. */
    id: () => String(lutPalette[target]?.id ?? ''),
    /** The resolved (key-blended) parameters of the active palette from the last update(). */
    resolved: () => latest,

    /**
     * A .cube file of the active palette as last baked, computed on the CPU with the same math
     * as the GPU bake (input domain: AgX output, display-encoded sRGB).
     * @param {number} [size]
     */
    exportCube(size = LUT_SIZE) {
      return cubeText(pending[target] ?? baked[target], size, String(lutPalette[target]?.name ?? lutPalette[target]?.id ?? 'palette'));
    },

    destroy() {
      for (const t of luts) t.destroy();
      for (const b of [...paramBufs, ...anchorBufs]) b.destroy();
    },
  };
}

/** @param {number} t */
function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** @param {ResolvedPalette} r */
function packParams(r) {
  const data = new ArrayBuffer(PARAMS_BYTES);
  const f = new Float32Array(data);
  const u = new Uint32Array(data);
  const g = r.grade;
  f[0] = r.keepLuminance; f[1] = g.lift; f[2] = g.gamma; f[3] = g.gain;
  f[4] = g.chroma; f[5] = g.shadowAmt; f[6] = g.highlightAmt; u[7] = Math.min(r.anchors.length, MAX_ANCHORS);
  f.set(g.shadowTint, 8);
  f.set(g.highlightTint, 12);
  return data;
}

/** @param {ResolvedPalette} r */
function packAnchors(r) {
  const f = new Float32Array(MAX_ANCHORS * ANCHOR_BYTES / 4);
  r.anchors.slice(0, MAX_ANCHORS).forEach((a, i) => {
    const o = i * 8;
    f[o] = a.from[0]; f[o + 1] = a.from[1]; f[o + 2] = a.from[2]; f[o + 3] = a.radius;
    f[o + 4] = a.to[0] - a.from[0]; f[o + 5] = a.to[1] - a.from[1]; f[o + 6] = a.to[2] - a.from[2]; f[o + 7] = a.strength;
  });
  return f;
}

/**
 * One color through the palette on the CPU: the same steps as lut-bake.wgsl.
 * @param {ResolvedPalette} r
 * @param {Vec3} rgb  display-encoded sRGB 0..1 (an AgX output)
 * @returns {Vec3} display-encoded sRGB 0..1
 */
export function bakeColor(r, rgb) {
  const lab0 = linearToOklab(srgbToLinear(rgb));
  let ox = 0, oy = 0, oz = 0, wsum = 0;
  for (const a of r.anchors.slice(0, MAX_ANCHORS)) {
    const d = Math.hypot(lab0[0] - a.from[0], lab0[1] - a.from[1], lab0[2] - a.from[2]) / a.radius;
    const w = a.strength * Math.exp(-d * d);
    ox += w * (a.to[0] - a.from[0]); oy += w * (a.to[1] - a.from[1]); oz += w * (a.to[2] - a.from[2]);
    wsum += w;
  }
  const k = 1 / Math.max(1, wsum);
  let L = lab0[0] + ox * k;
  L = L + (lab0[0] - L) * r.keepLuminance;

  const g = r.grade;
  L = Math.min(1, Math.max(0, L));
  L = Math.pow(Math.max(g.lift + L * (g.gain - g.lift), 0), 1 / g.gamma);
  let a = (lab0[1] + oy * k) * g.chroma;
  let b = (lab0[2] + oz * k) * g.chroma;
  const Lw = Math.min(1, Math.max(0, L));
  const ws = g.shadowAmt * (1 - Lw) * (1 - Lw);
  const wh = g.highlightAmt * Lw * Lw;
  a += (g.shadowTint[1] - a) * ws; b += (g.shadowTint[2] - b) * ws;
  a += (g.highlightTint[1] - a) * wh; b += (g.highlightTint[2] - b) * wh;

  const lin = oklabToLinear(gamutClipOklab([L, a, b]));
  const c01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
  const out = linearToSrgb([c01(lin[0]), c01(lin[1]), c01(lin[2])]);
  return [c01(out[0]), c01(out[1]), c01(out[2])];
}

/**
 * @param {ResolvedPalette} r @param {number} size @param {string} title
 * @returns {string}
 */
export function cubeText(r, size = LUT_SIZE, title = 'palette') {
  const n = Math.max(2, Math.min(129, Math.round(size)));
  const lines = [`TITLE "ebb ${title.replace(/"/g, '')}"`, `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let bz = 0; bz < n; bz++) for (let gy = 0; gy < n; gy++) for (let rx = 0; rx < n; rx++) {
    const c = bakeColor(r, [rx / (n - 1), gy / (n - 1), bz / (n - 1)]);
    lines.push(`${c[0].toFixed(6)} ${c[1].toFixed(6)} ${c[2].toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}
