// @ts-check
// Chunk bench (docs 08, 19, docs/future/13 section 3.11): each cost that grows with the island's
// size, on today's island (3 x 3 chunks) and the larger island (4 x 4) side by side. The GPU half runs the real game in a frame (tools/chunk-bench-frame.html), one
// island at a time; the CPU half runs here with no GPU (tools/chunk-bench-cpu.js). Results are drawn
// as bars against doc 19's medium-tier budgets and can be copied as a plain-text table.

import { SIZES } from './chunk-bench-sizes.js';
import { cpuBench } from './chunk-bench-cpu.js';
import { COARSE_ORDER } from '../src/sim/tick.js';

const BUDGET = { gpu: 13, cpuFrame: 8, hour: 15, hourLaptop: 25 };
const FRAME_TIMEOUT_MS = 150000;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(location.search);

/** @typedef {{ gpu?: any, cpu?: any }} SizeResult */
/** @type {Record<string, SizeResult>} */
let results = {};
let ran = { seed: 1, at: '' };

/**
 * @typedef {Object} Metric
 * @property {string} name
 * @property {string} [note]
 * @property {'ms' | 'KB' | 's'} unit
 * @property {(r: SizeResult) => number | undefined} get
 * @property {number} [budget]  a bar over it turns rust
 * @property {number} [soft]    a second, softer line (the laptop hour)
 * @property {string} group     bars in one group share a scale
 * @property {boolean} [optional]  left out when no island has a value
 */

/** @param {SizeResult} r @param {string} label */
const passFrame = (r, label) => r.gpu?.gpu?.passes?.[label]?.perFrame;
const SHADOWS = ['shadow-0', 'shadow-1', 'shadow-2', 'shadow-3'];
const LISTED = ['water-sim', 'water-foam', 'water', 'terrain-wetness', 'opaque', 'flora', ...SHADOWS];

/** @type {Metric[]} */
const TOTALS = [
  { name: 'GPU per frame', note: 'every pass in the frame', unit: 'ms', group: 'gpuTotal', budget: BUDGET.gpu, get: (r) => r.gpu?.gpu?.total },
  { name: 'Main thread per frame', note: 'the app\'s own work each frame', unit: 'ms', group: 'cpuFrame', budget: BUDGET.cpuFrame, get: (r) => r.gpu?.cpuFrame?.mean },
  { name: 'One game hour', note: 'the hourly tick and the journal\'s look', unit: 'ms', group: 'hour', budget: BUDGET.hour, soft: BUDGET.hourLaptop, get: (r) => r.cpu?.tick?.hour?.mean },
];

/** @type {Metric[]} */
const GPU = [
  { name: 'Water sim, flux and depth', note: 'one compute pass, every step of the frame (src/world/water/sim.js)', unit: 'ms', group: 'gpu', get: (r) => passFrame(r, 'water-sim') },
  { name: 'Foam', note: 'src/world/water/foam.js', unit: 'ms', group: 'gpu', get: (r) => passFrame(r, 'water-foam') },
  { name: 'Water surface draw', note: 'src/render/passes/water.js', unit: 'ms', group: 'gpu', get: (r) => passFrame(r, 'water') },
  { name: 'Wetness, one run', note: 'runs now and then, not every frame (src/world/terrain/wetness.js)', unit: 'ms', group: 'gpu', get: (r) => r.gpu?.gpu?.passes?.['terrain-wetness']?.perRun },
  { name: 'Terrain, opaque pass', note: 'src/render/passes/terrain.js', unit: 'ms', group: 'gpu', get: (r) => passFrame(r, 'opaque') },
  ...SHADOWS.map((label, i) => /** @type {Metric} */ ({ name: `Shadow cascade ${i + 1}`, note: 'src/render/passes/shadow.js', unit: 'ms', group: 'gpu', optional: true, get: (r) => passFrame(r, label) })),
  { name: 'Shadows, all cascades', unit: 'ms', group: 'gpu', get: (r) => {
    if (!r.gpu?.timestamps) return undefined;
    return SHADOWS.reduce((s, l) => s + (passFrame(r, l) ?? 0), 0);
  } },
  { name: 'Flora', note: 'src/render/passes/flora.js', unit: 'ms', group: 'gpu', get: (r) => passFrame(r, 'flora') },
  { name: 'Everything else', note: 'sky, grass, creatures, post and the rest', unit: 'ms', group: 'gpu', get: (r) => {
    const g = r.gpu?.gpu;
    if (!g || !r.gpu?.timestamps) return undefined;
    return g.total - LISTED.reduce((s, l) => s + (g.passes[l]?.perFrame ?? 0), 0);
  } },
];

/** @type {Record<string, string>} */
const STEP_NAMES = { tide: 'Tide', weather: 'Weather', seasons: 'Seasons', growth: 'Growth', ecology: 'Ecology', creatures: 'Creatures', swarms: 'Schools and swarms' };
/** @type {Record<string, string>} */
const STEP_NOTES = {
  growth: 'grass cover and plants on the 192 x 192 grid',
  ecology: 'chamfer, shelter, plant field, pools and pond fit',
  creatures: 'frogs arriving, settling, leaving',
  swarms: 'minnows, dragonflies, damselflies',
};
/** @type {Metric[]} */
const TICK = [
  ...COARSE_ORDER.map((s) => /** @type {Metric} */ ({ name: STEP_NAMES[s.id] ?? s.id, note: STEP_NOTES[s.id], unit: 'ms', group: 'tick', get: (r) => r.cpu?.tick?.steps?.[s.id]?.mean })),
  { name: 'Journal look', note: 'its scans of the island after the tick', unit: 'ms', group: 'tick', get: (r) => r.cpu?.tick?.journal?.mean },
];

/** @type {Metric[]} */
const CPU = [
  { name: 'Water summary rebuild', note: 'src/world/water/summary.js, after a stroke and once a game day', unit: 'ms', group: 'summary', get: (r) => r.cpu?.summaryMs?.mean },
  { name: 'Building a new island without the GPU', note: 'landform, water summary and habitat (src/world/island-model.js)', unit: 'ms', group: 'build', get: (r) => r.cpu?.buildMs },
  { name: 'One 24-hour catch-up block, on the page', note: 'src/sim/catchup.js', unit: 'ms', group: 'catchup', get: (r) => r.cpu?.catchUp?.pageMs },
  { name: 'The same block in a worker', note: 'as the game runs it, with copying the island in and out', unit: 'ms', group: 'catchup', get: (r) => r.cpu?.catchUp?.workerMs },
];

/** @type {Metric[]} */
const SAVE = [
  { name: 'World section, raw', note: 'the hourly tick\'s state after one game day (src/save/sections.js)', unit: 'KB', group: 'kb', get: (r) => r.cpu ? r.cpu.save.worldRaw / 1024 : undefined },
  { name: 'World section, gzipped', unit: 'KB', group: 'kb', get: (r) => r.cpu ? r.cpu.save.worldGz / 1024 : undefined },
  { name: 'Whole save file', note: 'every section, gzipped, no chunk edited yet', unit: 'KB', group: 'kb', get: (r) => r.cpu ? r.cpu.save.fileBytes / 1024 : undefined },
  { name: 'If every open chunk were edited', note: 'each edited chunk adds 96 KB of heights and paint before gzip', unit: 'KB', group: 'kbChunks', get: (r) => r.cpu ? (r.cpu.save.chunks * r.cpu.save.editedChunkRaw) / 1024 : undefined },
];

// ---------------------------------------------------------------------------
// Drawing

/** @param {number | undefined} v @param {string} unit */
function fmt(v, unit) {
  if (v === undefined || !Number.isFinite(v)) return '-';
  if (unit === 'KB') return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} KB`;
  if (unit === 's') return `${v.toFixed(2)} s`;
  return v >= 100 ? `${v.toFixed(0)} ms` : `${v.toFixed(2)} ms`;
}

/** @param {Metric[]} list */
function scales(list) {
  /** @type {Record<string, number>} */ const out = {};
  for (const m of list) {
    for (const s of SIZES) {
      const v = m.get(results[s.id] ?? {});
      const top = Math.max(Number.isFinite(v) ? /** @type {number} */ (v) : 0, m.budget ?? 0, m.soft ?? 0);
      out[m.group] = Math.max(out[m.group] ?? 0, top);
    }
  }
  for (const k of Object.keys(out)) out[k] = (out[k] || 1) * 1.08;
  return out;
}

/** @param {string} id @param {Metric[]} list */
function draw(id, list) {
  const sc = scales(list);
  const visible = list.filter((m) => !m.optional || SIZES.some((s) => Number.isFinite(m.get(results[s.id] ?? {}))));
  $(id).innerHTML = visible.map((m) => {
    const rows = SIZES.map((s) => {
      const v = m.get(results[s.id] ?? {});
      const ok = v !== undefined && Number.isFinite(v);
      const w = ok ? Math.max(0, Math.min(100, (/** @type {number} */ (v) / sc[m.group]) * 100)) : 0;
      const over = ok && m.budget !== undefined && /** @type {number} */ (v) > m.budget;
      const marks = [
        m.budget !== undefined ? `<i class="mark" style="left:${((m.budget / sc[m.group]) * 100).toFixed(1)}%"></i>` : '',
        m.soft !== undefined ? `<i class="mark soft" style="left:${((m.soft / sc[m.group]) * 100).toFixed(1)}%"></i>` : '',
      ].join('');
      return `<div class="brow"><span class="tag">${s.name}</span><div class="track">` +
        (ok ? `<div class="fill${over ? ' over' : ''}" style="width:${w.toFixed(1)}%;background:${s.color}"></div>` : '') +
        `${marks}</div><span class="val${ok ? '' : ' none'}">${ok ? fmt(v, m.unit) : 'waiting'}</span></div>`;
    }).join('');
    return `<div class="metric"><div class="mhead"><span class="mname">${m.name}</span>${m.note ? `<span class="mnote">${m.note}</span>` : ''}</div>${rows}</div>`;
  }).join('');
}

function drawAll() {
  draw('totals', TOTALS);
  draw('gpu', GPU);
  draw('tick', TICK);
  draw('cpu', CPU);
  draw('save', SAVE);
  $('others').textContent = othersText() || 'Waiting for the first run.';
  const any = SIZES.some((s) => results[s.id]?.gpu || results[s.id]?.cpu);
  /** @type {HTMLButtonElement} */ ($('copy')).disabled = !any;
}

function legend() {
  $('legend').innerHTML = SIZES.map((s) => `<span><i style="background:${s.color}"></i>${s.title}, ${s.name} chunks, ${s.meters} m</span>`).join('') +
    '<span><i class="budget"></i>budget</span>';
}

// ---------------------------------------------------------------------------
// Plain text

/** @param {string} s @param {number} n */
const pad = (s, n) => (s.length >= n ? `${s} ` : s + ' '.repeat(n - s.length));
/** @param {string} s @param {number} n */
const padL = (s, n) => (s.length >= n ? ` ${s}` : ' '.repeat(n - s.length) + s);

/** Every pass label that is not on its own row, per island, per frame. */
function othersText() {
  /** @type {Set<string>} */ const labels = new Set();
  for (const s of SIZES) for (const l of Object.keys(results[s.id]?.gpu?.gpu?.passes ?? {})) if (!LISTED.includes(l)) labels.add(l);
  if (!labels.size) return '';
  const head = pad('pass, ms per frame', 30) + SIZES.map((s) => padL(s.name, 10)).join('');
  const lines = [...labels].sort().map((l) => pad(l, 30) + SIZES.map((s) => padL(fmt(results[s.id]?.gpu?.gpu?.passes?.[l]?.perFrame, 'ms').replace(' ms', ''), 10)).join(''));
  return [head, ...lines].join('\n');
}

function resultsText() {
  const first = SIZES.map((s) => results[s.id]?.gpu).find(Boolean);
  const out = [
    `ebb chunk bench, seed ${ran.seed}, ${ran.at}`,
    first ? `GPU: ${first.adapter}. Tier ${first.tier}, render ${first.renderSize.join(' x ')}. Timestamps: ${first.timestamps ? 'yes, pass by pass' : 'no, whole frame only (submit to work done)'}.` : 'GPU: not measured.',
    `Budgets (doc 19, medium): GPU ${BUDGET.gpu} ms and main thread ${BUDGET.cpuFrame} ms per frame; one game hour ${BUDGET.hour} ms desktop, ${BUDGET.hourLaptop} ms laptop.`,
    '',
    pad('', 46) + SIZES.map((s) => padL(`${s.name} (${s.meters} m)`, 16)).join(''),
  ];
  /** @param {string} title @param {Metric[]} list */
  const section = (title, list) => {
    out.push(title);
    for (const m of list) {
      const vals = SIZES.map((s) => m.get(results[s.id] ?? {}));
      if (m.optional && !vals.some((v) => Number.isFinite(v))) continue;
      out.push(pad(`  ${m.name}`, 46) + vals.map((v) => padL(fmt(v, m.unit), 16)).join(''));
    }
  };
  section('Totals', TOTALS);
  section('GPU, ms per frame', GPU);
  section('One game hour, ms', TICK);
  section('Rebuilds and catch-up', CPU);
  section('Save', SAVE);
  const sizes = SIZES.map((s) => {
    const g = results[s.id]?.gpu, c = results[s.id]?.cpu;
    return `${s.name}: water rect ${g?.waterRect ? `${g.waterRect.w} x ${g.waterRect.h}` : c?.rect ? `${c.rect.w} x ${c.rect.h}` : '-'} cells, ${g?.gpu?.frames ?? '-'} frames timed, ${c?.tick?.plants ?? '-'} plants after the day`;
  });
  out.push('', ...sizes);
  const others = othersText();
  if (others) out.push('', others);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// The run

/** @param {string} text */
const say = (text) => { $('status').textContent = text; };

/** @param {HTMLIFrameElement} frame */
function fitFrame(frame) {
  const stage = $('stage');
  const fit = () => { frame.style.transform = `scale(${stage.clientWidth / 1280})`; };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  return () => ro.disconnect();
}

/**
 * The GPU half for one island: the game in a frame until it posts its numbers.
 * @param {import('./chunk-bench-sizes.js').BenchSize} size @param {number} seed
 */
function runFrame(size, seed) {
  return new Promise((resolve, reject) => {
    const stage = $('stage');
    stage.innerHTML = '';
    const frame = document.createElement('iframe');
    const q = new URLSearchParams({ size: size.id, seed: String(seed), tier: params.get('tier') ?? 'medium' });
    for (const k of ['frames', 'settle']) { const v = params.get(k); if (v) q.set(k, v); }
    frame.src = `chunk-bench-frame.html?${q}`;
    frame.title = size.title;
    stage.appendChild(frame);
    const unfit = fitFrame(frame);
    const done = () => { clearTimeout(timer); removeEventListener('message', onMessage); unfit(); };
    const timer = setTimeout(() => { done(); reject(new Error(`${size.title} did not finish in ${FRAME_TIMEOUT_MS / 1000} s`)); }, FRAME_TIMEOUT_MS);
    /** @param {MessageEvent} e */
    function onMessage(e) {
      if (e.source !== frame.contentWindow || e.data?.source !== 'chunk-bench') return;
      if (e.data.type === 'progress') say(e.data.text);
      else if (e.data.type === 'result') { done(); resolve(e.data); }
      else if (e.data.type === 'error') { done(); reject(new Error(e.data.message)); }
    }
    addEventListener('message', onMessage);
  });
}

async function runAll() {
  const go = /** @type {HTMLButtonElement} */ ($('go'));
  const seedInput = /** @type {HTMLInputElement} */ ($('seed'));
  const seed = Math.floor(Math.abs(Number(seedInput.value) || 0)) >>> 0;
  seedInput.value = String(seed);
  go.disabled = true;
  results = {};
  ran = { seed, at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
  drawAll();
  /** @type {string[]} */ const problems = [];
  try {
    for (const s of SIZES) {
      results[s.id] = {};
      try {
        results[s.id].gpu = await runFrame(s, seed);
        const g = results[s.id].gpu;
        $('device').textContent = `GPU: ${g.adapter}. Tier ${g.tier}, render ${g.renderSize.join(' x ')} pixels. ` +
          (g.timestamps ? 'Timestamps: yes, so every pass is timed on its own.' : 'Timestamps: not available here, so only the whole frame is timed (submit to work done).');
      } catch (e) {
        console.error('[chunk-bench]', e);
        problems.push(`${s.title}, GPU: ${e instanceof Error ? e.message : String(e)}`);
      }
      drawAll();
    }
    $('stage').innerHTML = '<p>The GPU half is done. The hours now run without the GPU.</p>';
    for (const s of SIZES) {
      try {
        results[s.id].cpu = await cpuBench(s, seed, say);
      } catch (e) {
        console.error('[chunk-bench]', e);
        problems.push(`${s.title}, CPU: ${e instanceof Error ? e.message : String(e)}`);
      }
      drawAll();
    }
    say(problems.length ? `Finished, but some parts did not run: ${problems.join('; ')}` : 'Finished. Copy results gives the same numbers as a plain-text table.');
  } finally {
    go.disabled = false;
  }
}

$('go').addEventListener('click', runAll);
$('copy').addEventListener('click', async () => {
  const text = resultsText();
  try {
    await navigator.clipboard.writeText(text);
    say('Results copied.');
  } catch {
    $('others').textContent = text;
    /** @type {HTMLDetailsElement} */ ($('others').parentElement).open = true;
    say('The browser would not copy, so the table is shown under Every other pass.');
  }
});
legend();
drawAll();
say('Ready. Press Run the bench.');
if (params.has('run')) runAll();
// For tools pages that read the numbers (and for checking this page): the latest results and text.
/** @type {any} */ (window).chunkBench = { results: () => results, text: resultsText };
