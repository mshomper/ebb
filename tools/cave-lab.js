// @ts-check
// The cave lab (H1, the floor maker; doc 16): floors made from seeds side by side, each as a map, its
// field cut level and upright, and in 3D with an orbit and a roof cut; and a table of every floor's
// meshing time, triangles, walk check, the seeds it tried, and whether one thread makes the very
// same floor (plan and mesh hashes). Runs from a local server.

import { initWorkers, run, poolSize } from '../src/core/workers.js';
import { makeFloor } from '../src/world/hollow/floor.js';
import { drawMap, drawFieldLevel, drawFieldSection, KINDS, CELLS } from './cave-lab-maps.js';
import { createFloorView } from './cave-lab-view.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const F = (await (await fetch('../recipes/world/hollow.json')).json()).floors;
initWorkers();

// The legend: chamber kinds and map cells.
const legend = $('legend');
for (const k of Object.values(KINDS)) legend.insertAdjacentHTML('beforeend', `<span><i style="background:${k.colour}"></i>${k.label}</span>`);
const cellNames = { floor: 'Walkable floor', cut: 'Floor not reached', steep: 'Too steep', shallow: 'Shallow water', deep: 'Deep water', rock: 'Rock' };
for (const [k, name] of Object.entries(cellNames)) legend.insertAdjacentHTML('beforeend', `<span><i style="background:${/** @type {any} */ (CELLS)[k]}"></i>${name}</span>`);

const level = /** @type {HTMLInputElement} */ ($('level'));
level.addEventListener('input', () => { $('levelOut').textContent = level.value; });

/** The inputs for the floors to make, from the controls. */
function wanted() {
  const seed = Number(/** @type {HTMLInputElement} */ ($('seed')).value) | 0;
  const trip = Number(/** @type {HTMLInputElement} */ ($('trip')).value) | 0;
  const floor = Number(/** @type {HTMLInputElement} */ ($('floor')).value) | 0;
  const lv = Number(level.value);
  const depth = /** @type {HTMLSelectElement} */ ($('depth')).value;
  const mode = /** @type {HTMLSelectElement} */ ($('mode')).value;
  /** @param {number} s @param {string} d */
  const one = (s, d) => {
    /** @type {any} */ const i = { seed: s, trip, floor, level: lv };
    if (d === 'sponge') { i.depth = 1; i.flavor = 'sponge'; } else if (d !== 'level') i.depth = Number(d);
    return i;
  };
  if (mode === 'depths') return ['0', '1', '2', '3', 'sponge'].map((d) => one(seed, d));
  const n = mode === 'seeds6' ? 6 : 3;
  return Array.from({ length: n }, (_, k) => one(seed + k, depth));
}

/** @param {any} f */
const depthName = (f) => (f.plan.flavor === 'sponge' ? `The sponge (${F.depths[f.plan.depth].name.toLowerCase()})` : F.depths[f.plan.depth].name);
const ms = (/** @type {number} */ x) => `${Math.round(x)} ms`;

/** One floor's card. @param {any} f @param {any} inputs */
async function card(f, inputs) {
  const el = document.createElement('article');
  el.className = 'card floor';
  const ok = f.check.ok;
  el.innerHTML = `
    <h2>${depthName(f)} <small>seed ${inputs.seed}, trip ${inputs.trip}, floor ${inputs.floor}, level ${inputs.level}</small></h2>
    <div class="facts"><span><b>${f.plan.chambers.length}</b> chambers</span><span><b>${f.mesh.triangles.toLocaleString()}</b> triangles</span>
      <span><b>${ms(f.timing.totalMs)}</b> to make</span><span class="${ok ? 'ok' : 'bad'}"><b>${ok ? 'Walkable end to end' : f.check.reason}</b></span>
      ${f.tries.length > 1 ? `<span><b>${f.tries.length}</b> seeds tried</span>` : ''}</div>
    <div class="tabs"><button data-tab="map" aria-pressed="true">Map</button><button data-tab="level" class="quiet">Field, level</button><button data-tab="section" class="quiet">Field, upright</button></div>
    <canvas class="flat"></canvas>
    <canvas class="view"></canvas>
    <label class="field">Roof cut <input class="cut" type="range" step="0.1"></label>
    <div class="buttons"><button class="quiet top">From above</button><button class="quiet angled">At an angle</button><button class="closer">Look closer</button></div>`;
  $('floors').append(el);
  const flat = /** @type {HTMLCanvasElement} */ (el.querySelector('canvas.flat'));
  let tab = 'map';
  const paint = () => (tab === 'map' ? drawMap(flat, f, F.walk) : tab === 'level' ? drawFieldLevel(flat, f) : drawFieldSection(flat, f));
  paint();
  new ResizeObserver(() => paint()).observe(flat);
  for (const b of el.querySelectorAll('.tabs button')) {
    b.addEventListener('click', () => {
      tab = /** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.tab);
      for (const o of el.querySelectorAll('.tabs button')) { o.setAttribute('aria-pressed', String(o === b)); o.classList.toggle('quiet', o !== b); }
      paint();
    });
  }
  el.querySelector('.closer')?.addEventListener('click', () => closer(f, inputs));
  const view = await hook3d(/** @type {HTMLCanvasElement} */ (el.querySelector('canvas.view')), /** @type {HTMLInputElement} */ (el.querySelector('input.cut')), f);
  if (!view) return;
  view.top();
  el.querySelector('.top')?.addEventListener('click', () => view.top());
  el.querySelector('.angled')?.addEventListener('click', () => view.angled());
}

/**
 * A 3D view on a canvas with its roof cut slider (or a note when there is no WebGPU).
 * @param {HTMLCanvasElement} canvas @param {HTMLInputElement} cut @param {any} f
 */
async function hook3d(canvas, cut, f) {
  const view = await createFloorView(canvas, f.mesh, f.bounds, f.plan.flavor === 'sponge' ? 'sponge' : f.plan.depthId);
  if (!view) { canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No WebGPU here, so no 3D view.' })); return null; }
  // The roof cut starts a little over the highest chamber floor.
  const top = Math.max(...f.plan.chambers.map((/** @type {any} */ c) => c.y));
  cut.min = String(view.cutRange[0]); cut.max = String(view.cutRange[1]); cut.value = String(Math.min(view.cutRange[1], top + 2.2));
  view.setCut(Number(cut.value));
  cut.oninput = () => view.setCut(Number(cut.value));
  return view;
}

/** Show one floor large, at the top of the floors. @param {any} f @param {any} inputs */
async function closer(f, inputs) {
  const box = $('closer');
  box.hidden = false;
  $('closerTitle').textContent = `${depthName(f)}, seed ${inputs.seed}: closer`;
  // A fresh canvas each time, so the old view's listeners go with the old one.
  const old = /** @type {HTMLCanvasElement} */ ($('bigView'));
  const canvas = /** @type {HTMLCanvasElement} */ (old.cloneNode(false));
  old.replaceWith(canvas);
  const view = await hook3d(canvas, /** @type {HTMLInputElement} */ ($('bigCut')), f);
  box.scrollIntoView({ behavior: 'smooth' });
  if (!view) return;
  view.angled();
  $('bigTop').onclick = () => view.top();
  $('bigAngled').onclick = () => view.angled();
  $('bigLow').onclick = () => view.low();
}

/** One floor's table row; the one-thread check fills in when it lands. @param {any} f @param {any} inputs */
function row(f, inputs) {
  const tr = document.createElement('tr');
  const cells = [
    ['Floor', `seed ${inputs.seed}, trip ${inputs.trip}, floor ${inputs.floor}, level ${inputs.level}`],
    ['Depth', depthName(f)],
    ['Chambers', `${f.plan.chambers.length}: ${f.plan.chambers.map((/** @type {any} */ c) => /** @type {any} */ (KINDS)[c.kind].label.toLowerCase()).join(', ')}`],
    ['Triangles', f.mesh.triangles.toLocaleString()],
    ['Field (all cores)', `${ms(f.timing.fieldMs)} on ${poolSize()} workers`],
    ['Mesh and grid', `${ms(f.timing.meshMs)} + ${ms(f.timing.gridMs)}`],
    ['Total', ms(f.timing.totalMs)],
    ['Walkable', f.check.ok ? `<span class="ok">yes, ${Math.round(f.check.reachedShare * 100)}% of the floor reached</span>` : `<span class="bad">${f.check.reason}</span>`],
    ['Seeds tried', f.tries.map((/** @type {any} */ t) => `${t.attempt}: ${t.ok ? 'walkable' : t.reason}`).join('; ')],
    ['Same on one thread', 'checking'],
  ];
  tr.innerHTML = cells.map(([h, v]) => `<td data-h="${h}">${v}</td>`).join('');
  $('rows').append(tr);
  const last = /** @type {HTMLElement} */ (tr.lastElementChild);
  // Started once every floor is made, so it never slows the timings above.
  return () => run({ module: './world/hollow/floor.js', fn: 'floorHashes' }, { inputs, F }).then((h) => {
    const same = h.planHash === f.planHash && h.meshHash === f.meshHash;
    last.innerHTML = same ? `<span class="ok">yes, plan ${f.planHash.toString(16)}, mesh ${f.meshHash.toString(16)}</span>` : `<span class="bad">no: plan ${h.planHash.toString(16)} vs ${f.planHash.toString(16)}, mesh ${h.meshHash.toString(16)} vs ${f.meshHash.toString(16)}</span>`;
  });
}

const make = /** @type {HTMLButtonElement} */ ($('make'));
async function makeAll() {
  make.disabled = true;
  $('floors').replaceChildren(); $('rows').replaceChildren();
  const list = wanted();
  /** @type {(() => Promise<void>)[]} */ const checks = [];
  for (let i = 0; i < list.length; i++) {
    $('status').textContent = `Making floor ${i + 1} of ${list.length}...`;
    const f = await makeFloor(list[i], F, { run, keepField: true });
    await card(f, list[i]);
    checks.push(row(f, list[i]));
  }
  $('status').textContent = `Made ${list.length} floors. Checking each on one thread...`;
  await Promise.all(checks.map((c) => c()));
  $('status').textContent = `Made ${list.length} floors, each checked on one thread.`;
  make.disabled = false;
}
make.addEventListener('click', makeAll);
makeAll();

// Many seeds: every depth and the sponge, floors made but not drawn.
const sweep = /** @type {HTMLButtonElement} */ ($('sweep'));
sweep.addEventListener('click', async () => {
  sweep.disabled = true; make.disabled = true;
  const n = Math.max(1, Number(/** @type {HTMLInputElement} */ ($('sweepN')).value) | 0);
  const base = wanted()[0];
  $('sweepRows').replaceChildren();
  for (const d of ['0', '1', '2', '3', 'sponge']) {
    const tr = document.createElement('tr');
    $('sweepRows').append(tr);
    let first = 0, most = 0, never = 0;
    /** @type {number[]} */ const tris = [], times = [];
    for (let s = 0; s < n; s++) {
      /** @type {any} */ const inputs = { seed: base.seed + s, trip: base.trip, floor: base.floor, level: base.level };
      if (d === 'sponge') { inputs.depth = 1 + (s % 3); inputs.flavor = 'sponge'; } else inputs.depth = Number(d);
      const f = await makeFloor(inputs, F, { run });
      if (f.tries.length === 1) first++;
      if (!f.check.ok) never++;
      most = Math.max(most, f.tries.length);
      tris.push(f.mesh.triangles); times.push(f.timing.totalMs);
      $('status').textContent = `Many seeds: ${d === 'sponge' ? 'the sponge' : F.depths[Number(d)].name.toLowerCase()}, ${s + 1} of ${n}`;
    }
    tris.sort((a, b) => a - b); times.sort((a, b) => a - b);
    const mid = (/** @type {number[]} */ a) => a[a.length >> 1];
    const cells = [
      ['Depth', d === 'sponge' ? 'The sponge (depths 2 to 4)' : F.depths[Number(d)].name], ['Floors', String(n)],
      ['Walkable at the first seed', `${first} of ${n}`], ['Most seeds needed', String(most)],
      ['Never walkable', never ? `<span class="bad">${never}</span>` : '<span class="ok">0</span>'],
      ['Triangles (least, middle, most)', `${tris[0].toLocaleString()}, ${mid(tris).toLocaleString()}, ${tris[n - 1].toLocaleString()}`],
      ['Time, middle', ms(mid(times))],
    ];
    tr.innerHTML = cells.map(([h, v]) => `<td data-h="${h}">${v}</td>`).join('');
  }
  $('status').textContent = `Many seeds: done, ${n} a depth.`;
  sweep.disabled = false; make.disabled = false;
});
