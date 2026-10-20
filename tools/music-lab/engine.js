// @ts-check
// Music lab, Engine tab (doc 24, "The development engine"; phase 4a): grow a piece from the spring
// material by seed and hear it. In 4a the engine grows the harmony only: a form template, a walk
// through the chord grammar, the best few of many candidates kept and one chosen by the seed. The
// chord chart shows every bar's chord, how tense it is against what the template asked for, and the
// cadence each phrase lands. The sliders change the rules live; Save settings downloads them as
// recipes/music/develop.json to send back.

import { grow } from '../../src/audio/music/develop/index.js';
import { realize } from '../../src/audio/music/realize.js';
import { dayColorAt } from '../../src/audio/music/daycolor.js';
import { createNotation } from './notation.js';
import { createPianoRoll } from './pianoroll.js';
import { createStage, loadJson, loadMusicRecipes, sunLabel } from './perform-ui.js';

const SLOTS = /** @type {const} */ ([['morning', 'Morning', 20], ['interlude', 'Interlude', 35], ['evening', 'Evening', 6]]);
const WEATHER = /** @type {const} */ ([['clear', 'Clear'], ['rain', 'Rain'], ['mist', 'Mist']]);
const CADENCE_NAMES = /** @type {Record<string, string>} */ ({
  plagal: 'Plagal, IV to I', modal: 'Modal, flat seven to I', 'ii-I': 'ii to I', deceptive: 'Deceptive, to vi', half: 'Half, ending on V',
});
const SHORT_CAD = /** @type {Record<string, string>} */ ({ plagal: 'plagal', modal: 'modal', 'ii-I': 'ii to I', deceptive: 'deceptive', half: 'half' });
const TERM_NAMES = /** @type {Record<string, string>} */ ({
  variety: 'variety', tensionFit: 'follows the curve', repeatWindow: 'loops', stuck: 'stuck on a chord', colorCrowd: 'too many colors', forced: 'forced cadence',
});

/** A tension 0..1 as a fill, cool to warm. @param {number} t */
function tensionFill(t) {
  const k = Math.max(0, Math.min(1, t / 0.7));
  const a = [220, 232, 228], b = [242, 196, 152];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * @param {HTMLElement} host the Engine tab's section
 * @param {{mixer: any}} env
 */
export async function initEngine(host, env) {
  const [{ director, recipes }, material, rules0, names] = await Promise.all([
    loadMusicRecipes(), loadJson('recipes/music/material/spring.json'), loadJson('recipes/music/develop.json'), loadJson('recipes/music/names.json'),
  ]);
  /** @type {any} */
  const rules = structuredClone(rules0);
  const url = new URL(location.href);
  let slot = url.searchParams.get('eslot') ?? 'interlude';
  let weather = url.searchParams.get('eweather') ?? 'clear';

  const sliders = [
    ['tensionFollow', 'Follow the tension curve', 0, 6, 0.5, (/** @type {number} */ v) => v.toFixed(1)],
    ['colorAmount', 'Color chords', 0, 2, 0.1, (/** @type {number} */ v) => `${Math.round(v * 100)}%`],
    ['hold', 'Hold a chord another bar', 0, 3, 0.1, (/** @type {number} */ v) => `${v.toFixed(1)}x`],
    ['splitLast', 'Two chords in the bar before a cadence', 0, 1, 0.05, (/** @type {number} */ v) => `${Math.round(v * 100)}%`],
  ];

  host.innerHTML = `
    <div class="card">
      <h2>Engine</h2>
      <p class="muted">The development engine grows a piece from spring's material. In this first step it grows the harmony only: you hear the chords on the left hand with the string bed, and no melody yet. The same seed always grows the same piece and the same name.</p>
      <div class="grid2">
        <div>
          <h3>Slot</h3>
          <div class="seg" role="group" aria-label="Slot" id="en-slots">${SLOTS.map(([id, label]) => `<button data-slot="${id}">${label}</button>`).join('')}</div>
          <h3>Weather</h3>
          <div class="seg" role="group" aria-label="Weather" id="en-weather">${WEATHER.map(([id, label]) => `<button data-weather="${id}">${label}</button>`).join('')}</div>
        </div>
        <div>
          <h3>Seed</h3>
          <div class="row"><input id="en-seed" inputmode="numeric" aria-label="Seed" style="font:800 19px Nunito,sans-serif;width:7em;max-width:100%;padding:10px;border-radius:12px;border:1px solid #CFC3AF;background:#FFFDF8">
            <button id="en-prev" style="flex:1 1 100px">Previous</button>
            <button id="en-next" style="flex:1 1 100px">Next</button></div>
          <div class="row" style="margin-top:10px">
            <button class="big" id="en-play" style="flex:1 1 140px">Play</button>
            <button id="en-run" style="flex:1 1 180px">Play seeds in a row</button>
            <button id="en-stop" style="flex:1 1 100px">Stop</button>
          </div>
          <p class="muted" id="en-status" role="status"></p>
        </div>
      </div>
    </div>
    <div class="card">
      <h2 id="en-title"></h2>
      <div class="tiles" id="en-facts"></div>
      <h3>Chords, phrase by phrase</h3>
      <p class="muted">Each box is a bar. Its color is how tense the chord feels, cool to warm. In the strip along the bottom, the filled part is the chord's tension and the dark mark is what the template asked for there.</p>
      <div id="en-chart" class="en-chart"></div>
      <div class="row" style="margin-top:10px"><button id="en-copy" style="flex:0 1 auto">Copy a note about this seed</button><span class="muted" id="en-copied" role="status"></span></div>
    </div>
    <div class="grid2">
      <div class="card">
        <h2>Harmony</h2>
        ${sliders.map(([k, label, min, max, step]) => `<label class="slider"><span>${label}</span><input type="range" data-h="${k}" min="${min}" max="${max}" step="${step}"><output data-h-out="${k}"></output></label>`).join('')}
        <h3>Cadences</h3>
        <p class="muted">How often each kind of ending is chosen, wherever a template offers it. At zero it never appears.</p>
        ${Object.keys(CADENCE_NAMES).map((c) => `<label class="slider"><span>${CADENCE_NAMES[c]}</span><input type="range" data-cad="${c}" min="0" max="3" step="0.1"><output data-cad-out="${c}"></output></label>`).join('')}
        <div class="row" style="margin-top:10px">
          <button id="en-save" style="flex:1 1 160px">Save settings</button>
          <button id="en-reset" style="flex:1 1 120px">Reset</button>
        </div>
        <p class="muted">Save settings downloads the rules as a file (develop.json) for you to send me.</p>
      </div>
      <div class="card">
        <h2>Candidates</h2>
        <p class="muted" id="en-cand-note"></p>
        <div id="en-cands"></div>
        <h3>Why the chosen one scored as it did</h3>
        <div class="tiles" id="en-terms"></div>
      </div>
    </div>
    <div class="card">
      <h3>Piano roll</h3>
      <div id="en-roll"></div>
      <h3>Sheet music</h3>
      <div id="en-notation"></div>
    </div>`;

  const $ = (/** @type {string} */ id) => /** @type {any} */ (host.querySelector(`#${id}`));
  const roll = createPianoRoll($('en-roll'));
  const notation = createNotation($('en-notation'));
  const stage = createStage(env, recipes, { roll, notation, status: (t) => { $('en-status').textContent = t; } });
  $('en-seed').value = url.searchParams.get('eseed') ?? '1';
  $('en-status').textContent = 'Press Play to hear this seed.';
  let running = false;
  /** @type {any} */
  let grown = null;

  const seed = () => (Number($('en-seed').value) >>> 0) || 1;
  const sun = () => SLOTS.find((s) => s[0] === slot)?.[2] ?? 30;

  function syncControls() {
    for (const b of host.querySelectorAll('[data-slot]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-slot') === slot));
    for (const b of host.querySelectorAll('[data-weather]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-weather') === weather));
    for (const [k, , , , , fmt] of sliders) {
      const v = rules.harmony[/** @type {string} */ (k)];
      /** @type {HTMLInputElement} */ (host.querySelector(`[data-h="${k}"]`)).value = String(v);
      /** @type {HTMLElement} */ (host.querySelector(`[data-h-out="${k}"]`)).textContent = /** @type {any} */ (fmt)(v);
    }
    for (const c of Object.keys(CADENCE_NAMES)) {
      const v = rules.harmony.cadenceWeights[c] ?? 1;
      /** @type {HTMLInputElement} */ (host.querySelector(`[data-cad="${c}"]`)).value = String(v);
      /** @type {HTMLElement} */ (host.querySelector(`[data-cad-out="${c}"]`)).textContent = `${v.toFixed(1)}x`;
    }
  }

  function save() {
    const u = new URL(location.href);
    u.searchParams.set('eslot', slot);
    u.searchParams.set('eweather', weather);
    u.searchParams.set('eseed', String(seed()));
    u.hash = 'engine';
    history.replaceState(null, '', u);
  }

  function perform() {
    const dayColor = dayColorAt(sun(), director.dayColor);
    return { p: realize(grown.piece, { seed: seed(), dayColor, available: stage.available() }, recipes), dayColor };
  }

  function chart() {
    const rep = grown.piece.grown.report;
    let barNo = 0;
    $('en-chart').innerHTML = rep.plan.map((/** @type {any} */ ph, /** @type {number} */ i) => {
      const bars = rep.bars.filter((/** @type {any} */ b) => b.phrase === i);
      const cells = bars.map((/** @type {any} */ b) => {
        barNo++;
        const main = b.chords[0];
        const two = b.chords.length > 1;
        const sym = b.chords.map((/** @type {any} */ c) => esc(c.symbol)).join(' <span class="en-then">then</span> ');
        const rom = b.held ? 'held' : b.chords.map((/** @type {any} */ c) => esc(c.place)).join(', ');
        const tens = b.chords.reduce((s, /** @type {any} */ c) => s + c.tension, 0) / b.chords.length;
        return `<div class="en-bar${b.cadence ? ' en-cad' : ''}" style="background:${tensionFill(two ? tens : main.tension)}">
          <span class="en-no">${barNo}</span><b>${sym}</b><span class="en-rom">${rom}</span>
          <span class="en-meter" aria-label="tension ${tens.toFixed(2)}, aim ${b.target.toFixed(2)}"><i style="width:${Math.round(tens * 100)}%"></i><em style="left:${Math.round(b.target * 100)}%"></em></span>
        </div>`;
      }).join('');
      return `<div class="en-phrase"><div class="en-ph-head"><b>${i + 1}. ${esc(ph.role)}</b><span>${ph.bars} bars, ends ${esc(SHORT_CAD[ph.cadence] ?? ph.cadence)}</span></div><div class="en-bars">${cells}</div></div>`;
    }).join('') + `<div class="en-phrase"><div class="en-ph-head"><b>Coda</b><span>${material.coda.length} bars, the short close</span></div><div class="en-bars">${material.coda.map((/** @type {string} */ p) => `<div class="en-bar" style="background:${tensionFill(material.chords[p].tension)}"><span class="en-no">${++barNo}</span><b>${esc(material.chords[p].symbol)}</b><span class="en-rom">${esc(p)}</span></div>`).join('')}</div></div>`;
  }

  function candidates() {
    const c = grown.candidates;
    const keep = Math.max(1, rules.keepBest ?? 4);
    const ok = c.filter((/** @type {any} */ x) => x.total > -Infinity);
    const hi = Math.max(...ok.map((/** @type {any} */ x) => x.total), 0.01), lo = Math.min(...ok.map((/** @type {any} */ x) => x.total), 0);
    const W = 480, H = 130, bw = W / c.length;
    const bars = c.map((/** @type {any} */ x, /** @type {number} */ i) => {
      const banned = x.total === -Infinity;
      const h = banned ? 6 : 10 + ((x.total - lo) / Math.max(1e-6, hi - lo)) * (H - 40);
      const fill = i === grown.chosen ? '#4a6a47' : i < keep && !banned ? '#8DAE80' : banned ? '#C9877B' : '#CFC3AF';
      return `<rect x="${(i * bw + 2).toFixed(1)}" y="${(H - 20 - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${fill}"/>`;
    }).join('');
    $('en-cands').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Candidate scores, best first">${bars}<text x="0" y="${H - 4}">best</text><text x="${W}" y="${H - 4}" text-anchor="end">worst</text></svg>`;
    const banned = c.filter((/** @type {any} */ x) => x.banned).length;
    $('en-cand-note').textContent = `${c.length} progressions grown for this seed, best first. The light green ones are the best ${keep}; the seed chose the dark one (number ${grown.chosen + 1}).${banned ? ` ${banned} were ruled out as a plain loop (red).` : ''}`;
    const t = grown.piece.grown.report.judged.terms;
    $('en-terms').innerHTML = Object.entries(t).map(([k, v]) => `<div class="tile"><b style="font-size:19px">${(/** @type {number} */ (v) >= 0 ? '+' : '')}${/** @type {number} */ (v).toFixed(2)}</b><span>${TERM_NAMES[k] ?? k}</span></div>`).join('');
  }

  function refresh() {
    grown = grow(material, rules, { slot, weather, seed: seed() }, names);
    const pc = grown.piece;
    const { p } = perform();
    roll.setPerformance(p);
    notation.render(p.abc);
    $('en-title').textContent = pc.title;
    const tmpl = material.templates[pc.grown.template]?.name ?? pc.grown.template;
    $('en-facts').innerHTML = [
      [tmpl, 'template'], [pc.meter, 'meter'], [`${Math.round(p.bpm)}`, 'beats a minute'], [p.key, 'key'],
      [`${grown.piece.sections ? Object.values(grown.piece.sections).reduce((s, x) => s + /** @type {any} */ (x).bars, 0) : 0}`, 'bars'], [`${p.durationS.toFixed(0)} s`, 'length'],
    ].map(([b, s]) => `<div class="tile"><b style="font-size:19px">${esc(String(b))}</b><span>${s}</span></div>`).join('');
    chart();
    candidates();
    $('en-copied').textContent = '';
    save();
  }

  /** @returns {Promise<void>} */
  async function play() {
    const ticket = await stage.begin();
    const { p, dayColor } = perform();
    roll.setPerformance(p);
    return stage.play(ticket, grown.piece, p, { seed: seed(), dayColor, label: `"${grown.piece.title}", seed ${seed()} (${sunLabel(sun(), director)})` });
  }

  host.querySelector('#en-slots')?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-slot]');
    if (b) { slot = /** @type {string} */ (b.getAttribute('data-slot')); syncControls(); refresh(); }
  });
  host.querySelector('#en-weather')?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-weather]');
    if (b) { weather = /** @type {string} */ (b.getAttribute('data-weather')); syncControls(); refresh(); }
  });
  for (const el of host.querySelectorAll('[data-h]')) el.addEventListener('input', () => {
    rules.harmony[/** @type {string} */ (el.getAttribute('data-h'))] = Number(/** @type {HTMLInputElement} */ (el).value);
    syncControls(); refresh();
  });
  for (const el of host.querySelectorAll('[data-cad]')) el.addEventListener('input', () => {
    rules.harmony.cadenceWeights[/** @type {string} */ (el.getAttribute('data-cad'))] = Number(/** @type {HTMLInputElement} */ (el).value);
    syncControls(); refresh();
  });
  $('en-seed').addEventListener('change', refresh);
  $('en-prev').addEventListener('click', () => { $('en-seed').value = String(Math.max(1, seed() - 1)); refresh(); });
  $('en-next').addEventListener('click', () => { $('en-seed').value = String(seed() + 1); refresh(); });
  $('en-play').addEventListener('click', () => { running = false; play(); });
  $('en-stop').addEventListener('click', () => { running = false; stage.stop(0.3); });
  $('en-run').addEventListener('click', async () => {
    running = true;
    const first = seed();
    while (running) {
      await play();
      if (!running) break;
      $('en-status').textContent = `Seed ${seed()} finished. The next seed starts in a moment.`;
      await new Promise((r) => setTimeout(r, 2500));
      if (!running) break;
      $('en-seed').value = String(seed() + 1);
      refresh();
      if (seed() >= first + 19) running = false; // twenty seeds, then stop
    }
  });
  $('en-save').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(rules, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'develop.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('en-reset').addEventListener('click', () => { Object.assign(rules, structuredClone(rules0)); syncControls(); refresh(); });
  $('en-copy').addEventListener('click', async () => {
    const rep = grown.piece.grown.report;
    const chords = rep.plan.map((/** @type {any} */ _, /** @type {number} */ i) => rep.bars.filter((/** @type {any} */ b) => b.phrase === i).map((/** @type {any} */ b) => b.chords.map((/** @type {any} */ c) => c.symbol).join(' then ')).join(', ')).join(' / ');
    const text = `Engine, spring ${slot}${weather === 'clear' ? '' : `, ${weather}`}, seed ${seed()} ("${grown.piece.title}"): ${chords}. My note: `;
    try { await navigator.clipboard.writeText(text); $('en-copied').textContent = 'Copied. Paste it into your message and add your note.'; } catch { $('en-copied').textContent = text; }
  });

  syncControls();
  refresh();
}
