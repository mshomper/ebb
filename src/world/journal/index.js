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
import { initialJournal, learn, notePlanted, momentsNow, catchMoments, foundAnimal, foundFind, namedAnimal, flag, noteGift, liftedStone } from './observe.js';
import { journalLook } from './look.js';
import { describe, identify, showMeSpot, momentKind, frogCard } from './describe.js';
import { groundKind, groundCard, groundSurvey, describeGround, groundSpot } from './ground.js';
import { almanac } from './almanac.js';
import { describeWeb } from './web.js';
import { washMap } from './wash.js';
import { stampNotes, markShown, markNotesSeen, markPageSeen, readOf, pageSince, unread, noteState } from './read.js';

/**
 * @typedef {Object} JournalUiSlice
 * @property {boolean} open
 * @property {'living'|'ground'|'web'|'almanac'|'notes'} view
 * @property {string|null} page   the page shown in the living or ground view, or null for the list
 * @property {'half'|'full'} size  the phone sheet's height
 * @property {number} [notesSince] the last note number seen before Notes was opened (read.js): newer ones show as new
 * @property {number} [pageSince]  the same for the page open
 * @property {string} [webAt]      a Web node to bring to the middle (a note about a thing with no page)
 * @property {number} [webAtN]     counts those asks, so the Web takes each once
 */

/**
 * @param {{ world: { state: any, env: any }, words: any, island: any, web: any, wash?: any,
 *   creatures?: { frogAt: (x: number, z: number) => { x: number, z: number, id?: number } | null } | null,
 *   finds?: any, pieces?: any, shore?: (() => Record<string, number> | null) | null, list?: any,
 *   schools?: { at: (x: number, z: number) => { sp: string, id: number, x: number, z: number } | null }[] }} opts
 *   schools: the live schools (minnows; src/world/creatures/schools.js), which say whether a tap
 *   landed on one
 *   world: the live world (state and env of the hourly tick); words: recipes/world/journal.json;
 *   island: recipes/world/journal-island.json; web: recipes/world/journal-web.json;
 *   wash: recipes/world/journal-wash.json; creatures: the live creatures (src/world/creatures),
 *   which say whether a tap landed on a frog; shore: the shore zones and rock pools now
 *   (shore-presence.js), which the Web shows; pieces: the placed loose stones (src/world/pieces),
 *   which say whether a tap landed on one
 */
export function createJournal(opts) {
  const { world, words, island, web, wash, creatures } = opts;
  /** The finds near the view (world/finds/index.js), or none. */
  const finds = opts.finds ?? null;
  const fresh = !get('journal');
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
  /** The shore zones and rock pools now, for the Web (shore-presence.js), or null. */
  const shore = () => opts.shore?.() ?? null;

  /** @param {{ journal: import('./observe.js').Journal, notes: import('./observe.js').Note[] }} r */
  function commit(r) {
    // Each new note gets its number (read.js); with Notes or its page open, it is read as it comes.
    settle(stampNotes(r.journal, r.notes), r.notes);
  }
  /** Keep a journal whose new notes are numbered already, and post them. @param {any} stamped @param {any[]} notes */
  function settle(stamped, notes) {
    let next = stamped;
    if (notes.length) {
      /** @type {JournalUiSlice | undefined} */ const u = get('journalUi');
      if (u?.open && u.view === 'notes') next = markNotesSeen(next);
      if (u?.open && u.page) next = markPageSeen(next, u.page);
    }
    if (next !== journal) {
      journal = next;
      update('journal', () => journal);
    }
    for (const n of notes) emitDeferred('note:posted', n);
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

  /**
   * Look at the island, then ink any link of the web that has now been seen: the same step catch-up
   * runs for hours you were away (look.js). @param {any[]} events @param {number} hour @param {any} [state]
   */
  const look = (events, hour, state = world.state) => {
    const r = journalLook(journal, { state, events, hour, habitat: habitat(), material: material(), words, island, web, paintVersion, shore: shore() });
    settle(r.journal, r.notes);
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
    // A frog first: they are small, and finding one is the point.
    const frog = creatures?.frogAt(x, z);
    if (frog) return frogCard(frog, world.state, words, world.env.recipes?.species?.frog?.presence);
    // Then a school (minnows): small and quick, and found by looking closely too.
    for (const s of opts.schools ?? []) {
      const hit = s.at(x, z);
      const rec = hit && words.species[hit.sp];
      if (rec) return { sp: hit.sp, name: rec.card ?? rec.name, sub: null, icon: rec.icon, text: rec.stages?.[0] ?? '', wx: hit.x, wz: hit.z, r: 0.6, stage: -1 };
    }
    // Then a find (docs/future/11): smaller still, and found by looking closely.
    const fd = finds?.findAt(x, z);
    const fr = fd && words.species[fd.sp];
    // A shell names which one it is; its page holds them all.
    const it = fd?.item ? fr?.collection?.find((/** @type {any} */ c) => c.id === fd.item) : null;
    if (fr && it) return { sp: fd.sp, item: it.id, name: it.name, sub: it.rarity, icon: fr.icon, text: it.cardLine, wx: fd.x, wz: fd.z, r: 0.12, stage: -1 };
    if (fr) return { sp: fd.sp, name: fr.card ?? fr.name, sub: null, icon: fr.icon, text: fr.cardLine ?? '', wx: fd.x, wz: fd.z, r: 0.12, stage: -1 };
    // Then a loose stone or a driftwood log (docs/future/10): the tap lifts or rolls it to look
    // underneath. It has no page. With the turtles' gift (unlocks.carry) its card offers Carry.
    const pc = opts.pieces?.pieceAt(x, z);
    const pw = pc && words.pieces?.[pc.kind];
    if (pw) {
      return { sp: `piece:${pc.kind}`, piece: pc.id, kind: pc.kind, name: pw.name, sub: null, icon: pw.icon, text: pw.cardLine, wx: pc.x, wz: pc.z,
        r: pc.kind === 'log' ? (pc.length ?? 1) * 0.55 : pc.size * 0.7, stage: -1, noPage: true, canCarry: !!get('unlocks')?.carry };
    }
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
    // A loose stone tips up to show underneath, a log rolls over (src/world/pieces); the first of
    // each is written down.
    if (card.piece) {
      emitDeferred('piece:lifted', { id: card.piece });
      commit(liftedStone(journal, { state: world.state, hour: hourIndex(), words }, card.kind));
      return;
    }
    // Tapping a frog, or a school of minnows, is finding it: its page inks (once).
    if (card.sp === 'frogs' || words.species[card.sp]?.kind === 'school') found(card.sp);
    // Tapping a find is finding it, the same way.
    // A shell is found one kind at a time, each written down once.
    const item = /** @type {any} */ (card).item ?? null;
    const fresh = item ? !journal.species[card.sp]?.learned.includes(`item:${item}`) : !journal.species[card.sp]?.ever;
    if (words.species[card.sp]?.kind === 'find' && fresh) {
      commit(foundFind(journal, card.sp, { state: world.state, hour: hourIndex(), words }, item));
    }
    const list = card.ground ? words.moments.ground : words.moments[momentKind(words.species[card.sp])];
    const ids = momentsNow(list, now(card.stage), words.moments);
    const name = card.name.charAt(0).toLowerCase() + card.name.slice(1);
    commit(catchMoments(journal, card.sp, ids, { state: world.state, hour: hourIndex(), words, name, list }));
  }

  /** You found a frog (or a school): the page inks, the moment is written, and the web follows. */
  function found(sp = 'frogs') {
    if (journal.species[sp]?.ever) return;
    commit(foundAnimal(journal, { state: world.state, hour: hourIndex(), words }, sp));
    look([], hourIndex());
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
    // Catch-up wrote the hours you were away (src/sim/away.js): its journal is the journal now. Its
    // notes are not posted, so they wait under "You may have missed".
    on('journal:replaced', (/** @type {{ journal: any }} */ p) => {
      journal = p.journal;
      update('journal', () => journal);
      if (washedPage) rewash();
    }),
    // Edits move water and plants between hours: look again (the habitat is rebuilt first).
    on('water:summary-updated', () => look([], hourIndex())),
    on('terrain:stroke-ended', () => { paintVersion++; if (washedPage) rewash(); }),
    // Sculpt's Stone mode set a stone (src/app.js): the Web's Stones are on the island.
    on('terrain:stone-set', () => {
      const next = flag(journal, 'stones:set');
      if (next !== journal) { journal = next; update('journal', () => journal); look([], hourIndex()); }
    }),
    // The shore rezones a moment after an edit: look again, so the Web sees new pools and zones.
    on('shore:zoned', () => look([], hourIndex())),
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
    // The island gave you something (src/world/expansion.js): written once, shown as a card.
    on('progress:gifted', (/** @type {any} */ g) => commit(noteGift(journal, g, { state: world.state, hour: hourIndex(), words }))),
    // Watching a frog (or a school) from close by finds it too (src/world/creatures/index.js, schools.js).
    on('creature:found', (/** @type {{ species: string }} */ p) => {
      if (p.species === 'frogs' || words.species[p.species]?.kind === 'school') found(p.species);
    }),
    // You named a frog (S6c-3, src/app.js): the moment is written, and its open card takes the name.
    on('creature:named', (/** @type {{ species: string, id: number, name: string }} */ p) => {
      if (p.species !== 'frogs') return;
      commit(namedAnimal(journal, p.name, { state: world.state, hour: hourIndex(), words }));
      const c = get('identify');
      if (c?.sp === 'frogs' && c.id === p.id) {
        const card = frogCard({ x: c.wx, z: c.wz, id: c.id }, world.state, words, world.env.recipes?.species?.frog?.presence);
        update('identify', () => ({ ...c, ...card }));
      }
    }),
    onAction((a) => {
      // Choosing a tool or closing the card puts the tap card away.
      if (a.type === 'tool.select' || a.type === 'ui.identify') { if (get('identify')) update('identify', () => null); return; }
      if (a.type === 'journal.showMe') { showMe(a.sp); return; }
      // A note was shown on the island (src/ui/island-notes.js): it is no longer one you may have missed.
      if (a.type === 'journal.noteShown') {
        const next = markShown(journal, a.n);
        if (next !== journal) { journal = next; update('journal', () => journal); }
        return;
      }
      if (a.type !== 'ui.journal') return;
      /** @type {JournalUiSlice} */ const u = get('journalUi');
      const open = a.toggle ? !u.open : a.open ?? u.open;
      /** @type {Partial<JournalUiSlice>} */ const patch = { open };
      if (a.view) patch.view = a.view;
      if (a.page !== undefined) {
        patch.page = a.page;
        if (a.page) patch.view = words.species[a.page] ? 'living' : island.ground[a.page] ? 'ground' : u.view;
        // A thing with no page of its own (a rock pool, the wrack): its note opens the Web on it.
        if (a.page && !words.species[a.page] && !island.ground[a.page] && web.nodes?.[a.page]) {
          Object.assign(patch, { view: 'web', page: null, webAt: a.page, webAtN: (u.webAtN ?? 0) + 1 });
        }
      }
      if (a.size) patch.size = a.size;
      // Opening the journal, or a page in it, puts the tap card away (the page now says it all).
      if (open && (!u.open || a.page) && get('identify')) update('identify', () => null);
      // Opening Notes, or a page: what was unread stays marked new while you look (since), and
      // counts as read from now on.
      const view = patch.view ?? u.view, page = patch.page !== undefined ? patch.page : u.page;
      const read = readOf(journal);
      let next = journal;
      if (open && view === 'notes' && !(u.open && u.view === 'notes')) { patch.notesSince = read.notes; next = markNotesSeen(next); }
      if (open && page && (page !== u.page || !u.open)) { patch.pageSince = pageSince(read, page); next = markPageSeen(next, page); }
      if (next !== journal) { journal = next; update('journal', () => journal); }
      update('journalUi', (s) => ({ ...s, ...patch }));
      if (open !== u.open) emitDeferred(open ? 'ui:panel-opened' : 'ui:panel-closed', { panel: 'journal' });
    }),
  ];
  look([], hourIndex());
  // On a new journal, the first look describes the island you start with: read, not news.
  if (fresh) { journal = markNotesSeen(journal); update('journal', () => journal); }

  return {
    words,
    island,
    /** The journal now. */
    journal: () => journal,
    /** What is unread: notes since Notes was last opened, and pages with notes since each was opened (read.js). */
    unread: () => unread(journal),
    /** A note against the last one seen: 'missed', 'new' or 'seen' (read.js). */
    noteState,
    /** Is there a page for this id? @param {string} id */
    hasPage: (id) => !!(words.species[id] || island.ground[id]),
    /** A living thing's or a ground's page, in words. @param {string} id */
    describe: (id) => (words.species[id]
      ? describe(journal, id, world.state, habitat(), words, hourIndex())
      : describeGround(journal, id, survey(), island, words)),
    web,
    /** The Living things list's groups, filters and places (recipes/world/journal-list.json). */
    list: opts.list ?? null,
    /** The web of what needs what: its bands of names and its links, inked or in pencil. */
    describeWeb: () => describeWeb(journal, habitat() ? { ...survey(), shore: shore() } : null, web),
    /** The almanac's rows for the time shown. */
    almanac: () => almanac({ state: world.state, tHours: display() / SECONDS_PER_HOUR,
      weatherNow: weatherAt(world.state?.weather, display(), world.env.recipes?.seasons),
      tideParams: tideParams(world.env.recipes?.water?.tide), words, island }),
    dispose() { for (const off of offs) off(); },
  };
}

/** @typedef {ReturnType<typeof createJournal>} LiveJournal */
