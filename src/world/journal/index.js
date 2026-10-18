// @ts-check
// Live side of the field journal (docs 13, 15): keeps the store slice `journal` current by looking at
// the world after every game hour (the `world:ticked` event with that hour's tick events), after
// edits and plantings, and when the Plant tool refuses a spot. It posts the journal's new notes as
// `note:posted`; names what a tap lands on, a plant, grass, rushes or the ground itself (store slice
// `identify`), and catches the moment if it is a special one; answers a page's Show me by gliding
// the camera to it; and opens and closes the journal on the `ui.journal` action (store slice
// `journalUi`). The model is pure (observe.js, describe.js, ground.js, almanac.js); this file only
// wires it to the bus, the store, the clock and the actions.

import { on, emitDeferred } from '../../core/events.js';
import { get, update, subscribe } from '../../core/store.js';
import { hourIndex, display, SECONDS_PER_HOUR, HOURS_PER_DAY } from '../../core/clock.js';
import { onAction } from '../../input/actions.js';
import { weatherAt } from '../weather.js';
import { tideParams } from '../tide.js';
import { initialJournal, observe, learn, notePlanted, momentsNow, catchMoments } from './observe.js';
import { describe, identify, showMeSpot } from './describe.js';
import { groundKind, groundCard, groundSurvey, describeGround, groundSpot } from './ground.js';
import { almanac } from './almanac.js';
import { inkWeb, describeWeb } from './web.js';
import { washMap } from './wash.js';

/**
 * @typedef {Object} JournalUiSlice
 * @property {boolean} open
 * @property {'living'|'ground'|'web'|'almanac'|'notes'} view
 * @property {string|null} page   the page shown in the living or ground view, or null for the list
 * @property {'half'|'full'} size  the phone sheet's height
 */

/**
 * @param {{ world: { state: any, env: any }, words: any, island: any, web: any, wash?: any }} opts
 *   world: the live world (state and env of the hourly tick); words: recipes/world/journal.json;
 *   island: recipes/world/journal-island.json; web: recipes/world/journal-web.json;
 *   wash: recipes/world/journal-wash.json
 */
export function createJournal(opts) {
  const { world, words, island, web, wash } = opts;
  /** @type {import('./observe.js').Journal} */
  let journal = get('journal') ?? initialJournal(hourIndex());
  update('journal', () => journal);
  update('journalUi', (u) => u ?? { open: false, view: 'living', page: null, size: 'half' });

  const habitat = () => world.env.habitat?.() ?? null;
  // The plant recipes with the cover plants' (rushes; grass has no habitat axes), so a tap on the
  // ground and a page's wash know where each would do well.
  const flora = () => ({ ...(world.env.recipes?.flora ?? {}), ...(world.env.recipes?.covers ?? {}) });
  /** The terrain's painted materials (rgba8 per 0.25 m texel), once the terrain is up. */
  const material = () => get('terrainLive')?.mirror?.material ?? null;
  let paintVersion = 0;
  const survey = () => groundSurvey(habitat(), material(), world.state, island, paintVersion);

  /** @param {{ journal: import('./observe.js').Journal, notes: import('./observe.js').Note[] }} r */
  function commit(r) {
    if (r.journal !== journal) {
      journal = r.journal;
      update('journal', () => journal);
    }
    for (const n of r.notes) emitDeferred('note:posted', n);
  }
  /**
   * The show-where wash for the page open in the journal, if any (store slice `wash`, painted by
   * the tonemap pass after the palette). The recipe rides along so the renderer needs no journal.
   */
  function rewash() {
    /** @type {JournalUiSlice | undefined} */ const u = get('journalUi');
    const page = u?.open && (u.view === 'living' || u.view === 'ground') ? u.page : null;
    const map = page && wash && habitat()
      ? washMap(page, { state: world.state, hab: habitat(), material: material(), island, flora: flora(), words, journal, wash })
      : null;
    update('wash', () => ({ map, recipe: wash ?? null }));
  }
  let washedPage = /** @type {string | null} */ (null);

  /** Look at the island, then ink any link of the web that has now been seen. @param {any[]} events @param {number} hour @param {any} [state] */
  const look = (events, hour, state = world.state) => {
    commit(observe(journal, { state, events, hour, habitat: habitat(), words }));
    if (habitat()) commit(inkWeb(journal, survey(), { web, words, state, hour }));
    if (washedPage) rewash();
  };

  /** The weather and time now, as moments read them. @param {number} stage */
  function now(stage) {
    const t = display();
    const w = weatherAt(world.state?.weather, t, world.env.recipes?.seasons);
    const hours = t / SECONDS_PER_HOUR;
    return { stage, season: world.state?.seasons?.index ?? 0, hourOfDay: hours - Math.floor(hours / HOURS_PER_DAY) * HOURS_PER_DAY, rain: w.rain, mist: w.mist };
  }

  /** What a ground point holds: a plant, a cover plant (grass, rushes), or the ground itself. @param {number} x @param {number} z */
  function cardAt(x, z) {
    const hab = habitat();
    const living = identify(world.state, hab, x, z, words);
    if (living) return living;
    const kind = groundKind(hab, material(), x, z, island);
    return kind ? groundCard(kind, hab, x, z, { island, flora: flora(), journal, words }) : null;
  }

  /**
   * Show a card (and its ring), and catch any moment it is part of.
   * @param {any} card @param {number} x @param {number} y screen point the card sits beside
   */
  function select(card, x, y) {
    update('identify', () => (card ? { ...card, x, y, at: performance.now() } : null));
    if (!card) return;
    const list = card.ground ? words.moments.ground : words.moments[words.species[card.sp]?.kind === 'cover' ? 'cover' : 'plant'];
    const ids = momentsNow(list, now(card.stage), words.moments);
    const name = card.name.charAt(0).toLowerCase() + card.name.slice(1);
    commit(catchMoments(journal, card.sp, ids, { state: world.state, hour: hourIndex(), words, name, list }));
  }

  /**
   * Ring the example nearest the middle of your view. The camera stays where it is (a game-driven
   * move is distracting); the card follows the ring on screen, and an arrow at the edge points to
   * it while it is out of view (src/ui/island-notes.js). @param {string} sp
   */
  function showMe(sp) {
    const view = get('view');
    const near = view?.center() ?? null;
    let card = null;
    if (words.species[sp]) card = showMeSpot(sp, world.state, habitat(), words, near);
    else if (island.ground[sp]) {
      const spot = groundSpot(sp, habitat(), material(), survey(), island, near);
      if (spot) card = groundCard(spot.kind, habitat(), spot.x, spot.z, { island, flora: flora(), journal, words });
    }
    if (!card) return;
    const at = view?.project(card.wx, card.wz);
    select({ ...card, pinned: true }, at?.x ?? 0, at?.y ?? 0);
  }

  const offs = [
    on('world:ticked', (/** @type {{ hour: number, events: any[], state: any }} */ p) => look(p.events ?? [], p.hour, p.state)),
    // Edits move water and plants between hours: look again (the habitat is rebuilt first).
    on('water:summary-updated', () => look([], hourIndex())),
    on('terrain:stroke-ended', () => { paintVersion++; if (washedPage) rewash(); }),
    // A page opened or closed (or the journal itself): wash for the new page, or clear the wash.
    subscribe('journalUi', (/** @type {JournalUiSlice} */ u) => {
      const page = u.open && (u.view === 'living' || u.view === 'ground') ? u.page : null;
      if (page === washedPage) return;
      washedPage = page;
      rewash();
    }),
    on('growth:planted', (/** @type {{ species: string }} */ p) => {
      journal = notePlanted(journal, p.species, hourIndex());
      look([], hourIndex());
    }),
    on('plant:refused', (/** @type {{ species: string, reason: string }} */ p) =>
      commit(learn(journal, p.species, `refused:${p.reason}`, { state: world.state, hour: hourIndex(), words }))),
    on('look:tapped', (/** @type {{ x: number, y: number, point: number[] | null }} */ p) =>
      select(p.point ? cardAt(p.point[0], p.point[2]) : null, p.x, p.y)),
    onAction((a) => {
      // Choosing a tool or closing the card puts the tap card away.
      if (a.type === 'tool.select' || a.type === 'ui.identify') { if (get('identify')) update('identify', () => null); return; }
      if (a.type === 'journal.showMe') { showMe(a.sp); return; }
      if (a.type !== 'ui.journal') return;
      /** @type {JournalUiSlice} */ const u = get('journalUi');
      const open = a.toggle ? !u.open : a.open ?? u.open;
      /** @type {Partial<JournalUiSlice>} */ const patch = { open };
      if (a.view) patch.view = a.view;
      if (a.page !== undefined) {
        patch.page = a.page;
        if (a.page) patch.view = words.species[a.page] ? 'living' : island.ground[a.page] ? 'ground' : u.view;
      }
      if (a.size) patch.size = a.size;
      // Opening the journal, or a page in it, puts the tap card away (the page now says it all).
      if (open && (!u.open || a.page) && get('identify')) update('identify', () => null);
      update('journalUi', (s) => ({ ...s, ...patch }));
      if (open !== u.open) emitDeferred(open ? 'ui:panel-opened' : 'ui:panel-closed', { panel: 'journal' });
    }),
  ];
  look([], hourIndex());

  return {
    words,
    island,
    /** The journal now. */
    journal: () => journal,
    /** Is there a page for this id? @param {string} id */
    hasPage: (id) => !!(words.species[id] || island.ground[id]),
    /** A living thing's or a ground's page, in words. @param {string} id */
    describe: (id) => (words.species[id]
      ? describe(journal, id, world.state, habitat(), words, hourIndex())
      : describeGround(journal, id, survey(), island, words)),
    web,
    /** The web of what needs what: its bands of names and its links, inked or in pencil. */
    describeWeb: () => describeWeb(journal, habitat() ? survey() : null, web),
    /** The almanac's rows for the time shown. */
    almanac: () => almanac({ state: world.state, tHours: display() / SECONDS_PER_HOUR,
      weatherNow: weatherAt(world.state?.weather, display(), world.env.recipes?.seasons),
      tideParams: tideParams(world.env.recipes?.water?.tide), words, island }),
    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createJournal>} LiveJournal */
