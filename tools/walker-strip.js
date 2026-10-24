// @ts-check
// Walker frame strips (walker gestures, October 24, 2026): the real figure, posed by its own motion
// code from a scripted run, drawn one frame per pose into a strip, with a small curve under each row
// showing what the strip is about. Each run is played twice: once to find the moments worth a frame
// (the lean's peak, the settle back), then again from the start to draw them; the motion is the same
// both times. ?strip=<name> opens one; ?save=1 also writes it as a PNG for a local helper that
// accepts PUT /__strip/<name>.png (the game's own server refuses it, so nothing is written there).

import { createStage } from './walker-figure-stage.js';
import { loadFigureModel, eyeUniforms } from '../src/world/figure/index.js';
import { buildFigure } from '../src/world/figure/rig.js';
import { createFigureMotion } from '../src/world/figure/motion.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const view = /** @type {HTMLCanvasElement} */ ($('view'));
const strip = /** @type {HTMLCanvasElement} */ ($('strip'));
const note = $('note');

const made = await createStage(view);
if (!made.ok) { note.textContent = `This page needs WebGPU (${made.reason}).`; throw new Error(made.reason); }
const stage = made.stage;
const R = await (await fetch('../recipes/world/figure.json')).json();
const W = await (await fetch('../recipes/world/walker.json')).json();
const built = buildFigure(await loadFigureModel(R), R);
stage.setMesh(built);
stage.setGround(() => 0);
const headBone = built.skeleton.findIndex((b) => b.name === 'head');
const eyeBuf = new Float32Array(20);
const DT = 1 / 60;

/**
 * A stand-in walker with the game's numbers (walker.json pace): stands `waitS`, walks to x = goal
 * at `pace` (easing up, slowing into the stop), then stands.
 * @param {number} pace m/s @param {number} goal @param {number} waitS
 */
function walkerRun(pace, goal, waitS) {
  const P = W.pace;
  const w = { x: -goal, speed: 0, t: 0, done: false };
  return {
    w,
    /** One frame on, and the input the figure reads. */
    step() {
      w.t += DT;
      let want = 0;
      const going = w.t > waitS && !w.done;
      if (going) want = Math.min(pace, Math.sqrt(2 * P.accelMps2 * Math.max(goal - w.x, 0)) + 0.05);
      const dv = want - w.speed;
      w.speed += Math.sign(dv) * Math.min(Math.abs(dv), (dv > 0 ? P.accelMps2 : P.accelMps2 * 3) * DT);
      w.x += w.speed * DT;
      if (going && goal - w.x < P.arriveM * 0.2) { w.done = true; w.speed = 0; }
      return { x: w.x, z: 0, y: 0, yaw: Math.PI / 2, speed: w.speed, moving: going && !w.done, ground: () => 0, depth: () => 0, below: true, posture: /** @type {'stand'} */ ('stand') };
    },
  };
}

/**
 * The strips. Each row: a run (a motion, and a step that moves it on one frame and returns what to
 * record), then picks frames from the record by time.
 * @type {Record<string, { title: string, view: { yaw: number, pitch: number, dist: number }, rows: { name: string, run: () => { motion: any, step: () => any, place: () => number[] }, picks: (rec: any[]) => { i: number, label: string }[], curve: { key: string, label: string, unit: string } }[] }>}
 */
const STRIPS = {
  lean: {
    title: 'Lean into starts and stops (side view)',
    view: { yaw: Math.PI / 2, pitch: 0.05, dist: 3.6 },
    rows: [['Stroll', W.pace.strollMps, 2.2], ['Brisk', W.pace.briskMps, 2.9]].map(([name, pace, goal]) => ({
      name: /** @type {string} */ (name),
      curve: { key: 'lean', label: 'body lean, forward', unit: '°' },
      run() {
        const motion = createFigureMotion(R, built.skeleton);
        const run = walkerRun(/** @type {number} */ (pace), /** @type {number} */ (goal), 1);
        let s = run.step();
        return {
          motion,
          step() { s = run.step(); const r = motion.update(DT, s); return { t: run.w.t, r, speed: s.speed, moving: s.moving, lean: motion.info.leanDeg }; },
          place: () => [s.x, 0, 0, Math.PI / 2],
        };
      },
      picks(rec) {
        const startI = rec.findIndex((f) => f.speed > 0);
        const stopI = rec.findIndex((f, i) => i > startI && f.speed === 0);
        const arg = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ sgn) => { let k = a; for (let i = a; i < b; i++) if (sgn * rec[i].lean > sgn * rec[k].lean) k = i; return k; };
        const tip = arg(startI, startI + 90, 1);
        const back = arg(stopI, stopI + 90, -1);
        const brake = rec.findIndex((f, i) => i > tip + 30 && f.speed < rec[tip + 30].speed * 0.98);
        return [
          { i: startI - 10, label: 'standing' },
          { i: tip, label: 'sets off' },
          { i: Math.round((tip + brake) / 2), label: 'walking' },
          { i: brake + Math.round((stopI - brake) * 0.6), label: 'braking' },
          { i: stopI + 2, label: 'stops' },
          { i: back, label: 'settles back' },
          { i: Math.min(rec.length - 1, stopI + 120), label: 'at rest' },
        ];
      },
    })),
  },
};

const TILE_W = 300, TILE_H = 400, LABEL = 34, CURVE = 110, HEAD = 40, PAD = 12;

/** Draw one strip into the strip canvas. @param {string} name */
async function render(name) {
  const S = STRIPS[name];
  note.textContent = `Drawing ${S.title}...`;
  stage.view(S.view);
  const rows = S.rows.map((row) => {
    // First pass: record the run.
    const a = row.run();
    const rec = [];
    for (let f = 0; f < 60 * 9; f++) rec.push(a.step());
    return { row, rec, picks: row.picks(rec).filter((p) => p.i >= 0 && p.i < rec.length) };
  });
  const cols = Math.max(...rows.map((r) => r.picks.length));
  const rowH = HEAD + TILE_H + LABEL + CURVE + PAD;
  strip.width = cols * TILE_W;
  strip.height = rows.length * rowH;
  const g = /** @type {CanvasRenderingContext2D} */ (strip.getContext('2d'));
  g.fillStyle = '#FBF7F0'; g.fillRect(0, 0, strip.width, strip.height);
  for (let ri = 0; ri < rows.length; ri++) {
    const { row, rec, picks } = rows[ri], y0 = ri * rowH;
    g.fillStyle = '#23361F'; g.font = "800 22px Nunito, sans-serif"; g.fillText(`${S.title}: ${row.name}`, 12, y0 + 28);
    // Second pass: the same run again, drawing each picked frame.
    const b = row.run();
    let f = 0;
    for (let c = 0; c < picks.length; c++) {
      let r = null;
      while (f <= picks[c].i) { r = b.step(); f++; }
      stage.snap();
      stage.draw({ bones: b.motion.bones, eyes: eyeUniforms(R.eyes, headBone, r.r.eyes, eyeBuf), place: b.place(), weights: false, night: false, water: -9, follow: b.place(), dt: DT });
      // Copied in the same task as the draw, while the frame is still the canvas's own.
      const x = c * TILE_W, y = y0 + HEAD;
      g.drawImage(view, x, y, TILE_W, TILE_H);
      await new Promise((ok) => setTimeout(ok, 0));
      // Upright: a faint line through the feet.
      g.strokeStyle = 'rgba(74,106,71,0.45)'; g.setLineDash([6, 6]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + TILE_W / 2, y + 30); g.lineTo(x + TILE_W / 2, y + TILE_H - 20); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#1E2624'; g.font = "800 18px Nunito, sans-serif";
      const v = rec[picks[c].i][row.curve.key];
      g.fillText(`${c + 1}  ${picks[c].label}`, x + 12, y + TILE_H + 24);
      g.font = "600 16px Nunito, sans-serif"; g.fillStyle = '#4A5551';
      g.fillText(`${v >= 0 ? '+' : ''}${v.toFixed(1)}${row.curve.unit}`, x + TILE_W - 70, y + TILE_H + 24);
    }
    // The curve, with a dot at each frame.
    const cy = y0 + HEAD + TILE_H + LABEL + 14, ch = CURVE - 34, vals = rec.map((q) => q[row.curve.key]);
    const lo = Math.min(0, ...vals), hi = Math.max(0.1, ...vals);
    const px = (/** @type {number} */ i) => 12 + (i / (rec.length - 1)) * (strip.width - 24);
    const py = (/** @type {number} */ v) => cy + ch - ((v - lo) / (hi - lo)) * ch;
    g.strokeStyle = '#d9cfba'; g.lineWidth = 2; g.beginPath(); g.moveTo(12, py(0)); g.lineTo(strip.width - 12, py(0)); g.stroke();
    g.strokeStyle = '#4a6a47'; g.lineWidth = 3; g.beginPath();
    vals.forEach((v, i) => (i ? g.lineTo(px(i), py(v)) : g.moveTo(px(i), py(v)))); g.stroke();
    g.fillStyle = '#C9835A'; g.font = "800 16px Nunito, sans-serif";
    picks.forEach((p, c) => { g.beginPath(); g.arc(px(p.i), py(vals[p.i]), 6, 0, Math.PI * 2); g.fill(); g.fillText(String(c + 1), px(p.i) - 4, py(vals[p.i]) - 10); });
    g.fillStyle = '#4A5551'; g.font = "600 15px Nunito, sans-serif"; g.fillText(`${row.curve.label} over ${(rec.length * DT).toFixed(0)} s (0 is the line)`, 14, cy + ch + 18);
  }
  note.textContent = `${S.title}: ${rows.map((r) => r.picks.length).join(' and ')} frames.`;
  if (new URLSearchParams(location.search).get('save')) {
    const blob = await new Promise((ok) => strip.toBlob(ok, 'image/png'));
    const res = await fetch(`/__strip/${name}.png`, { method: 'PUT', body: blob });
    note.textContent += res.ok ? ' Saved.' : ' Not saved.';
  }
}

const bar = $('bar');
for (const name of Object.keys(STRIPS)) {
  const b = document.createElement('button');
  b.textContent = STRIPS[name].title;
  b.addEventListener('click', () => { bar.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b))); render(name); });
  bar.append(b);
}
const first = new URLSearchParams(location.search).get('strip') ?? Object.keys(STRIPS)[0];
/** @type {HTMLElement | undefined} */ (bar.children[Object.keys(STRIPS).indexOf(first)])?.click();
