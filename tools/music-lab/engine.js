// @ts-check
// Music lab, Engine tab (doc 24, "The development engine"; phases 4a and 4b): grow a piece from a
// season's material (spring or summer) by seed and hear it: a form template, a walk through the
// chord grammar, the best few of many candidates kept and one chosen by the seed; then, for most
// pieces, a melody grown from the season's motifs and fitted to the chords (4b). The chord chart
// shows every bar's chord, how tense it is against what the template asked for, and the cadence each
// phrase lands; the melody strip colors every note by its job. The sliders change the rules live;
// Save settings downloads them as recipes/music/develop.json to send back.

import { grow } from '../../src/audio/music/develop/index.js';
import { realize } from '../../src/audio/music/realize.js';
import { dayColorAt } from '../../src/audio/music/daycolor.js';
import { createNotation } from './notation.js';
import { createPianoRoll } from './pianoroll.js';
import { createStage, loadJson, loadMusicRecipes, sunLabel } from './perform-ui.js';

const SLOTS = /** @type {const} */ ([['morning', 'Morning', 20], ['interlude', 'Interlude', 35], ['evening', 'Evening', 6], ['nocturne', 'Nocturne', -20]]);
/** Seasons with written material (recipes/music/material/<id>.json). */
const SEASONS = /** @type {const} */ ([['spring', 'Spring'], ['summer', 'Summer']]);
const WEATHER = /** @type {const} */ ([['clear', 'Clear'], ['rain', 'Rain'], ['mist', 'Mist']]);
/** Melody: as the game decides (melody.chance), always, or never. */
const SING = /** @type {const} */ ([['game', 'As the game'], ['always', 'Always'], ['never', 'Never']]);
const TECH_NAMES = /** @type {Record<string, string>} */ ({
  return: 'Return, the motif again', sequence: 'Sequence, moved by steps', fragment: 'Fragment, its head or tail', extension: 'Extension, carried on',
  augmentation: 'Augmentation, twice as slow', inversion: 'Inversion, upside down', displacement: 'Displacement, a beat later', diminution: 'Diminution, twice as fast',
});
/** Each note's job, its color in the melody strip and its name. */
const JOBS = /** @type {[string, string, string][]} */ ([['motif', '#7F77DD', 'motif'], ['return', '#AFA9EC', 'motif brought back'], ['development', '#1D9E75', 'development'], ['chord', '#5DCAA5', 'bent onto the chord'], ['passing', '#B4B2A9', 'passing tone'], ['suspension', '#EF9F27', 'suspension'], ['goal', '#D85A30', 'goal note'], ['counter', '#D4537E', 'counter-line']]);
const MEL_TERMS = /** @type {Record<string, string>} */ ({
  leaps: 'leaps not stepped back from', repeats: 'notes repeated', steps: 'mostly steps', rhythm: 'a few note lengths', range: 'range over a tenth', highPoints: 'one high point a phrase', motifShare: 'half motif, half development', tension: 'peaks follow the curve', frogBand: 'clear of the frogs', parallels: 'fifths with the bass',
});
const CADENCE_NAMES = /** @type {Record<string, string>} */ ({
  plagal: 'Plagal, IV to I', modal: 'Modal, flat seven to I', 'ii-I': 'ii to I', deceptive: 'Deceptive, to vi', half: 'Half, ending on V',
});
const SHORT_CAD = /** @type {Record<string, string>} */ ({ plagal: 'plagal', modal: 'modal', 'ii-I': 'ii to I', deceptive: 'deceptive', half: 'half' });
const TERM_NAMES = /** @type {Record<string, string>} */ ({
  variety: 'variety', tensionFit: 'follows the curve', repeatWindow: 'loops', stuck: 'stuck on a chord', colorCrowd: 'too many colors', roughReturn: 'rough return', forced: 'forced cadence',
});

/** A tension 0..1 as a fill, cool to warm. @param {number} t */
function tensionFill(t) {
  const k = Math.max(0, Math.min(1, t / 0.7));
  const a = [220, 232, 228], b = [242, 196, 152];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;
}

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** A chord symbol as a player reads it: "Dsus2" is written D2. @param {string} s */
const show = (s) => esc(s.replace(/sus2/g, '2'));

/**
 * @param {HTMLElement} host the Engine tab's section
 * @param {{mixer: any}} env
 */
export async function initEngine(host, env) {
  const [{ director, recipes }, rules0, names, ...mats] = await Promise.all([
    loadMusicRecipes(), loadJson('recipes/music/develop.json'), loadJson('recipes/music/names.json'),
    ...SEASONS.map(([id]) => loadJson(`recipes/music/material/${id}.json`)),
  ]);
  /** @type {Record<string, any>} */
  const materials = Object.fromEntries(SEASONS.map(([id], i) => [id, mats[i]]));
  /** @type {any} */
  const rules = structuredClone(rules0);
  const url = new URL(location.href);
  let slot = url.searchParams.get('eslot') ?? 'interlude';
  let weather = url.searchParams.get('eweather') ?? 'clear';
  let season = materials[url.searchParams.get('eseason') ?? ''] ? /** @type {string} */ (url.searchParams.get('eseason')) : 'spring';
  let material = materials[season];
  let sing = url.searchParams.get('esing') ?? 'game';

  const sliders = [
    ['tensionFollow', 'Follow the tension curve', 0, 6, 0.5, (/** @type {number} */ v) => v.toFixed(1)],
    ['colorAmount', 'Color chords', 0, 2, 0.1, (/** @type {number} */ v) => `${Math.round(v * 100)}%`],
    ['borrowedAmount', 'Borrowed chords (flat six, minor iv)', 0, 3, 0.1, (/** @type {number} */ v) => `${Math.round(v * 100)}%`],
    ['pairPull', 'Seconds answer each other (D2 and G2)', 1, 6, 0.5, (/** @type {number} */ v) => `${v.toFixed(1)}x`],
    ['rockChance', 'Rock between the seconds (D2 and G2, F2 and Bb2)', 0, 1, 0.05, (/** @type {number} */ v) => `${Math.round(v * 100)}% of phrases`],
    ['lineChance', 'Written lines (bass walk, sus4 to sus2, summer)', 0, 1, 0.05, (/** @type {number} */ v) => `${Math.round(v * 100)}% of phrases`],
    ['hold', 'Hold a chord another bar', 0, 3, 0.1, (/** @type {number} */ v) => `${v.toFixed(1)}x`],
    ['splitLast', 'Two chords in the bar before a cadence', 0, 1, 0.05, (/** @type {number} */ v) => `${Math.round(v * 100)}%`],
  ];

  host.innerHTML = `
    <div class="card">
      <h2>Engine</h2>
      <p class="muted">The development engine grows a piece from a season's material (spring in D, summer in F, with its lifted mornings, the electric piano and the guitar now and then). It grows the harmony first, then, for most pieces, a melody from the season's motifs, cut from the tides. The same seed always grows the same piece and the same name, with or without its melody.</p>
      <div class="grid2">
        <div>
          <h3>Season</h3>
          <div class="seg" role="group" aria-label="Season" id="en-seasons">${SEASONS.map(([id, label]) => `<button data-season="${id}">${label}</button>`).join('')}</div>
          <h3>Slot</h3>
          <div class="seg even" role="group" aria-label="Slot" id="en-slots">${SLOTS.map(([id, label]) => `<button data-slot="${id}">${label}</button>`).join('')}</div>
          <h3>Weather</h3>
          <div class="seg" role="group" aria-label="Weather" id="en-weather">${WEATHER.map(([id, label]) => `<button data-weather="${id}">${label}</button>`).join('')}</div>
          <h3>Melody</h3>
          <div class="seg" role="group" aria-label="Melody" id="en-sing">${SING.map(([id, label]) => `<button data-sing="${id}">${label}</button>`).join('')}</div>
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
      <p class="muted">Each box is a bar (two bars in 6/8, where a chord lasts two short bars). Its color is how tense the chord feels, cool to warm. In the strip along the bottom, the filled part is the chord's tension and the dark mark is what the template asked for there.</p>
      <div id="en-chart" class="en-chart"></div>
      <h3>Melody, note by note</h3>
      <p class="muted" id="en-mel-note"></p>
      <div id="en-mel"></div>
      <div class="en-legend" id="en-mel-legend">${JOBS.map(([, c, label]) => `<span><i style="background:${c}"></i>${label}</span>`).join('')}</div>
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
    <div class="grid2">
      <div class="card">
        <h2>Melody</h2>
        <label class="slider"><span>Pieces that sing (clear weather)</span><input type="range" data-m="chance" min="0" max="1" step="0.05"><output data-m-out="chance"></output></label>
        <label class="slider"><span>Guitar counter-line (summer, of singing pieces)</span><input type="range" data-m="counter" min="0" max="1" step="0.05"><output data-m-out="counter"></output></label>
        <h3>Development</h3>
        <p class="muted">How often each technique follows a phrase's motif. At zero it never appears.</p>
        ${Object.keys(TECH_NAMES).map((k) => `<label class="slider"><span>${TECH_NAMES[k]}</span><input type="range" data-t="${k}" min="0" max="0.6" step="0.01"><output data-t-out="${k}"></output></label>`).join('')}
      </div>
      <div class="card">
        <h2>Melody candidates</h2>
        <p class="muted" id="en-mcand-note"></p>
        <div id="en-mcands"></div>
        <h3>Why the chosen melody scored as it did</h3>
        <div class="tiles" id="en-mterms"></div>
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
    for (const b of host.querySelectorAll('[data-season]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-season') === season));
    for (const b of host.querySelectorAll('[data-slot]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-slot') === slot));
    for (const b of host.querySelectorAll('[data-weather]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-weather') === weather));
    for (const b of host.querySelectorAll('[data-sing]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-sing') === sing));
    const pct = (/** @type {number} */ v) => `${Math.round(v * 100)}%`;
    /** @type {[string, number][]} */
    const mv = [['chance', rules.melody.chance.default], ['counter', rules.melody.counter.chance]];
    for (const [k, v] of mv) {
      /** @type {HTMLInputElement} */ (host.querySelector(`[data-m="${k}"]`)).value = String(v);
      /** @type {HTMLElement} */ (host.querySelector(`[data-m-out="${k}"]`)).textContent = pct(v);
    }
    for (const k of Object.keys(TECH_NAMES)) {
      const v = rules.melody.techniques[k] ?? 0;
      /** @type {HTMLInputElement} */ (host.querySelector(`[data-t="${k}"]`)).value = String(v);
      /** @type {HTMLElement} */ (host.querySelector(`[data-t-out="${k}"]`)).textContent = v.toFixed(2);
    }
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
    u.searchParams.set('eseason', season);
    u.searchParams.set('esing', sing);
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
        const span = rep.span ?? 1;
        const label = span > 1 ? `${barNo + 1} to ${barNo + span}` : `${barNo + 1}`;
        barNo += span;
        const main = b.chords[0];
        const two = b.chords.length > 1;
        const sym = b.chords.map((/** @type {any} */ c) => show(c.symbol)).join(' <span class="en-then">then</span> ');
        const rom = b.held ? 'held' : b.figure === 'rock' ? 'rocking' : b.chords.map((/** @type {any} */ c) => esc(c.place)).join(', ');
        const tens = b.chords.reduce((s, /** @type {any} */ c) => s + c.tension, 0) / b.chords.length;
        return `<div class="en-bar${b.cadence ? ' en-cad' : ''}" style="background:${tensionFill(two ? tens : main.tension)}">
          <span class="en-no">${label}</span><b>${sym}</b><span class="en-rom">${rom}</span>
          <span class="en-meter" aria-label="tension ${tens.toFixed(2)}, aim ${b.target.toFixed(2)}"><i style="width:${Math.round(tens * 100)}%"></i><em style="left:${Math.round(b.target * 100)}%"></em></span>
        </div>`;
      }).join('');
      return `<div class="en-phrase"><div class="en-ph-head"><b>${i + 1}. ${esc(ph.role)}</b><span>${ph.bars} bars, ends ${esc(SHORT_CAD[ph.cadence] ?? ph.cadence)}</span></div><div class="en-bars">${cells}</div></div>`;
    }).join('') + (() => {
      const e = rep.ending;
      const lastBar = rep.bars[rep.bars.length - 1];
      const endBars = e.hold ? [[lastBar.chords[lastBar.chords.length - 1].symbol, 0]] : e.bars;
      return `<div class="en-phrase"><div class="en-ph-head"><b>Ending</b><span>${esc(e.name)}, ${endBars.length} bar${endBars.length > 1 ? 's' : ''}</span></div><div class="en-bars">${endBars.map((/** @type {[string, number]} */ [s, tn], /** @type {number} */ k) => { const sp = k === endBars.length - 1 ? 1 : (rep.span ?? 1); const lab = sp > 1 ? `${barNo + 1} to ${barNo + sp}` : `${barNo + 1}`; barNo += sp; return `<div class="en-bar${k === endBars.length - 1 ? ' en-cad' : ''}" style="background:${tensionFill(tn)}"><span class="en-no">${lab}</span><b>${show(s)}</b><span class="en-rom">${k === endBars.length - 1 ? 'held' : '&nbsp;'}</span></div>`; }).join('')}</div></div>`;
    })();
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

  /** The melody strip: every note as a bar of color by its job, the chords along the bottom. */
  function melodyStrip() {
    const m = grown.piece.grown.report.melody;
    if (!m) {
      $('en-mel').innerHTML = '';
      $('en-mel-legend').hidden = true;
      $('en-mel-note').textContent = 'This seed has no melody: it plays chords and the bed. Choose Always above to hear the melody it would sing.';
      return;
    }
    $('en-mel-legend').hidden = false;
    const all = [...m.notes.map((/** @type {any} */ n) => n.midi), ...m.counter.map((/** @type {any} */ n) => n.midi)];
    const lo = Math.min(...all) - 1, hi = Math.max(...all) + 1;
    const W = 960, H = 220, bot = 30, xs = W / m.total, ys = (H - bot - 6) / Math.max(1, hi - lo);
    const y = (/** @type {number} */ midi) => 4 + (hi - midi) * ys;
    const color = Object.fromEntries(JOBS.map(([j, c]) => [j, c]));
    const rect = (/** @type {any} */ n, /** @type {string} */ c) => `<rect x="${(n.t * xs).toFixed(1)}" y="${(y(n.midi) - ys / 2).toFixed(1)}" width="${Math.max(2, n.d * xs - 1.5).toFixed(1)}" height="${Math.max(4, ys - 1).toFixed(1)}" rx="2" fill="${c}"/>`;
    const bars = [];
    for (let t = 0; t <= m.total; t += m.len) bars.push(`<line x1="${(t * xs).toFixed(1)}" x2="${(t * xs).toFixed(1)}" y1="0" y2="${H - bot}" stroke="#E3D9C9" stroke-width="1"/>`);
    const chords = m.chords.map((/** @type {any} */ c, /** @type {number} */ i) => {
      const end = i + 1 < m.chords.length ? m.chords[i + 1].t : m.total;
      return `<rect x="${(c.t * xs + 1).toFixed(1)}" y="${H - bot + 4}" width="${Math.max(2, (end - c.t) * xs - 2).toFixed(1)}" height="${bot - 6}" rx="4" fill="#F1EFE8" stroke="#D3D1C7"/>`;
    }).join('');
    $('en-mel').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="The melody, each note colored by its job">${bars.join('')}${chords}${m.counter.map((/** @type {any} */ n) => rect(n, color.counter)).join('')}${m.notes.map((/** @type {any} */ n) => rect(n, color[n.job] ?? '#888')).join('')}</svg>`;
    const motifs = m.phrases.map((/** @type {any} */ p, /** @type {number} */ i) => `phrase ${i + 1}: ${p.motif ? (material.motifs[p.motif]?.name ?? p.motif) : 'none'}`).join(', ');
    const inst = grown.piece.palette.melody[0];
    $('en-mel-note').textContent = `Sung on ${inst === 'guitar' ? 'the guitar (its bright layer)' : inst === 'fm-piano' ? 'the electric piano' : inst}${m.withCounter ? `, with a counter-line on ${grown.piece.palette.counter[0]}` : ''}. Motifs: ${motifs}. Each column of the strip is an eighth; the chords run along the bottom.`;
  }

  function melodyCandidates() {
    const m = grown.piece.grown.report.melody;
    if (!m) { $('en-mcands').innerHTML = ''; $('en-mterms').innerHTML = ''; $('en-mcand-note').textContent = 'No melody for this seed.'; return; }
    const c = m.candidates;
    const hi = Math.max(...c.map((/** @type {any} */ x) => x.total)), lo = Math.min(...c.map((/** @type {any} */ x) => x.total));
    const W = 480, H = 130, bw = W / c.length;
    const bars = c.map((/** @type {any} */ x, /** @type {number} */ i) => {
      const h = 10 + ((x.total - lo) / Math.max(1e-6, hi - lo)) * (H - 40);
      const fill = i === m.chosen ? '#4a6a47' : i < m.keep ? '#8DAE80' : '#CFC3AF';
      return `<rect x="${(i * bw + 2).toFixed(1)}" y="${(H - 20 - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${fill}"/>`;
    }).join('');
    $('en-mcands').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Melody candidate scores, best first">${bars}<text x="0" y="${H - 4}">best</text><text x="${W}" y="${H - 4}" text-anchor="end">worst</text></svg>`;
    $('en-mcand-note').textContent = `${c.length} melodies grown over these chords, best first. The light green ones are the best ${m.keep}; the seed chose the dark one (number ${m.chosen + 1}).`;
    $('en-mterms').innerHTML = Object.entries(m.judged.terms).map(([k, v]) => `<div class="tile"><b style="font-size:19px">${(/** @type {number} */ (v) >= 0 ? '+' : '')}${/** @type {number} */ (v).toFixed(2)}</b><span>${MEL_TERMS[k] ?? k}</span></div>`).join('');
  }

  function refresh() {
    grown = grow(material, rules, { slot, weather, seed: seed(), melody: sing === 'game' ? undefined : sing === 'always' }, names);
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
    melodyStrip();
    candidates();
    melodyCandidates();
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

  host.querySelector('#en-seasons')?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-season]');
    if (b) { season = /** @type {string} */ (b.getAttribute('data-season')); material = materials[season]; syncControls(); refresh(); }
  });
  host.querySelector('#en-slots')?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-slot]');
    if (b) { slot = /** @type {string} */ (b.getAttribute('data-slot')); syncControls(); refresh(); }
  });
  host.querySelector('#en-sing')?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-sing]');
    if (b) { sing = /** @type {string} */ (b.getAttribute('data-sing')); syncControls(); refresh(); }
  });
  for (const el of host.querySelectorAll('[data-m]')) el.addEventListener('input', () => {
    const v = Number(/** @type {HTMLInputElement} */ (el).value);
    if (el.getAttribute('data-m') === 'chance') rules.melody.chance.default = v; else rules.melody.counter.chance = v;
    syncControls(); refresh();
  });
  for (const el of host.querySelectorAll('[data-t]')) el.addEventListener('input', () => {
    rules.melody.techniques[/** @type {string} */ (el.getAttribute('data-t'))] = Number(/** @type {HTMLInputElement} */ (el).value);
    syncControls(); refresh();
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
    const text = `Engine, ${season} ${slot}${weather === 'clear' ? '' : `, ${weather}`}, seed ${seed()} ("${grown.piece.title}"): ${chords}. My note: `;
    try { await navigator.clipboard.writeText(text); $('en-copied').textContent = 'Copied. Paste it into your message and add your note.'; } catch { $('en-copied').textContent = text; }
  });

  syncControls();
  refresh();
}
