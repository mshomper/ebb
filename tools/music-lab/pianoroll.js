// @ts-check
// Piano roll for the music lab: a realized performance drawn on a canvas, time left to right and
// pitch bottom to top, one color per voice, with bar numbers and chord symbols along the top,
// section names at their starts, and the sustain pedal as a strip along the bottom.
//
// It never scrolls sideways. It shows a window of a few seconds that pages forward with the
// playhead: when the playhead reaches 85 percent of the window, the window jumps so the playhead
// sits at 15 percent. The static picture of a window is cached, so moving the playhead only
// redraws the playhead line and the outlines of the notes sounding under it.

/**
 * @typedef {Object} Performance
 * @property {number} durationS
 * @property {{index: number, t: number, chord?: string}[]} bars
 * @property {{t: number, dur: number, midi: number, vel: number, voice: string, instrument?: string}[]} notes
 * @property {{t: number, down: boolean}[]} [pedal]
 * @property {{name: string, t: number}[]} [sections]
 */

const INK = '#1E2624';
const MUTED = '#4A5551';
const MOSS = '#4a6a47';
/** Voice colors: calm, apart in hue and lightness, readable on cream. Melody is the darkest. */
export const VOICE_COLORS = /** @type {Record<string, string>} */ ({
  mel: '#2F5F34', acc: '#4C7A9E', bass: '#8A5534', counter: '#B88A2E', pad: '#8E7CB8',
});
const EXTRA_COLORS = ['#5E8C86', '#A8606F', '#6F6A5E'];
const VOICE_NAMES = /** @type {Record<string, string>} */ ({
  mel: 'melody', acc: 'accompaniment', bass: 'bass', counter: 'countermelody', pad: 'pad',
});
const VOICE_ORDER = ['mel', 'counter', 'acc', 'bass', 'pad'];

/**
 * @param {HTMLElement} host
 * @param {{onSeekBar?: (barIndex: number) => void, windowS?: number}} [opts]
 * @returns {{setPerformance: (perf: Performance|null) => void, setPlayhead: (seconds: number|null) => void, setWindow: (seconds: number|null) => void}}
 */
export function createPianoRoll(host, opts = {}) {
  host.classList.add('ebb-pianoroll');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;max-width:100%;touch-action:manipulation;cursor:pointer;border-radius:10px';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Piano roll');
  const legend = document.createElement('div');
  legend.className = 'ebb-pianoroll-legend';
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:16px;line-height:1.3;color:' + INK;
  host.append(canvas, legend);

  /** @type {Performance|null} */
  let perf = null;
  /** @type {Performance['notes']} */
  let notes = [];
  /** @type {{t: number, down: boolean}[]} */
  let pedal = [];
  /** @type {{name: string, t: number}[]} */
  let sections = [];
  /** @type {Performance['bars']} */
  let bars = [];
  /** @type {Record<string, string>} */
  let colors = {};
  let lo = 48, hi = 84;
  /** @type {number|null} */
  let windowOverride = opts.windowS ?? null;
  let winStart = 0;
  /** @type {number|null} */
  let playhead = null;
  let maxDur = 0;

  // Layout in CSS pixels, set by size().
  let W = 320, H = 260, dpr = 1;
  const GUTTER = 34, TOP = 42, PED = 8, PED_GAP = 4, RIGHT = 6;
  /** @type {HTMLCanvasElement} */
  const still = document.createElement('canvas');
  let stillKey = '';

  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const sctx = /** @type {CanvasRenderingContext2D} */ (still.getContext('2d'));

  function windowS() {
    if (windowOverride && windowOverride > 0) return windowOverride;
    const n = W < 560 ? 4 : 8; // about 8 bars on desktop, 4 on a phone so notes stay readable
    if (bars.length > n) return Math.max(2, bars[n].t - bars[0].t);
    return W < 560 ? 8 : 16;
  }
  const plotL = () => GUTTER;
  const plotR = () => W - RIGHT;
  const plotT = () => TOP;
  const plotB = () => H - PED - PED_GAP - 2;
  /** @param {number} t */
  const xOf = (t) => plotL() + ((t - winStart) / windowS()) * (plotR() - plotL());
  const rowH = () => (plotB() - plotT()) / (hi - lo + 1);
  /** @param {number} m top edge of the row for MIDI m */
  const yOf = (m) => plotB() - (m - lo + 1) * rowH();

  function size() {
    const cs = getComputedStyle(host);
    const inner = host.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
    const cw = Math.max(200, Math.floor(inner || 320));
    const ch = cw < 560 ? 220 : 260;
    const d = Math.min(3, window.devicePixelRatio || 1);
    if (cw === W && ch === H && d === dpr && canvas.width === Math.round(cw * d)) return false;
    W = cw; H = ch; dpr = d;
    for (const c of [canvas, still]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    canvas.style.height = H + 'px';
    stillKey = '';
    follow();
    return true;
  }

  function buildLegend() {
    legend.textContent = '';
    for (const v of Object.keys(colors)) {
      const item = document.createElement('span');
      item.style.cssText = 'display:inline-flex;align-items:center;gap:6px;white-space:nowrap';
      const sw = document.createElement('span');
      sw.style.cssText = `display:inline-block;width:18px;height:10px;border-radius:3px;background:${colors[v]}`;
      item.append(sw, document.createTextNode(VOICE_NAMES[v] || v));
      legend.appendChild(item);
    }
  }

  /** @param {number} v */
  function alphaOf(v) {
    const n = v > 1 ? v / 127 : v;
    return 0.3 + 0.7 * Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.7));
  }

  /** Draws the cached picture of the current window. */
  function drawStill() {
    const c = sctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#FFFDF8';
    c.fillRect(0, 0, W, H);
    const L = plotL(), R = plotR(), T = plotT(), B = plotB(), rh = rowH();

    // Key shading: black-key rows a little darker.
    for (let m = lo; m <= hi; m++) {
      const pc = ((m % 12) + 12) % 12;
      const black = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
      c.fillStyle = black ? '#EFE7DA' : '#F8F3EA';
      c.fillRect(L, yOf(m), R - L, rh + 0.5);
    }
    // Octave lines and labels.
    c.font = '700 13px Nunito, system-ui, sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'right';
    for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) {
      const y = yOf(m) + rh;
      c.strokeStyle = 'rgba(30,38,36,0.18)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(L, Math.round(y) + 0.5); c.lineTo(R, Math.round(y) + 0.5); c.stroke();
      c.fillStyle = MUTED;
      c.fillText('C' + (m / 12 - 1), L - 5, Math.min(B - 6, Math.max(T + 6, y - rh / 2)));
    }

    if (!perf) {
      c.fillStyle = MUTED;
      c.textAlign = 'center';
      c.font = '700 16px Nunito, system-ui, sans-serif';
      c.fillText('No performance yet', (L + R) / 2, (T + B) / 2);
      return;
    }

    const t0 = winStart, t1 = winStart + windowS();
    // Bar lines, numbers and chords. Labels are skipped rather than allowed to collide.
    const vis = bars.filter((b) => b.t >= t0 - 1e-6 && b.t <= t1 + 1e-6);
    const pxPerBar = vis.length > 1 ? (xOf(vis[1].t) - xOf(vis[0].t)) : R - L;
    let numEvery = 1;
    c.font = '800 14px Nunito, system-ui, sans-serif';
    const numW = c.measureText('88').width + 6;
    while (pxPerBar * numEvery < numW) numEvery *= 2;
    const secStarts = new Set(sections.map((s) => Math.round(s.t * 1000)));
    for (const b of vis) {
      const x = Math.round(xOf(b.t)) + 0.5;
      const isSec = secStarts.has(Math.round(b.t * 1000));
      c.strokeStyle = isSec ? 'rgba(74,106,71,0.75)' : 'rgba(30,38,36,0.22)';
      c.lineWidth = isSec ? 1.5 : 1;
      c.beginPath(); c.moveTo(x, T - 2); c.lineTo(x, B); c.stroke();
    }
    let lastChordEnd = -Infinity;
    for (let i = 0; i < vis.length; i++) {
      const b = vis[i];
      const x = xOf(b.t);
      const next = bars[bars.indexOf(b) + 1];
      const room = (next ? xOf(next.t) : R) - x;
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      const nb = b.index;
      if ((b.index - 1) % numEvery === 0 || numEvery === 1) {
        c.font = '800 14px Nunito, system-ui, sans-serif';
        c.fillStyle = INK;
        if (x + 3 < R - 8) c.fillText(String(nb), x + 3, T - 22);
      }
      if (b.chord) {
        c.font = '700 14px Nunito, system-ui, sans-serif';
        const cw = c.measureText(b.chord).width;
        if (x + 3 > lastChordEnd + 4 && cw <= Math.max(room - 4, 0) + 18 && x + 3 + cw <= R) {
          c.fillStyle = MUTED;
          c.fillText(b.chord, x + 3, T - 6);
          lastChordEnd = x + 3 + cw;
        }
      }
    }
    // Section names, in moss, to the right of the bar number.
    c.font = '800 14px Nunito, system-ui, sans-serif';
    for (const s of sections) {
      if (s.t < t0 - 1e-6 || s.t > t1) continue;
      const x = xOf(s.t);
      const b = bars.find((bb) => Math.abs(bb.t - s.t) < 1e-3);
      const off = b ? c.measureText(String(b.index)).width + 9 : 3;
      const tw = c.measureText(s.name).width + 10;
      if (x + off + tw > R) continue;
      c.fillStyle = '#E4EDE0';
      c.beginPath(); c.roundRect(x + off - 3, T - 37, tw, 19, 6); c.fill();
      c.fillStyle = MOSS;
      c.fillText(s.name, x + off + 2, T - 22);
    }

    // Notes, quiet voices first so the melody sits on top.
    c.save();
    c.beginPath(); c.rect(L, T, R - L, B - T); c.clip();
    const h = Math.max(2, Math.min(rh - 1, 12));
    const order = Object.keys(colors).sort((a, b) => rank(b) - rank(a));
    for (const v of order) {
      c.fillStyle = colors[v];
      for (const n of notes) {
        if (n.voice !== v || n.t > t1 || n.t + n.dur < t0) continue;
        const x = xOf(n.t), x2 = xOf(n.t + n.dur);
        c.globalAlpha = alphaOf(n.vel);
        c.beginPath();
        c.roundRect(x + 0.5, yOf(n.midi) + (rh - h) / 2, Math.max(2, x2 - x - 1), h, Math.min(3, h / 2));
        c.fill();
      }
    }
    c.globalAlpha = 1;
    c.restore();

    // Sustain pedal strip.
    const py = H - PED - 3;
    c.fillStyle = '#EDE5D7';
    c.beginPath(); c.roundRect(L, py, R - L, PED, 3); c.fill();
    c.font = '700 13px Nunito, system-ui, sans-serif';
    c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillStyle = MUTED;
    c.fillText('ped', L - 5, py + PED / 2);
    c.fillStyle = '#7C8F78';
    let downAt = /** @type {number|null} */ (null);
    const flush = (/** @type {number} */ endT) => {
      if (downAt === null) return;
      const a = Math.max(xOf(downAt), L), z = Math.min(xOf(endT), R);
      if (z > a) { c.beginPath(); c.roundRect(a, py, Math.max(1.5, z - a - 1.5), PED, 3); c.fill(); }
    };
    for (const p of pedal) {
      if (p.down && downAt === null) downAt = p.t;
      else if (!p.down && downAt !== null) { flush(p.t); downAt = null; }
    }
    if (downAt !== null) flush(Math.max(maxDur, t1));
  }

  /** @param {string} v */
  function rank(v) { const i = VOICE_ORDER.indexOf(v); return i < 0 ? 2.5 : i; }

  function draw() {
    size();
    const key = `${W}x${H}@${dpr}:${winStart.toFixed(4)}:${windowS()}`;
    if (key !== stillKey) { drawStill(); stillKey = key; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(still, 0, 0);
    if (!perf || playhead === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = xOf(playhead);
    if (x < plotL() - 1 || x > plotR() + 1) return;
    // Outline the notes sounding under the playhead.
    const rh = rowH(), h = Math.max(2, Math.min(rh - 1, 12));
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.25;
    for (const n of notes) {
      if (n.t > playhead || n.t + n.dur <= playhead) continue;
      const x1 = xOf(n.t), x2 = xOf(n.t + n.dur);
      ctx.beginPath();
      ctx.roundRect(Math.max(x1, plotL()) + 0.5, yOf(n.midi) + (rh - h) / 2, Math.max(2, Math.min(x2, plotR()) - Math.max(x1, plotL()) - 1), h, Math.min(3, h / 2));
      ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, plotT() - 4); ctx.lineTo(Math.round(x) + 0.5, H - 2); ctx.stroke();
  }

  /** Pages the window so the playhead stays inside it. */
  function follow() {
    const w = windowS();
    if (playhead === null) { winStart = 0; return; }
    if (playhead < winStart || playhead >= winStart + 0.85 * w) winStart = Math.max(0, playhead - 0.15 * w);
  }

  canvas.addEventListener('pointerup', (e) => {
    if (!perf || !bars.length || !opts.onSeekBar) return;
    const r = canvas.getBoundingClientRect();
    const px = Math.max(plotL(), Math.min(plotR(), e.clientX - r.left));
    const t = winStart + ((px - plotL()) / (plotR() - plotL())) * windowS();
    let hit = bars[0];
    for (const b of bars) { if (b.t <= t + 1e-6) hit = b; else break; }
    opts.onSeekBar(hit.index);
  });

  const ro = new ResizeObserver(() => { if (size()) draw(); });
  ro.observe(host);

  size();
  draw();

  return {
    setPerformance(p) {
      perf = p || null;
      notes = perf ? [...(perf.notes || [])].sort((a, b) => a.t - b.t) : [];
      bars = perf ? [...(perf.bars || [])].sort((a, b) => a.t - b.t) : [];
      pedal = perf ? [...(perf.pedal || [])].sort((a, b) => a.t - b.t) : [];
      sections = perf ? [...(perf.sections || [])] : [];
      maxDur = perf ? Math.max(perf.durationS || 0, ...notes.map((n) => n.t + n.dur)) : 0;
      colors = {};
      const voices = [...new Set(notes.map((n) => n.voice))].sort((a, b) => rank(a) - rank(b));
      let extra = 0;
      for (const v of voices) colors[v] = VOICE_COLORS[v] || EXTRA_COLORS[extra++ % EXTRA_COLORS.length];
      if (notes.length) {
        let a = Infinity, b = -Infinity;
        for (const n of notes) { if (n.midi < a) a = n.midi; if (n.midi > b) b = n.midi; }
        a -= 2; b += 2;
        if (b - a < 24) { const mid = (a + b) / 2; a = Math.floor(mid - 12); b = Math.ceil(mid + 12); }
        lo = Math.max(0, a); hi = Math.min(127, b);
      } else { lo = 48; hi = 84; }
      playhead = null; winStart = 0; stillKey = '';
      buildLegend();
      draw();
    },
    setPlayhead(seconds) {
      playhead = seconds === null || seconds === undefined || !Number.isFinite(seconds) ? null : Math.max(0, seconds);
      follow();
      draw();
    },
    setWindow(seconds) {
      windowOverride = seconds && seconds > 0 ? seconds : null;
      follow();
      stillKey = '';
      draw();
    },
  };
}
