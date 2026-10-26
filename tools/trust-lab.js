// @ts-check
// The trust lab (P2h, docs/future/13 8.6): one chart per species with a presence block, trust over
// played days for the keeper's habit (recipes/world/treats.json labHabit), from
// src/world/creatures/pace.js, which runs the game's own trust rules. Curves: today (main before P2h),
// no treats, a treat a day, and a treat a day with the meadowsweet boon and with the meadowsweet and
// chamomile blend (recipes/world/cook.json boons). Sliders for the habit and each species' numbers;
// the days to each word under each chart; the tuned numbers as recipe lines to paste back.

import { paceCurve, topWord } from '../src/world/creatures/pace.js';
import { TRUST_WORDS, maxTrust } from '../src/world/creatures/trust.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const get = (/** @type {string} */ p) => fetch(`../recipes/${p}.json`).then((r) => r.json());

const SPECIES = [['frog', 'Frogs'], ['minnow', 'Minnows'], ['dragonfly', 'Dragonflies'], ['damselfly', 'Damselflies'], ['turtle', 'Turtles']];
const [treats, cook, ...recs] = await Promise.all([get('world/treats'), get('world/cook'), ...SPECIES.map(([k]) => get(`species/${k}`))]);
/** Main before P2h (36369e4): watching a minute and a meal. */
const TODAY = { frog: [0.012, 0.06], minnow: [0.012, 0.06], dragonfly: [0.015, 0], damselfly: [0.015, 0], turtle: [0.01, 0] };
const WORD = (/** @type {string} */ w) => w[0].toUpperCase() + w.slice(1);
const DAYS = 10;

/** The species as tuned (copies), keyed like SPECIES. */
const R = Object.fromEntries(SPECIES.map(([k], i) => [k, structuredClone(recs[i])]));
const H = { ...treats.labHabit, meadowsweet: cook.boons.meadowsweet.trust, blend: cook.boons['meadowsweet+chamomile'].trust };

const CURVES = [
  { id: 'today', label: 'Today', color: '#8E8C84', dash: true },
  { id: 'none', label: 'No treats', color: '#4F7F95' },
  { id: 'treat', label: 'A treat a day', color: '#4a6a47', treat: true },
  { id: 'mead', label: 'Treat and meadowsweet', color: '#B0674A', treat: true, boost: 'meadowsweet' },
  { id: 'blend', label: 'Treat and the blend', color: '#6B4E7A', treat: true, boost: 'blend' },
];

/** Knobs: [object, key, label, min, max, step]. */
function knob(/** @type {any} */ obj, /** @type {string} */ key, /** @type {string} */ label, /** @type {number} */ min, /** @type {number} */ max, /** @type {number} */ step) {
  const l = document.createElement('label');
  const v = document.createElement('b');
  const r = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: obj[key] });
  const show = () => { v.textContent = String(obj[key]); };
  r.addEventListener('input', () => { obj[key] = Number(r.value); show(); draw(); });
  l.append(label, v, r);
  show();
  return l;
}

$('habit').append(
  knob(H, 'sitMin', 'Minutes sitting near it', 0, 20, 1),
  knob(H, 'standMin', 'Minutes standing near it', 0, 20, 1),
  knob(H, 'feeds', 'Meals a day (frogs, minnows)', 0, 3, 1),
  knob(H, 'meadowsweet', 'Meadowsweet boon', 1, 1.3, 0.01),
  knob(H, 'blend', 'Meadowsweet and chamomile', 1, 1.4, 0.01),
);

/** Each species' card: chart, table, its own knobs. */
const cards = SPECIES.map(([k, name]) => {
  const card = document.createElement('div');
  card.className = 'card';
  const P = R[k].presence;
  const knobs = document.createElement('div');
  knobs.className = 'knobs';
  knobs.append(knob(P.watch, 'trustPerMin', 'Watching, a minute', 0, 0.02, 0.0001));
  if ((P.feedTrust ?? 0) > 0) knobs.append(knob(P, 'feedTrust', 'A meal', 0, 0.1, 0.001), knob(P, 'treatFeeds', 'A treat, in meals', 0, 6, 0.1));
  card.innerHTML = `<h2>${name}</h2><div class="legend"></div><div class="chart"></div><table></table>`;
  card.append(knobs);
  $('charts').append(card);
  return { k, card };
});

/** The curves this species has (no treat lines for a species that takes none). @param {any} rec */
const curvesOf = (rec) => CURVES.filter((c) => !c.treat || (rec.presence.treatFeeds ?? 0) > 0);

/** One curve's result. @param {string} k @param {any} c */
function run(k, c) {
  const rec = R[k];
  if (c.id === 'today') {
    const [w, f] = /** @type {any} */ (TODAY)[k];
    const old = { ...rec, presence: { ...rec.presence, watch: { ...rec.presence.watch, trustPerMin: w }, feedTrust: f, treatFeeds: 0 } };
    return paceCurve(old, { ...H, treat: false }, DAYS);
  }
  return paceCurve(rec, { ...H, treat: !!c.treat, boost: c.boost ? /** @type {any} */ (H)[c.boost] : 1 }, DAYS);
}

const fmt = (/** @type {number | undefined} */ d) => (d === undefined ? 'later' : `day ${d.toFixed(1)}`);

function draw() {
  for (const { k, card } of cards) {
    const rec = R[k], P = rec.presence, top = maxTrust(P), cs = curvesOf(rec);
    const res = cs.map((c) => ({ c, r: run(k, c) }));
    const W = 460, Hh = 260, L = 76, B = 30, T = 10, Rr = 10;
    const yMax = Math.min(1, top + 0.05);
    const x = (/** @type {number} */ d) => L + (d / DAYS) * (W - L - Rr), y = (/** @type {number} */ t) => Hh - B - (t / yMax) * (Hh - B - T);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${k} trust over played days">`;
    P.bands.forEach((/** @type {number} */ b, /** @type {number} */ i) => {
      if (b > top) return;
      s += `<line x1="${L}" x2="${W - Rr}" y1="${y(b)}" y2="${y(b)}" stroke="#E3D9C9" stroke-width="2"/>`;
      s += `<text x="${L - 6}" y="${y(b) + 5}" text-anchor="end">${WORD(TRUST_WORDS[i + 1])}</text>`;
    });
    s += `<text x="${L - 6}" y="${y(0) - 4}" text-anchor="end">Wary</text>`;
    s += `<line x1="${L}" x2="${W - Rr}" y1="${y(top)}" y2="${y(top)}" stroke="#B0674A" stroke-width="1.5" stroke-dasharray="2 5"/><text x="${L + 6}" y="${y(top) - 5}">as far as it goes</text>`;
    if (P.namingTrust) s += `<line x1="${L}" x2="${W - Rr}" y1="${y(P.namingTrust)}" y2="${y(P.namingTrust)}" stroke="#4A5551" stroke-width="1" stroke-dasharray="1 4"/><text x="${W - Rr - 4}" y="${y(P.namingTrust) - 5}" text-anchor="end">can be named</text>`;
    for (let d = 0; d <= DAYS; d += 2) s += `<text x="${x(d)}" y="${Hh - 8}" text-anchor="middle">${d}</text>`;
    s += `<line x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}" stroke="#CFC3AF" stroke-width="2"/>`;
    for (const { c, r } of res) {
      const pts = r.trust.map((t, d) => `${x(d).toFixed(1)},${y(t).toFixed(1)}`).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="${c.color}" stroke-width="${c.dash ? 2.5 : 3}" ${c.dash ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round"/>`;
    }
    s += `</svg>`;
    card.querySelector('.chart').innerHTML = s;
    card.querySelector('.legend').innerHTML = res.map(({ c }) => `<span><i class="${c.dash ? 'dash' : ''}" style="background:${c.color}"></i>${c.label}</span>`).join('');
    const words = TRUST_WORDS.slice(1, TRUST_WORDS.indexOf(/** @type {any} */ (topWord(rec))) + 1);
    card.querySelector('table').innerHTML = `<tr><th>Played days to</th>${words.map((w) => `<th>${WORD(w)}</th>`).join('')}</tr>`
      + res.map(({ c, r }) => `<tr><td><span class="sw" style="background:${c.color}"></span>${c.label}</td>${words.map((w) => `<td class="n">${fmt(r.at[w])}</td>`).join('')}</tr>`).join('');
  }
  // Summary: days to the top word, per species and curve.
  $('summary').innerHTML = `<tr><th>Species</th><th>Top word</th>${CURVES.map((c) => `<th>${c.label}</th>`).join('')}</tr>`
    + SPECIES.map(([k, name]) => {
      const rec = R[k], top = topWord(rec), cs = curvesOf(rec);
      return `<tr><td>${name}</td><td>${WORD(top)}</td>${CURVES.map((c) => `<td class="n">${cs.includes(c) ? fmt(run(k, c).at[top]).replace('day ', '') : ''}</td>`).join('')}</tr>`;
    }).join('');
  $('json').value = SPECIES.map(([k]) => {
    const P = R[k].presence;
    const parts = [`"trustPerMin": ${P.watch.trustPerMin}`];
    if ((P.feedTrust ?? 0) > 0) parts.push(`"feedTrust": ${P.feedTrust}`, `"treatFeeds": ${P.treatFeeds}`);
    return `${k}.json presence: ${parts.join(', ')}`;
  }).join('\n') + `\ncook.json boons: meadowsweet ${H.meadowsweet}, meadowsweet+chamomile ${H.blend}\ntreats.json labHabit: ${JSON.stringify({ sitMin: H.sitMin, standMin: H.standMin, feeds: H.feeds })}`;
}

$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('json').value); $('copied').textContent = 'Copied.'; } catch { $('json').select(); $('copied').textContent = 'Selected; press Ctrl+C.'; }
});

draw();
