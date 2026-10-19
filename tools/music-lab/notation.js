// @ts-check
// Notation view for the music lab: draws a multi-voice ABC tune as SVG with the vendored abcjs
// (src/vendor/abcjs, MIT), fitted to the host's width and re-flowed when the host is resized, and
// marks the notes sounding at a tick in moss green while it plays.
//
// Ticks are the same timeline as src/audio/music/score.js: 480 per quarter note, 0 at the start of
// the tune (a pickup bar starts at 0 too), repeats not expanded. The tick map is built here by
// walking each engraved voice and adding up the written note lengths, so it matches score.js note
// for note instead of depending on abcjs's own tempo-based timing.
//
// abcjs is a UMD bundle, so it is loaded once as a classic script (window.ABCJS). render() returns
// a promise that settles when the tune is drawn. Nothing here throws: parse problems and load
// failures are shown in plain text under the staff.

const ABCJS_URL = new URL('../../src/vendor/abcjs/abcjs-basic-min.js', import.meta.url).href;
const TICKS_PER_WHOLE = 4 * 480;
const MOSS = '#4a6a47';
const INK = '#1E2624';
const USER_SCROLL_QUIET_MS = 4000;
const PROGRAM_SCROLL_MS = 1500;

/** @type {Promise<any>|null} */
let loading = null;

/** Loads abcjs once per page. @returns {Promise<any>} window.ABCJS */
function loadAbcjs() {
  const w = /** @type {any} */ (window);
  if (w.ABCJS) return Promise.resolve(w.ABCJS);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ABCJS_URL;
    s.async = true;
    s.onload = () => (w.ABCJS ? resolve(w.ABCJS) : reject(new Error('abcjs loaded but did not set window.ABCJS')));
    s.onerror = () => { loading = null; reject(new Error('could not load ' + ABCJS_URL)); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Adds a grand-staff layout line when the tune has two or more voices and names no layout itself:
 * every voice joined by a brace, bar lines running through the staves, like a piano score.
 * @param {string} abc
 */
function withGrandStaff(abc) {
  if (/^%%(score|staves)\b/m.test(abc)) return abc;
  /** @type {string[]} */
  const ids = [];
  for (const m of abc.matchAll(/^V:\s*([^\s\]%]+)/gm)) if (!ids.includes(m[1])) ids.push(m[1]);
  if (ids.length < 2) return abc;
  const line = `%%score {${ids.join(' | ')}}`;
  const k = abc.search(/^K:/m);
  return k < 0 ? `${line}\n${abc}` : `${abc.slice(0, k)}${line}\n${abc.slice(k)}`;
}

/** abcjs warnings are small HTML strings; show them as plain text. @param {string} s */
function plain(s) {
  const d = document.createElement('div');
  d.innerHTML = String(s);
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * @typedef {{start: number, end: number, els: SVGElement[], line: number}} TimedNote
 * start and end in ticks; els are the SVG groups abcjs drew for that note (head, stem, flags).
 */

/**
 * Walks the engraved tune and returns every written note with its tick span. Voices are matched
 * across systems by their position in each system, as abcjs lays them out.
 * @param {any} tune
 * @returns {TimedNote[]}
 */
function buildTimeline(tune) {
  /** @type {TimedNote[]} */
  const out = [];
  const groups = (tune && tune.engraver && tune.engraver.staffgroups) || [];
  /** @type {number[]} */
  const voiceT = [];
  groups.forEach((/** @type {any} */ group, /** @type {number} */ line) => {
    if (!group || !group.voices) return;
    group.voices.forEach((/** @type {any} */ voice, /** @type {number} */ v) => {
      if (voice.staff && voice.staff.isTabStaff) return;
      let t = voiceT[v] || 0;
      for (const el of voice.children || []) {
        if (el.hint || (el.type !== 'note' && el.type !== 'rest')) continue;
        let len = el.durationClass || el.duration || 0;
        if (el.abcelem && el.abcelem.rest && el.abcelem.rest.type === 'spacer') len = 0;
        if (len <= 0) continue;
        const start = Math.round(t * TICKS_PER_WHOLE);
        t += len;
        if (el.type === 'note' && el.elemset && el.elemset.length) {
          out.push({ start, end: Math.round(t * TICKS_PER_WHOLE), els: el.elemset.filter(Boolean), line });
        }
      }
      voiceT[v] = t;
    });
  });
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Nearest ancestor that scrolls vertically, or null for the page itself. @param {Element} el */
function scrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/**
 * @param {HTMLElement} host
 * @returns {{render: (abcText: string) => Promise<void>, highlight: (tick: number|null) => void, clear: () => void}}
 */
export function createNotation(host) {
  host.classList.add('ebb-notation');
  const paper = document.createElement('div');
  paper.className = 'ebb-notation-paper';
  paper.style.cssText = 'width:100%;max-width:100%;overflow:hidden;color:' + INK;
  const notes = document.createElement('div');
  notes.className = 'ebb-notation-warnings';
  notes.setAttribute('role', 'status');
  notes.style.cssText = 'font-size:16px;line-height:1.45;color:#7A3B2E;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:6px';
  notes.hidden = true;
  host.append(paper, notes);

  let abc = '';
  let renderedWidth = 0;
  /** @type {TimedNote[]} */
  let timeline = [];
  /** @type {Set<SVGElement>} */
  let lit = new Set();
  /** @type {number|null} */
  let lastTick = null;
  let lastLine = -1;
  let renderSeq = 0;

  // When did the user last scroll? Our own smooth scrolls are ignored for a moment.
  let userScrollAt = -Infinity;
  let programScrollUntil = 0;
  const markUser = () => { userScrollAt = performance.now(); };
  const onScroll = () => { if (performance.now() > programScrollUntil) markUser(); };
  window.addEventListener('wheel', markUser, { passive: true });
  window.addEventListener('touchmove', markUser, { passive: true });
  window.addEventListener('keydown', (e) => { if (/^(Arrow|Page|Home|End| )/.test(e.key)) markUser(); });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  /** @param {string[]} list */
  function showWarnings(list) {
    notes.textContent = list.join('\n');
    notes.hidden = list.length === 0;
  }

  function width() { return Math.floor(paper.clientWidth || host.clientWidth || 320); }

  async function draw() {
    const seq = ++renderSeq;
    let ABCJS;
    try { ABCJS = await loadAbcjs(); } catch (err) {
      showWarnings(['The notation library did not load: ' + (err instanceof Error ? err.message : String(err))]);
      return;
    }
    if (seq !== renderSeq) return;
    const w = width();
    renderedWidth = w;
    unlight();
    timeline = [];
    paper.textContent = '';
    if (!abc.trim()) { showWarnings([]); return; }
    try {
      const phone = w < 520;
      const tunes = ABCJS.renderAbc(paper, withGrandStaff(abc), {
        responsive: 'resize',
        staffwidth: Math.max(200, w - 24),
        paddingleft: 4, paddingright: 4, paddingtop: 8, paddingbottom: 8,
        add_classes: true, // abcjs draws in currentColor, so the paper's ink color and a note's color style both reach it
        wrap: { minSpacing: phone ? 1.4 : 1.7, maxSpacing: phone ? 2.4 : 2.7, preferredMeasuresPerLine: phone ? 2 : 4 },
        format: {
          gchordfont: '"Nunito" 15 bold',
          annotationfont: '"Nunito" 14',
          titlefont: '"Nunito" 20 bold',
          voicefont: '"Nunito" 14',
          measurefont: '"Nunito" 12 italic',
          tempofont: '"Nunito" 14',
        },
      });
      const tune = tunes && tunes[0];
      const svg = paper.querySelector('svg');
      if (svg) { svg.style.maxWidth = '100%'; svg.style.display = 'block'; }
      timeline = buildTimeline(tune);
      showWarnings(((tune && tune.warnings) || []).map(plain).filter(Boolean));
    } catch (err) {
      paper.textContent = '';
      showWarnings(['The notation could not be drawn: ' + (err instanceof Error ? err.message : String(err))]);
    }
    if (lastTick !== null) light(lastTick, false);
  }

  function unlight() {
    for (const el of lit) { el.style.color = ''; el.style.fill = ''; el.classList.remove('ebb-note-on'); }
    lit = new Set();
  }

  /** @param {number} tick @param {boolean} follow */
  function light(tick, follow) {
    /** @type {Set<SVGElement>} */
    const next = new Set();
    let line = -1;
    /** @type {SVGElement|null} */
    let first = null;
    for (const n of timeline) {
      if (n.start > tick) break;
      if (n.end > tick) {
        for (const el of n.els) next.add(el);
        if (!first) { first = n.els[0]; line = n.line; }
      }
    }
    for (const el of lit) if (!next.has(el)) { el.style.color = ''; el.style.fill = ''; el.classList.remove('ebb-note-on'); }
    for (const el of next) if (!lit.has(el)) { el.style.color = MOSS; el.style.fill = MOSS; el.classList.add('ebb-note-on'); }
    lit = next;
    if (follow && first) followInto(first);
    if (line >= 0) lastLine = line;
  }

  /** Scrolls vertically only, and only when the system is off screen and the user is not scrolling. @param {Element} el */
  function followInto(el) {
    const now = performance.now();
    if (now < programScrollUntil || now - userScrollAt < USER_SCROLL_QUIET_MS) return;
    const svg = el.closest('svg') || el;
    const r = el.getBoundingClientRect();
    const sys = svg.getBoundingClientRect();
    const sp = scrollParent(paper);
    const viewTop = sp ? sp.getBoundingClientRect().top : 0;
    const viewH = sp ? sp.clientHeight : window.innerHeight;
    if (r.top >= viewTop + 8 && r.bottom <= viewTop + viewH - 8) return;
    // Put the note's system about a fifth of the way down; never move sideways.
    const top = Math.max(sys.top, r.top - 120);
    const dy = top - viewTop - viewH * 0.2;
    programScrollUntil = performance.now() + PROGRAM_SCROLL_MS;
    if (sp) sp.scrollBy({ top: dy, left: 0, behavior: 'smooth' });
    else window.scrollBy({ top: dy, left: 0, behavior: 'smooth' });
  }

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    const w = width();
    if (!abc || Math.abs(w - renderedWidth) < 16) return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { draw(); }, 150);
  });
  ro.observe(host);

  return {
    render(abcText) {
      abc = String(abcText || '');
      lastLine = -1;
      return draw();
    },
    highlight(tick) {
      if (tick === null || tick === undefined || !Number.isFinite(tick)) { lastTick = null; lastLine = -1; unlight(); return; }
      lastTick = tick;
      light(tick, true);
    },
    clear() {
      renderSeq++;
      abc = ''; lastTick = null; lastLine = -1; timeline = [];
      unlight();
      paper.textContent = '';
      showWarnings([]);
    },
  };
}
