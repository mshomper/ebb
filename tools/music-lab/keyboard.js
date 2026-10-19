// @ts-check
// On-screen piano keys and the computer-keyboard mapping for the music lab's instrument bench.
// The number of white keys shown follows the width of the page, so the keys always fit (no
// horizontal scrolling); octave buttons move the window. Multi-touch works: each finger is its
// own key. Loudness comes from the slider, or from how far down the key you press (lower is
// louder, as a key pressed near its front edge sounds), whichever the bench chooses.

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER = new Set([0, 2, 5, 7, 9]); // a black key follows these white keys
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** @param {number} midi */
export function noteName(midi) {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Computer keys to semitones above the window's lowest C (the common layout in music software). */
const KEYMAP = /** @type {Record<string, number>} */ ({
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17,
});

/**
 * @param {HTMLElement} host
 * @param {{
 *   onDown: (midi: number, velocity: number) => void,
 *   onUp: (midi: number) => void,
 *   onPedal: (down: boolean) => void,
 *   velocity: () => number,
 *   velocityFromHeight: () => boolean,
 *   onVelocityNudge: (delta: number) => void,
 *   onOctave: (lowC: number) => void,
 *   onSwap: () => void,
 * }} h
 */
export function createKeyboard(host, h) {
  let lowC = 48; // C3
  /** @type {Map<number, HTMLElement>} */
  const els = new Map();
  /** @type {Map<number, number>} pointer id → midi */
  const pointers = new Map();
  /** @type {Set<string>} */
  const keysDown = new Set();

  function whiteCount() {
    const w = host.clientWidth || 600;
    const per = window.innerWidth < 560 ? 40 : 44;
    // Whole octaves plus the next C where possible, at least one octave.
    const n = Math.max(8, Math.floor(w / per));
    return Math.min(22, n);
  }

  function build() {
    host.innerHTML = '';
    els.clear();
    const n = whiteCount();
    const ww = 100 / n;
    let wi = 0;
    for (let m = lowC; wi < n; m++) {
      const pc = m % 12;
      if (!WHITE.includes(pc)) continue;
      const k = document.createElement('div');
      k.className = 'w';
      k.style.left = `${wi * ww}%`;
      k.style.width = `${ww}%`;
      k.dataset.midi = String(m);
      if (pc === 0) {
        const lab = document.createElement('span');
        lab.className = 'lab';
        lab.textContent = noteName(m);
        k.appendChild(lab);
      }
      host.appendChild(k);
      els.set(m, k);
      if (BLACK_AFTER.has(pc) && wi < n - 1) {
        const b = document.createElement('div');
        b.className = 'b';
        b.style.left = `${(wi + 0.66) * ww}%`;
        b.style.width = `${ww * 0.62}%`;
        b.dataset.midi = String(m + 1);
        host.appendChild(b);
        els.set(m + 1, b);
      }
      wi++;
    }
    h.onOctave(lowC);
  }

  /** @param {PointerEvent} e */
  function midiAt(e) {
    const t = /** @type {HTMLElement|null} */ (document.elementFromPoint(e.clientX, e.clientY));
    const m = t?.closest?.('[data-midi]');
    return m ? Number(/** @type {HTMLElement} */ (m).dataset.midi) : null;
  }

  /** @param {PointerEvent} e @param {number} midi */
  function velocityOf(e, midi) {
    if (!h.velocityFromHeight()) return h.velocity();
    const el = els.get(midi);
    if (!el) return h.velocity();
    const r = el.getBoundingClientRect();
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    return Math.round(8 + y * 112);
  }

  /** @param {number} midi @param {boolean} on */
  function mark(midi, on) {
    els.get(midi)?.classList.toggle('down', on);
  }

  host.addEventListener('pointerdown', (e) => {
    const m = midiAt(e);
    if (m === null) return;
    e.preventDefault();
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, m);
    mark(m, true);
    h.onDown(m, velocityOf(e, m));
  });
  host.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const m = midiAt(e);
    const old = /** @type {number} */ (pointers.get(e.pointerId));
    if (m === null || m === old) return;
    // Sliding to a new key: release the old one and strike the new one (a glissando).
    mark(old, false);
    h.onUp(old);
    pointers.set(e.pointerId, m);
    mark(m, true);
    h.onDown(m, velocityOf(e, m));
  });
  /** @param {PointerEvent} e */
  const up = (e) => {
    const m = pointers.get(e.pointerId);
    if (m === undefined) return;
    pointers.delete(e.pointerId);
    mark(m, false);
    h.onUp(m);
  };
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'tab') { e.preventDefault(); h.onSwap(); return; }
    if (e.repeat) { if (k === ' ' || k in KEYMAP) e.preventDefault(); return; }
    if (k === ' ') { e.preventDefault(); h.onPedal(true); return; }
    if (k === 'z') { shift(-12); return; }
    if (k === 'x') { shift(12); return; }
    if (k === 'c') { h.onVelocityNudge(-10); return; }
    if (k === 'v') { h.onVelocityNudge(10); return; }
    if (k in KEYMAP) {
      e.preventDefault();
      const m = lowC + KEYMAP[k];
      keysDown.add(k);
      mark(m, true);
      h.onDown(m, h.velocity());
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') { h.onPedal(false); return; }
    if (k in KEYMAP && keysDown.has(k)) {
      keysDown.delete(k);
      const m = lowC + KEYMAP[k];
      mark(m, false);
      h.onUp(m);
    }
  });

  /** @param {number} d */
  function shift(d) {
    lowC = Math.max(21 - 9, Math.min(96, lowC + d));
    build();
  }

  let lastW = 0;
  new ResizeObserver(() => { if (Math.abs(host.clientWidth - lastW) > 20) { lastW = host.clientWidth; build(); } }).observe(host);
  build();

  return {
    shift,
    /** @param {number} midi @param {boolean} on */
    mark,
    get lowC() { return lowC; },
    whiteCount,
  };
}
