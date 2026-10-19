// @ts-check
// The reveal on return (docs 02, 13, 15; S7c). After catch-up (src/sim/away.js, `world:caught-up`):
//   under thresholdHours away: the plants grow in over a couple of seconds, no more;
//   longer: the cream screen fades into the scene while every plant grows from how it was to how it
//   is; rings mark the places the best notes are about; the animals, hidden while the plants grow,
//   all come back within one short window (a few nearest the middle of the view make their plop or
//   ripple); and the best notes show one at a time in the usual corner, each one's ring breathing,
//   with an arrow at the edge when it is out of view. The camera never moves. Any tap, key or wheel
//   ends it at once with everything in its final state; notes not shown stay in the journal under
//   "You may have missed". The HUD steps aside while it plays (body.ebb-revealing, hud.css).
// Nothing here knows a species: notes rank by kind (reveal-plan.js), plants and covers grow in
// from the growth state, and animals come back through the hooks each live animal system offers.
// Emits `reveal:started`, `reveal:note-shown`, `reveal:ended` (for the island's sounds later).
// Settings (S8b): reveal off skips it all, time-lapse and notes; calm motion (src/ui/motion.js)
// makes the long time-lapse the short one with every plant together, and holds the rings still.
// Timings: recipes/world/save.json `reveal`.

import { on, emit, emitDeferred } from '../core/events.js';
import { get, update } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { planReveal } from '../world/journal/reveal-plan.js';
import { iconSvg } from './icons/icons.js';
import { calm } from './motion.js';

/**
 * @param {{ app: any, words: any }} opts  app: startApp's result (world, growth, animals); words:
 *   recipes/world/journal.json
 */
export async function mountReveal(opts) {
  const { app, words } = opts;
  const R = (await loadRecipe('world/save')).reveal;
  const arrow = document.createElement('div');
  arrow.className = 'ebb-pointer ebb-reveal-pointer';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = iconSvg('back');
  document.body.appendChild(arrow);

  /** @type {null | { t0: number, timers: ReturnType<typeof setTimeout>[], places: { x: number, z: number }[], focus: number, shown: number, total: number, raf: number, still: boolean }} */
  let run = null;

  on('world:caught-up', (/** @type {any} */ p) => {
    if (run) finish(false);
    if (!p.before?.growth) return;
    // Settings' reveal off: no time-lapse and no notes. The island is simply as it is now, and the
    // notes wait in the journal as "You may have missed" (away.js then sends reveal: false, so
    // island-notes.js says how many).
    if (get('settings')?.reveal === false) return;
    // Calm motion (src/ui/motion.js): the plants grow in together, no ripple.
    if (!p.reveal) { app.growth?.timeLapse(p.before.growth, R.shortGrowS, calm() ? R.calmSpread : R.growSpread); return; }
    start(p);
  });

  /** @param {any} p the catch-up: hours, notes, events, before */
  function start(p) {
    const view = get('view');
    const plan = planReveal({ notes: p.notes ?? [], events: p.events ?? [], state: app.world.state, habitat: app.world.env.habitat?.() ?? null,
      words, count: R.notes, places: R.places, near: view?.center?.() ?? null });
    const t0 = performance.now();
    // Calm motion: the long time-lapse becomes the short one, all plants together, and the rings hold still.
    const still = calm();
    const growS = still ? R.shortGrowS : R.growS;
    run = { t0, timers: [], places: plan.places, focus: -1, shown: 0, total: (p.notes ?? []).length, raf: 0, still };
    document.body.classList.add('ebb-revealing');
    emitDeferred('reveal:started', { hours: p.hours, notes: plan.shown.length, places: plan.places.length });
    app.growth?.timeLapse(p.before.growth, growS, still ? R.calmSpread : R.growSpread);
    for (const a of animals()) a.hide();
    update('reveal', () => ({ rings }));
    const later = (/** @type {number} */ s, /** @type {() => void} */ fn) => run?.timers.push(setTimeout(fn, s * 1000));
    later(R.animalsAtS, animalsBack);
    plan.shown.forEach((s, i) => later(R.notesAtS + i * R.noteS, () => {
      if (!run) return;
      run.focus = s.place;
      run.shown++;
      emit('reveal:note', { note: s.note, showS: R.noteS });
      emitDeferred('reveal:note-shown', { index: i, sp: s.note.sp, kind: s.note.kind ?? null });
    }));
    const endS = Math.max(growS, R.animalsAtS + R.animalsWindowS + 0.5, R.notesAtS + plan.shown.length * R.noteS);
    later(endS, () => finish(false));
    // Any tap, key or wheel ends it, with everything where it ends up.
    addEventListener('pointerdown', interrupt, true);
    addEventListener('keydown', interrupt, true);
    addEventListener('wheel', interrupt, { capture: true, passive: true });
    follow();
  }

  /** @param {Event} e */
  function interrupt(e) {
    // A tap on a reveal note opens its page; the reveal ends either way.
    void e;
    finish(true);
  }

  /** The live animal systems that can take part (frogs, midges now; more later). */
  function animals() { return /** @type {any[]} */ (app.animals ?? []).filter((a) => a && typeof a.hide === 'function'); }

  /** Every animal back within one window; only the few nearest the middle of the view plop or ripple. */
  function animalsBack() {
    const near = get('view')?.center?.() ?? [0, 0];
    /** @type {{ sys: any, id: number, d: number }[]} */ const all = [];
    for (const sys of animals()) {
      if (sys.style === 'thicken') continue;   // a swarm has no plop
      for (const s of sys.spots()) all.push({ sys, id: s.id, d: (s.x - near[0]) ** 2 + (s.z - near[1]) ** 2 });
    }
    all.sort((a, b) => a.d - b.d || a.id - b.id);
    const chosen = all.slice(0, R.animalEffects);
    for (const sys of animals()) sys.back({ windowS: R.animalsWindowS, effects: new Set(chosen.filter((c) => c.sys === sys).map((c) => c.id)) });
  }

  /** The reveal's rings for the terrain marks: each place, the shown note's breathing. @param {number} now ms */
  function rings(now) {
    if (!run) return [];
    const t = (now - run.t0) / 1000;
    const k = Math.min(1, Math.max(0, (t - R.notesAtS + 0.6) / 0.6));
    return run.places.map((p, i) => {
      const focus = i === run?.focus;
      // Calm motion: the shown note's ring holds still at its middle size.
      const breath = !focus ? 0 : run?.still ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 2.4);
      return [p.x, p.z, R.ringM * (1 + 0.15 * breath), k * (focus ? 0.55 + 0.35 * breath : 0.4)];
    });
  }

  /** The arrow at the screen's edge toward the shown note's ring while it is out of view. */
  function follow() {
    if (!run) { arrow.classList.remove('is-on'); return; }
    run.raf = requestAnimationFrame(follow);
    const place = run.focus >= 0 ? run.places[run.focus] : null;
    const view = get('view');
    if (!place || !view) { arrow.classList.remove('is-on'); return; }
    const p = view.project(place.x, place.z), M = 28, W = innerWidth, H = innerHeight;
    const inside = !p.behind && p.x > M && p.x < W - M && p.y > M && p.y < H - M;
    arrow.classList.toggle('is-on', !inside);
    if (inside) return;
    const cx = W / 2, cy = H / 2, dx = p.x - cx, dy = p.y - cy;
    const k = Math.min((W / 2 - M) / Math.max(Math.abs(dx), 1e-3), (H / 2 - M) / Math.max(Math.abs(dy), 1e-3));
    const deg = Math.atan2(dy, dx) * 180 / Math.PI + 180;   // the drawn chevron points left
    arrow.style.transform = `translate(${Math.round(cx + dx * k - 22)}px, ${Math.round(cy + dy * k - 22)}px) rotate(${deg.toFixed(1)}deg)`;
  }

  /** End the reveal: by input (everything lands now) or because it played out. @param {boolean} interrupted */
  function finish(interrupted) {
    if (!run) return;
    const r = run;
    run = null;
    for (const t of r.timers) clearTimeout(t);
    cancelAnimationFrame(r.raf);
    removeEventListener('pointerdown', interrupt, true);
    removeEventListener('keydown', interrupt, true);
    removeEventListener('wheel', interrupt, { capture: true });
    app.growth?.endTimeLapse();
    for (const a of animals()) a.end();
    arrow.classList.remove('is-on');
    update('reveal', () => null);
    document.body.classList.remove('ebb-revealing');
    const missed = Math.max(0, r.total - r.shown);
    emit('reveal:ended', { missed, interrupted });
  }
}
