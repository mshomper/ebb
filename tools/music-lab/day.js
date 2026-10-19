// @ts-check
// Music lab, Day tab (doc 24, "The shape of a day", "The music lab"): runs the real director through
// one or three game days with tools/music-lab/daysim.js and draws what it decided. One row per game
// day, midnight to midnight: the sky's night and twilight, sunrise and sunset, the slot windows the
// director opens (computed the same way as director.js slotAt), every piece as a solid bar in its
// slot's color, every rest as a hatched bar, and the frog window darker while frogs call. Below,
// the silence share against doc 24's target, a list of the pieces and the director's own log.
// Nothing plays; the whole day is simulated in a moment, so every control re-runs it.

import { simulate } from './daysim.js';
import { realize } from '../../src/audio/music/realize.js';

const DAY = 86400;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_LABEL = ['Spring', 'Summer', 'Autumn', 'Winter'];
const STAND_IN_SLOTS = ['morning', 'interlude', 'evening', 'nocturne'];

/** Slot colors (fill), the text color that reads on a solid bar, and labels from long to short. */
const SLOT = /** @type {Record<string, {fill: string, ink: string, labels: string[]}>} */ ({
  morning: { fill: '#D9A23A', ink: '#1E2624', labels: ['morning', 'morn.', 'M'] },
  interlude: { fill: '#6F9A5E', ink: '#FFFDF8', labels: ['interlude', 'inter.', 'I'] },
  evening: { fill: '#C46A45', ink: '#FFFDF8', labels: ['evening', 'eve.', 'E'] },
  frogs: { fill: '#2F6B5E', ink: '#FFFDF8', labels: ['frog window', 'frogs', 'F'] },
  'early-nocturne': { fill: '#7A6FA8', ink: '#FFFDF8', labels: ['early nocturne', 'early noct.', 'N'] },
  nocturne: { fill: '#4D5F8F', ink: '#FFFDF8', labels: ['nocturne', 'noct.', 'N'] },
  hush: { fill: '#8E9895', ink: '#1E2624', labels: ['pre-dawn hush', 'hush', 'H'] },
});
/** The main lane's background: the page's light color by day, a soft cool tint by night, between at twilight. */
const LANE = { day: '#FFFDF8', twilight: '#EEEFF1', night: '#DEE3EC', edge: '#E3D9C9' };
const SLOT_NAME =/** @type {Record<string, string>} */ ({ morning: 'Morning', interlude: 'Interlude', evening: 'Evening', frogs: 'Frog window', 'early-nocturne': 'Early nocturne', nocturne: 'Nocturne', hush: 'Pre-dawn hush' });

const INPUT_STYLE = 'font:800 19px Nunito,sans-serif;width:9em;max-width:100%;padding:10px;border-radius:12px;border:1px solid #CFC3AF;background:#FFFDF8;color:#1E2624';

/** @param {number} h hours, may be past 24 @returns {string} */
function hhmm(h) {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** @param {number} s real seconds */
const realClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * Build the Day tab inside host and run the first day.
 * @param {HTMLElement} host the Day tab's section
 */
export async function initDay(host) {
  const j = async (/** @type {string} */ p) => {
    const res = await fetch(new URL(`../../${p}`, import.meta.url), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${p}: ${res.status}`);
    return res.json();
  };
  host.innerHTML = '<div class="card"><h2>Day</h2><p class="muted">Loading the director and the pieces.</p></div>';
  const [director, sky, seasons, frog, index, rz, vo] = await Promise.all([
    j('recipes/music/director.json'), j('recipes/world/sky.json'), j('recipes/world/seasons.json'), j('recipes/species/frog.json'),
    j('recipes/music/pieces/index.json'), j('recipes/music/realize.json'), j('recipes/music/voicing.json'),
  ]);
  /** @type {any[]} */
  const realPieces = await Promise.all(index.pieces.map((/** @type {string} */ id) => j(`recipes/music/pieces/${id}.json`)));
  /** Every real piece copied once into every slot, for every season and weather. */
  const standIns = realPieces.flatMap((p) => STAND_IN_SLOTS.map((slot) => ({ ...p, id: `${p.id}-as-${slot}`, slots: [slot], seasons: [...SEASONS], weather: undefined, requires: {} })));
  const orbit = sky.orbit;
  const dormancy = seasons.dormancy?.frogs ?? [2.6, 0.3];
  const callAfterDuskH = frog.motion?.moods?.callAfterDuskH ?? [-0.5, 3];
  const rzRecipes = { realize: rz, voicing: vo };
  const midday = director.dayColor.keys.day;
  /** @type {Map<string, number>} realized lengths in real seconds, by piece and seed */
  const lenCache = new Map();
  const realLength = (/** @type {any} */ piece, /** @type {number} */ seed) => {
    const k = `${piece.id}:${seed}`;
    let s = lenCache.get(k);
    if (s === undefined) {
      try { s = realize(piece, { seed, dayColor: midday, available: ['piano', 'pad'] }, rzRecipes).durationS; } catch { s = 120; }
      lenCache.set(k, s);
    }
    return s;
  };

  const opt = {
    season: 0, days: 3, weather: /** @type {'clear'|'cloud'|'rain'|'mist'} */ ('clear'), frogs: true,
    frequency: 'now-and-then', flow: 1, lengths: /** @type {'planned'|'real'} */ ('planned'), pool: 'stand-in', seed: 1,
  };

  /** A row of text buttons, one pressed. @param {string} key @param {[any, string][]} choices @param {string} label */
  const seg = (key, choices, label) => `<div class="seg" role="group" aria-label="${esc(label)}" data-seg="${key}">${choices.map(([v, t]) =>
    `<button type="button" data-v="${esc(JSON.stringify(v))}" aria-pressed="${String(/** @type {any} */ (opt)[key] === v)}">${esc(t)}</button>`).join('')}</div>`;

  host.innerHTML = `
    <div class="card">
      <h2>Day</h2>
      <p class="muted">The director decides when music plays: a morning piece after sunrise, interludes through the day, an evening piece as the light goes gold, silence while the frogs call, perhaps a nocturne late at night, and a rest of a few real minutes after every piece. This runs the game's own director through whole game days in a moment, so you can see the pacing.</p>
      <div class="grid2">
        <div>
          <h3>Season to start in</h3>
          ${seg('season', [[0, 'Spring'], [1, 'Summer'], [2, 'Autumn'], [3, 'Winter']], 'Season to start in')}
          <p class="muted">Each run starts on that season's day 2 at 04:00, before dawn.</p>
          <h3>Game days</h3>
          ${seg('days', [[1, '1 day'], [3, '3 days']], 'Number of game days')}
          <h3>Weather</h3>
          ${seg('weather', [['clear', 'Clear'], ['cloud', 'Cloud'], ['rain', 'Rain'], ['mist', 'Mist']], 'Weather')}
          <h3>Frogs settled</h3>
          ${seg('frogs', [[true, 'Yes'], [false, 'No']], 'Frogs settled')}
          <p class="muted">Frogs sleep in the pond mud from late autumn to early spring, so even settled frogs leave dusk free then.</p>
        </div>
        <div>
          <h3>Music setting</h3>
          ${seg('frequency', [['often', 'Often'], ['now-and-then', 'Now and then'], ['rarely', 'Rarely'], ['off', 'Off']], 'Music setting')}
          <h3>Time flow</h3>
          ${seg('flow', [[1, '1x'], [4, '4x'], [16, '16x']], 'Time flow')}
          <p class="muted">A game day is 24 real minutes at 1x, 6 at 4x and 90 seconds at 16x. Rests are in real time, so faster time fits fewer pieces into a day.</p>
          <h3>Piece lengths</h3>
          ${seg('lengths', [['planned', 'Planned slot lengths'], ['real', 'Real piece lengths']], 'Piece lengths')}
          <p class="muted">Only a short test piece exists yet, so planned lengths show the pacing the finished score will have.</p>
          <h3>Pool</h3>
          ${seg('pool', [['stand-in', 'Stand-in pool'], ['real', 'Real pieces only']], 'Pool')}
          <p class="muted">The stand-in pool copies each piece into every slot, season and weather so every slot has something to play; real pieces only shows what the score can fill today.</p>
        </div>
      </div>
      <h3>Seed</h3>
      <div class="row">
        <input id="dy-seed" inputmode="numeric" aria-label="Seed" style="${INPUT_STYLE}">
        <button type="button" id="dy-new" style="flex:1 1 140px">New seed</button>
        <button type="button" class="big" id="dy-run" style="flex:2 1 220px">Run the day</button>
      </div>
    </div>
    <div class="card">
      <div class="tiles" id="dy-tiles"></div>
      <h3>The day, midnight to midnight</h3>
      <p class="muted">Each row is one game day. The thin strip on top shows when each slot may start. Below it, solid bars are pieces playing, numbered as in the list below, and hatched bars are the rests after them. The lane is tinted cool at night and lighter at twilight; the gold dots on the time line are sunrise and sunset.</p>
      <div id="dy-legend" class="row" style="gap:8px 16px;margin:6px 0 10px"></div>
      <div id="dy-rows"></div>
      <h3>Pieces played</h3>
      <ol class="list" id="dy-list"></ol>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-weight:800;min-height:32px">The director's log</summary>
        <ol class="list" id="dy-log" style="font-size:16px"></ol>
      </details>
    </div>`;

  const $ = (/** @type {string} */ id) => /** @type {any} */ (host.querySelector(`#${id}`));
  $('dy-seed').value = String(opt.seed);

  for (const g of host.querySelectorAll('[data-seg]')) {
    const key = /** @type {string} */ (g.getAttribute('data-seg'));
    for (const b of g.querySelectorAll('button')) b.addEventListener('click', () => {
      /** @type {any} */ (opt)[key] = JSON.parse(b.getAttribute('data-v') ?? 'null');
      for (const o of g.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
      run();
    });
  }
  $('dy-seed').addEventListener('change', () => { const v = parseInt($('dy-seed').value, 10); opt.seed = Number.isFinite(v) ? v >>> 0 : 1; $('dy-seed').value = String(opt.seed); run(); });
  $('dy-new').addEventListener('click', () => { const u = new Uint32Array(1); crypto.getRandomValues(u); opt.seed = u[0] % 100000; $('dy-seed').value = String(opt.seed); run(); });
  $('dy-run').addEventListener('click', () => run());

  $('dy-legend').innerHTML = [
    ...['morning', 'interlude', 'evening', 'frogs', 'early-nocturne', 'nocturne', 'hush'].map((s) => legendItem(`<rect x="1" y="3" width="26" height="14" rx="3" fill="${SLOT[s].fill}"/>`, s === 'hush' ? 'Hush' : SLOT_NAME[s])),
    legendItem(`<defs>${hatchDef('lg-hatch')}</defs><rect x="1" y="3" width="26" height="14" rx="3" fill="url(#lg-hatch)" stroke="#B9AD99"/>`, 'Rest'),
    legendItem(`<rect x="1" y="3" width="26" height="14" rx="3" fill="${LANE.night}" stroke="#CFC3AF"/>`, 'Night'),
  ].join('');

  /** @type {any} */
  let last = null;
  function run() {
    const startDay = opt.season * 7 + 2;
    const pieces = opt.pool === 'stand-in' ? standIns : realPieces;
    const res = simulate({
      recipes: { director, seasons: {} }, pieces, orbit, days: opt.days, flow: opt.flow, seed: opt.seed,
      startDay, startHour: 4, weather: opt.weather, frogsSettled: opt.frogs, frequency: opt.frequency,
      lengths: opt.lengths, realLength, dormancy, callAfterDuskH,
    });
    last = res;
    showTiles(res);
    drawRows();
    showList(res);
  }

  /** @param {any} res */
  function showTiles(res) {
    const no = res.log.filter((/** @type {any} */ l) => l.decision === 'rolled no').length;
    const perDay = res.pieces.length / opt.days;
    $('dy-tiles').innerHTML = `
      <div class="tile" style="grid-column:1 / -1;min-width:0"><span>Silence</span><b>${Math.round(res.silenceShare * 100)} percent</b>
        <span>of real time. Doc 24's target is 55 to 65 percent. Over 12 seeds, 3 days at 1x, "Now and then" (the default) measures 56 to 70 percent (middle 62) and "Often" 54 to 63. One day is a small sample; 3 days steadies it.</span></div>
      <div class="tile"><span>Pieces per game day</span><b>${perDay.toFixed(perDay % 1 ? 1 : 0)}</b><span>${res.pieces.length} in all</span></div>
      <div class="tile"><span>Real time simulated</span><b>${(res.endRealS / 60).toFixed(res.endRealS % 60 ? 1 : 0)} min</b><span>${opt.days} game ${opt.days === 1 ? 'day' : 'days'} at ${opt.flow}x</span></div>
      <div class="tile"><span>Slots that rolled no</span><b>${no}</b><span>chances that came up empty</span></div>`;
  }

  /** @param {any} res */
  function showList(res) {
    const at = (/** @type {number} */ realS) => {
      const g = res.startT + realS * 60 * res.flow;
      const day = Math.floor(g / DAY);
      return { day, label: `${SEASON_LABEL[Math.floor(day / 7) % 4]} day ${day % 7}, ${hhmm((g - day * DAY) / 3600)}` };
    };
    $('dy-list').innerHTML = res.pieces.length
      ? res.pieces.map((/** @type {any} */ p) => `<li><b>${esc(at(p.startRealS).label)}</b> · ${esc(SLOT_NAME[p.slot] ?? p.slot)} · ${esc(p.id)} · seed ${p.seed} · ${((Math.min(p.endRealS, res.endRealS) - p.startRealS) / 60).toFixed(1)} real min${p.endRealS > res.endRealS ? ' (still playing when the run ends)' : ''}${p.note ? ` · ${esc(p.note)}` : ''}</li>`).join('')
      : `<li class="muted">${opt.frequency === 'off' ? 'Music is off, so nothing plays.' : 'Nothing played. Try the stand-in pool, another seed or another season.'}</li>`;
    $('dy-log').innerHTML = res.log.map((/** @type {any} */ l) => `<li>${esc(at(l.realS).label)} (real ${realClock(l.realS)})${l.slot ? ` · ${esc(SLOT_NAME[l.slot] ?? l.slot)}` : ''}: ${esc(l.decision)}</li>`).join('') || '<li class="muted">The director logged nothing.</li>';
  }

  // ---------------- the timeline ----------------

  const measure = document.createElement('canvas').getContext('2d');
  const textW = (/** @type {string} */ s, /** @type {number} */ px) => {
    if (!measure) return s.length * px * 0.55;
    measure.font = `700 ${px}px Nunito, system-ui, sans-serif`;
    return measure.measureText(s).width;
  };
  /** The longest label that fits a width, or ''. @param {string[]} labels @param {number} w @param {number} px */
  const fit = (labels, w, px) => labels.find((l) => textW(l, px) + 8 <= w) ?? '';

  /** Is any frog awake (settled and not dormant) at a game time? @param {number} gameT */
  const frogsAwakeAt = (gameT) => {
    if (!opt.frogs) return false;
    const pos = ((gameT / (7 * DAY)) % 4 + 4) % 4;
    const [a, b] = dormancy;
    return !(b <= a ? pos >= a || pos < b : pos >= a && pos < b);
  };

  /**
   * The slot windows of one game day, in hours from its midnight, exactly as director.js slotAt
   * resolves them in order: last night's nocturne, the pre-dawn hush, morning, interludes, evening,
   * the frog window (or an early nocturne when no frog is awake) and tonight's nocturne.
   * @param {any} d dayInfo(day) @param {any} prev dayInfo(day - 1)
   */
  const windows = (d, prev) => {
    const S = director.slots;
    /** @type {{slot: string, from: number, to: number}[]} */
    const w = [];
    const add = (/** @type {string} */ slot, /** @type {number} */ from, /** @type {number} */ to) => {
      const a = Math.max(0, from), b = Math.min(24, to);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) w.push({ slot, from: a, to: b });
    };
    const hushFrom = d.sunrise - S.preDawnHushH;
    if (prev) add('nocturne', prev.dusk + S.nocturne.fromDuskH - 24, Math.min(d.dawn + S.nocturne.toDawnH, hushFrom));
    add('hush', hushFrom, d.sunrise);
    add('morning', d.sunrise, d.sunrise + S.morning.withinH);
    const interTo = d.falling[S.interlude.toSunDeg] ?? 24;
    add('interlude', Math.max(d.sunrise + S.interlude.fromSunriseH, d.sunrise + S.morning.withinH), interTo);
    const frogFrom = d.dusk + S.frogWindow.fromDuskH, frogTo = d.dusk + S.frogWindow.toDuskH;
    add('evening', Math.max(d.falling[S.evening.sunDeg[0]], interTo), Math.min(d.falling[S.evening.sunDeg[1]], frogFrom));
    const awake = frogsAwakeAt(d.day * DAY + ((frogFrom + frogTo) / 2) * 3600);
    add(awake ? 'frogs' : 'early-nocturne', frogFrom, frogTo);
    add('nocturne', Math.max(d.dusk + S.nocturne.fromDuskH, frogTo), 24);
    return w;
  };

  function drawRows() {
    const res = last;
    if (!res) return;
    const rows = $('dy-rows');
    const W = Math.max(240, Math.floor(rows.clientWidth || host.clientWidth || 320));
    const px = 14;
    const padL = 1, padR = 1;
    const x = (/** @type {number} */ h) => padL + (h / 24) * (W - padL - padR);
    // Slot strip, then the main lane, then the time line with its labels.
    const stripY = 0, stripH = 8, laneY = 12, laneH = 38, axisY = laneY + laneH + 8, labelY = axisY + 21, H = labelY + 5;
    const endGameT = res.startT + res.endRealS * 60 * res.flow;
    const toGame = (/** @type {number} */ realS) => res.startT + realS * 60 * res.flow;

    rows.innerHTML = res.days.map((/** @type {any} */ d, /** @type {number} */ i) => {
      const day0 = d.day * DAY;
      const prev = i > 0 ? res.days[i - 1] : null;
      const hatch = `dyh-${i}`, clip = `dyc-${i}`;
      const rect = (/** @type {number} */ h0, /** @type {number} */ h1, /** @type {number} */ y, /** @type {number} */ hh, /** @type {string} */ attrs) =>
        `<rect x="${x(h0).toFixed(1)}" y="${y}" width="${Math.max(0, x(h1) - x(h0)).toFixed(1)}" height="${hh}" ${attrs}/>`;
      /** @type {string[]} */
      const parts = [`<defs>${hatchDef(hatch)}<clipPath id="${clip}">${rect(0, 24, laneY, laneH, 'rx="6"')}</clipPath></defs>`];

      // Slot strip: color only, the legend names them.
      for (const w of windows(d, prev)) parts.push(rect(w.from, w.to, stripY, stripH, `rx="3" fill="${SLOT[w.slot].fill}"${w.slot === 'frogs' ? '' : ' fill-opacity="0.75"'}`));

      // Main lane background: day, twilight and night.
      /** @type {string[]} */
      const lane = [rect(0, 24, laneY, laneH, `fill="${LANE.day}"`)];
      const tint = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ fill) => {
        const a1 = Math.max(0, a), b1 = Math.min(24, b);
        if (Number.isFinite(a1) && Number.isFinite(b1) && b1 > a1) lane.push(rect(a1, b1, laneY, laneH, `fill="${fill}"`));
      };
      tint(0, d.dawn, LANE.night); tint(d.dawn, d.sunrise, LANE.twilight); tint(d.sunset, d.dusk, LANE.twilight); tint(d.dusk, 24, LANE.night);

      // Rests and pieces, in game time, cut to this row; parts of the day not simulated stay blank.
      const span = (/** @type {number} */ g0, /** @type {number} */ g1) => {
        const a = Math.max(g0, day0, res.startT), b = Math.min(g1, day0 + DAY, endGameT);
        return b > a ? [(a - day0) / 3600, (b - day0) / 3600] : null;
      };
      for (const r of res.rests) {
        const s = span(toGame(r.fromRealS), toGame(r.toRealS));
        if (s) lane.push(rect(s[0], s[1], laneY + 9, laneH - 18, `rx="3" fill="url(#${hatch})" stroke="#B9AD99"`));
      }
      res.pieces.forEach((/** @type {any} */ p, /** @type {number} */ n) => {
        const s = span(toGame(p.startRealS), toGame(p.endRealS));
        if (!s) return;
        const c = SLOT[p.slot] ?? SLOT.interlude;
        const x0 = x(s[0]), w = Math.max(3, x(s[1]) - x0);
        lane.push(`<rect x="${x0.toFixed(1)}" y="${laneY + 3}" width="${w.toFixed(1)}" height="${laneH - 6}" rx="4" fill="${c.fill}"><title>${esc(`${n + 1}. ${SLOT_NAME[p.slot] ?? p.slot}, ${p.id}, seed ${p.seed}`)}</title></rect>`);
        // "5 morning" if it fits, else "5", else nothing: a label never spills out of its bar.
        const label = fit([`${n + 1} ${c.labels[0]}`, `${n + 1}`], w, px);
        if (label) lane.push(`<text x="${(x0 + w / 2).toFixed(1)}" y="${laneY + laneH / 2 + 5}" text-anchor="middle" style="fill:${c.ink}">${esc(label)}</text>`);
      });
      parts.push(`<g clip-path="url(#${clip})">${lane.join('')}</g>`, rect(0, 24, laneY, laneH, `rx="6" fill="none" stroke="${LANE.edge}"`));

      // Time line: hour ticks, labels at 0, 6, 12, 18 and 24, sunrise and sunset as dots on the line.
      parts.push(`<line x1="${x(0)}" x2="${x(24)}" y1="${axisY}" y2="${axisY}" stroke="#B9AD99" stroke-width="1.5"/>`);
      for (let h = 0; h <= 24; h += 3) {
        const big = h % 6 === 0;
        parts.push(`<line x1="${x(h).toFixed(1)}" x2="${x(h).toFixed(1)}" y1="${axisY - (big ? 4 : 2)}" y2="${axisY + (big ? 4 : 2)}" stroke="#8E9895"/>`);
        if (big) parts.push(`<text x="${x(h).toFixed(1)}" y="${labelY}" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}">${String(h).padStart(2, '0')}:00</text>`);
      }
      for (const h of [d.sunrise, d.sunset]) if (Number.isFinite(h)) parts.push(`<circle cx="${x(h).toFixed(1)}" cy="${axisY}" r="4.5" fill="#E6B84A" stroke="#B8801F" stroke-width="1.5"/>`);

      const head = `${SEASON_LABEL[Math.floor(d.day / 7) % 4]} day ${d.day % 7}`;
      const sun = Number.isFinite(d.sunrise) ? `sunrise ${hhmm(d.sunrise)}, sunset ${hhmm(d.sunset)}` : '';
      const frogNote = opt.frogs ? (frogsAwakeAt(day0 + (d.dusk + 1) * 3600) ? 'frogs awake at dusk' : 'frogs asleep in the mud') : 'no frogs';
      return `<div style="margin:14px 0 6px"><b style="font-size:17px">${esc(head)}</b> <span class="muted">${esc(sun)} · ${frogNote}</span></div>
        <svg class="chart dy-row" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto" role="img" aria-label="${esc(`${head}: ${sun}`)}">${parts.join('')}</svg>`;
    }).join('');
    // svg.chart text in the lab's stylesheet is 13 px; the rows' labels are 14 px.
    for (const t of rows.querySelectorAll('text')) /** @type {any} */ (t).style.font = `700 ${px}px Nunito, system-ui, sans-serif`;
  }

  let lastW = 0;
  new ResizeObserver(() => {
    const w = Math.floor($('dy-rows').clientWidth);
    if (w && Math.abs(w - lastW) > 1) { lastW = w; drawRows(); }
  }).observe($('dy-rows'));
  await document.fonts?.ready;
  run();
}

/** @param {string} id */
function hatchDef(id) {
  return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#F4EEE4"/><line x1="0" y1="0" x2="0" y2="8" stroke="#B9AD99" stroke-width="3"/></pattern>`;
}

/** @param {string} swatch svg contents, 28 by 20 @param {string} label */
function legendItem(swatch, label) {
  return `<span style="display:inline-flex;align-items:center;gap:6px;font-size:16px"><svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">${swatch}</svg>${label}</span>`;
}
