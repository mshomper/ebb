// @ts-check
// Where the walker looks (walker gestures, part 2; October 24, 2026): the head, a little of the upper
// body and the drawn eyes turn toward the most interesting thing near you. First wins: the thing you
// clicked or are about to use (focus), a creature that just arrived (notice), the fire, a creature
// close by, a find. Only things in front (within frontDeg either side) and in reach count, so the
// head never swivels round to something behind you. Once it picks something it holds it at least
// holdS, so it never flicks between two; a passing interest (the fire, a creature, a find) is looked
// at for its kind's dwellS and then left be for againS, and the head goes back to where the view
// looks. Everything eases on springs with a top speed, so nothing snaps: the eyes move first (a small
// shift across the face, they lead), the head follows, the chest takes what is past the head's limit.
// Walking, it all turns less. Numbers: recipes/world/figure.json look. Pure; live animation only.

import { DEG } from './kinematics.js';

const wrap = (/** @type {number} */ a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (/** @type {number} */ v, /** @type {number} */ a) => Math.max(-a, Math.min(a, v));

/** @typedef {{ x: number, y: number, z: number, kind: string }} Interest */

/** A critically damped spring with a top speed. @param {number} k stiffness (1/s2) @param {number} vmax */
function follower(k, vmax) {
  let x = 0, v = 0;
  return {
    get x() { return x; },
    /** @param {number} goal @param {number} dt */
    step(goal, dt) {
      const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n, c = 2 * Math.sqrt(k);
      for (let i = 0; i < n; i++) {
        v = clamp(v + (k * (goal - x) - c * v) * h, vmax);
        x += v * h;
      }
      return x;
    },
    reset() { x = 0; v = 0; },
  };
}

/**
 * @param {any} L recipes/world/figure.json look
 */
export function createLook(L) {
  const vmax = L.degPerS * DEG;
  const head = { yaw: follower(L.headStiffness, vmax), pitch: follower(L.headStiffness, vmax) };
  const chest = follower(L.chestStiffness, vmax * 0.5);
  const eyes = { x: follower(L.eyes.stiffness, 1), y: follower(L.eyes.stiffness, 1) };
  let t = 0;
  /** The thing you clicked or are about to use. @type {(Interest & { until: number }) | null} */
  let focus = null;
  /** Creatures that just arrived. @type {(Interest & { until: number })[]} */
  let arrivals = [];
  /** Things looked at a while ago, left be for a time. @type {(Interest & { until: number })[]} */
  let seen = [];
  /** What it looks at now, since when, and how much it scored. @type {{ it: Interest, at: number, score: number } | null} */
  let chosen = null;
  /** The head's goal waits headDelayS after a new choice, so the eyes move first. */
  let heldGoal = { total: 0, chest: 0, pitch: 0 }, waitUntil = 0, was = /** @type {Interest | null} */ (null);

  const kindOf = (/** @type {string} */ k) => L.kinds[k] ?? L.kinds.find;
  const same = (/** @type {Interest} */ a, /** @type {Interest} */ b) => a.kind === b.kind && Math.hypot(a.x - b.x, a.z - b.z) < L.sameM;

  return {
    /** Look at a spot for forS seconds (a click on a thing, an action's target). @param {number} x @param {number} y @param {number} z @param {number} [forS] */
    focus(x, y, z, forS = L.focusS) { focus = { x, y, z, kind: 'focus', until: t + forS }; },
    /** A creature arrived there: worth a look. @param {number} x @param {number} y @param {number} z */
    notice(x, y, z) { arrivals.push({ x, y, z, kind: 'arrival', until: t + L.arrivalS }); },
    /** Put down somewhere new: look ahead, nothing chosen. */
    reset() { focus = null; arrivals = []; seen = []; chosen = null; was = null; waitUntil = 0; heldGoal = { total: 0, chest: 0, pitch: 0 }; head.yaw.reset(); head.pitch.reset(); chest.reset(); eyes.x.reset(); eyes.y.reset(); },
    /** What it looks at now (tools, tests). */
    get target() { return chosen ? chosen.it : null; },

    /**
     * Step. Returns the head's turn and tip (radians: yaw to the walker's left, pitch down), the
     * chest's turn, and the eyes' shift across the face (rest-pose meters: x to the left, y up).
     * @param {number} dt
     * @param {{ x: number, z: number, eyeY: number, yaw: number, m: number, viewYaw: number | null, extraYaw: number, interests: Interest[] }} s
     *   eyeY: the eyes' height (world m); yaw: the body's facing; m: 0 standing to 1 walking;
     *   viewYaw: where the view looks (world yaw), if anywhere; extraYaw: a short act's own turn of the head
     */
    update(dt, s) {
      t += dt;
      if (focus && t > focus.until) focus = null;
      arrivals = arrivals.filter((a) => a.until > t);
      seen = seen.filter((a) => a.until > t);
      const relOf = (/** @type {Interest} */ it) => wrap(Math.atan2(it.x - s.x, it.z - s.z) - s.yaw);
      const scoreOf = (/** @type {Interest} */ it) => {
        const K = kindOf(it.kind), d = Math.hypot(it.x - s.x, it.z - s.z);
        if (it.kind !== 'focus' && (d > K.maxM || Math.abs(relOf(it)) > L.frontDeg * DEG)) return 0;
        return K.weight / (1 + d * L.distFalloff);
      };
      // The best in reach now.
      /** @type {Interest | null} */ let best = null, bestScore = 0;
      for (const it of [...(focus ? [focus] : []), ...arrivals, ...s.interests]) {
        if (it.kind !== 'focus' && seen.some((q) => same(q, it))) continue;
        const sc = scoreOf(it);
        if (sc > bestScore) { best = it; bestScore = sc; }
      }
      if (chosen) {
        // The one chosen, where it is now (a creature moves): the same kind nearest where it was.
        const prev = chosen.it;
        const now = prev.kind === 'focus' ? focus : [...arrivals, ...s.interests].find((q) => same(q, prev)) ?? null;
        const sc = now ? scoreOf(now) : 0;
        const K = kindOf(prev.kind), held = t - chosen.at;
        const tired = prev.kind !== 'focus' && held > K.dwellS;
        if (!now || sc === 0 || tired) {
          if (tired && now) seen.push({ ...now, until: t + K.againS });
          chosen = null;
        } else {
          chosen.it = now; chosen.score = sc;
          // Held long enough, a much better one may take over; a focus always does.
          if (best && !same(best, now) && (best.kind === 'focus' || (held > L.holdS && bestScore > sc * L.switchRatio))) chosen = null;
        }
      }
      if (!chosen && best && !seen.some((q) => same(q, /** @type {Interest} */ (best)))) chosen = { it: best, at: t, score: bestScore };

      // Goals: toward the thing, or along the view (head only, as before).
      const less = 1 - L.walkingLess * s.m;
      // want: the whole way to the thing; the head and chest go as far as their limits, the eyes the rest.
      let total = 0, pitch = 0, chestGoal = 0, wantYaw = 0, wantPitch = 0;
      if (chosen) {
        const it = chosen.it;
        wantYaw = relOf(it) * less;
        wantPitch = Math.atan2(s.eyeY - it.y, Math.max(0.3, Math.hypot(it.x - s.x, it.z - s.z))) * less;
        total = clamp(wantYaw, (L.maxYawDeg + L.chestMaxDeg) * DEG);
        chestGoal = clamp(total * L.chestShare + Math.sign(total) * Math.max(0, Math.abs(total) - L.maxYawDeg * DEG), L.chestMaxDeg * DEG);
        pitch = clamp(wantPitch * L.pitchShare, L.targetPitchDeg * DEG);
      } else if (s.viewYaw !== null) {
        total = wantYaw = clamp(wrap(s.viewYaw - s.yaw), L.maxYawDeg * DEG) * (1 - 0.7 * s.m);
      }
      // A new choice: the eyes go at once, the head a beat later.
      const now = chosen ? chosen.it : null;
      if (now !== was && !(now && was && same(now, was))) waitUntil = t + L.headDelayS;
      was = now;
      if (t >= waitUntil) heldGoal = { total, chest: chestGoal, pitch };
      const headGoal = clamp(heldGoal.total - heldGoal.chest + s.extraYaw, L.maxYawDeg * DEG);
      const c = chest.step(heldGoal.chest, dt);
      const hy = head.yaw.step(headGoal, dt), hp = head.pitch.step(heldGoal.pitch, dt);
      // The eyes lead: they shift toward the thing by how far the head and chest still are from it,
      // so they move first, drift back toward the middle as the head arrives, and keep a little of
      // the way when the head has gone as far as it goes.
      const E = L.eyes, full = E.fullDeg * DEG;
      const ex = eyes.x.step(clamp((wantYaw - hy - c) / full, 1) * E.shiftM[0], dt);
      const ey = eyes.y.step(-clamp((wantPitch - hp) / full, 1) * E.shiftM[1], dt);
      return { yaw: hy, pitch: hp, chest: c, eyes: [ex, ey], target: chosen ? chosen.it : null };
    },
  };
}
