// @ts-check
// A small pond chorus for the listening page, calling by the game's rule
// (src/world/creatures/agents.js, recipes/species/frog.json motion.call):
//  - in the dusk window (from callAfterDuskH[0] to [1] hours after dusk) and content
//    (mood >= callFromMood), a frog that thinks again starts a calling bout (20 to 60 s) with
//    probability 0.6, otherwise rests 3 to 8 s and thinks again;
//  - while calling, at each 30 Hz step it starts a call with probability perS * dt, if its own
//    sac has settled (0.15 s after the last pulse) and no frog started within gapS (0.4 s);
//  - a call start is when its throat sac starts swelling (pulseS 0.32 s).
// The season's call density (doc 25: spring 1.3, summer 1, autumn 0.5, winter 0) scales perS.
// Everything is drawn from a seeded stream, so the same seed gives the same chorus.

import { stream } from '../../src/core/rng.js';

/**
 * @typedef {Object} LabFrog
 * @property {string} id
 * @property {number[]} pos   [x, y, z]
 * @property {'rest'|'call'} mode
 * @property {number} nextAt  frog clock seconds
 * @property {number} until
 * @property {number} pulseUntil
 * @property {number} lastCallAt
 */

/**
 * @param {any} call frog.json motion.call {perS, gapS, pulseS, boutS}
 * @param {any} moods frog.json motion.moods {callFromMood, callAfterDuskH}
 * @param {number} seed
 */
export function createChorus(call, moods, seed) {
  const stepHz = 30, dt = 1 / stepHz;
  /** @type {LabFrog[]} */
  let frogs = [];
  let clock = 0;
  let lastCall = -1e9;
  let r = stream(seed, 7);

  /**
   * Place n frogs on a ring around the pond (seeded jitter in angle and radius).
   * @param {number} n @param {number} radiusM
   */
  function place(n, radiusM) {
    const pr = stream(seed, 8, n);
    frogs = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (i + pr.range(-0.3, 0.3))) / n;
      const rr = radiusM * pr.range(0.85, 1.12);
      frogs.push({ id: `frog-${i + 1}`, pos: [Math.cos(a) * rr, 0.05, Math.sin(a) * rr], mode: 'rest', nextAt: clock + pr.range(0, 3), until: 0, pulseUntil: -1, lastCallAt: -1e9 });
    }
  }

  /**
   * Run the frogs up to clock time `to`, reporting each call start.
   * @param {number} to frog clock seconds
   * @param {{callTime: boolean, rateFactor: number}} env callTime: in the window and content
   * @param {(f: LabFrog, t: number) => void} onCall
   */
  function advance(to, env, onCall) {
    let guard = 0;
    while (clock + dt <= to && guard++ < 3000) {
      clock += dt;
      for (const f of frogs) {
        if (f.mode === 'call' && clock >= f.until) { f.mode = 'rest'; f.nextAt = clock; }
        if (!env.callTime && f.mode === 'call') { f.mode = 'rest'; f.nextAt = clock + 3; }
        if (f.mode === 'call') {
          if (clock >= f.pulseUntil + 0.15 && r.next() < call.perS * env.rateFactor * dt && clock - lastCall >= call.gapS) {
            f.pulseUntil = clock + call.pulseS;
            f.lastCallAt = clock;
            lastCall = clock;
            onCall(f, clock);
          }
        } else if (clock >= f.nextAt) {
          if (env.callTime && r.next() < 0.6) {
            f.mode = 'call';
            f.until = clock + r.range(call.boutS[0], call.boutS[1]);
          } else f.nextAt = clock + 3 + 5 * r.next();
        }
      }
    }
  }

  return {
    place,
    advance,
    /** Jump the frog clock (no calls on the way), e.g. after a hidden tab. @param {number} t */
    jumpTo(t) { clock = t; },
    now: () => clock,
    frogs: () => frogs,
    /** Is this hour in the frogs' dusk window? @param {number} hour @param {number} duskHour */
    inWindow(hour, duskHour) {
      const since = ((hour - duskHour) % 24 + 36) % 24 - 12;
      return since >= moods.callAfterDuskH[0] && since < moods.callAfterDuskH[1];
    },
    /** Restart the random stream (the "reseed" button). @param {number} s */
    reseed(s) { seed = s; r = stream(seed, 7); },
  };
}
