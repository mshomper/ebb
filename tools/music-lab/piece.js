// @ts-check
// Music lab, Piece tab (doc 24, "The music lab"): choose a piece, a seed and the time of day, see
// its notation and a piano roll that follow along as it plays, A/B two seeds of the same piece,
// and tap a bar to get a note to send ("seed 4127, bar 9"). The seed and settings live in the
// page address, so a link opens the same performance.

import { realize } from '../../src/audio/music/realize.js';
import { createPerformer } from '../../src/audio/music/perform.js';
import { createInstruments } from '../../src/audio/music/instruments.js';
import { dayColorAt, dayKeyName } from '../../src/audio/music/daycolor.js';
import { createNotation } from './notation.js';
import { createPianoRoll } from './pianoroll.js';

const KEY_LABEL = { night: 'night', blueHour: 'blue hour', golden: 'golden hour', morning: 'morning or afternoon', day: 'midday' };

/**
 * @param {HTMLElement} host the Piece tab's section
 * @param {{mixer: any}} env
 */
export async function initPiece(host, env) {
  const j = async (/** @type {string} */ p) => (await fetch(new URL(`../../${p}`, import.meta.url), { cache: 'no-cache' })).json();
  const [director, rz, vo, index] = await Promise.all([
    j('recipes/music/director.json'), j('recipes/music/realize.json'), j('recipes/music/voicing.json'),
    j('recipes/music/pieces/index.json').catch(() => ({ pieces: ['test-spring-01'] })),
  ]);
  const pieces = await Promise.all(index.pieces.map((/** @type {string} */ id) => j(`recipes/music/pieces/${id}.json`)));
  const recipes = { realize: rz, voicing: vo };
  const url = new URL(location.href);
  const q = (/** @type {string} */ k, /** @type {string} */ d) => url.searchParams.get(k) ?? d;

  host.innerHTML = `
    <div class="card">
      <h2>Piece</h2>
      <p class="muted">Every play of a piece is drawn from its seed: the same seed is always the same performance; a new seed is a new performance of the same melody and harmony. Tap a bar on the piano roll to get a note you can send me.</p>
      <div class="grid2">
        <div>
          <h3>Piece</h3>
          <select id="pc-piece" aria-label="Piece" style="width:100%"></select>
          <h3>Time of day</h3>
          <label class="slider"><span>Sun height</span><input type="range" id="pc-sun" min="-20" max="60" step="1"><output id="pc-sun-out"></output></label>
          <h3>Form</h3>
          <div class="seg" role="group" aria-label="Form">
            <button id="pc-full" aria-pressed="true">Full</button>
            <button id="pc-short" aria-pressed="false">Short form</button>
          </div>
          <h3>Key</h3>
          <div class="seg" role="group" aria-label="Key" id="pc-keys"></div>
        </div>
        <div>
          <h3>Seed</h3>
          <div class="row"><input id="pc-seed" inputmode="numeric" aria-label="Seed" style="font:800 19px Nunito,sans-serif;width:9em;max-width:100%;padding:10px;border-radius:12px;border:1px solid #CFC3AF;background:#FFFDF8">
            <button id="pc-new" style="flex:1 1 140px">New seed</button></div>
          <div class="row" style="margin-top:10px">
            <button class="big" id="pc-play" style="flex:1 1 140px">Play</button>
            <button id="pc-finish" style="flex:1 1 140px">Finish gently</button>
            <button id="pc-stop" style="flex:1 1 100px">Stop</button>
          </div>
          <h3>Compare two seeds</h3>
          <div class="row"><input id="pc-seed-b" inputmode="numeric" aria-label="Second seed" style="font:800 19px Nunito,sans-serif;width:9em;max-width:100%;padding:10px;border-radius:12px;border:1px solid #CFC3AF;background:#FFFDF8">
            <button id="pc-ab" style="flex:1 1 200px">Play this seed, then the second</button></div>
          <p class="muted" id="pc-status"></p>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="tiles" id="pc-facts"></div>
      <div id="pc-noteline" class="note" style="margin-top:10px" hidden></div>
      <h3>Piano roll</h3>
      <div id="pc-roll"></div>
      <h3>Notation</h3>
      <p class="muted" id="pc-notation-note"></p>
      <div id="pc-notation"></div>
      <h3>About this piece</h3>
      <p id="pc-about"></p>
    </div>`;

  const $ = (/** @type {string} */ id) => /** @type {any} */ (host.querySelector(`#${id}`));
  for (const p of pieces) $('pc-piece').add(new Option(p.title, p.id));
  $('pc-piece').value = q('piece', pieces[0].id);
  $('pc-sun').value = q('sun', '15');
  $('pc-seed').value = q('seed', String(4127));
  $('pc-seed-b').value = q('seedB', String(2));
  let short = q('form', 'full') === 'short';
  let key = q('key', 'auto');
  $('pc-full').setAttribute('aria-pressed', String(!short));
  $('pc-short').setAttribute('aria-pressed', String(short));

  const roll = createPianoRoll($('pc-roll'), { onSeekBar: (/** @type {number} */ bar) => noteLine(bar) });
  const notation = createNotation($('pc-notation'));
  /** @type {any} */
  let inst = null;
  /** @type {any} */
  let performer = null;
  /** @type {any} */
  let perf = null;
  let raf = 0;

  const piece = () => pieces.find((p) => p.id === $('pc-piece').value) ?? pieces[0];
  const seed = () => (Number($('pc-seed').value) >>> 0) || 1;

  function keysButtons() {
    const p = piece();
    const box = $('pc-keys');
    box.innerHTML = '';
    for (const k of ['auto', ...p.keys]) {
      const b = document.createElement('button');
      b.textContent = k === 'auto' ? 'As the seed picks' : k;
      b.setAttribute('aria-pressed', String(k === key));
      b.addEventListener('click', () => { key = k; keysButtons(); refresh(); });
      box.appendChild(b);
    }
  }

  function save() {
    const u = new URL(location.href);
    u.searchParams.set('piece', piece().id);
    u.searchParams.set('seed', String(seed()));
    u.searchParams.set('seedB', $('pc-seed-b').value);
    u.searchParams.set('sun', $('pc-sun').value);
    u.searchParams.set('form', short ? 'short' : 'full');
    u.searchParams.set('key', key);
    u.hash = 'piece';
    history.replaceState(null, '', u);
  }

  /** @param {number} s */
  function perform(s) {
    const sun = Number($('pc-sun').value);
    const dayColor = dayColorAt(sun, director.dayColor);
    const available = inst ? inst.available() : ['piano', 'pad', 'bell', 'fm-piano'];
    return { p: realize(piece(), { seed: s, dayColor, available, shortForm: short, key: key === 'auto' ? undefined : key }, recipes), dayColor };
  }

  function refresh() {
    const sun = Number($('pc-sun').value);
    $('pc-sun-out').textContent = `${sun} degrees, ${KEY_LABEL[/** @type {'day'} */ (dayKeyName(sun, director.dayColor))]}`;
    const { p } = perform(seed());
    perf = p;
    roll.setPerformance(p);
    notation.render(p.abc);
    $('pc-notation-note').textContent = p.transpose ? `As written, in ${piece().keys[0]}; this seed plays it in ${p.key}.` : 'As written.';
    const inst = Object.entries(p.instruments).map(([v, i]) => `${v === 'mel' ? 'melody' : v === 'acc' ? 'accompaniment' : v} on ${i}`).join(', ');
    $('pc-facts').innerHTML = [
      [p.path.join(' '), 'form played'], [p.key, 'key'], [`${Math.round(p.bpm)}`, 'beats a minute'],
      [p.pattern.replace(/-/g, ' '), 'accompaniment'], [`${p.durationS.toFixed(0)} s`, 'length'], [inst, 'instruments'],
    ].map(([b, s], i) => `<div class="tile"${i === 3 || i === 5 ? ' style="grid-column:1/-1"' : ''}><b style="font-size:19px">${b}</b><span>${s}</span></div>`).join('');
    $('pc-about').textContent = piece().notes ?? '';
    save();
  }

  /** @param {number} bar */
  function noteLine(bar) {
    const b = perf?.bars.find((/** @type {any} */ x) => x.index === bar);
    if (!b) return;
    const text = `${piece().title}, seed ${perf.seed}, bar ${bar}${b.chord ? ` (${b.chord})` : ''}, section ${b.section}: `;
    const box = $('pc-noteline');
    box.hidden = false;
    box.innerHTML = '';
    const t = document.createElement('span');
    t.textContent = text;
    const c = document.createElement('button');
    c.textContent = 'Copy';
    c.style.marginLeft = '10px';
    c.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); c.textContent = 'Copied'; } catch { c.textContent = 'Select the text to copy'; } });
    box.append(t, c);
  }

  async function ensure() {
    if (!inst) {
      $('pc-status').textContent = 'Getting the instruments ready.';
      inst = await createInstruments(env.mixer.ctx, env.mixer.input('music'));
      performer = createPerformer(env.mixer.ctx, inst.set);
    }
  }

  /** @param {number} s @returns {Promise<void>} */
  async function play(s) {
    await env.mixer.unlock();
    await ensure();
    performer.stop(0.2);
    const { p, dayColor } = perform(s);
    perf = p;
    roll.setPerformance(p);
    env.mixer.setMusicTone({ lowpassHz: dayColor.brightHz, wet: dayColor.wet }, 0.5);
    $('pc-status').textContent = 'Unpacking the notes this performance uses.';
    const t0 = performance.now();
    await inst.prepare(p);
    const mem = Object.values(inst.stats()).reduce((n, x) => n + (/** @type {any} */ (x).decodedMB ?? 0), 0);
    $('pc-status').textContent = `Playing seed ${s}. Unpacked in ${((performance.now() - t0) / 1000).toFixed(1)} s; ${mem.toFixed(0)} MB in memory.`;
    return new Promise((done) => {
      // For "Finish gently": the coda alone, at this seed's tempo, to follow the current section.
      const pc = piece();
      const coda = pc.sections.coda ? realize(pc, { seed: s, dayColor, available: inst.available(), key: p.key, path: ['coda'] }, recipes) : null;
      performer.play(p, {
        coda,
        onTime: () => {},
        onEnd: () => { cancelAnimationFrame(raf); roll.setPlayhead(-1); notation.highlight(null); $('pc-status').textContent = `Finished seed ${s}.`; inst.trim(); done(); },
      });
      const follow = () => {
        const pos = performer.position();
        if (pos >= 0) {
          roll.setPlayhead(pos);
          notation.highlight(tickAt(p, pos));
          raf = requestAnimationFrame(follow);
        }
      };
      raf = requestAnimationFrame(follow);
    });
  }

  $('pc-play').addEventListener('click', () => play(seed()));
  $('pc-stop').addEventListener('click', () => performer?.stop(0.3));
  $('pc-finish').addEventListener('click', () => { const s = performer?.finish(); if (s !== undefined) $('pc-status').textContent = `Finishing at the end of this section, in about ${Math.ceil(s)} s.`; });
  $('pc-ab').addEventListener('click', async () => {
    const a = seed(), b = (Number($('pc-seed-b').value) >>> 0) || 2;
    $('pc-seed').value = String(a); refresh();
    await play(a);
    await new Promise((r) => setTimeout(r, 1200));
    $('pc-seed').value = String(b); refresh();
    await play(b);
    $('pc-seed').value = String(a); refresh();
  });
  $('pc-new').addEventListener('click', () => { $('pc-seed').value = String(1 + Math.floor((Date.now() % 100000) * 7.3) % 9999); refresh(); });
  for (const id of ['pc-seed', 'pc-seed-b']) $(id).addEventListener('change', refresh);
  $('pc-piece').addEventListener('change', () => { key = 'auto'; keysButtons(); refresh(); });
  $('pc-sun').addEventListener('input', refresh);
  $('pc-full').addEventListener('click', () => { short = false; $('pc-full').setAttribute('aria-pressed', 'true'); $('pc-short').setAttribute('aria-pressed', 'false'); refresh(); });
  $('pc-short').addEventListener('click', () => { short = true; $('pc-full').setAttribute('aria-pressed', 'false'); $('pc-short').setAttribute('aria-pressed', 'true'); refresh(); });

  keysButtons();
  refresh();
}

/** The score tick sounding at a time, from the performance's tick-to-time samples. @param {any} p @param {number} t */
function tickAt(p, t) {
  const tt = p.tickTimes;
  if (!tt.length || t < 0) return null;
  for (let i = 1; i < tt.length; i++) {
    if (tt[i][1] >= t) {
      const [k0, t0] = tt[i - 1], [k1, t1] = tt[i];
      return k0 + ((k1 - k0) * (t - t0)) / Math.max(1e-6, t1 - t0);
    }
  }
  return tt[tt.length - 1][0];
}
