// @ts-check
// The pond tier on the listening page (doc 25 "Creature voices"): a minnow's sip at a chosen
// distance in front of you, once or now and then, and one dragonfly hovering, darting past or
// perched at a chosen distance, through the same voices the game uses (src/audio/voices.js).

import { stream } from '../../src/core/rng.js';

/**
 * @param {ReturnType<typeof import('../../src/audio/voices.js').createVoices>} voices
 * @param {any} wings the dragonfly wing recipe (wingRecipe), for its dart speed and reach
 */
export function createPondLife(voices, wings) {
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const num = (/** @type {string} */ id) => Number(/** @type {HTMLInputElement} */ ($(id)).value);
  const rng = stream(20261020, 0x50d);
  /** @type {'none'|'hover'|'dart'|'perch'} */ let mode = 'none';
  let t = 0, nextSip = 0;

  for (const id of ['sip-dist', 'df-dist']) {
    const input = /** @type {HTMLInputElement} */ ($(id));
    const show = () => { $(`${id}-out`).textContent = `${Number(input.value).toFixed(1)} m`; };
    input.addEventListener('input', show);
    show();
  }
  for (const b of $('df-mode').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      mode = /** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.m);
      for (const o of $('df-mode').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
    });
  }
  $('sip-auto').addEventListener('click', () => $('sip-auto').setAttribute('aria-pressed', String($('sip-auto').getAttribute('aria-pressed') !== 'true')));

  /** @type {{eye: number[], forward: number[]}} */ let ear = { eye: [0, 1, 0], forward: [0, 0, -1] };
  /** A point `d` m in front of the ears, `side` m to the right, `up` m above the water at 0. */
  const ahead = (/** @type {number} */ d, /** @type {number} */ side, /** @type {number} */ y) => {
    const f = ear.forward, l = Math.hypot(f[0], f[2]) || 1;
    const fx = f[0] / l, fz = f[2] / l;
    return [ear.eye[0] + fx * d - fz * side, y, ear.eye[2] + fz * d + fx * side];
  };
  /** One sip on the water at the slider's distance ahead, a little to one side. */
  const sip = () => {
    const p = ahead(num('sip-dist'), rng.range(-0.6, 0.6), 0);
    if (voices.sip(p)) $('t-sips').textContent = String(voices.stats().sips);
  };
  $('sip-one').addEventListener('click', sip);

  return {
    /**
     * Ten times a second. @param {{eye: number[], forward: number[]}} e the ears
     * @param {number} dt seconds @param {boolean} started sound is on
     */
    tick(e, dt, started) {
      ear = e;
      t += dt;
      if (started && $('sip-auto').getAttribute('aria-pressed') === 'true' && t >= nextSip) { sip(); nextSip = t + rng.range(1.5, 5); }
      // The dragonfly: at the slider's distance from the ears, level with them.
      const d = num('df-dist');
      /** @type {{id: string, pos: number[], speed: number, flying: boolean}[]} */ const flyers = [];
      if (mode === 'hover') flyers.push({ id: 'df', pos: ahead(d, 0.15 * Math.sin(t * 0.8), ear.eye[1] + 0.03 * Math.sin(t * 5)), speed: 0.1, flying: true });
      else if (mode === 'perch') flyers.push({ id: 'df', pos: ahead(d, 0, ear.eye[1]), speed: 0, flying: false });
      else if (mode === 'dart') {
        // Back and forth across in front of you, 6 m each way, at dart speed as it passes you and
        // slowing at each end.
        const span = 3, per = (2 * Math.PI * span) / wings.dartMps;
        const ph = (t % per) / per;
        const x = span * Math.sin(ph * 2 * Math.PI);
        const v = Math.abs(span * 2 * Math.PI / per * Math.cos(ph * 2 * Math.PI));
        flyers.push({ id: 'df', pos: ahead(d, x, ear.eye[1]), speed: v, flying: true });
      }
      voices.setFlyers(flyers);
      const h = voices.flyersHeard()[0];
      $('t-wings').textContent = h ? `${h.dist.toFixed(1)} m, ${h.speed.toFixed(1)} m/s` : mode === 'perch' ? 'perched: silent' : mode === 'none' ? 'none' : 'too far';
    },
  };
}
