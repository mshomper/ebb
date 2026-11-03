// @ts-check
// The move arena's "How the moves feel" panel (the cinematic pass, November 3, 2026): the Camera
// motion setting (0 off to 1 full), switches for the time bends and the flash shadows, sliders for
// the camera's kick and shake, each move's beats and the swing's contact, the sound cues counted so
// far (no audio yet), and Copy as recipe blocks for recipes/world/hollow-cine.json. DOM only.

/**
 * @param {HTMLElement} box
 * @param {{ CR: any, CR0: any, cine: any, MR: any, say: (s: string) => void, blocks: HTMLTextAreaElement }} o
 */
export function createCinePanel(box, o) {
  const { CR, cine, MR } = o;
  const ids = Object.keys(CR.moves);
  box.innerHTML = `
    <h2>How the moves feel</h2>
    <p class="muted">The camera, the clock and the lantern take part in each move. Camera motion turns it all down, to off.</p>
    <div class="slider"><label for="cine-amount">Camera motion</label><input id="cine-amount" type="range" min="0" max="1" step="0.05" value="${CR.camera.amount}"><output for="cine-amount"></output></div>
    <div class="buttons">
      <button id="cine-time" aria-pressed="${CR.time.on}">Hit-stop and slow-down: ${CR.time.on ? 'on' : 'off'}</button>
      <button id="cine-shadows" aria-pressed="${CR.shadows.on}">Flash shadows: ${CR.shadows.on ? 'on' : 'off'}</button>
    </div>
    <h2>The camera's kick and shake</h2>
    <div id="cine-cam"></div>
    <h2>Tune a move's beats</h2>
    <label class="pick">Move <select id="cine-move">${ids.map((id) => `<option value="${id}">${MR.moves[id]?.name ?? id}</option>`).join('')}<option value="contact">The staff's swing landing</option></select></label>
    <div id="cine-beats"></div>
    <h2>Sound cues sent</h2>
    <p class="muted" id="cine-cues">None yet. Each beat sends one; the sounds come later.</p>
    <div class="buttons"><button id="cine-copy">Copy the feel as recipe blocks</button></div>`;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (box.querySelector(`#${id}`));

  const amount = /** @type {HTMLInputElement} */ ($('cine-amount'));
  const amountOut = /** @type {HTMLOutputElement} */ (box.querySelector('output[for=cine-amount]'));
  const showAmount = () => { amountOut.textContent = CR.camera.amount === 0 ? 'off' : `${Math.round(CR.camera.amount * 100)} %`; };
  amount.addEventListener('input', () => { CR.camera.amount = Number(amount.value); showAmount(); });
  amount.addEventListener('change', () => amount.blur());
  showAmount();
  /** @param {string} id @param {() => boolean} get @param {(v: boolean) => void} set @param {string} name */
  const toggle = (id, get, set, name) => $(id).addEventListener('click', (e) => {
    set(!get());
    const b = /** @type {HTMLElement} */ (e.currentTarget);
    b.setAttribute('aria-pressed', String(get())); b.textContent = `${name}: ${get() ? 'on' : 'off'}`; b.blur();
  });
  toggle('cine-time', () => CR.time.on, (v) => { CR.time.on = v; cine.time.on = v; }, 'Hit-stop and slow-down');
  toggle('cine-shadows', () => CR.shadows.on, (v) => { CR.shadows.on = v; }, 'Flash shadows');

  /** Sliders for every number in an object, down two levels (a beat's push, its kick). @param {HTMLElement} el @param {any} obj @param {string} pre */
  function sliders(el, obj, pre) {
    el.innerHTML = '';
    /** @type {[any, string, string][]} */ const rows = [];
    const walk = (/** @type {any} */ v, /** @type {string} */ label, depth = 0) => {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'number') rows.push([v, k, `${label}${k}`]);
        else if (x && typeof x === 'object' && !Array.isArray(x) && depth < 2) walk(x, `${label}${k} `, depth + 1);
      }
    };
    walk(obj, '');
    if (!rows.length) { el.innerHTML = '<p class="muted">No numbers to tune here.</p>'; return; }
    rows.forEach(([o2, k, label], i) => {
      const v = o2[k], neg = v < 0, max = Math.max(1, Math.ceil(Math.abs(v) * 3)), step = max <= 3 ? 0.01 : max <= 30 ? 0.05 : 1;
      const row = document.createElement('div');
      row.className = 'slider';
      row.innerHTML = `<label for="${pre}${i}">${label}</label><input id="${pre}${i}" type="range" min="${neg ? -max : 0}" max="${neg ? 0 : max}" step="${step}" value="${v}"><output for="${pre}${i}"></output>`;
      const input = /** @type {HTMLInputElement} */ (row.querySelector('input')), out = /** @type {HTMLOutputElement} */ (row.querySelector('output'));
      const show = () => { out.textContent = String(o2[k]); };
      input.addEventListener('input', () => { o2[k] = Number(input.value); show(); });
      input.addEventListener('change', () => input.blur());
      show();
      el.append(row);
    });
  }
  sliders($('cine-cam'), { kick: CR.camera.kick, shake: CR.camera.shake, time: { stopRate: CR.time.stopRate, maxStopS: CR.time.maxStopS } }, 'cc');
  const pick = /** @type {HTMLSelectElement} */ ($('cine-move'));
  const showBeats = () => sliders($('cine-beats'), pick.value === 'contact' ? CR.contact : CR.moves[pick.value], 'cb');
  pick.addEventListener('change', () => { showBeats(); pick.blur(); });
  showBeats();

  $('cine-copy').addEventListener('click', async (e) => {
    const line = (/** @type {string} */ k, /** @type {any} */ v, /** @type {any} */ was) => `    "${k}": ${JSON.stringify(v)},${JSON.stringify(v) === JSON.stringify(was) ? '' : '   (changed)'}`;
    const text = ['recipes/world/hollow-cine.json:', ...['camera', 'time', 'shadows', 'contact'].map((k) => line(k, CR[k], o.CR0[k])),
      'recipes/world/hollow-cine.json moves:', ...ids.map((id) => line(id, CR.moves[id], o.CR0.moves[id]))].join('\n');
    o.blocks.value = text;
    try { await navigator.clipboard.writeText(text); o.say('Copied: paste each line over the same entry in hollow-cine.json.'); } catch { o.say('Shown below; copy them from the box.'); }
    /** @type {HTMLElement} */ (e.currentTarget).blur();
  });

  return {
    show() {
      const c = Object.entries(cine.cues);
      $('cine-cues').textContent = c.length ? c.map(([k, n]) => `${k} ${n}`).join(', ') : 'None yet. Each beat sends one; the sounds come later.';
    },
  };
}
