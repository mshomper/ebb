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
 */

/** @param {string} p */
async function loadJson(p) {
  const r = await fetch(new URL(`../../../${p}`, import.meta.url), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
}

/**
 * @param {import('../mixer.js').Mixer} mixer
 * @param {{ tier: 'desktop'|'mobile', seed: number, sunAltDeg: (t: number) => number, emit?: (name: string, payload: any) => void }} opts
 *   seed: the music's own seed (the world seed and this device's session count)
 */
export async function createMusic(mixer, opts) {
  const [director, rz, vo, rules, names, material, themes] = await Promise.all([
    loadJson('recipes/music/director.json'),
    loadJson('recipes/music/realize.json'), loadJson('recipes/music/voicing.json'), loadJson('recipes/music/develop.json'),
    loadJson('recipes/music/names.json'), loadJson('recipes/music/material/spring.json'),
    loadJson('recipes/music/pieces/themes/index.json').catch(() => ({ candidates: [] })),
  ]);
  const recipes = { realize: rz, voicing: vo };
  // The four tides in their sixteen seasonal settings (doc 24, Motifs).
  const tides = await Promise.all(themes.candidates.flatMap((/** @type {any} */ c) => Object.values(c.settings))
    .map((/** @type {any} */ id) => loadJson(`recipes/music/pieces/themes/${id}.json`)));
  // One stand-in per slot that the composer fills when chosen. Only spring has material so far, so
  // every season grows from spring's until the other seasons' material is written (phase 7).
  const grownSlots = GROWN_SLOTS.map((slot) => ({
    id: `grown-${slot}`, grownSlot: slot, slots: [slot], seasons: [...SEASONS], requires: {}, keys: [material.home],
  }));
  const dir = createDirector({ director, seasons: {} }, [...tides, ...grownSlots], { seed: opts.seed, sunAltDeg: opts.sunAltDeg });

  /** @type {Awaited<ReturnType<typeof createInstruments>> | null} */ let inst = null;
  /** @type {Promise<any> | null} */ let instPromise = null;
  /** @type {ReturnType<typeof createPerformer> | null} */ let performer = null;
  /** The piece playing (or being unpacked), or null. @type {null | { id: string, title: string, seed: number, slot: string, windowEndRealS: number, finishing: boolean, started: boolean }} */
  let current = null;
  /** @type {'often'|'now-and-then'|'rarely'|'off'} */ let frequency = 'now-and-then';
  /** @type {MusicState | null} */ let last = null;
  let disposed = false;

  /** The instruments, made once, after the first touch (the piano loads after the island's sounds). */
  function ensure() {
    instPromise ??= createInstruments(mixer.ctx, mixer.input('music'), { tier: opts.tier }).then((i) => {
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
    const piece = d.piece.grownSlot ? grow(material, rules, { slot: d.piece.grownSlot, weather: st.weather, seed: d.seed }, names).piece : d.piece;
    const key = d.key ?? piece.keys?.[0];
    current = { id: piece.id, title: piece.title ?? piece.id, seed: d.seed, slot, windowEndRealS: d.windowEndRealS, finishing: false, started: false };
    dir.started(d, dirState(st), key);
    const mine = current;
    try {
      const i = await ensure();
      if (current !== mine || disposed) return;
      const dayColor = dayColorAt(st.sunAltDeg, director.dayColor);
      const perf = realize(piece, { seed: d.seed, dayColor, available: i.available(), key: d.key }, recipes);
      const coda = piece.sections?.coda ? realize(piece, { seed: d.seed, dayColor, available: i.available(), key: perf.key, path: ['coda'] }, recipes) : null;
      await i.prepare(perf);
      if (current !== mine || disposed || !performer) return;
      mixer.setMusicTone({ lowpassHz: dayColor.brightHz, wet: dayColor.wet }, 2);
      mine.started = true;
      performer.play(perf, { coda, onEnd: () => ended(mine) });
      opts.emit?.('music:started', { id: piece.id, title: mine.title, seed: d.seed, slot });
    } catch (e) {
      console.warn('ebb music: a piece could not start', e);
      ended(mine);
    }
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
      const d = dir.update(dirState(st));
      if (d) start(d, st);
    },
    /**
     * Testing (`?music=now`, the lab's playPiece): grow and play a piece for a slot now, whatever
     * the director would say; the director then rests after it as usual.
     * @param {{slot?: string, seed?: number}} [o]
     */
    playNow(o = {}) {
      if (!last || current) return false;
      const slot = o.slot ?? 'morning';
      const stand = grownSlots.find((g) => g.grownSlot === slot) ?? grownSlots[0];
      start({ piece: stand, seed: (o.seed ?? opts.seed) >>> 0, slot, key: undefined, windowEndRealS: Infinity }, last);
      return true;
    },
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
