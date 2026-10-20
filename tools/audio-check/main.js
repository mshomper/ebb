// @ts-check
// The listening page (doc 17 "Sourcing", doc 25 "tools/audio-check.html"): the live ambience and
// creature voices, driven by sliders instead of the game. A small pond chorus calls by the game's
// rule; the map lets Matt walk around the pond and hear the calls move around him.

import { createMixer } from '../../src/audio/mixer.js';
import { loadAudioRecipe } from '../../src/audio/recipes.js';
import { createAmbience } from '../../src/audio/ambience.js';
import { createVoices } from '../../src/audio/voices.js';
import { blendFromPosition } from '../../src/audio/ambience/curves.js';
import { loadRecipe } from '../../src/core/recipes.js';
import { createChorus } from './chorus.js';
import { createMap } from './map.js';
import { createBedList } from './beds.js';
import { createPondLife } from './pond-life.js';
import { wingRecipe } from '../../src/audio/voices/dragonfly.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const ICON_CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#7C9D72" stroke="#5F7F5B" stroke-width="2"/><path d="M8 12.5l2.8 2.8 5.2-5.6" fill="none" stroke="#FBF7F0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="#B5654A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.2"/></svg>';
const DOT_WAIT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#A9B3A6" stroke-width="2.4"/></svg>';
const status = (/** @type {string} */ icon, /** @type {string} */ text) => { $('status').innerHTML = `${icon}<span>${text}</span>`; };

const SEED = 20261019;
const POND_R = 5;          // the frogs' ring, meters
const MIDGE_POS = [2.2, 0.6, -1.6];
const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];
const tier = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700 ? 'mobile' : 'desktop';

// ---- Sliders -----------------------------------------------------------------------------------
const num = (/** @type {string} */ id) => Number(/** @type {HTMLInputElement} */ ($(id)).value);
const pct = (/** @type {number} */ x) => `${Math.round(x * 100)} %`;
/** @param {number} h */
const clockText = (h) => { const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
/** @type {Record<string, (v: number) => string>} */
const fmt = {
  season: (v) => {
    const b = blendFromPosition(v, 0.286);
    const parts = b.map((w, i) => [w, SEASON_NAMES[i]]).filter(([w]) => /** @type {number} */ (w) > 0.01).sort((a, b2) => /** @type {number} */ (b2[0]) - /** @type {number} */ (a[0]));
    if (parts.length === 1) return /** @type {string} */ (parts[0][1]);
    return parts.map(([w, n]) => `${n} ${Math.round(/** @type {number} */ (w) * 100)}`).join(', ');
  },
  hour: clockText,
  wx: pct, wind: pct, gust: pct, frost: pct, near: pct, stream: pct, mood: (v) => v.toFixed(2),
  tide: (v) => (v > 0.8 ? 'high' : v < 0.2 ? 'low' : v > 0.5 ? 'rising high' : 'half'),
  height: (v) => `${v.toFixed(1)} m`,
  'fall-flow': (v) => (v > 0 ? `${(v * 1000).toFixed(1)} L/s` : 'none'),
  'fall-height': (v) => `${v.toFixed(1)} m`,
  'fall-dist': (v) => `${v.toFixed(1)} m`,
  'frog-count': (v) => String(v),
};
for (const id of Object.keys(fmt)) {
  const input = /** @type {HTMLInputElement} */ ($(id));
  const out = $(`${id}-out`);
  const show = () => { out.textContent = fmt[id](Number(input.value)); };
  input.addEventListener('input', show);
  show();
}
/** @param {string} id @param {[number, string][]} marks @param {number} max */
function ticks(id, marks, max) {
  // Labels near an end are pinned to that end, so none hangs outside the slider.
  $(id).innerHTML = marks.map(([v, t]) => {
    const x = v / max;
    const tf = x < 0.08 ? 'translateX(0)' : x > 0.92 ? 'translateX(-100%)' : 'translateX(-50%)';
    return `<span style="left:${x * 100}%;transform:${tf}">${t}</span>`;
  }).join('');
}
ticks('season-ticks', [[0.5, 'spring'], [1.5, 'summer'], [2.5, 'autumn'], [3.5, 'winter']], 3.99);

// ---- Load ----------------------------------------------------------------------------------------
let seasonsRecipe = /** @type {any} */ (null);
const [mixerRecipe, ambRecipe, procRecipe, frogSpecies, midgeSpecies, dragonflySpecies, minnowSpecies] = await Promise.all([
  loadAudioRecipe('audio/mixer'), loadAudioRecipe('audio/ambience'), loadAudioRecipe('audio/procedural'),
  loadRecipe('species/frog'), loadRecipe('species/midge'), loadRecipe('species/dragonfly'), loadRecipe('species/minnow'),
]);
try { seasonsRecipe = await loadRecipe('world/seasons'); } catch { /* optional */ }
const frogVoice = frogSpecies.voice;
const midgeVoice = midgeSpecies.voice;
const frogCall = frogSpecies.motion.call;
const frogMoods = frogSpecies.motion.moods;
const dormancy = seasonsRecipe?.dormancy?.frogs ?? [2.6, 0.3];
const midgeDensity = midgeSpecies.swarm.density;
const midgeWarmth = midgeSpecies.field.warmth;

const mixer = createMixer(mixerRecipe, { tier });
const ambience = createAmbience(mixer, ambRecipe, procRecipe, SEED, { tier });
const wings = wingRecipe(dragonflySpecies);
const voices = createVoices(mixer, { frog: frogVoice, midge: midgeVoice, dragonfly: wings, minnow: minnowSpecies.voice, proc: procRecipe }, SEED, { tier });
const pondLife = createPondLife(voices, wings);
const chorus = createChorus(frogCall, frogMoods, SEED);
chorus.place(num('frog-count'), POND_R);

// ---- The listener --------------------------------------------------------------------------------
const listener = { x: 0, z: 8.5, facePond: false, heading: 0 };
/** The ears: on the bank at the listener, looking at the pond or north. */
function earNow() {
  const h = num('height');
  const eye = [listener.x, Math.max(0.4, h), listener.z];
  let fx = 0, fz = -1;
  if (listener.facePond) {
    const d = Math.hypot(listener.x, listener.z) || 1;
    fx = -listener.x / d; fz = -listener.z / d;
  }
  listener.heading = Math.atan2(fx, -fz);
  // Look a little down when high up, so the pond stays in view.
  const down = Math.min(0.85, h / 30);
  const fwd = [fx * (1 - down), -down, fz * (1 - down)];
  const l = Math.hypot(fwd[0], fwd[1], fwd[2]);
  return { eye, forward: [fwd[0] / l, fwd[1] / l, fwd[2] / l] };
}

const map = createMap(/** @type {SVGSVGElement} */ (/** @type {unknown} */ ($('map'))), {
  pondR: POND_R, midge: MIDGE_POS, midgeReach: midgeVoice.reachM,
  onMove: (x, z) => { listener.x = x; listener.z = z; },
});
map.setFrogs(chorus.frogs());
map.setListener(listener.x, listener.z, 0);

// ---- Buttons -------------------------------------------------------------------------------------
/** @param {HTMLElement} el */
const pressed = (el) => el.getAttribute('aria-pressed') === 'true';
/** @param {HTMLElement} el @param {boolean} on */
const press = (el, on) => el.setAttribute('aria-pressed', String(on));
let weather = 'clear';
for (const b of $('weather').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    weather = /** @type {string} */ (b.dataset.w);
    for (const o of $('weather').querySelectorAll('button')) press(/** @type {HTMLElement} */ (o), o === b);
  });
}
for (const id of ['residents', 'call-now', 'auto-gust', 'face']) {
  $(id).addEventListener('click', () => press($(id), !pressed($(id))));
}
$('face').addEventListener('click', () => { listener.facePond = pressed($('face')); });
$('frog-count').addEventListener('input', () => { chorus.place(num('frog-count'), POND_R); map.setFrogs(chorus.frogs()); });

const recent = /** @type {number[]} */ ([]);
/** One frog call: the sound and the flash on the map. @param {{id: string, pos: number[]}} f @param {number} [when] */
function sound(f, when) {
  const ok = voices.call(f.id, 'frog', f.pos, 0.4 + 0.6 * num('mood'), when);
  if (ok) { map.flash(f.id); recent.push(performance.now()); }
  return ok;
}
$('one-call').addEventListener('click', () => {
  const fs = chorus.frogs();
  const f = fs[Math.floor((performance.now() / 997) % fs.length)];
  if (!sound(f)) status(DOT_WAIT, 'Frogs are dormant in winter, so there is no call. Move the season slider before winter.');
});
for (const b of $('shots').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    const btn = /** @type {HTMLElement} */ (b);
    ambience.fire(/** @type {string} */ (btn.dataset.s), { kind: btn.dataset.k });
  });
}

// ---- Bed meters --------------------------------------------------------------------------------
const bedList = createBedList($('beds'), ambience, voices);
$('solo-off').addEventListener('click', () => bedList.clearSolo());

// ---- Start ---------------------------------------------------------------------------------------
let started = false;
status(DOT_WAIT, 'Ready. Press Start sound.');
$('start').addEventListener('click', async () => {
  await mixer.unlock();
  started = true;
  /** @type {HTMLButtonElement} */ ($('start')).disabled = true;
  $('start').textContent = 'Sound is on';
  status(ICON_CHECK, `Sound is on (${tier === 'mobile' ? 'phone' : 'desktop'} settings: ${frogVoice.maxVoices[tier]} frog calls at once at most).`);
});

// ---- The loop: 10 Hz state, frogs on the audio clock --------------------------------------------
let gustNow = 0;
const gustRng = { t: 0, next: 0, until: 0, peak: 0 };
const duskHourOf = (/** @type {number} */ s) => {
  // Day length from the season (a rough guide for the lab: 15 h midsummer, 9 h midwinter).
  const dayLen = 12 + 3 * Math.cos(((s - 1.5) / 4) * 2 * Math.PI);
  return { dusk: 12 + dayLen / 2 + 1, rise: 12 - dayLen / 2, set: 12 + dayLen / 2 };
};
let hourShown = -1;
let lastFrame = performance.now();

function tick() {
  const nowMs = performance.now();
  const dt = Math.min(0.5, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  const seasonPos = num('season');
  const blend = blendFromPosition(seasonPos, ambRecipe.seasonEdge);
  const hour = num('hour');
  const sun = duskHourOf(seasonPos);
  if (seasonPos !== hourShown) {
    hourShown = seasonPos;
    ticks('hour-ticks', [[0.3, 'night'], [Math.max(6, sun.rise), 'dawn'], [12, 'noon'], [Math.min(19.5, sun.set + 0.6), 'dusk']], 24);
  }

  // Gusts: when on, a seeded rhythm of swells, stronger with wind.
  if (pressed($('auto-gust'))) {
    gustRng.t += dt;
    if (gustRng.t >= gustRng.next) {
      const w = num('wind');
      gustRng.peak = Math.min(1, (0.3 + 0.7 * w) * (0.5 + 0.5 * Math.abs(Math.sin(gustRng.t * 1.37))));
      gustRng.until = gustRng.t + 2 + 3 * Math.abs(Math.sin(gustRng.t * 0.71));
      gustRng.next = gustRng.until + (6 + 14 * Math.abs(Math.sin(gustRng.t * 0.53))) / (0.4 + w);
    }
    const target = gustRng.t < gustRng.until ? gustRng.peak : 0;
    gustNow += (target - gustNow) * Math.min(1, dt * 1.2);
    /** @type {HTMLInputElement} */ ($('gust')).value = gustNow.toFixed(2);
    $('gust-out').textContent = pct(gustNow);
  } else gustNow = num('gust');

  const ear = earNow();
  voices.setListener(ear.eye, ear.forward);
  voices.setSeason(blend);
  const near = num('near');
  const wxAmt = num('wx');
  const tide = num('tide');

  // The ambience.
  ambience.update({
    waterNear: { still: near, slow: num('stream') * 0.6, running: num('stream') },
    tidePhase: Math.acos(Math.max(-1, Math.min(1, tide * 2 - 1))) / (2 * Math.PI),
    wind: num('wind'), gust: gustNow, hour,
    season: Math.floor(seasonPos), seasonPhase: seasonPos % 1, seasonBlend: blend,
    weather: /** @type {any} */ (weather), camHeight: num('height'), life: 0,
    frost: num('frost'), residents: pressed($('residents')) ? ['frog'] : [],
    rain: weather === 'rain' ? wxAmt : 0, mist: weather === 'mist' ? wxAmt : 0,
    sunriseH: sun.rise, sunsetH: sun.set,
    surfaceNear: { water: near, pads: near * 0.5, reeds: Math.min(1, 0.3 + near * 0.6), grass: Math.max(0.2, 1 - near * 0.5) },
    listener: { x: listener.x, y: 0, z: listener.z },
    eye: ear.eye, forward: ear.forward,
    // One waterfall to the right of the camera target, at the slider's distance.
    falls: num('fall-flow') > 0 && num('fall-dist') < ambRecipe.falls.distance.reachM
      ? [{ pos: [listener.x + num('fall-dist'), num('fall-height') / 2, listener.z], heightM: num('fall-height'), flowM3s: num('fall-flow'), distM: Math.hypot(num('fall-dist'), num('fall-height') / 2) }]
      : [],
  });

  // The frogs: settled, awake (not dormant), content, and in the dusk window (or "call now").
  const dormant = seasonPos >= dormancy[0] || seasonPos < dormancy[1];
  const settled = pressed($('residents'));
  const content = num('mood') >= frogMoods.callFromMood;
  const inWin = chorus.inWindow(hour, sun.dusk);
  const callTime = settled && !dormant && (pressed($('call-now')) || (inWin && content));
  $('t-window').textContent = !settled ? 'no frogs' : dormant ? 'dormant' : pressed($('call-now')) ? 'call now' : inWin ? (content ? 'calling' : 'unsettled') : 'not yet';
  if (started) {
    const audioNow = mixer.ctx.currentTime;
    // The chorus runs on its own clock, 0.15 s ahead of the audio clock, so calls are scheduled.
    const ahead = 0.15;
    const target = audioNow + ahead;
    if (chorus.now() < audioNow - 1) chorus.jumpTo(audioNow);
    chorus.advance(target, { callTime, rateFactor: voices.callRateFactor() }, (f, t) => {
      sound(f, t);
    });
  }

  // Midges: the density by hour like the game (dusk peak, day, night), warmth by season, wind damp.
  const since = ((hour - (sun.set)) % 24 + 36) % 24 - 12;
  const D = midgeDensity;
  let dens = since >= D.duskFromH && since < D.duskToH ? D.dusk : (hour > sun.rise && hour < sun.set ? D.day : D.night);
  dens *= blend.reduce((a, w, i) => a + w * midgeWarmth[i], 0) * (1 - D.windDamp * num('wind'));
  // Midges gather over still water, so they thin when the pond is not near.
  dens *= Math.min(1, 0.4 + near);
  voices.setSwarms([{ id: 'pond-swarm', pos: MIDGE_POS, density: dens }]);
  const heard = voices.swarmsHeard()[0];
  const dist = Math.hypot(MIDGE_POS[0] - ear.eye[0], MIDGE_POS[1] - ear.eye[1], MIDGE_POS[2] - ear.eye[2]);
  $('t-midge').textContent = `${Math.round(dens * 100)} %, ${dist.toFixed(1)} m`;
  $('t-midge-note').textContent = heard ? 'midge density, and how far: heard now' : 'midge density, and how far: too far to hear';

  while (recent.length && nowMs - recent[0] > 60000) recent.shift();
  $('t-calls').textContent = String(recent.length);
  $('t-voices').textContent = `${voices.liveCount()} of ${frogVoice.maxVoices[tier]}`;
  map.setListener(listener.x, listener.z, listener.heading);
  map.setMidge(dens, !!heard);
  pondLife.tick(ear, dt, started);
  bedList.refresh(started);
  const pc = ambience.poolCounts();
  $('pools').innerHTML = Object.entries(pc).map(([k, v]) => `<div class="tile"><b>${v}</b><span>${POOL_NAMES[k] ?? k}</span></div>`).join('');
}

/** @type {Record<string, string>} */
const POOL_NAMES = {
  afterRainDrips: 'drips after rain', firstDrops: 'first drops of rain', mudDrips: 'mud drips at low tide',
  dawnDrips: 'dawn drips', dawnCreaks: 'dawn reed creaks', stalkKnocks: 'dry stalk knocks', bareKnocks: 'bare stalk knocks',
  seedRattles: 'seed rattles in gusts', frostTicks: 'frost ticks', aeolian: 'stalk whistles', dryCrackle: 'dry crackles in rain',
};

setInterval(() => {
  try { tick(); } catch (e) { status(ICON_WARN, `Something went wrong: ${/** @type {Error} */ (e).message}`); console.error(e); }
}, 100);
tick();
