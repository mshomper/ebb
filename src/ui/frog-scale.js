// @ts-check
// The frog size preview panel (?frogscale, ahead of S6): step between six real-size frogs around
// the pond, look at one from 3 m, 1 m or 40 cm, and try them at real size, 1.5 or 2.5 times. Also
// says how long the pond's edge is, for setting how many frogs it could hold. Camera moves go out
// as `camera.focus` actions; the frogs come from app.js (`frogScale`). Styles: frog-scale.css.

import { dispatch } from '../input/actions.js';

/**
 * @param {HTMLElement} parent
 * @param {{ recipe: any, find: () => any, setSize: (s: number) => void, size: number }} fs
 * @returns {() => void} dispose
 */
export function mountFrogScale(parent, fs) {
  const P = fs.recipe.preview;
  const root = document.createElement('section');
  root.className = 'ebb-frogscale';
  root.setAttribute('aria-label', 'Frog size preview');
  let frog = 0, view = -1;
  /** @type {any} */ let found = null;

  const sizeLabel = (/** @type {number} */ s) => (s === 1 ? 'Real' : `${s}x`);
  function render() {
    const spots = found?.spots ?? [];
    const s = spots[frog];
    const ready = !!spots.length;
    root.innerHTML = `
      <div class="ebb-frogscale__head"><b>Frog size</b>
        <button type="button" class="ebb-frogscale__hide" data-act="hide">Hide</button></div>
      <div class="ebb-frogscale__body">
        <p class="ebb-frogscale__line">${ready
          ? `Pond edge about ${found.edgeM} m. At one frog per ${P.frogsPerEdgeM} m, about ${Math.round(found.edgeM / P.frogsPerEdgeM)} frogs.`
          : 'Waiting for the pond to settle.'}</p>
        <div class="ebb-frogscale__row"><span>Frog ${ready ? `${frog + 1} of ${spots.length}, ${s.where}` : ''}</span>
          <button type="button" data-act="next" ${ready ? '' : 'disabled'}>Next frog</button></div>
        <div class="ebb-frogscale__label">Look from</div>
        <div class="ebb-frogscale__row">${P.views.map((/** @type {any} */ v, /** @type {number} */ i) =>
          `<button type="button" data-view="${i}" aria-pressed="${view === i}" ${ready ? '' : 'disabled'}>${v.label}</button>`).join('')}</div>
        <div class="ebb-frogscale__label">Size</div>
        <div class="ebb-frogscale__row">${P.sizes.map((/** @type {number} */ z) =>
          `<button type="button" data-size="${z}" aria-pressed="${fs.size === z}">${sizeLabel(z)}</button>`).join('')}</div>
      </div>`;
  }

  function look() {
    const s = found?.spots?.[frog];
    if (!s || view < 0) return;
    const v = P.views[view];
    dispatch({ type: 'camera.focus', x: s.x, z: s.z, y: s.y + 0.02 * fs.size, distance: Math.max(v.distanceM, 0.17 * fs.size), pitchDeg: v.pitchDeg });
  }

  root.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
    if (!b) return;
    if (b.dataset.act === 'hide') { root.classList.toggle('is-hidden'); b.textContent = root.classList.contains('is-hidden') ? 'Show' : 'Hide'; return; }
    if (b.dataset.act === 'next' && found) { frog = (frog + 1) % found.spots.length; if (view < 0) view = 1; look(); }
    if (b.dataset.view) { view = Number(b.dataset.view); look(); }
    if (b.dataset.size) { fs.setSize(Number(b.dataset.size)); look(); }
    // On a phone the open panel would cover the frog in the middle of the screen: tuck it away
    // after a view is chosen ("Show" brings it back).
    const tuck = window.matchMedia('(max-width: 560px)').matches && (b.dataset.view || b.dataset.act === 'next' || b.dataset.size);
    const hidden = root.classList.contains('is-hidden') || !!tuck;
    render();
    if (hidden) {
      root.classList.add('is-hidden');
      const hide = root.querySelector('[data-act="hide"]');
      if (hide) hide.textContent = 'Show';
    }
  });
  // Keep pointer and wheel input on the panel from reaching the island.
  for (const ev of ['pointerdown', 'pointermove', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });

  // The pond needs the water summary and the live water first.
  const poll = setInterval(() => {
    const f = fs.find();
    if (f) { found = f; clearInterval(poll); render(); }
  }, 700);

  render();
  parent.appendChild(root);
  return () => { clearInterval(poll); root.remove(); };
}
