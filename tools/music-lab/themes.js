// @ts-check
// Music lab, Themes tab (doc 24, "Motifs", phase 3): the island-theme candidates side by side, each
// a tide set four ways, one per season (recipes/music/pieces/themes/). Tap a setting to hear it;
// star the candidates you like and copy the picks as a sentence to send. The seed and sun height
// change the performance the same way as on the Piece tab; the lengths in the grid are at the
// default seed and each season's morning sun. Favourites live in this browser only.

import { realize } from '../../src/audio/music/realize.js';
import { dayColorAt } from '../../src/audio/music/daycolor.js';
import { ensureIconSprite, iconSvg } from '../../src/ui/icons/icons.js';
import { starIcon } from './icons.js';
import { createNotation } from './notation.js';
import { createPianoRoll } from './pianoroll.js';
import { createStage, loadJson, loadMusicRecipes, sunLabel } from './perform-ui.js';

const SEASONS = /** @type {const} */ (['spring', 'summer', 'autumn', 'winter']);
/** @typedef {typeof SEASONS[number]} Season */
/** Each season's morning sun height, in degrees: where the slider starts when a season is picked. */
const MORNING_SUN = { spring: 20, summer: 30, autumn: 12, winter: 8 };
const DEFAULT_SEED = 4127;
const FAV_KEY = 'ebb.musicLab.themeFavourites';

const INST_NAMES = /** @type {Record<string, string>} */ ({
  piano: 'piano', 'fm-piano': 'FM piano', pad: 'pad', bell: 'bell', strings: 'strings', cello: 'cello',
  harp: 'harp', flute: 'flute', vibraphone: 'vibraphone', 'vibraphone-bowed': 'bowed vibraphone', glass: 'glass',
});
const instName = (/** @type {string} */ id) => INST_NAMES[id] ?? id.replace(/-/g, ' ');
const MODES = /** @type {Record<string, string>} */ ({ '': 'major', m: 'minor', dor: 'dorian', mix: 'mixolydian', lyd: 'lydian', phr: 'phrygian' });

/** "E dorian", "D minor", "F sharp major". @param {string} key */
function keyLabel(key) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(key);
  if (!m) return key;
  return `${m[1]}${m[2] === '#' ? ' sharp' : m[2] === 'b' ? ' flat' : ''} ${MODES[m[3]] ?? m[3]}`;
}

/** A candidate's description cut to one short line: its first sentence, without asides, up to about 80 characters. @param {string} about */
function oneLine(about) {
  let s = (about.split(/(?<=\.)\s/)[0] ?? about).replace(/\s*\([^)]*\)/g, '').replace(/\.$/, '');
  if (s.length > 80) {
    const cut = Math.max(s.lastIndexOf(', ', 80), s.lastIndexOf(': ', 80));
    if (cut > 20) s = s.slice(0, cut);
  }
  return s;
}

/** @returns {Set<number>} */
function loadFavourites() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => Number.isFinite(x)) : []);
  } catch {
    return new Set();
  }
}
/** @param {Set<number>} favs */
function saveFavourites(favs) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs].sort((a, b) => a - b))); } catch { /* private window: favourites last this visit only */ }
}

/**
 * @param {HTMLElement} host the Themes tab's section
 * @param {{mixer: any}} env
 */
export async function initThemes(host, env) {
  const [{ director, recipes }, index] = await Promise.all([loadMusicRecipes(), loadJson('recipes/music/pieces/themes/index.json')]);
  /** @type {{n: number, name: string, about: string, settings: Record<Season, string>}[]} */
  const candidates = index.candidates;
  /** @type {Record<string, any>} */
  const pieces = {};
  await Promise.all(candidates.flatMap((c) => SEASONS.map(async (s) => { pieces[c.settings[s]] = await loadJson(`recipes/music/pieces/themes/${c.settings[s]}.json`); })));

  const url = new URL(location.href);
  const asked = url.searchParams.get('theme');
  let sel = candidates.flatMap((c) => SEASONS.map((s) => ({ c, s }))).find((x) => x.c.settings[x.s] === asked) ?? { c: candidates[0], s: /** @type {Season} */ ('spring') };
  const favs = loadFavourites();

  ensureIconSprite();
  host.innerHTML = `
    <div class="card">
      <h2>Themes</h2>
      <p class="th-intro">Four candidate island themes, each a tide: it rises to one held note and falls back past where it began. Each is set four ways, one per season, at most 40 seconds. Tap a setting to hear it.</p>
      <div class="th-head" aria-hidden="true"><span>Candidate</span><div class="th-cells">${SEASONS.map((s) => `<span>${s[0].toUpperCase()}${s.slice(1)}</span>`).join('')}</div></div>
      <div id="th-grid" class="th-grid"></div>
      <div class="row" style="margin-top:12px">
        <button id="th-copy" style="flex:0 1 auto">Copy my picks</button>
        <span class="muted" id="th-copied" role="status"></span>
      </div>
      <p class="note th-picks" id="th-picks"></p>
    </div>
    <div class="card">
      <div class="row">
        <button class="big" id="th-play" style="flex:1 1 140px">Play</button>
        <button id="th-finish" style="flex:1 1 140px">Finish gently</button>
        <button id="th-stop" style="flex:1 1 100px">Stop</button>
      </div>
      <p class="muted" id="th-status" role="status"></p>
      <div class="grid2">
        <div>
          <h3>Seed</h3>
          <div class="row"><input id="th-seed" inputmode="numeric" aria-label="Seed" style="font:800 19px Nunito,sans-serif;width:9em;max-width:100%;padding:10px;border-radius:12px;border:1px solid #CFC3AF;background:#FFFDF8">
            <button id="th-new" style="flex:1 1 140px">New seed</button></div>
          <p class="muted">The seed changes the performance: the left-hand textures, the layers and the instruments.</p>
        </div>
        <div>
          <h3>Time of day</h3>
          <label class="slider"><span>Sun height</span><input type="range" id="th-sun" min="-20" max="60" step="1"><output id="th-sun-out"></output></label>
          <p class="muted">Picking a season sets the sun to that season's morning.</p>
        </div>
      </div>
    </div>
    <div class="card">
      <h2 id="th-title"></h2>
      <div class="tiles" id="th-facts"></div>
      <div class="tiles" id="th-roles" style="margin-top:10px"></div>
      <div class="tiles" id="th-texture" style="margin-top:10px"></div>
      <p class="muted" id="th-standins" style="margin-top:10px" hidden></p>
      <h3>Piano roll</h3>
      <div id="th-roll"></div>
      <h3>Sheet music</h3>
      <div id="th-notation"></div>
      <h3>About this setting</h3>
      <p id="th-about"></p>
    </div>`;

  const $ = (/** @type {string} */ id) => /** @type {any} */ (host.querySelector(`#${id}`));
  const roll = createPianoRoll($('th-roll'));
  const notation = createNotation($('th-notation'));
  const stage = createStage(env, recipes, { roll, notation, status: (t) => { $('th-status').textContent = t; } });
  $('th-seed').value = url.searchParams.get('tseed') ?? String(DEFAULT_SEED);
  $('th-sun').value = url.searchParams.get('tsun') ?? String(MORNING_SUN[sel.s]);
  $('th-status').textContent = 'Tap a setting to hear it.';

  const seed = () => (Number($('th-seed').value) >>> 0) || 1;
  const piece = () => pieces[sel.c.settings[sel.s]];
  const seasonName = (/** @type {Season} */ s) => `${s[0].toUpperCase()}${s.slice(1)}`;

  /** @param {any} pc @param {number} s @param {number} sun */
  function perform(pc, s, sun) {
    const dayColor = dayColorAt(sun, director.dayColor);
    return { p: realize(pc, { seed: s, dayColor, available: stage.available() }, recipes), dayColor };
  }

  // ---------------- the grid ----------------

  /** Each setting's length at the default seed and its season's morning. */
  const lengthOf = (/** @type {string} */ id, /** @type {Season} */ s) => perform(pieces[id], DEFAULT_SEED, MORNING_SUN[s]).p.durationS;
  /** @type {Map<string, HTMLButtonElement>} */
  const cells = new Map();
  /** @type {Map<number, HTMLButtonElement>} */
  const favBtns = new Map();
  for (const c of candidates) {
    const row = document.createElement('div');
    row.className = 'th-cand';
    row.innerHTML = `
      <div class="th-info">
        <div class="th-name"><b class="th-n">${c.n}</b><b>${c.name}</b></div>
        <p class="th-line">${oneLine(c.about)}</p>
      </div>
      <div class="th-cells"></div>`;
    const fav = document.createElement('button');
    fav.className = 'th-fav';
    fav.setAttribute('aria-label', `Favourite: ${c.name}`);
    fav.innerHTML = `${starIcon()}<span>Favourite</span>`;
    fav.addEventListener('click', () => {
      if (favs.has(c.n)) favs.delete(c.n); else favs.add(c.n);
      saveFavourites(favs);
      showFavourites();
    });
    favBtns.set(c.n, fav);
    /** @type {HTMLElement} */ (row.querySelector('.th-name')).append(fav);
    const box = /** @type {HTMLElement} */ (row.querySelector('.th-cells'));
    for (const s of SEASONS) {
      const id = c.settings[s];
      const b = document.createElement('button');
      b.className = 'th-cell';
      const secs = Math.round(lengthOf(id, s));
      b.setAttribute('aria-label', `${c.name}, ${s}, ${secs} seconds`);
      b.innerHTML = `${iconSvg(`season-${s}`)}<span class="th-season">${seasonName(s)}</span><span class="th-len">${secs} s</span>`;
      b.addEventListener('click', () => {
        sel = { c, s };
        $('th-sun').value = String(MORNING_SUN[s]);
        refresh();
        play();
      });
      cells.set(id, b);
      box.append(b);
    }
    $('th-grid').append(row);
  }

  function showFavourites() {
    for (const [n, b] of favBtns) b.setAttribute('aria-pressed', String(favs.has(n)));
    $('th-picks').textContent = picksText();
  }
  function picksText() {
    const list = candidates.filter((c) => favs.has(c.n)).map((c) => `${c.n} ${c.name} (favourite)`);
    return `Theme picks: ${list.length ? list.join(', ') : 'none starred yet'}. Notes: `;
  }
  $('th-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(picksText()); $('th-copied').textContent = 'Copied.'; } catch { $('th-copied').textContent = 'Select the sentence below to copy it.'; }
  });

  // ---------------- the selected setting ----------------

  function save() {
    const u = new URL(location.href);
    u.searchParams.set('theme', sel.c.settings[sel.s]);
    u.searchParams.set('tseed', String(seed()));
    u.searchParams.set('tsun', $('th-sun').value);
    u.hash = 'themes';
    history.replaceState(null, '', u);
  }

  /** @type {any} */
  let perf = null;
  function refresh() {
    for (const [id, b] of cells) b.setAttribute('aria-pressed', String(id === sel.c.settings[sel.s]));
    const sun = Number($('th-sun').value);
    $('th-sun-out').textContent = sunLabel(sun, director);
    const pc = piece();
    const { p } = perform(pc, seed(), sun);
    perf = p;
    $('th-title').textContent = `${sel.c.n} ${sel.c.name}: ${sel.s}`;
    roll.setPerformance(p);
    // The card's heading already names the setting; a long title would be cut off on a phone.
    notation.render(p.abc.replace(/^T:.*\n/m, ''));
    facts(pc, p);
    $('th-about').textContent = pc.notes ?? '';
    save();
  }

  /** @param {any} pc @param {any} p */
  function facts(pc, p) {
    const I = p.instruments;
    const left = [...new Set([I.acc, I.bass, I.pad].filter(Boolean))].map(instName).join(' and ');
    const roles = [
      ['melody', I.mel ? instName(I.mel) : ''], ['left hand', left], ['counter-line', I.counter ? instName(I.counter) : ''],
      ['bed', I.bed ? instName(I.bed) : ''], ['touches', I.touch ? instName(I.touch) : ''],
    ];
    const tile = (/** @type {string} */ b, /** @type {string} */ s) => `<div class="tile"><b>${b}</b><span>${s}</span></div>`;
    $('th-facts').innerHTML = [
      [keyLabel(p.key), 'key'], [`${Math.round(p.bpm)}`, `beats a minute, in ${pc.meter}`], [`${p.durationS.toFixed(0)} s`, 'length'],
    ].map(([b, s]) => tile(b, s)).join('');
    $('th-roles').innerHTML = roles.map(([role, inst]) => tile(inst || 'not played', role)).join('');
    $('th-texture').innerHTML = tile(p.pattern.replace(/-/g, ' ') || 'none', 'left-hand textures');
    // Stand-ins: a role whose first choice isn't built yet plays the realizer's fallback.
    const avail = new Set(stage.available());
    const voice = { melody: 'mel', accomp: 'acc', counter: 'counter', bed: 'bed', touch: 'touch' };
    const role = { melody: 'the melody', accomp: 'the left hand', counter: 'the counter-line', bed: 'the bed', touch: 'the touches' };
    const waiting = Object.entries(pc.palette ?? {}).filter(([, list]) => Array.isArray(list) && list.length && !avail.has(list[0])).map(([r, list]) => {
      const used = I[/** @type {'mel'} */ (voice[/** @type {'melody'} */ (r)])];
      return `${instName(list[0])} for ${role[/** @type {'melody'} */ (r)] ?? r} (${used ? `${instName(used)} plays` : 'left out'})`;
    });
    $('th-standins').hidden = !waiting.length;
    $('th-standins').textContent = waiting.length ? `Some instruments are still being prepared; stand-ins play for now. Waiting: ${waiting.join(', ')}.` : '';
  }

  async function play() {
    const ticket = await stage.begin();
    const pc = piece();
    const s = seed();
    const sun = Number($('th-sun').value);
    const { p, dayColor } = perform(pc, s, sun);
    perf = p;
    roll.setPerformance(p);
    facts(pc, p);
    return stage.play(ticket, pc, p, { seed: s, dayColor, label: `${sel.c.name}, ${sel.s}, seed ${s}` });
  }

  $('th-play').addEventListener('click', () => play());
  $('th-stop').addEventListener('click', () => stage.stop(0.3));
  $('th-finish').addEventListener('click', () => { const s = stage.finish(); if (s !== undefined) $('th-status').textContent = `Finishing at the end of this section, in about ${Math.ceil(s)} s.`; });
  $('th-new').addEventListener('click', () => { $('th-seed').value = String(1 + Math.floor((Date.now() % 100000) * 7.3) % 9999); refresh(); });
  $('th-seed').addEventListener('change', refresh);
  $('th-sun').addEventListener('input', refresh);

  showFavourites();
  refresh();
  void perf;
}
