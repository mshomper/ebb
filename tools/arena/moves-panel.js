// @ts-check
// The movement arena's Q and E panel (H0b, October 27, 2026; doc 16, On screen): two round tablets,
// each with its move's drawn icon and its key beneath, no numbers. A waiting move drains to a pale
// outline and refills with ink from the bottom, with a glint round the rim when it is ready; a
// once-a-floor move shows a small wick, lit or spent; a move that spends fuel has a small flame mark
// on its rim; out of seeds or spent, the tablet greys and does nothing. Below: the pick lists, the
// switch between tap to fire and "Ready, then click", the gentler Hollow, a new floor, and sliders
// for every move's numbers and every stand-in's timings, with Copy as recipe blocks. DOM only.

import { hollowIconSvg } from '../../src/ui/icons/icons-hollow.js';

/** A small wick, lit or spent. @param {boolean} lit */
const WICK = (lit) => `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M8 15V9" stroke="#1E2624" stroke-width="1.75" stroke-linecap="round"/>${lit
  ? '<path d="M8 2C6.6 4 6 5.2 6 6.2A2 2 0 0 0 10 6.2C10 5.2 9.4 4 8 2Z" fill="#E08A5B" stroke="#1E2624" stroke-width="1.2"/>'
  : '<path d="M7 6.5C7.5 5.5 8.5 5.5 9 6.5" fill="none" stroke="#8A8F8C" stroke-width="1.2" stroke-linecap="round"/>'}</svg>`;
/** The flame mark on the rim of a move that spends fuel. */
const FLAME = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2C6.4 4.4 5.4 5.9 5.4 7.5A2.6 2.6 0 0 0 10.6 7.5C10.6 5.9 9.6 4.4 8 2Z" fill="#E08A5B" stroke="#1E2624" stroke-width="1.2" stroke-linejoin="round"/></svg>';

/**
 * @param {HTMLElement} box
 * @param {{ layer: any, MR: any, HR: any, MR0: any, HR0: any, FC: any, FC0: any, say: (s: string) => void, blocks: HTMLTextAreaElement }} o
 *   MR0, HR0: the recipes as loaded, to mark what changed
 */
export function createMovesPanel(box, o) {
  const { layer, MR, HR } = o;
  const ids = Object.keys(MR.moves);
  const tracks = [...new Set(ids.map((id) => MR.moves[id].track))];
  const options = tracks.map((t) => `<optgroup label="${t}">${ids.filter((id) => MR.moves[id].track === t)
    .map((id) => `<option value="${id}">${MR.moves[id].rank}. ${MR.moves[id].name}</option>`).join('')}</optgroup>`).join('');
  box.innerHTML = `
    <h2>Q and E</h2>
    <div class="tablets">${['Q', 'E'].map((k) => `
      <div class="peg"><div class="tablet" id="tab-${k}"><div class="ink"></div><div class="glyph"></div><span class="rim-flame"></span><span class="wick"></span></div><span class="key">${k}</span></div>`).join('')}
    </div>
    ${['Q', 'E'].map((k) => `<label class="pick">${k} holds <select id="peg-${k}">${options}</select></label>`).join('')}
    <div class="buttons" id="fire-mode">
      <button data-mode="tap" aria-pressed="true">Tap to fire</button>
      <button data-mode="ready" aria-pressed="false">Ready, then click</button>
    </div>
    <div class="buttons">
      <button id="gentle" aria-pressed="false">Gentler Hollow: off</button>
      <button id="new-floor">A new floor</button>
    </div>
    <p class="muted" id="move-state"></p>
    <h2>Tune a move</h2>
    <label class="pick">Move <select id="tune-move">${options}</select></label>
    <div id="move-sliders"></div>
    <h2>Tune a stand-in</h2>
    <label class="pick">Stand-in <select id="tune-foe">${Object.keys(HR.foes).map((k) => `<option value="${k}">${HR.foes[k].name}</option>`).join('')}</select></label>
    <div id="foe-sliders"></div>
    <h2>The crowd</h2>
    <p class="muted">How many may close in at once (attack slots), where the rest wait (the ring), and how hard bodies push apart. Each stand-in's body size is its bodyM above.</p>
    <div id="crowd-sliders"></div>
    <div class="buttons"><button id="copy-hollow">Copy the Hollow's numbers as recipe blocks</button></div>`;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (box.querySelector(`#${id}`));

  for (const k of /** @type {('Q' | 'E')[]} */ (['Q', 'E'])) {
    const sel = /** @type {HTMLSelectElement} */ ($(`peg-${k}`));
    sel.value = layer.pegs[k];
    sel.addEventListener('change', () => { layer.pegs[k] = sel.value; sel.blur(); });
  }
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (box.querySelectorAll('#fire-mode button'))) b.addEventListener('click', () => {
    layer.mode = b.dataset.mode;
    for (const x of box.querySelectorAll('#fire-mode button')) x.setAttribute('aria-pressed', String(x === b));
    o.say(layer.mode === 'tap' ? 'Tap to fire: Q or E goes at once, at the lock or the dot.' : 'Ready, then click: Q or E shows the mark, steer it, click to fire, the key again puts it away.');
    b.blur();
  });
  $('gentle').addEventListener('click', (e) => {
    layer.moves.gentle = !layer.moves.gentle;
    const b = /** @type {HTMLElement} */ (e.currentTarget);
    b.setAttribute('aria-pressed', String(layer.moves.gentle));
    b.textContent = `Gentler Hollow: ${layer.moves.gentle ? 'on, every wait halved' : 'off'}`;
    b.blur();
  });
  $('new-floor').addEventListener('click', (e) => { layer.newFloor(); o.say('A new floor: once-a-floor moves and seeds are back.'); /** @type {HTMLElement} */ (e.currentTarget).blur(); });

  /** Sliders for every number in an object (its nested numbers too, one level). @param {HTMLElement} el @param {any} obj @param {string} pre */
  function sliders(el, obj, pre) {
    el.innerHTML = '';
    /** @type {[any, string, string][]} */ const rows = [];
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'rank') continue;
      if (typeof v === 'number') rows.push([obj, k, k]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number') rows.push([v, k2, `${k} ${k2}`]);
    }
    rows.forEach(([o2, k, label], i) => {
      // Counts (attack slots) move in whole steps.
      const v = o2[k], max = Math.max(1, Math.ceil(Math.abs(v) * 3)), step = /Slots$/.test(k) ? 1 : max <= 3 ? 0.01 : max <= 30 ? 0.05 : 1;
      const row = document.createElement('div');
      row.className = 'slider';
      row.innerHTML = `<label for="${pre}${i}">${label}</label><input id="${pre}${i}" type="range" min="0" max="${max}" step="${step}" value="${v}"><output for="${pre}${i}"></output>`;
      const input = /** @type {HTMLInputElement} */ (row.querySelector('input')), out = /** @type {HTMLOutputElement} */ (row.querySelector('output'));
      const show = () => { out.textContent = String(o2[k]); };
      input.addEventListener('input', () => { o2[k] = Number(input.value); show(); });
      input.addEventListener('change', () => input.blur());
      show();
      el.append(row);
    });
  }
  const tuneMove = /** @type {HTMLSelectElement} */ ($('tune-move')), tuneFoe = /** @type {HTMLSelectElement} */ ($('tune-foe'));
  const showMove = () => sliders($('move-sliders'), MR.moves[tuneMove.value], 'm');
  const showFoe = () => sliders($('foe-sliders'), HR.foes[tuneFoe.value], 'f');
  tuneMove.addEventListener('change', () => { showMove(); tuneMove.blur(); });
  tuneFoe.addEventListener('change', () => { showFoe(); tuneFoe.blur(); });
  showMove(); showFoe();
  if (HR.crowd) sliders($('crowd-sliders'), HR.crowd, 'c');
  $('copy-hollow').addEventListener('click', async (e) => {
    const line = (/** @type {string} */ k, /** @type {any} */ v, /** @type {any} */ was) => `    "${k}": ${JSON.stringify(v)},${JSON.stringify(v) === JSON.stringify(was) ? '' : '   (changed)'}`;
    const text = ['recipes/world/hollow-moves.json moves:', ...ids.map((id) => line(id, MR.moves[id], o.MR0.moves[id])),
      'recipes/world/hollow.json foes:', ...Object.keys(HR.foes).map((k) => line(k, HR.foes[k], o.HR0.foes[k])),
      'recipes/world/hollow.json:', line('crowd', HR.crowd, o.HR0.crowd),
      'recipes/world/fight-clips.json clips.raiseLantern:', line('layer', o.FC.clips.raiseLantern.layer, o.FC0.clips.raiseLantern.layer)].join('\n');
    o.blocks.value = text;
    try { await navigator.clipboard.writeText(text); o.say('Copied: paste each line over the same entry in those two recipes.'); } catch { o.say('Shown below; copy them from the box.'); }
    /** @type {HTMLElement} */ (e.currentTarget).blur();
  });

  /** Glint once when a tablet comes ready. */
  const wasReady = { Q: true, E: true };
  return {
    show() {
      for (const k of /** @type {('Q' | 'E')[]} */ (['Q', 'E'])) {
        const id = layer.pegs[k], m = MR.moves[id], t = $(`tab-${k}`), why = layer.moves.why(id), r = layer.moves.ready(id);
        const glyph = /** @type {HTMLElement} */ (t.querySelector('.glyph'));
        if (glyph.dataset.id !== id) { glyph.innerHTML = hollowIconSvg(id, 44); glyph.dataset.id = id; }
        /** @type {HTMLElement} */ (t.querySelector('.ink')).style.height = `${Math.round(r * 100)}%`;
        /** @type {HTMLElement} */ (t.querySelector('.rim-flame')).innerHTML = m.sips ? FLAME : '';
        /** @type {HTMLElement} */ (t.querySelector('.wick')).innerHTML = m.once ? WICK(!layer.moves.spent(id)) : '';
        t.classList.toggle('grey', why === 'spent' || why === 'seeds');
        t.classList.toggle('waiting', why === 'waiting');
        t.classList.toggle('readied', layer.readied === k);
        const ready = !why || why === 'busy';
        if (ready && !wasReady[k]) { t.classList.remove('glint'); void t.offsetWidth; t.classList.add('glint'); }
        wasReady[k] = ready;
        t.title = `${m.name} (${m.pose})`;
      }
      const p = layer.moves.playing;
      $('move-state').textContent = `${p ? `Playing: ${MR.moves[p].name}. ` : ''}Seeds in the pack: ${layer.moves.seeds}.${layer.readied ? ` ${MR.moves[layer.pegs[layer.readied]].name} is ready: click to fire, ${layer.readied} again to put it away.` : ''}`;
    },
  };
}
