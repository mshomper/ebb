// @ts-check
// Sky lab: the real island with an hour and season preview (docs/06 "Tuning knobs": a time
// scrubber previews any hour and season without changing the world clock).
// Preview goes through clock.setDisplayOverride; weather preview writes the store slice `preview`.

import * as clock from '../src/core/clock.js';
import { get, update, subscribe } from '../src/core/store.js';
import { loadRecipe } from '../src/core/recipes.js';
import { on } from '../src/core/events.js';
import { loadShader } from '../src/core/gpu.js';

const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="#5F7F5B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const MOON_WORDS = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
  'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const DEG = 180 / Math.PI;
const DAYS_PER_YEAR = clock.DAYS_PER_SEASON * clock.SEASONS_PER_YEAR;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const pathCanvas = /** @type {HTMLCanvasElement} */ ($('path'));
const hourIn = /** @type {HTMLInputElement} */ ($('hour'));
const dayIn = /** @type {HTMLInputElement} */ ($('day'));
const flowSel = /** @type {HTMLSelectElement} */ ($('flow'));
const weatherSel = /** @type {HTMLSelectElement} */ ($('weather'));
const followBtn = /** @type {HTMLButtonElement} */ ($('follow'));

/** @typedef {{ sunAlt: number, sunAz: number, moonAlt: number, moonPhase: number, moonIllum: number, dayLengthH: number }} SunMoonLite */
/** @type {((t: number, o: {latitudeDeg: number, tiltDeg: number}) => SunMoonLite) | null} */
let sunMoon = null;
const orbit = { latitudeDeg: 40, tiltDeg: 18 };

/** Preview time in game seconds, or null while following the world clock. @type {number|null} */
let preview = null;

// ---------- time helpers ----------

/** @param {number} t game seconds @returns {{ day: number, hour: number }} day of the year 0..27, hour 0..24 */
function splitTime(t) {
  const yearT = t - Math.floor(t / clock.SECONDS_PER_YEAR) * clock.SECONDS_PER_YEAR;
  const day = Math.floor(yearT / clock.SECONDS_PER_DAY);
  const hour = (yearT - day * clock.SECONDS_PER_DAY) / clock.SECONDS_PER_HOUR;
  return { day, hour };
}

/** @param {number} hour */
function hhmm(hour) {
  const m = Math.round(hour * 60);
  const h = Math.floor(m / 60) % 25;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** @param {number} day day of the year 0..27 */
function seasonDay(day) {
  return `${SEASONS[Math.floor(day / clock.DAYS_PER_SEASON) % 4]}, day ${(day % clock.DAYS_PER_SEASON) + 1}`;
}

/** @param {number} t */
function describe(t) {
  const { day, hour } = splitTime(t);
  return `${seasonDay(day)}, ${hhmm(hour)}`;
}

function shownTime() {
  return preview ?? clock.display();
}

// ---------- preview control ----------

function applyPreview() {
  const t = (Number(dayIn.value) * 24 + Number(hourIn.value)) * clock.SECONDS_PER_HOUR;
  preview = t;
  clock.setDisplayOverride(t);
  followBtn.setAttribute('aria-pressed', 'false');
  refresh();
}

function follow() {
  preview = null;
  clock.setDisplayOverride(null);
  followBtn.setAttribute('aria-pressed', 'true');
  refresh();
}

hourIn.addEventListener('input', applyPreview);
dayIn.addEventListener('input', applyPreview);
followBtn.addEventListener('click', follow);

flowSel.value = String(clock.flow());
flowSel.addEventListener('change', () => {
  const f = /** @type {0|1|2|4} */ (Number(flowSel.value));
  clock.setFlow(f);
  update('meta', (m) => { m.flow = f; });
});
subscribe('meta', (m) => { if (m && String(m.flow) !== flowSel.value) flowSel.value = String(m.flow); });

weatherSel.addEventListener('change', () => {
  const w = weatherSel.value || null;
  update('preview', () => ({ weather: w }));
});

// ---------- readouts ----------

function refresh() {
  const t = shownTime();
  const { day, hour } = splitTime(t);
  if (preview === null) {
    // Following: the sliders track the world clock.
    hourIn.value = String(Math.round(hour * 10) / 10);
    dayIn.value = String(day);
  }
  $('hour-out').textContent = hhmm(Number(hourIn.value));
  $('day-out').textContent = `${seasonDay(Number(dayIn.value))} (${Number(dayIn.value) + 1} of ${DAYS_PER_YEAR})`;
  $('world-time').textContent = `World clock: ${describe(clock.worldT())}`;
  $('mode').textContent = preview === null
    ? 'Showing the world clock.'
    : `Previewing ${describe(preview)}. The world clock stays where it is.`;

  const ev = get('render')?.ev100;
  $('t-ev').textContent = Number.isFinite(ev) ? Number(ev).toFixed(1) : '-';

  if (!sunMoon) return;
  const s = sunMoon(t, orbit);
  $('t-alt').textContent = `${(s.sunAlt * DEG).toFixed(1)}°`;
  // sun-moon.js measures azimuth from south, west positive; show it as a bearing from north.
  const bearing = (((s.sunAz * DEG + 180) % 360) + 360) % 360;
  $('t-az').textContent = `${bearing.toFixed(0)}° ${COMPASS[Math.round(bearing / 45) % 8]}`;
  $('t-moon').textContent = `${Math.round(s.moonIllum * 100)}% lit`;
  $('t-moon-word').textContent = `moon: ${MOON_WORDS[Math.round(s.moonPhase * 8) % 8]}`;
  $('t-daylen').textContent = s.dayLengthH.toFixed(1);
  drawPath(day, hour);
}

// ---------- sun and moon chart ----------

/** @type {{ day: number, w: number, h: number, sun: number[], moon: number[] } | null} */
let pathCache = null;

/** @param {number} day @param {number} hour */
function drawPath(day, hour) {
  if (!sunMoon) return;
  const dpr = window.devicePixelRatio || 1;
  const w = pathCanvas.clientWidth;
  const h = pathCanvas.clientHeight;
  if (!w || !h) return;
  if (pathCanvas.width !== Math.round(w * dpr) || pathCanvas.height !== Math.round(h * dpr)) {
    pathCanvas.width = Math.round(w * dpr);
    pathCanvas.height = Math.round(h * dpr);
  }
  if (!pathCache || pathCache.day !== day) {
    const sun = [];
    const moon = [];
    for (let i = 0; i <= 96; i++) {
      const s = sunMoon((day * 24 + i / 4) * clock.SECONDS_PER_HOUR, orbit);
      sun.push(s.sunAlt * DEG);
      moon.push(s.moonAlt * DEG);
    }
    pathCache = { day, w, h, sun, moon };
  }
  const g = /** @type {CanvasRenderingContext2D} */ (pathCanvas.getContext('2d'));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const top = 8;
  const bottom = h - 24;
  const x = (/** @type {number} */ hr) => (hr / 24) * w;
  const y = (/** @type {number} */ deg) => top + ((90 - deg) / 180) * (bottom - top);

  g.font = '600 15px Nunito, system-ui, sans-serif';
  g.fillStyle = '#4A5551';
  g.strokeStyle = '#E3D9C9';
  g.lineWidth = 1;
  for (const hr of [0, 6, 12, 18, 24]) {
    g.beginPath();
    g.moveTo(x(hr), top);
    g.lineTo(x(hr), bottom);
    g.stroke();
    const label = `${String(hr).padStart(2, '0')}:00`;
    const tw = g.measureText(label).width;
    g.fillText(label, Math.min(w - tw, Math.max(0, x(hr) - tw / 2)), h - 4);
  }
  g.strokeStyle = '#7B8B84';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, y(0));
  g.lineTo(w, y(0));
  g.stroke();

  /** @param {number[]} arr @param {string} color */
  const line = (arr, color) => {
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.beginPath();
    arr.forEach((v, i) => (i ? g.lineTo(x(i / 4), y(v)) : g.moveTo(x(0), y(v))));
    g.stroke();
  };
  line(pathCache.moon, '#8F80B0');
  line(pathCache.sun, '#D99A4E');

  g.strokeStyle = '#1E2624';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x(hour), top);
  g.lineTo(x(hour), bottom);
  g.stroke();
}

/** @param {PointerEvent} e */
function pickHour(e) {
  const r = pathCanvas.getBoundingClientRect();
  const hr = Math.min(24, Math.max(0, ((e.clientX - r.left) / r.width) * 24));
  hourIn.value = String(Math.round(hr * 10) / 10);
  applyPreview();
}
pathCanvas.addEventListener('pointerdown', (e) => {
  pathCanvas.setPointerCapture(e.pointerId);
  pickHour(e);
});
pathCanvas.addEventListener('pointermove', (e) => { if (e.buttons) pickHour(e); });
window.addEventListener('resize', () => { pathCache = null; refresh(); });

// ---------- sky probe panel ----------
// Draws the probe on the app's own device (atmosphere.js emits 'sky:probe-ready' when it builds the
// probe, again after a device loss). Mode 0: one mip's six faces as a cross, texel-exact. Mode 1: the
// probe sampled by direction over the sky-view LUT for the same directions (orientation check).

const PROBE_LAB_WGSL = /* wgsl */ `
struct LabParams { mode: u32, lod: u32, exposure: f32, pxY: f32 };
@group(0) @binding(0) var<uniform> lab: LabParams;
@group(0) @binding(1) var probeArr: texture_2d_array<f32>;
@group(0) @binding(2) var probeCube: texture_cube<f32>;
@group(0) @binding(3) var probeSmp: sampler;
@group(0) @binding(4) var skyViewLut: texture_2d<f32>;
@group(0) @binding(5) var skySmp: sampler;
@group(0) @binding(6) var<uniform> sky: SkyUniforms;
@group(0) @binding(7) var<storage, read> state: SkyState;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> FullscreenOut { return fullscreenTriangle(vi); }

// Display only: exposure from the island, a soft shoulder, then sRGB-ish gamma.
fn shown(nits: vec3f) -> vec4f {
  let c = vec3f(1.0) - exp(-2.0 * max(nits, vec3f(0.0)) * lab.exposure);
  return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
}

// Horizontal cross: +Y over +Z; middle row -X, +Z, +X, -Z; -Y under +Z.
fn crossFace(cell: vec2i) -> i32 {
  if (cell.x == 1 && cell.y == 0) { return 2; }
  if (cell.x == 1 && cell.y == 2) { return 3; }
  var row = array<i32, 4>(1, 4, 0, 5);
  if (cell.y == 1 && cell.x >= 0 && cell.x < 4) { return row[cell.x]; }
  return -1;
}

@fragment
fn fs(in: FullscreenOut) -> @location(0) vec4f {
  if (lab.mode == 0u) {
    let g = in.uv * vec2f(4.0, 3.0);
    let face = crossFace(vec2i(floor(g)));
    if (face < 0) { return vec4f(0.984, 0.969, 0.941, 1.0); }
    let size = textureDimensions(probeArr, lab.lod);
    let texel = min(vec2u(fract(g) * vec2f(size)), size - vec2u(1u));
    return shown(textureLoad(probeArr, texel, face, lab.lod).rgb * PROBE_INV_SCALE);
  }
  let upper = in.uv.y < 0.5;
  let vy = select(in.uv.y - 0.5, in.uv.y, upper) * 2.0;
  if (abs(in.uv.y - 0.5) < lab.pxY * 1.5) { return vec4f(0.984, 0.969, 0.941, 1.0); }
  let theta = vy * PI;
  let az = (in.uv.x - 0.5) * 2.0 * PI;
  let d = vec3f(cos(az) * sin(theta), cos(theta), sin(az) * sin(theta));
  var L: vec3f;
  if (upper) {
    L = textureSampleLevel(probeCube, probeSmp, d, 0.0).rgb * PROBE_INV_SCALE;
  } else {
    L = textureSampleLevel(skyViewLut, skySmp, skyViewUv(d, sky.cameraHeightKm, sky.sizes.xy), 0.0).rgb * SKY_LUT_INV_SCALE;
    L = mix(L, state.dome.rgb * (1.0 + 2.0 * max(d.y, 0.0)) / 3.0, sky.weather.x);
  }
  var c = shown(L);
  if (abs(vy - 0.5) < lab.pxY * 2.0) { c = vec4f(mix(c.rgb, vec3f(1.0), 0.6), 1.0); }
  return c;
}
`;

const probeMipIn = /** @type {HTMLInputElement} */ ($('probe-mip'));
const probeStatus = $('probe-status');
let probeGen = 0;
let probeMipCount = 7;

function probeMipLabel() {
  const m = Number(probeMipIn.value);
  const r = m / Math.max(1, probeMipCount - 1);
  $('probe-mip-out').textContent = `${m} of ${probeMipCount - 1}, roughness ${r.toFixed(2)}`;
  $('probe-blur-cap').textContent = `Blurred (level ${m}, roughness ${r.toFixed(2)})`;
}
probeMipIn.addEventListener('input', probeMipLabel);

/**
 * @param {{ device: GPUDevice, probe: GPUTexture, probeView: GPUTextureView, probeSampler: GPUSampler,
 *   probeMips: number, probeSize: number, skyView: GPUTexture, skySampler: GPUSampler, uniforms: GPUBuffer, state: GPUBuffer }} p
 */
async function setupProbePanel(p) {
  const gen = ++probeGen;
  const { device } = p;
  probeMipCount = p.probeMips;
  probeMipIn.max = String(p.probeMips - 1);
  if (Number(probeMipIn.value) > p.probeMips - 1) probeMipIn.value = String(p.probeMips - 1);
  probeMipLabel();
  const code = [await loadShader('common'), await loadShader('lib-atmosphere'), await loadShader('lib-probe'), PROBE_LAB_WGSL].join('\n');
  const module = device.createShaderModule({ label: 'sky-lab-probe', code });
  const info = await module.getCompilationInfo();
  for (const m of info.messages) {
    if (m.type === 'error') console.error(`[sky-lab] probe shader line ${m.lineNum}: ${m.message}\n  ${code.split('\n')[m.lineNum - 1] ?? ''}`);
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  const pipe = await device.createRenderPipelineAsync({
    label: 'sky-lab-probe', layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const arr = p.probe.createView({ label: 'sky-lab-probe-array', dimension: '2d-array' });
  const skyView = p.skyView.createView();
  const panels = ['probe-sharp', 'probe-blur', 'probe-check'].map((id) => {
    const cv = /** @type {HTMLCanvasElement} */ ($(id));
    const ctx = /** @type {GPUCanvasContext} */ (cv.getContext('webgpu'));
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const buf = device.createBuffer({ label: `sky-lab-${id}`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: buf } }, { binding: 1, resource: arr }, { binding: 2, resource: p.probeView },
      { binding: 3, resource: p.probeSampler }, { binding: 4, resource: skyView }, { binding: 5, resource: p.skySampler },
      { binding: 6, resource: { buffer: p.uniforms } }, { binding: 7, resource: { buffer: p.state } }] });
    return { id, cv, ctx, buf, group };
  });
  probeStatus.textContent = `Probe faces are ${p.probeSize} by ${p.probeSize} texels with ${p.probeMips} levels, rebuilt every frame.`;

  const bytes = new ArrayBuffer(16);
  const u32 = new Uint32Array(bytes);
  const f32 = new Float32Array(bytes);
  const draw = () => {
    if (gen !== probeGen) return;
    const ev = Number(get('render')?.ev100);
    const dpr = window.devicePixelRatio || 1;
    const encoder = device.createCommandEncoder({ label: 'sky-lab-probe' });
    for (const pn of panels) {
      const w = Math.max(1, Math.round(pn.cv.clientWidth * dpr));
      const h = Math.max(1, Math.round(pn.cv.clientHeight * dpr));
      if (pn.cv.width !== w || pn.cv.height !== h) { pn.cv.width = w; pn.cv.height = h; }
      u32[0] = pn.id === 'probe-check' ? 1 : 0;
      u32[1] = pn.id === 'probe-blur' ? Number(probeMipIn.value) : 0;
      f32[2] = 1 / (1.2 * 2 ** (Number.isFinite(ev) ? ev : 12));
      f32[3] = 1 / h;
      device.queue.writeBuffer(pn.buf, 0, bytes);
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: pn.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, pn.group); pass.draw(3); pass.end();
    }
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

on('sky:probe-ready', (p) => {
  setupProbePanel(p).catch((err) => {
    console.error('[sky-lab] probe panel failed', err);
    probeStatus.textContent = `The probe panel could not start (${err instanceof Error ? err.message : String(err)}).`;
  });
});

// ---------- boot ----------

const status = $('status');
/** @param {string} icon @param {string} text */
const setStatus = (icon, text) => { status.innerHTML = `${icon}<span>${text}</span>`; };

refresh();
setInterval(refresh, 250);

try {
  const sky = await loadRecipe('world/sky');
  orbit.latitudeDeg = sky?.orbit?.latitudeDeg ?? 40;
  orbit.tiltDeg = sky?.orbit?.tiltDeg ?? 18;
} catch (err) {
  console.warn('[sky-lab] sky recipe not loaded, using latitude 40 and tilt 18', err);
}
try {
  sunMoon = /** @type {any} */ (await import('../src/world/sky/sun-moon.js')).sunMoon;
} catch (err) {
  console.warn('[sky-lab] sun-moon.js not available yet', err);
  $('t-moon-word').textContent = 'moon (sun and moon module not loaded)';
}
refresh();

// The island is loaded last and on its own, so a missing or broken module there leaves the
// controls and readouts working.
try {
  const { startApp } = await import('../src/app.js');
  const result = await startApp(canvas);
  if (!result.ok) {
    setStatus(ICON_WARN, `WebGPU is not available here (${result.reason}), so the island cannot be drawn. The controls and numbers below still work. Open this page in current Chrome or Edge to see the sky.`);
  } else {
    setStatus(ICON_OK, `The island is running (tier ${result.tier}). Orbit and zoom it while you move the sliders.`);
  }
} catch (err) {
  console.error(err);
  setStatus(ICON_WARN, `The island could not start here (${err instanceof Error ? err.message : String(err)}). The controls and numbers below still work.`);
}
