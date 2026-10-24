// @ts-check
// The asset lab (tools/asset-lab.html): each of Matt's models (tools/assets/models.json) beside its
// web copy (assets/models/camp/<out>.glb), turning together under day or dusk light, with triangles,
// file sizes, map sizes and a color map difference. The originals are not in the repo: Matt picks
// his Ebb/_assets folder once and the page reads the files from it, one model at a time.
// For testing without the picker: ?src=<folder url> fetches the originals from that served folder.

import { createStage } from './asset-lab-stage.js';
import { readModel, decodeMap, colorDiff, beside } from './asset-lab-model.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const status = $('status');
const say = (/** @type {string} */ t) => { status.textContent = t; };
const mb = (/** @type {number} */ b) => `${(b / 1048576).toFixed(b < 10485760 ? 2 : 1)} MB`;
const num = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US');

const list = await (await fetch('./assets/models.json', { cache: 'no-cache' })).json();
/** @type {Record<string, any>} */
const report = await fetch('../assets/models/camp/report.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
/** @type {{ source: string, out: string, sizeM: number, along: string, yawDeg?: number, made?: string }[]} */
const models = list.models;
/** The walker (assets/figures/walker.glb, 1.4 m), fetched once, to stand beside the pieces made in code. @type {Promise<ArrayBuffer> | null} */
let walkerBuf = null;
const walker = () => (walkerBuf ??= fetch('../assets/figures/walker.glb').then((r) => r.arrayBuffer()));
const srcUrl = new URLSearchParams(location.search).get('src');
/** @type {Map<string, File>} */ const files = new Map();

const r = await createStage([$('left'), $('right')]);
if (!r.ok) { say(r.reason); throw new Error(r.reason); }
const stage = r.stage;
// For scripted render sheets (a session saving pictures of every piece): the stage's camera.
/** @type {any} */ (globalThis).assetLab = { stage };

// Picker.
const pick = $('pick');
for (const [i, m] of models.entries()) pick.add(new Option(`${m.out} (${m.made ? 'made in code' : m.source})`, String(i)));
const startAt = Math.max(0, models.findIndex((m) => m.out === new URLSearchParams(location.search).get('model')));
pick.value = String(startAt);
pick.addEventListener('change', () => show(+pick.value));
$('prev').addEventListener('click', () => { pick.value = String((+pick.value + models.length - 1) % models.length); show(+pick.value); });
$('next').addEventListener('click', () => { pick.value = String((+pick.value + 1) % models.length); show(+pick.value); });

// Folder.
$('folder').addEventListener('click', () => $('folder-input').click());
$('folder-input').addEventListener('change', () => {
  files.clear();
  for (const f of /** @type {FileList} */ ($('folder-input').files)) files.set(f.name, f);
  const found = models.filter((m) => files.has(m.source)).length;
  $('folder-note').textContent = `Found ${found} of ${models.length} models in that folder.`;
  show(+pick.value);
});
if (srcUrl) $('folder-note').textContent = `Reading the originals from ${srcUrl} (test link).`;

// Light, turning, front.
for (const name of /** @type {const} */ (['day', 'dusk'])) {
  $(name).addEventListener('click', () => {
    stage.setLight(name);
    $('day').setAttribute('aria-pressed', String(name === 'day'));
    $('dusk').setAttribute('aria-pressed', String(name === 'dusk'));
  });
}
let paused = false;
const setPaused = (/** @type {boolean} */ p) => { paused = p; $('pause').setAttribute('aria-pressed', String(p)); $('pause').textContent = p ? 'Turn' : 'Pause'; };
$('pause').addEventListener('click', () => setPaused(!paused));
$('front').addEventListener('click', () => { setPaused(true); stage.cam.yaw = 0; stage.cam.pitch = 0.25; });

// Drag either view to orbit both; scroll to come closer.
/** @type {null | { x: number, y: number }} */ let drag = null;
for (const canvas of [$('left'), $('right')]) {
  canvas.addEventListener('pointerdown', (/** @type {PointerEvent} */ e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (/** @type {PointerEvent} */ e) => {
    if (!drag) return;
    stage.cam.yaw -= (e.clientX - drag.x) * 0.01;
    stage.cam.pitch = Math.min(1.45, Math.max(-0.05, stage.cam.pitch + (e.clientY - drag.y) * 0.01));
    drag = { x: e.clientX, y: e.clientY };
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
    e.preventDefault();
    stage.cam.zoom = Math.min(3, Math.max(0.3, stage.cam.zoom * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });
}

let last = performance.now();
const frame = (/** @type {number} */ now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && !drag) stage.cam.yaw += dt * 0.35;
  stage.draw();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

// Loading, one model at a time: each load waits for the one before it, which stops early once stale.
let loadId = 0;
let chain = Promise.resolve();
/** @param {number} i */
function show(i) {
  const id = ++loadId;
  chain = chain.then(() => run(i, id));
}

/** @param {string} label @param {string} value */
const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;

/**
 * Read one GLB, place it, decode its maps.
 * @param {ArrayBuffer} buffer @param {{ yawDeg?: number, sizeM: number, along: string }} place
 */
async function load(buffer, place) {
  const mesh = readModel(buffer, place);
  const [baseColor, metallicRoughness, normal] = await Promise.all([decodeMap(mesh.maps.baseColor), decodeMap(mesh.maps.metallicRoughness), decodeMap(mesh.maps.normal)]);
  return { mesh, bitmaps: { baseColor, metallicRoughness, normal } };
}
/** @param {Record<string, ImageBitmap | null>} b */
const closeAll = (b) => { for (const x of Object.values(b)) x?.close(); };

/** The original's bytes, from the chosen folder or the test link, or null. @param {{ source: string }} m */
async function originalBytes(m) {
  const f = files.get(m.source);
  if (f) return f.arrayBuffer();
  if (srcUrl) {
    const res = await fetch(`${srcUrl.replace(/\/$/, '')}/${encodeURIComponent(m.source)}`);
    if (!res.ok) throw new Error(`${m.source}: ${res.status} from the test link`);
    return res.arrayBuffer();
  }
  return null;
}

/** @param {number} i @param {number} id */
async function run(i, id) {
  const stale = () => id !== loadId;
  if (stale()) return;
  const m = models[i];
  const rep = report[m.out] ?? {};
  await stage.setModel(0, null);
  await stage.setModel(1, null);
  $('left').style.visibility = 'hidden';
  $('left-wait').style.display = '';
  $('left-title').textContent = m.made ? 'Beside the walker (1.4 m)' : 'Original';
  const heat = $('heat');
  heat.getContext('2d').clearRect(0, 0, heat.width, heat.height);
  $('diff').innerHTML = row('Mean', 'needs the original') + row('99th percentile', 'needs the original');

  try {
    say(`Loading the web copy of ${m.out}`);
    const copyBuf = await (await fetch(`../assets/models/camp/${m.out}.glb`, { cache: 'no-cache' })).arrayBuffer();
    if (stale()) return;
    // The copy is already placed by the build: run it through the same placement without a turn.
    const copy = await load(copyBuf, { yawDeg: 0, sizeM: m.sizeM, along: m.along });
    if (stale()) { closeAll(copy.bitmaps); return; }
    const b = copy.mesh.bounds;
    const dims = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((x) => x.toFixed(2)).join(' x ');
    const copyMap = copy.bitmaps.baseColor ? `${copy.bitmaps.baseColor.width} px` : 'none';
    const fill = (/** @type {any} */ o) => {
      $('stats').innerHTML =
        row('Triangles', `${o ? num(o.mesh.triangles) : rep.trianglesBefore ? num(rep.trianglesBefore) : 'not loaded'} to ${num(copy.mesh.triangles)}`) +
        row('File size', `${o ? mb(o.bytes) : rep.sourceBytes ? mb(rep.sourceBytes) : 'not loaded'} to ${mb(copyBuf.byteLength)}`) +
        row('Color map', `${o ? o.map : 'not loaded'} to ${copyMap}`) +
        row('Size (x, y, z)', `${dims} m`) +
        row('Real size', `${m.sizeM} m along its ${m.along === 'height' ? 'height' : 'longest side'}, turned ${m.yawDeg ?? 0} degrees`) +
        (o ? '' : row('', 'Original numbers from the build report until the original is loaded.'));
    };
    if (m.made) {
      // Made in code (tools/assets/made-pieces.mjs): no original to compare, so the left view shows
      // the piece beside the walker for scale, framed on its own.
      $('stats').innerHTML = row('Triangles', num(copy.mesh.triangles)) + row('File size', mb(copyBuf.byteLength)) + row('Paint', 'vertex colours') +
        row('Size (x, y, z)', `${dims} m`) + row('Made by', `<code>tools/assets/made/pieces.mjs</code> (${m.made})`);
      $('diff').innerHTML = row('Reading', 'Made in code: there is no original to compare.');
      stage.frameOn(b);
      await stage.setModel(1, copy);
      const fig = readModel(await walker(), { yawDeg: 0, sizeM: 1.4, along: 'height' });
      if (stale()) return;
      const both = beside(fig, copy.mesh, Math.max(0.15, (b.max[0] - b.min[0]) * 0.4));
      stage.frameOn(both.bounds, 0);
      await stage.setModel(0, { mesh: both, bitmaps: { baseColor: null, metallicRoughness: null, normal: null } });
      if (stale()) return;
      $('left').style.visibility = 'visible';
      $('left-wait').style.display = 'none';
      say(`${m.out}: made in code, shown beside the walker.`);
      return;
    }
    fill(null);
    stage.frameOn(b);
    await stage.setModel(1, copy);
    if (stale()) { closeAll(copy.bitmaps); return; }

    say(`Reading the original of ${m.out}`);
    const origBuf = await originalBytes(m).catch((e) => { console.error(e); say(String(e.message ?? e)); return null; });
    if (stale()) { closeAll(copy.bitmaps); return; }
    if (!origBuf) {
      closeAll(copy.bitmaps);
      $('left-text').textContent = files.size
        ? `${m.source} is not in the folder you chose.`
        : 'The original shows here once you choose your Ebb/_assets folder above.';
      if (files.size || !srcUrl) say(`${m.out}: the web copy is showing.`);
      return;
    }
    $('left-text').textContent = `Reading ${m.source} (${mb(origBuf.byteLength)})`;
    const t0 = performance.now();
    const orig = await load(origBuf, m);
    if (stale()) { closeAll(copy.bitmaps); closeAll(orig.bitmaps); return; }
    const oMap = orig.bitmaps.baseColor;
    fill({ mesh: orig.mesh, bytes: origBuf.byteLength, map: oMap ? `${oMap.width} px` : 'none' });

    if (oMap && copy.bitmaps.baseColor) {
      const d = colorDiff(oMap, copy.bitmaps.baseColor);
      heat.width = d.heat.width; heat.height = d.heat.height;
      heat.getContext('2d').putImageData(d.heat, 0, 0);
      const verdict = d.mean < 3 ? 'Good: the painting carried over.' : d.mean < 6 ? 'Close, but look at the colored patches.' : 'The paint changed: check it.';
      $('diff').innerHTML = row('Mean', d.mean.toFixed(2)) + row('99th percentile', String(d.p99)) + row('Reading', verdict);
    }
    closeAll(copy.bitmaps);
    await stage.setModel(0, orig);
    closeAll(orig.bitmaps);
    if (stale()) return;
    $('left').style.visibility = 'visible';
    $('left-wait').style.display = 'none';
    say(`${m.out}: original and web copy side by side (original read in ${((performance.now() - t0) / 1000).toFixed(1)} s).`);
  } catch (e) {
    console.error(e);
    if (!stale()) say(`${m.out}: ${/** @type {any} */ (e).message ?? e}`);
  }
}

show(startAt);
