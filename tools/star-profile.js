// @ts-check
// The star fire's logs seen side on, one panel a log, against the tops of the stones under each
// (the ring's and the hearth stones', from src/world/camp/ring-top.js): how far each log passes
// into a stone, if at all. "Before" is the rule the star had before the logs were fitted to the
// stones (one tilt for every log, the lined-up logs stopping at 0.235 m); "after" is star.js now.
// Used by tools/hearth-check.html; pure, so it also runs in node.

import { burntM, stoneTop } from '../src/world/camp/star.js';
import { hash32 } from '../src/core/rng.js';

const DEG = Math.PI / 180;
const u01 = (/** @type {number} */ h) => (h >>> 8) / 16777216;

/**
 * The star as it was laid before the fit: every log tipped 21 degrees (seeded a little), the ones
 * lined up with a hearth stone stopping at 0.235 m. Same shape as starLogs' output.
 * @param {{ word: string, ash: number }} at @param {{ sinceHour: number, flameUntilHour: number }} fire @param {number} hour
 * @param {{ flameH: number }} F @param {any} S @param {{ seed: number, hearth: boolean }} o
 */
export function starBefore(at, fire, hour, F, S, o) {
  if (at.word === 'none') return [];
  const burnt = burntM(at, fire, hour, F, S), n = S.logs, stones = [-90, 30, 150].map((d) => d * DEG), half = S.stoneHalfDeg * DEG;
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = hash32(o.seed >>> 0, i + 1);
    const a = (S.startDeg + (360 * i) / n + (u01(h) - 0.5) * 2 * S.jitterDeg) * DEG;
    const size = (S.sizeM / S.logLenM) * (1 + (u01(hash32(h, 1)) - 0.5) * 2 * S.sizeJitter);
    const onStone = o.hearth && stones.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < half);
    const r = o.hearth ? (onStone ? 0.235 : S.hearthInnerM) : S.innerM;
    const len = S.logLenM * size, stretch = Math.max(0.3, (len - burnt) / len);
    const roll = 21 * DEG * (1 + (u01(hash32(h, 2)) - 0.5) * 0.4);
    const glow = at.word === 'lit' ? S.glow.lit ?? 0.6 : S.glow[at.word] ?? 0;
    out.push({ a, r, y: ((len * stretch) / 2) * Math.sin(roll), roll, size, stretch, endChar: (S.endChar[at.word] ?? 0) * (0.9 + 0.2 * u01(hash32(h, 3))), glow });
  }
  return out;
}

/**
 * How far a log passes into a stone (m; 0 when it rests clear), checked along its underside and
 * across its width. @param {any} g a star log @param {any} S @param {boolean} hearth
 */
export function pierce(g, S, hearth) {
  const len = S.logLenM * g.size * g.stretch, hw = S.logHalfW * g.size, ca = Math.cos(g.a), sa = Math.sin(g.a);
  const y0 = g.y - (len / 2) * Math.sin(g.roll);
  let worst = 0;
  for (let t = 0.02; t <= len; t += 0.005) for (const w of [-1, 0, 1]) {
    const s = t * Math.cos(g.roll), top = stoneTop(ca * (g.r + s) - sa * w * hw, sa * (g.r + s) + ca * w * hw, hearth);
    if (top > S.ashTopM) worst = Math.max(worst, top - (y0 + t * Math.sin(g.roll)));
  }
  return worst;
}

/**
 * One log's panel: the stones' tops under its line (the highest across its width) and the log
 * side on, red where it passes into a stone. @param {any} g @param {any} S @param {boolean} hearth
 * @param {string} title @returns {string} an svg
 */
export function logPanel(g, S, hearth, title) {
  const W = 320, H = 190, X = (/** @type {number} */ m) => 14 + (m / 0.6) * (W - 28), Y = (/** @type {number} */ m) => H - 30 - (m / 0.3) * (H - 60);
  const ca = Math.cos(g.a), sa = Math.sin(g.a), hw = S.logHalfW * g.size;
  const top = [];
  for (let r = 0; r <= 0.6; r += 0.005) {
    let m = 0;
    for (const w of [-1, 0, 1]) m = Math.max(m, stoneTop(ca * r - sa * w * hw, sa * r + ca * w * hw, hearth));
    top.push(`${X(r).toFixed(1)},${Y(m).toFixed(1)}`);
  }
  const len = S.logLenM * g.size * g.stretch, th = S.logThick * g.size, y0 = g.y - (len / 2) * Math.sin(g.roll);
  const c = Math.cos(g.roll), s = Math.sin(g.roll);
  const pts = [[0, 0], [len, 0], [len, th], [0, th]].map(([u, v]) => [g.r + u * c - v * s, y0 + u * s + v * c]);
  const p = pierce(g, S, hearth), bad = p > 0.002;
  const words = bad ? `passes ${Math.round(p * 1000)} mm into a stone` : 'rests clear of the stones';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}: ${words}" style="width:100%;height:auto;display:block">
  <rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#FBF7F0"/>
  <line x1="${X(0)}" y1="${Y(0)}" x2="${X(0.6)}" y2="${Y(0)}" stroke="#B9AE9C" stroke-width="1.5"/>
  <polygon points="${X(0)},${Y(0)} ${top.join(' ')} ${X(0.6)},${Y(0)}" fill="#9A958C" stroke="#6E6A62" stroke-width="1.5"/>
  <polygon points="${pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" fill="${bad ? '#C4553D' : '#8A5A36'}" fill-opacity="0.85" stroke="#3B2A1C" stroke-width="2"/>
  <text x="14" y="22" font-family="Nunito, system-ui, sans-serif" font-weight="800" font-size="16" fill="#1E2624">${title}</text>
  <text x="14" y="${H - 9}" font-family="Nunito, system-ui, sans-serif" font-weight="600" font-size="15" fill="${bad ? '#A23B26' : '#4A5551'}">${words}</text>
</svg>`;
}
