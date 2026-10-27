// @ts-check
// The movement arena's Hollow panel (H0, October 27, 2026): the lantern's flame as the one readout of
// health (doc 16: drawn as the flame itself, no hearts or bars) with a Refill button, the swing's clip
// pick list and its tallies (hits, side and back hits, glanced off an armored front, misses), the
// stand-ins' spawn panel, and what each stand-in last did. DOM only; tools/arena/hollow.js runs it.

/** The flame, drawn: an outer and an inner tongue of fire over the wick, scaled by the fuel left. */
const FLAME = (/** @type {number} */ k) => {
  const h = 14 + 46 * k, w = 9 + 13 * k, y = 70 - h;
  return `<svg viewBox="0 0 60 84" width="60" height="84" aria-hidden="true">
  <path d="M30 ${y} C ${30 + w} ${y + h * 0.45}, ${30 + w * 0.9} ${70 - 2}, 30 70 C ${30 - w * 0.9} ${70 - 2}, ${30 - w} ${y + h * 0.45}, 30 ${y} Z" fill="#E08A5B" stroke="#1E2624" stroke-width="2" stroke-linejoin="round"/>
  <path d="M30 ${y + h * 0.4} C ${30 + w * 0.45} ${y + h * 0.65}, ${30 + w * 0.4} 68, 30 68 C ${30 - w * 0.4} 68, ${30 - w * 0.45} ${y + h * 0.65}, 30 ${y + h * 0.4} Z" fill="#F4D58D"/>
  <path d="M30 70 L30 80" stroke="#1E2624" stroke-width="2" stroke-linecap="round"/>
</svg>`;
};

/**
 * @param {HTMLElement} box where the panel goes
 * @param {{ hollow: any, HR: any, spawn: (kind: string) => void, clear: () => void, reset: () => void, actors: () => any[] }} o
 */
export function createHollowPanel(box, o) {
  const { hollow, HR } = o;
  box.innerHTML = `
    <h2>The lantern</h2>
    <div class="flame-row"><div id="flame"></div><div><p class="big" id="fuel"></p><p class="muted" id="raise"></p></div></div>
    <div class="buttons"><button id="refill">Refill the lantern</button></div>
    <h2>The staff's swing</h2>
    <label class="pick">Left click plays <select id="swing-clip">${Object.keys(HR.swing.clips).map((c) => `<option value="${c}">${c}</option>`).join('')}</select></label>
    <dl id="tally"></dl>
    <h2>Stand-ins</h2>
    <div class="buttons">${Object.entries(HR.foes).map(([k, f]) => `<button data-spawn="${k}">Add a ${/** @type {any} */ (f).name.toLowerCase()}</button>`).join('')}</div>
    <div class="buttons"><button id="foes-reset">Back to one of each</button><button id="foes-clear">Clear them all</button></div>
    <ul class="notes" id="foe-notes"></ul>`;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (box.querySelector(`#${id}`));
  const sel = /** @type {HTMLSelectElement} */ ($('swing-clip'));
  sel.value = hollow.swingClip;
  sel.addEventListener('change', () => { hollow.swingClip = sel.value; sel.blur(); });
  $('refill').addEventListener('click', (e) => { hollow.lantern.refill(); /** @type {HTMLElement} */ (e.currentTarget).blur(); });
  for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (box.querySelectorAll('[data-spawn]'))) b.addEventListener('click', () => { o.spawn(/** @type {string} */ (b.dataset.spawn)); b.blur(); });
  $('foes-reset').addEventListener('click', (e) => { o.reset(); /** @type {HTMLElement} */ (e.currentTarget).blur(); });
  $('foes-clear').addEventListener('click', (e) => { o.clear(); /** @type {HTMLElement} */ (e.currentTarget).blur(); });

  let lastK = -1;
  return {
    /** A few times a second. */
    show() {
      const L = hollow.lantern, k = Math.round(L.share * 20) / 20;
      if (k !== lastK) { $('flame').innerHTML = FLAME(k); lastK = k; }
      $('fuel').textContent = L.out ? 'The lantern is out' : `Fuel ${Math.round(L.fuel)} of ${HR.lantern.fuel}`;
      $('raise').textContent = L.snuffed ? 'Snuffed: an ember, burning nothing.' : L.raised ? `Held up: reaching ${L.reach().toFixed(1)} m, burning faster.` : `Hanging: reaching ${L.reach().toFixed(1)} m. Hold the right mouse button to raise it.`;
      const t = hollow.tally;
      $('tally').innerHTML = `<dt>Hits</dt><dd>${t.hits}</dd><dt>On a side</dt><dd>${t.side}</dd><dt>On the back</dt><dd>${t.back}</dd>`
        + `<dt>Glanced off a front</dt><dd>${t.glanced}</dd><dt>Misses</dt><dd>${t.misses}</dd><dt>Broken</dt><dd>${t.broke}</dd><dt>Hits taken</dt><dd>${t.taken}</dd>`;
      $('foe-notes').innerHTML = o.actors().filter((a) => a.foe).map((a) => `<li>${a.broken ? `${HR.foes[a.kind].name}: broken.` : a.note}</li>`).join('') || '<li>None. Add some above.</li>';
    },
  };
}
