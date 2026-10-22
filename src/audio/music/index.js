// @ts-check
// The music in the game (doc 24, "Module API"): the quiet musician. The director (director.js)
// decides when to play and what, twice a second, against the game's own sun and display time;
// this plays it. A slot with no written piece gets one grown by the composer (develop/, from the
// season's material, seeded, so the same seed always gives the same piece and name); the four
// tides sit in the pool as they are, and the season's home tide opens its first morning. Each piece
// unpacks only the notes it uses, plays on the music bus, and finishes gently at a phrase end when
// its slot closes or the music is turned off. The music's brightness and room follow the sun
// (daycolor.js). Nothing starts while the frogs call, during a time preview, or before the first
// touch. Its randomness is its own (src/core/rng.js, the 'music' streams), so it never touches the
// world.
//
//   update(state) ─→ director ─→ grow() or a written piece ─→ realize() ─→ prepare ─→ performer
//                                                                            └─→ mixer 'music' bus

import { createDirector } from './director.js';
import { realize } from './realize.js';
import { createPerformer } from './perform.js';
import { createInstruments } from './instruments.js';
import { dayColorAt } from './daycolor.js';
import { grow } from './develop/index.js';
import { heartOf, soundOf } from './hearts.js';
import { hash32 } from '../../core/rng.js';
import { DAYS_PER_SEASON } from '../../core/clock.js';
import { stream } from '../../core/rng.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
/** Slots a grown piece can fill (the composer's slot names). */
const GROWN_SLOTS = ['morning', 'interlude', 'evening', 'nocturne'];

/**
 * What the game tells the music each update.
 * @typedef {Object} MusicState
 * @property {number} realS        real seconds since the session began
 * @property {number} gameT        display time, game seconds
 * @property {number} sunAltDeg    the sun's height now
 * @property {'clear'|'cloud'|'rain'|'mist'} weather
 * @property {boolean} frogsAwake  a frog is on the island and not asleep for winter
 * @property {boolean} frogsCalling a frog is calling now
 * @property {string[]} residents  settled species ids
 * @property {boolean} previewing  display time is away from world time (the time dial)
 * @property {number} [flow]       the time speed now (0 paused, 1, 2 or 4; default 1)
 * @property {boolean} [freshIsland] this island is brand new (no save came back): the opening plays
 */

/** @param {string} p */
async function loadJson(p) {
  const r = await fetch(new URL(`../../../${p}`, import.meta.url), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
}

/**
 * @param {import('../mixer.js').Mixer} mixer
 * @param {{ seed: number, sunAltDeg: (t: number) => number, emit?: (name: string, payload: any) => void }} opts
 *   seed: the music's own seed (the world seed and this device's session count)
 */
export async function createMusic(mixer, opts) {
  const [director, rz, vo, rules, names, spring, themes, summer] = await Promise.all([
    loadJson('recipes/music/director.json'),
    loadJson('recipes/music/realize.json'), loadJson('recipes/music/voicing.json'), loadJson('recipes/music/develop.json'),
    loadJson('recipes/music/names.json'), loadJson('recipes/music/material/spring.json'),
    loadJson('recipes/music/pieces/themes/index.json').catch(() => ({ candidates: [] })),
    loadJson('recipes/music/material/summer.json').catch(() => null),
  ]);
  // Each season's material (recipes/music/material/); a season without its own grows from spring's.
  /** @type {Record<string, any>} */
  const materials = { spring, ...(summer ? { summer } : {}) };
  const material = spring;
  /** The material for a season, or spring's. @param {string} season */
  const materialFor = (season) => materials[season] ?? spring;
  /** The season at a game time (14 game days each, src/core/clock.js). @param {number} gameT */
  const seasonAt = (gameT) => SEASONS[Math.floor(gameT / (DAYS_PER_SEASON * 86400)) % 4];
  const recipes = { realize: rz, voicing: vo };
  // The four tides in their sixteen seasonal settings (doc 24, Motifs).
  const tides = await Promise.all(themes.candidates.flatMap((/** @type {any} */ c) => Object.values(c.settings))
    .map((/** @type {any} */ id) => loadJson(`recipes/music/pieces/themes/${id}.json`)));
  // One stand-in per slot that the composer fills when chosen, from the season's own material.
  const grownSlots = GROWN_SLOTS.map((slot) => ({
    id: `grown-${slot}`, grownSlot: slot, alwaysNew: true, slots: [slot], seasons: [...SEASONS], requires: {}, keys: [material.home],
  }));
  const dir = createDirector({ director, seasons: {} }, [...tides, ...grownSlots], { seed: opts.seed, sunAltDeg: opts.sunAltDeg });

  /** @type {Awaited<ReturnType<typeof createInstruments>> | null} */ let inst = null;
  /** @type {Promise<any> | null} */ let instPromise = null;
  /** @type {ReturnType<typeof createPerformer> | null} */ let performer = null;
  /** The piece playing (or being unpacked), or null. @type {null | { id: string, title: string, seed: number, slot: string, windowEndRealS: number, finishing: boolean, started: boolean, key: string }} */
  let current = null;
  /** @type {'often'|'now-and-then'|'rarely'|'off'} */ let frequency = 'now-and-then';
  /** @type {MusicState | null} */ let last = null;
  // The opening (director.json opening): on a brand-new island, soon after the first touch, the home
  // tide, a short rest, then a grown piece; the director takes over after that. Stages: 0 not yet
  // touched, 1 waiting to start the tide, 2 tide playing, 3 resting, 4 done (or not a new island).
  const O = director.opening;
  const openRng = stream(opts.seed >>> 0, 0x6f70);
  const opening = { stage: O ? 0 : 4, at: 0 };
  // Hearted pieces (hearts.js; director.json hearts): a hearted tide weighs more in the choice, and a
  // slot the composer fills sometimes plays a hearted grown piece of that slot again instead.
  const HR = director.hearts ?? { weight: 1, replayChance: 0, minGapRealMin: 60 };
  const heartRng = stream(opts.seed >>> 0, 0x6872);
  /** @type {import('./hearts.js').Heart[]} */ let hearted = [];
  /** @type {import('./hearts.js').Heart[]} */ let passed = [];
  /** Real seconds each hearted grown piece last played. @type {Map<string, number>} */ const replayedAt = new Map();
  // The return reveal (director.json reveal): while it plays the director waits; the home tide plays
  // under the drift, at most once every onceEveryRealH real hours (kept on this device).
  const RV = director.reveal ?? { onceEveryRealH: 20, fadeS: 8 };
  let revealing = false;
  let revealTide = false;
  /** A test request (?music=now) waiting for the next update. @type {null | { slot: string, seed: number }} */
  let pendingNow = null;
  let disposed = false;

  /** The instruments, made once, after the first touch (the piano loads after the island's sounds). */
  function ensure() {
    instPromise ??= createInstruments(mixer.ctx, mixer.input('music')).then((i) => {
      inst = i;
      performer = createPerformer(mixer.ctx, i.set);
      return i;
    });
    return instPromise;
  }

  /** @param {MusicState} st */
  const dirState = (st) => ({ ...st, frequency });

  /** Start what the director chose. @param {any} d @param {MusicState} st */
  async function start(d, st) {
    const slot = d.slot === 'early-nocturne' ? 'nocturne' : d.slot;
    // A slot the composer fills may replay one of your hearted grown pieces for that slot.
    let growSeed = d.seed, growWeather = st.weather;
    const growSeason = materials[seasonAt(st.gameT)] ? seasonAt(st.gameT) : 'spring';
    let replay = false;
    if (d.piece.grownSlot) {
      const ofSlot = hearted.filter((h) => h.kind === 'grown' && h.slot === d.piece.grownSlot && (h.season ?? 'spring') === growSeason
        && st.realS - (replayedAt.get(h.key) ?? -Infinity) >= HR.minGapRealMin * 60);
      if (ofSlot.length && heartRng.next() < HR.replayChance) {
        const h = ofSlot[heartRng.int(ofSlot.length)];
        growSeed = /** @type {number} */ (h.seed);
        growWeather = /** @type {any} */ (h.weather ?? st.weather);
        replayedAt.set(h.key, st.realS);
        replay = true;
      }
    }
    /** @param {number} s */
    const growFrom = (s) => grow(materialFor(growSeason), rules, { slot: d.piece.grownSlot, weather: growWeather, seed: s }, names).piece;
    let piece = d.piece.grownSlot ? growFrom(growSeed) : d.piece;
    // A new grown piece leans away from what you turned down (director.json hearts.passLean): a piece
    // you passed never comes back, and one whose form or sound you keep passing is often grown again
    // from another seed. The seed itself always grows the same piece, so hearts still come back exactly.
    if (d.piece.grownSlot && !replay) {
      for (let k = 0; k < (HR.passTries ?? 3); k++) {
        const h = heartOf({ id: piece.id, title: piece.title, grown: true, grownSlot: d.piece.grownSlot, weather: growWeather, seed: growSeed, season: growSeason });
        const formN = passed.filter((p) => p.template && p.template === piece.grown?.template).length;
        const soundN = passed.filter((p) => p.sound && p.sound === soundOf(piece.palette)).length;
        const keep = Math.max(HR.passFloor ?? 0.35, (HR.passLean ?? 0.75) ** (formN + soundN));
        const gone = passed.some((p) => p.key === h.key);
        if (!gone && heartRng.next() < keep) break;
        growSeed = hash32(growSeed, 0x7061, k + 1);
        piece = growFrom(growSeed);
      }
    }
    const key = d.key ?? piece.keys?.[0];
    // A tide shows its own name ("Moon pull"), a grown piece the composer's.
    current = { id: piece.id, title: piece.theme?.name ?? piece.title ?? piece.id, seed: growSeed, slot, windowEndRealS: d.windowEndRealS, finishing: false, started: false,
      key: heartOf({ id: piece.id, title: '', grown: !!d.piece.grownSlot, grownSlot: d.piece.grownSlot, weather: growWeather, seed: growSeed, season: growSeason }).key };
    dir.started(d, dirState(st), key);
    const mine = current;
    try {
      const i = await ensure();
      if (current !== mine || disposed) return;
      const dayColor = dayColorAt(st.sunAltDeg, director.dayColor);
      const perf = realize(piece, { seed: growSeed, dayColor, available: i.available(), key: d.key }, recipes);
      const coda = piece.sections?.coda ? realize(piece, { seed: growSeed, dayColor, available: i.available(), key: perf.key, path: ['coda'] }, recipes) : null;
      await i.prepare(perf);
      if (current !== mine || disposed || !performer) return;
      mixer.setMusicTone({ lowpassHz: dayColor.brightHz, wet: dayColor.wet }, 2);
      mine.started = true;
      performer.play(perf, { coda, onEnd: () => ended(mine) });
      opts.emit?.('music:started', { id: piece.id, title: mine.title, seed: growSeed, slot, durationS: perf.durationS,
        grown: !!d.piece.grownSlot, grownSlot: d.piece.grownSlot, weather: growWeather, season: growSeason,
        template: piece.grown?.template, sound: soundOf(piece.palette) });
    } catch (e) {
      console.warn('ebb music: a piece could not start', e);
      ended(mine);
    }
  }

  /**
   * One step of the opening, when nothing is playing. True while the opening holds the director back.
   * @param {MusicState} st
   */
  function openingStep(st) {
    if (opening.stage === 0) {
      if (!st.freshIsland) { opening.stage = 4; return false; }
      opening.stage = 1;
      opening.at = st.realS + openRng.range(O.afterTouchS[0], O.afterTouchS[1]);
    }
    if (st.frogsCalling || st.previewing || frequency === 'off') return true;
    if (opening.stage === 1 && st.realS >= opening.at) {
      opening.stage = 2;
      const tide = dir.homeTide(st.gameT);
      const piece = tide ?? grownSlots.find((g) => g.grownSlot === O.then) ?? grownSlots[0];
      start({ piece, seed: openRng.int(2 ** 31), slot: O.then, key: undefined, windowEndRealS: Infinity }, st);
      return true;
    }
    if (opening.stage === 2) {
      opening.stage = 3;
      opening.at = st.realS + openRng.range(O.restS[0], O.restS[1]);
      return true;
    }
    if (opening.stage === 3 && st.realS >= opening.at) {
      opening.stage = 4;
      const stand = grownSlots.find((g) => g.grownSlot === O.then) ?? grownSlots[0];
      start({ piece: stand, seed: openRng.int(2 ** 31), slot: O.then, key: undefined, windowEndRealS: Infinity }, st);
      return true;
    }
    return opening.stage < 4;
  }

  /** A piece is over (finished, stopped or failed): rest. @param {any} which */
  function ended(which) {
    if (current !== which) return;
    current = null;
    if (last) dir.ended(dirState(last));
    inst?.trim();
    opts.emit?.('music:ended', { id: which.id });
  }

  return {
    /**
     * Twice a second.
     * @param {MusicState} st
     */
    update(st) {
      last = st;
      if (disposed) return;
      // Nothing is decided before the first touch or while the tab is hidden: the slots then pass
      // unheard rather than piling up.
      if (mixer.ctx.state !== 'running') return;
      ensure();
      // The music's colour follows the sun, even through a time preview.
      const dc = dayColorAt(st.sunAltDeg, director.dayColor);
      if (current?.started) {
        mixer.setMusicTone({ lowpassHz: dc.brightHz, wet: dc.wet }, 4);
        // Past its slot's close, or turned off: finish the phrase, then the coda.
        if (!current.finishing && (st.realS > current.windowEndRealS || frequency === 'off')) {
          current.finishing = true;
          performer?.finish();
        }
        return;
      }
      if (current) return;   // unpacking
      if (revealTide) {
        revealTide = false;
        const tide = dir.homeTide(st.gameT);
        if (tide) start({ piece: tide, seed: heartRng.int(2 ** 31), slot: 'reveal', key: undefined, windowEndRealS: Infinity }, st);
        return;
      }
      if (revealing) return;
      if (pendingNow) {
        const { slot, seed } = pendingNow;
        pendingNow = null;
        const stand = grownSlots.find((g) => g.grownSlot === slot) ?? grownSlots[0];
        start({ piece: stand, seed, slot, key: undefined, windowEndRealS: Infinity }, st);
        return;
      }
      if (opening.stage < 4 && openingStep(st)) return;
      const d = dir.update(dirState(st));
      if (d) start(d, st);
    },
    /**
     * Testing (`?music=now`, the lab's playPiece): grow and play a piece for a slot now, whatever
     * the director would say; the director then rests after it as usual.
     * @param {{slot?: string, seed?: number}} [o]
     */
    playNow(o = {}) {
      if (pendingNow) return false;
      pendingNow = { slot: o.slot ?? 'morning', seed: (o.seed ?? opts.seed) >>> 0 };
      return true;
    },
    /**
     * The pieces you hearted (store slice music): hearted tides weigh more in the director's choice.
     * @param {import('./hearts.js').Heart[]} list
     */
    setHearted(list) {
      hearted = Array.isArray(list) ? list : [];
      const keys = new Set(hearted.map((h) => h.key));
      for (const t of tides) t.weight = (director.tides?.weight ?? 1) * (keys.has(`tide:${t.id}`) ? HR.weight : 1);
    },
    /**
     * The pieces you turned down (store slice music, passed): a passed tide leaves the pool, and a
     * piece playing now that you turn down fades out over hearts.passFadeS.
     * @param {import('./hearts.js').Heart[]} list
     */
    setPassed(list) {
      passed = Array.isArray(list) ? list : [];
      const keys = new Set(passed.map((h) => h.key));
      for (const t of tides) t.passed = keys.has(`tide:${t.id}`);
      if (current?.started && !current.finishing && keys.has(current.key)) {
        current.finishing = true;
        performer?.stop(HR.passFadeS ?? 4);
      }
    },
    /**
     * The return reveal began (reveal:started). A full reveal plays the home tide, unless one did
     * recently or the music is off; a piece already playing fades out first.
     * @param {{ full: boolean }} o
     */
    revealStarted(o) {
      revealing = true;
      // Before the first touch the reveal runs silent, and the tide waits to play just after that touch.
      if (!o.full || frequency === 'off') return;
      let lastAt = 0;
      try { lastAt = Number(localStorage.getItem('ebb.music.revealAt') ?? 0) || 0; } catch { /* no storage: allow it */ }
      if (Date.now() - lastAt < RV.onceEveryRealH * 3600 * 1000) return;
      try { localStorage.setItem('ebb.music.revealAt', String(Date.now())); } catch { /* fine */ }
      if (current?.started) performer?.stop(Math.min(RV.fadeS, 3));
      revealTide = true;
    },
    /** The reveal ended (reveal:ended): the director carries on. */
    revealEnded() { revealing = false; },
    /** @param {'often'|'now-and-then'|'rarely'|'off'} level */
    setFrequency(level) { frequency = level; },
    /** Stop now with a fade (mute, photo export). @param {{fadeS?: number}} [o] */
    stop(o = {}) { performer?.stop(o.fadeS ?? 8); },
    /** What is playing: { id, title, seed, slot } or null (tools, and later the now-playing line). */
    playing: () => (current?.started ? { id: current.id, title: current.title, seed: current.seed, slot: current.slot } : null),
    /** The director's log and history (tools). */
    log: () => dir.log(),
    history: () => dir.history(),
    /** The instruments' memory, by name (tools). */
    stats: () => (inst ? inst.stats() : {}),
    dispose() { disposed = true; performer?.stop(0.3); },
  };
}
