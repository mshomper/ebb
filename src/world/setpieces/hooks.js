// @ts-check
// Each set piece's own rules, for the runner (runner.js): what a choice does to its run (onNote),
// what a step writes as it falls (onStep), what carries from one run to the next (carry), and its
// own wait-for checks. Pure and worker-safe: they read the run and the recipe, and return a new run.
// A set piece with no entry here still plays its beats; the rest of F14's first set add theirs here.

import { hash32 } from '../../core/rng.js';
import { pick } from './runner.js';

/**
 * @typedef {import('./runner.js').Run} Run
 * @typedef {{ onNote?: (run: Run, note: any, c: any) => Run, onStep?: (run: Run, step: any, c: any) => Run,
 *   carry?: (last: Run | undefined) => Record<string, any>, waitFor?: Record<string, (run: Run, R: any, sp: any) => boolean> }} Hooks
 */

/** @param {any[]} a @param {number} i @param {(v: any) => any} fn */
const at = (a, i, fn) => a.map((v, j) => (j === i ? fn(v) : v));

/**
 * The cairn builder: a cairn a step along a trail the live game planned (a `trail` note, once); a
 * stone added to a cairn (a `stone` note, addMax at most each) is answered by the next with one more
 * than it holds; the letter under the last is read (a `read` note).
 * @type {Hooks}
 */
const cairns = {
  onNote(run, note, c) {
    const C = c.R.cairn, list = run.data.cairns ?? [];
    if (note.kind === 'trail') return run.data.trail ? run : { ...run, data: { ...run.data, trail: note.points } };
    if (note.kind === 'read') return run.data.read !== undefined || list.length < (c.R.beats[0].repeat ?? 1) ? run : { ...run, data: { ...run.data, read: note.hour } };
    if (note.kind === 'stone') {
      const i = note.cairn;
      if (!(i >= 0 && i < list.length) || list[i].added >= C.addMax) return run;
      return { ...run, data: { ...run.data, cairns: at(list, i, (k) => ({ ...k, added: k.added + 1 })) } };
    }
    return run;
  },
  onStep(run, step, c) {
    if (step.def.id !== 'cairn') return run;
    const C = c.R.cairn, list = run.data.cairns ?? [], prev = list[list.length - 1];
    const answer = !!prev && prev.added > 0;
    const stones = answer ? Math.min(C.maxStones, prev.stones + prev.added + 1) : pick(C.stones, c.env.seed ?? 0, 0xca1, run.n, list.length);
    const seed = hash32(c.env.seed ?? 0, 0xca2, list.length) >>> 0;
    return { ...run, data: { ...run.data, cairns: [...list, { stones, added: 0, hour: c.hour, seed, answer }] } };
  },
};

/**
 * The passing boat: a parcel left on the stone while the boat lies at anchor (a `parcel` note,
 * between dusk and dawn); at dawn, if there was one, a gift in return and the next letter. An untaken
 * gift and the count of parcels sent carry to the next run.
 * @type {Hooks}
 */
const boat = {
  carry(last) {
    const d = last?.data ?? {};
    return { sent: d.sent ?? 0, given: d.given ?? 0, ...(d.gift && d.gift.taken === undefined ? { gift: d.gift } : {}) };
  },
  onNote(run, note, c) {
    if (note.kind === 'parcel') {
      // Only while the boat lies at anchor: dusk has fallen, dawn not yet.
      if (run.fell.length !== 1 || run.data.parcel) return run;
      return { ...run, data: { ...run.data, parcel: { what: note.what, hour: note.hour } } };
    }
    if (note.kind === 'taken') {
      const g = run.data.gift;
      return g && g.taken === undefined ? { ...run, data: { ...run.data, gift: { ...g, taken: note.hour } } } : run;
    }
    return run;
  },
  onStep(run, step, c) {
    if (step.def.id !== 'dawn' || !run.data.parcel) return run;
    const B = c.R.boat, sent = (run.data.sent ?? 0) + 1, given = run.data.given ?? 0;
    // The keeper's gift after many seasons; otherwise the returns in turn (the letters speak of
    // them), passing over one that is what was sent.
    const R = B.returns, at = (sent - 1) % R.length;
    const keep = B.keepsakeAfter && sent === B.keepsakeAfter ? B.keepsake : null;
    const ret = keep ?? (R[at].kind !== run.data.parcel.what ? R[at] : R[(at + 1) % R.length]);
    // The letters in order, warmer as they go; past the last, the quiet ones by turn (page ids).
    const letters = B.letters, quiet = B.quiet ?? [];
    const letter = given < letters.length ? letters[given] : quiet.length ? quiet[(given - letters.length) % quiet.length] : null;
    const gift = { kind: ret.kind, n: ret.n ?? 1, keepsake: !!keep, letter, hour: c.hour };
    return { ...run, data: { ...run.data, sent, given: given + 1, gift } };
  },
};

/** @type {Record<string, Hooks>} */
export const HOOKS = { cairns, boat };
