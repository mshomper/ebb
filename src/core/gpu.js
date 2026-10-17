// @ts-check
// GPU adapter, device, canvas context, shader loading and allocation tracking (docs/03, 04, 19).

const SHADER_ROOT = new URL('../shaders/', import.meta.url);
const OPTIONAL_FEATURES = /** @type {GPUFeatureName[]} */ ([
  'float32-filterable', 'shader-f16', 'timestamp-query', 'rg11b10ufloat-renderable',
]);

/**
 * @typedef {Object} Gpu
 * @property {GPUAdapter} adapter
 * @property {GPUDevice} device
 * @property {GPUCanvasContext} context
 * @property {GPUTextureFormat} format       swapchain format
 * @property {Set<string>} features          optional features that were granted
 */

/** @typedef {{ ok: true, gpu: Gpu } | { ok: false, reason: 'missing'|'no-adapter'|'device-failed' }} GpuResult */

/** @type {GPUDevice | null} */
let currentDevice = null;
/** @type {((info: GPUDeviceLostInfo) => void)[]} */
const lostListeners = [];
/** @type {Map<string, number>} */
const allocations = new Map();
/** @type {Map<string, Promise<string>>} */
const shaderCache = new Map();

/**
 * Request the adapter and device and configure the canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<GpuResult>}
 */
export async function initGpu(canvas) {
  if (!('gpu' in navigator)) return { ok: false, reason: 'missing' };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { ok: false, reason: 'no-adapter' };

  const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter.features.has(f));
  /** @type {GPUDevice} */
  let device;
  try {
    device = await adapter.requestDevice({
      requiredFeatures,
      requiredLimits: { maxStorageBuffersPerShaderStage: 8 },
    });
  } catch (err) {
    console.error('requestDevice failed', err);
    return { ok: false, reason: 'device-failed' };
  }
  currentDevice = device;
  allocations.clear();

  device.addEventListener('uncapturederror', (e) => {
    console.error('WebGPU error:', /** @type {GPUUncapturedErrorEvent} */ (e).error.message);
  });
  device.lost.then((info) => {
    if (device !== currentDevice) return;
    for (const fn of lostListeners) fn(info);
  });

  const context = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  const format = navigator.gpu.getPreferredCanvasFormat();
  // COPY_SRC lets tools pages read a pixel of the final image (the palette lab's eyedropper).
  context.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });

  return { ok: true, gpu: { adapter, device, context, format, features: new Set(requiredFeatures) } };
}

/**
 * Called when the device is lost for any reason other than our own destroy().
 * @param {(info: GPUDeviceLostInfo) => void} fn
 */
export function onDeviceLost(fn) {
  lostListeners.push(fn);
}

/**
 * Load a WGSL file from src/shaders/, expanding `// #include name` lines once each.
 * @param {string} name   file name without extension, e.g. 'tonemap'
 * @returns {Promise<string>}
 */
export async function loadShader(name) {
  const included = new Set();
  return expand(name, included);
}

/**
 * @param {string} name
 * @param {Set<string>} included
 * @returns {Promise<string>}
 */
async function expand(name, included) {
  included.add(name);
  const src = await fetchShader(name);
  const out = [];
  for (const line of src.split('\n')) {
    const m = /^\s*\/\/\s*#include\s+([\w-]+)\s*$/.exec(line);
    if (!m) { out.push(line); continue; }
    if (included.has(m[1])) continue;
    out.push(`// ---- begin ${m[1]}.wgsl ----`, await expand(m[1], included), `// ---- end ${m[1]}.wgsl ----`);
  }
  return out.join('\n');
}

/** @param {string} name */
function fetchShader(name) {
  let p = shaderCache.get(name);
  if (!p) {
    p = fetch(new URL(`${name}.wgsl`, SHADER_ROOT), { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`Shader ${name}.wgsl not found (${r.status})`);
      return r.text();
    });
    shaderCache.set(name, p);
  }
  return p;
}

/**
 * Create a shader module and log any compile messages with file context.
 * @param {GPUDevice} device
 * @param {string} name
 */
export async function makeShaderModule(device, name) {
  const code = await loadShader(name);
  const module = device.createShaderModule({ label: name, code });
  const info = await module.getCompilationInfo();
  for (const m of info.messages) {
    const where = `${name}.wgsl (expanded) line ${m.lineNum}:${m.linePos}`;
    const log = m.type === 'error' ? console.error : m.type === 'warning' ? console.warn : console.info;
    log(`[wgsl] ${where} ${m.message}\n  ${code.split('\n')[m.lineNum - 1] ?? ''}`);
  }
  return module;
}

/**
 * Create a buffer and record its size under its label.
 * @param {GPUDevice} device
 * @param {GPUBufferDescriptor & { label: string }} desc
 */
export function makeBuffer(device, desc) {
  const buf = device.createBuffer(desc);
  track(desc.label, desc.size);
  return buf;
}

/**
 * Create a texture and record an estimate of its size under its label.
 * @param {GPUDevice} device
 * @param {GPUTextureDescriptor & { label: string }} desc
 */
export function makeTexture(device, desc) {
  const tex = device.createTexture(desc);
  const size = /** @type {number[]} */ (Array.isArray(desc.size) ? desc.size : [
    /** @type {GPUExtent3DDict} */ (desc.size).width,
    /** @type {GPUExtent3DDict} */ (desc.size).height ?? 1,
    /** @type {GPUExtent3DDict} */ (desc.size).depthOrArrayLayers ?? 1,
  ]);
  const texels = size[0] * (size[1] ?? 1) * (size[2] ?? 1);
  const mipFactor = (desc.mipLevelCount ?? 1) > 1 ? 4 / 3 : 1;
  track(desc.label, texels * bytesPerTexel(desc.format) * mipFactor);
  return tex;
}

/**
 * Forget an allocation (call alongside destroy()).
 * @param {string} label
 */
export function untrack(label) {
  allocations.delete(label);
}

/** @returns {{ totalBytes: number, byLabel: [string, number][] }} */
export function memoryReport() {
  let totalBytes = 0;
  for (const v of allocations.values()) totalBytes += v;
  return { totalBytes, byLabel: [...allocations.entries()].sort((a, b) => b[1] - a[1]) };
}

/** @param {string} label @param {number} bytes */
function track(label, bytes) {
  allocations.set(label, bytes);
}

/** @param {GPUTextureFormat} format */
function bytesPerTexel(format) {
  if (/32float|32uint|32sint/.test(format)) return /^rgba/.test(format) ? 16 : /^rg/.test(format) ? 8 : 4;
  if (/16float|16uint|16sint|16unorm/.test(format)) return /^rgba/.test(format) ? 8 : /^rg/.test(format) ? 4 : 2;
  if (format === 'depth24plus-stencil8') return 4;
  return /^rgba|^bgra|rgb10a2|rg11b10/.test(format) ? 4 : /^rg/.test(format) ? 2 : 1;
}
