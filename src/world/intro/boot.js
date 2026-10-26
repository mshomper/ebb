// @ts-check
// The first evening's start (docs/future/13 sections 2.2 and 2.3), as src/app.js sees it. A new
// island opens at dawn on spring day 0 with the walker standing on the beach below the camp and
// the boat grounded behind (Matt, October 22: no row-in). A save in the middle of the evening opens
// below where you stood. The director itself starts once the journal is up (src/main.js), since
// its flags live in the journal. The camp pad is E1's store slice `campPad` (src/world/camp); on an
// older island it is null until stamped on the first load, and the boat moors once it is.
//
// Test links (unsaved): `?intro` runs the evening on a fresh island; `?intro=<beatId>` starts at
// that beat with the earlier beats' results laid in (dusk and rest open near sunset);
// `?intro=shape-sunset` and `?intro=dawn` open a moment (MOMENTS below); `?nointro`
// starts a fresh island as if skipped. Other test links leave the evening out entirely, so they
// open as they always have.

import { emit } from '../../core/events.js';
import { get, subscribe, update } from '../../core/store.js';
import { dispatch } from '../../input/actions.js';
import { sunMoon } from '../sky/sun-moon.js';
import { createIntroLive, dawnHour, flapSpot } from './adapter.js';
import { mooringOf } from './boat.js';

const H = 3600;

/** Beats that open near sunset on a test link. */
const DUSK_BEATS = ['dusk', 'rest'];

/**
 * Test links that open a moment rather than a beat (tools/intro-lab.html): `?intro=shape-sunset`
 * opens a minute of game time before sunset, two parts into the shape beat; `?intro=dawn` opens just
 * before the first sunrise with the ring and the day's beats undone, never having rested.
 * @type {Record<string, { beat: string, parts?: number, at: 'sunset' | 'dawn' }>}
 */
const MOMENTS = { 'shape-sunset': { beat: 'shape', parts: 2, at: 'sunset' }, dawn: { beat: 'ring', at: 'dawn' } };

/** The hour of today's sunset on day 0. @param {any} orbit */
function sunsetHour(orbit) {
  let h = 12;
  while (h < 23 && sunMoon(h * H, orbit).sunAlt >= 0) h += 1 / 60;
  return h;
}

/**
 * Does the evening run on this visit? A save always runs it (it may be done already); a fresh
 * island runs it unless another test link opened it. @param {URLSearchParams} params
 * @param {boolean} fresh @param {string[]} testParams src/save/autosave.js TEST_PARAMS
 */
export function introRuns(params, fresh, testParams) {
  if (!fresh || params.has('intro') || params.has('nointro')) return true;
  return !testParams.some((k) => params.has(k));
}

/**
 * The hour a new island opens on, or null to keep the usual start (a save, or a test link that
 * sets the day or the hour). @param {any} R recipes/world/intro.json @param {any} orbit
 * @param {URLSearchParams} params @param {boolean} fresh @param {string[]} testParams
 * @param {boolean} timeSet a test link set the day or hour
 */
export function introStartHour(R, orbit, params, fresh, testParams, timeSet) {
  if (!fresh || timeSet || !introRuns(params, fresh, testParams)) return null;
  const beat = params.get('intro');
  const m = beat ? MOMENTS[beat] : null;
  if (m?.at === 'sunset') return sunsetHour(orbit) - 0.1;
  if (m?.at === 'dawn') {
    // Just before the sun rises on day 1.
    let h = 24 + 2;
    while (h < 24 + 12 && sunMoon(h * H, orbit).sunAlt < 0) h += 1 / 60;
    return h - 0.1;
  }
  if (beat && DUSK_BEATS.includes(beat)) {
    // Just before sunset on day 0 for dusk (the beat starts as the sun goes), just after for rest.
    const h = sunsetHour(orbit);
    return beat === 'dusk' ? h - 0.2 : h + 0.3;
  }
  return dawnHour(R, orbit);
}

/**
 * @param {{ R: any, boatR: any, params: URLSearchParams, testParams: string[], back: any, walk: any,
 *   terrain: any, water: any, land: any, terrainSeed: number, orbit: any, clock: any, camera?: any,
 *   pack?: any, camp?: any, campRecipe?: any, boat?: { setMooring: (m: any) => void } | null }} o
 *   campRecipe: recipes/world/camp.json (how far round the view opens at the flap)
 *   pack: E2's pack (holds, take); boat: the boat (boat.js createBoat), set at its mooring here
 */
export function createIntroBoot(o) {
  const fresh = !o.back;
  const runs = introRuns(o.params, fresh, o.testParams);
  const beatIds = o.R.beats.map((/** @type {any} */ b) => b.id);
  const testLink = fresh ? o.params.get('intro') : null;
  const moment = testLink ? MOMENTS[testLink] ?? null : null;
  const testBeat = moment?.beat ?? testLink;
  const at = testBeat ? Math.max(0, beatIds.indexOf(testBeat)) : 0;
  const flags = /** @type {string[]} */ (o.back?.journal?.flags ?? []);
  // The store slice `intro` { beat, started, done } is there from the first frame on every path
  // (E3 offers Light and Rest by it): an island that never runs the evening reads as done.
  update('intro', () => ({ beat: null, started: false, done: !runs }));
  const ground =(/** @type {number} */ x, /** @type {number} */ z) => o.terrain.sampleHeight(x, z);
  const B = o.boatR.boat ?? o.boatR;
  /** The mooring from a pad: the land recipe's mooring numbers over the boat recipe's. @param {any} pad */
  const moor = (pad) => (pad ? mooringOf(pad, ground, { ...B.mooring, ...(pad.camp?.mooring ?? {}) }) : null);
  const pad = get('campPad') ?? null;
  const mooring = moor(pad);
  o.boat?.setMooring(mooring);
  // An older island's pad is stamped on its first load: the boat moors once it is.
  const offPad = subscribe('campPad', (/** @type {any} */ p) => o.boat?.setMooring(moor(p)));
  /** @type {ReturnType<typeof createIntroLive> | null} */ let live = null;

  // Where the walker opens: on the beach for a new island (moved up the beach while the tide
  // covers the spot); at the tent flap on a test link past the landing; below where you stood for
  // a save in the middle of the evening.
  if (runs && fresh && !o.params.has('nointro') && pad) {
    let s = at >= beatIds.indexOf('page') ? flapSpot(pad) : mooring?.stand ?? null;
    for (let i = 0; s && i < 40 && ground(s.x, s.z) < o.water.tide + 0.05; i++) s = { ...s, x: s.x - pad.fx * 0.25, z: s.z - pad.fz * 0.25 };
    if (s && o.walk.placeAt(s.x, s.z, s.yaw, 'stand')) {
      // The low view opens behind you, looking where you face (the camera's yaw points from the
      // target back to the eye).
      const p = o.camera?.pose();
      // At the flap, from beside you, so the tent at your back does not fill the view (E3).
      const side = at >= beatIds.indexOf('page') ? o.campRecipe?.rest?.viewSideRad ?? 1.25 : 0;
      if (p) o.camera.setPose({ ...p, target: [s.x, ground(s.x, s.z), s.z], yaw: s.yaw + Math.PI + side });
      o.walk.downHere();
    }
  } else if (!fresh && flags.includes('intro:begun') && !flags.includes('intro:done')) {
    o.walk.downHere();
  }

  return {
    id: 'intro',
    /** The boat's stake, where it lies, and where a new island's walker stands (as it opened). */
    mooring,
    /** The director, once started. */
    get live() { return live; },
    /** The pack (E2), made after the walker: the ring beat asks it what you hold. @param {any} pack */
    usePack(pack) { o.pack = pack; },
    /** The camp (E3, src/world/camp): its tent, ring, fire and rest replace the stand-in camp. @param {any} camp */
    useCamp(camp) { o.camp = camp; },
    /** Start the director, after the journal is up (src/main.js). */
    start() {
      if (!runs || live) return;
      const mode = get('meta')?.intro === 'short' ? 'short' : 'full';
      live = createIntroLive({ ...o, fresh, mode });
      // A test link past the start: the earlier beats' results laid in.
      if (at > 0) {
        for (const id of ['begun', ...beatIds.slice(0, at)]) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: `intro:${id}` }));
        // Mid-beat: its first parts done.
        for (let i = 0; i < (moment?.parts ?? 0); i++) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: `intro:${testBeat}.${i}` }));
        if (at > beatIds.indexOf('page')) dispatch(/** @type {any} */ ({ type: 'journal.flag', flag: 'keeper:first' }));
        emit('intro:camp-ready', { tent: at > beatIds.indexOf('pitch'), ring: at > beatIds.indexOf('ring') });
        // Past the gathering and before the ring: the handfuls the ring needs are in the pack.
        if (at > beatIds.indexOf('gather') && at <= beatIds.indexOf('ring')) { o.pack?.add('drift-twigs', 1); o.pack?.add('pebbles', 2); }
      }
      live.start();
      if (fresh && o.params.has('nointro')) live.intro.skip();
      live.publish();
    },
    /** The game hour shown now, counted from the world's start (tools/intro-lab.html). */
    hours: () => o.clock.display() / H,
    /** Each frame (a system on the live sim). @param {{ realDt: number }} f */
    tick(f) { live?.update(f.realDt); },
    /** Glowing camp slots for the terrain marks (the stand-in camp's). @param {number} now ms */
    rings: (now) => live?.rings(now / 1000) ?? [],
    dispose() { live?.dispose(); offPad(); },
  };
}
