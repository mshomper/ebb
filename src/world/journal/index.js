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
import { initialJournal, learn, notePlanted, momentsNow, catchMoments, foundAnimal, foundFind, namedAnimal, flag, noteGift, noteOnce, liftedStone, stormShells } from './observe.js';
import { journalLook } from './look.js';
import { describe, identify, showMeSpot, momentKind, frogCard, turtleCard } from './describe.js';
import { henCard } from './hen.js';
import { groundKind, groundCard, groundSurvey, describeGround, groundSpot } from './ground.js';
import { almanac } from './almanac.js';
import { describeWeb } from './web.js';
import { washMap } from './wash.js';
import { buriedNotice } from './buried.js';
import { UNDER_PAGES } from '../finds/under-log.js';
import { stampNotes, markShown, markNotesSeen, markPageSeen, readOf, pageSince, unread, noteState } from './read.js';

/**
 * @typedef {Object} JournalUiSlice
 * @property {boolean} open
 * @property {'trails'|'living'|'ground'|'web'|'almanac'|'notes'|'shelf'|'keeper'|'camp'|'herbarium'} view  keeper: the keeper's pages (src/ui/journal-keeper.js); camp: the camp page (src/ui/journal-camp.js); herbarium: the forager's trail's page (src/ui/journal-herbarium.js)
 * @property {string|null} [keeper] the keeper page open, or null for their list
 * @property {'naturalist'|'beach'|'shape'|'forage'} [trail] the trail the Trails page shows when it is not wide enough for all four
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
 *   finds?: any, keepsakes?: any, pieces?: any, lift?: any, nets?: any, shore?: (() => Record<string, number> | null) | null, list?: any,
 *   schools?: { at: (x: number, z: number, y?: number) => { sp: string, id: number, x: number, z: number } | null }[] }} opts
 *   schools: the live schools (minnows; src/world/creatures/schools.js), which say whether a tap
 *   landed on one
 *   world: the live world (state and env of the hourly tick); words: recipes/world/journal.json;
 *   island: recipes/world/journal-island.json; web: recipes/world/journal-web.json;
 *   wash: recipes/world/journal-wash.json; creatures: the live creatures (src/world/creatures),
 *   which say whether a tap landed on a frog; shore: the shore zones and rock pools now
 *   (shore-presence.js), which the Web shows; pieces: the placed loose stones (src/world/pieces),
 *   which say whether a tap landed on one; nets: the nets (src/world/nets), the same, and a living
 *   catch let go from the haul tray is found (`net:released`, its kind's first written as a find)
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

  /**
   * What a ground point holds: a plant, a cover plant (grass, rushes), or the ground itself.
   * @param {number} x @param {number} z @param {number} [y] the tapped point's height: a school or a
   *   dragonfly is found along the line from the eye through it, since it is not on the ground
   */
  function cardAt(x, z, y) {
    const card = cardBase(x, z, y);
    // Terrain (the ground itself, grass and rushes) never pops up a card (Matt, October 22, 2026):
    // a click on it walks. Only what lies there to gather shows, as its own card: named for the
    // things, with their Gather buttons and the word for how much is there.
    if (card && (card.ground || words.species[card.sp]?.kind === 'cover')) {
      const g = opts.gather ? opts.gather.decorate({ ...card, text: '' }, x, z) : null;
      if (!g?.gathers?.length) return null;
      const names = g.gathers.map((/** @type {any} */ t) => t.name);
      const name = names.length > 1 ? `${names[0]} and ${names[1].charAt(0).toLowerCase()}${names[1].slice(1)}` : names[0];
      return { ...g, name, sub: null, icon: 'gather', noPage: true, suits: null, suitsPencil: null, gatherOnly: true };
    }
    // Last, what can be gathered there (src/world/gather): its Gather buttons and its word.
    return opts.gather ? opts.gather.decorate(card, x, z) : card;
  }
  /** @param {number} x @param {number} z @param {number} [y] */
  function cardBase(x, z, y) {
    // A frog first: they are small, and finding one is the point.
    const frog = creatures?.frogAt(x, z);
    if (frog) return frogCard(frog, world.state, words, world.env.recipes?.species?.frog?.presence);
    // The hen (docs/future/15): her word and her name; and her tail feather lying at camp.
    const hen = /** @type {any} */ (opts).hen;
    const hn = hen?.henAt?.(x, z);
    if (hn && words.species.hens) return henCard(hn, world.state, words, world.env.recipes?.species?.hen?.presence);
    const fe = hen?.featherCard?.(x, z) ?? null;
    if (fe) return fe;
    // Her perch at camp (slice 3).
    const pe = hen?.perchCard?.(x, z) ?? null;
    if (pe) return pe;
    // Then a school of minnows under the water, or a dragonfly in the air above it.
    for (const s of opts.schools ?? []) {
      const hit = s.at(x, z, y);
      const rec = hit && words.species[hit.sp];
      // A turtle is one animal with its own trust and maybe a name (bonds.js).
      if (rec && hit.sp === 'turtles' && hit.one !== undefined) return turtleCard({ x: hit.x, z: hit.z, id: hit.one }, world.state, words, world.env.recipes?.species?.turtle?.presence);
      if (rec) return { sp: hit.sp, name: rec.card ?? rec.name, sub: null, icon: rec.icon, text: rec.stages?.[0] ?? '', wx: hit.x, wz: hit.z, r: 0.6, stage: -1 };
    }
    // Then a find (docs/future/11): smaller still, and found by looking closely.
    const fd = finds?.findAt(x, z);
    const fr = fd && words.species[fd.sp];
    // A shell names which one it is; its page holds them all.
    const it = fd?.item ? fr?.collection?.find((/** @type {any} */ c) => c.id === fd.item) : null;
    if (fr && it) return { sp: fd.sp, item: it.id, storm: !!fd.storm, name: it.name, sub: it.rarity, icon: fr.icon, text: it.cardLine, wx: fd.x, wz: fd.z, r: 0.12, stage: -1 };
    // A stranded jellyfish is much bigger than the other finds: its ring is too.
    if (fr) return { sp: fd.sp, name: fr.card ?? fr.name, sub: null, icon: fr.icon, text: fr.cardLine ?? '', wx: fd.x, wz: fd.z, r: fr.ringM ?? 0.12, stage: -1 };
    // Then a keepsake on the strandline (docs/future/12): no name to learn, only what it looks like
    // and how rare it is. It has no page; its card offers to leave it (and, with the shelf, to keep it).
    const ks = opts.keepsakes?.keepsakeAt(x, z);
    const KW = words.keepsakes;
    if (ks && KW) {
      return { sp: 'keepsake', keepsake: ks.id, name: KW.card, sub: KW.rarity[ks.n.rarity] ?? ks.n.rarity, icon: KW.icon,
        text: opts.keepsakes.words(ks.n), wx: ks.x, wz: ks.z, r: 0.15, stage: -1, noPage: true,
        family: ks.n.family, letter: ks.n.family === 'bottle' && !!ks.n.message, mark: ks.n.mark ? { family: ks.n.family, mark: ks.n.mark } : null };
    }
    // Then a net (docs/future/12): how long it has left, and Lift once it is full. It has no page.
    const nt = opts.nets?.netAt(x, z);
    if (nt) {
      return { sp: 'net', net: nt.id, name: nt.name, sub: null, icon: 'net', text: nt.text, wx: nt.x, wz: nt.z, r: 0.5, stage: -1,
        noPage: true, canLift: nt.canLift, liftLabel: nt.liftLabel, inLabel: nt.inLabel };
    }
    // Then a loose stone or a driftwood log (docs/future/10): on foot within reach its card offers
    // Lift (L3a). A log opens the Driftwood page (L2), its form and its wear on the card (log: what
    // the page's sketch is traced from). Once driftwood washes up (unlocks.carry) its card offers Carry.
    // Then the keeper's camp (docs/future/13 section 3): the tent and the fire ring, or their glowing
    // ground before they are set up (src/world/camp cardAt: Pitch, Lay, Light, Feed, Rest).
    const cp = /** @type {any} */ (opts).camp?.cardAt?.(x, z) ?? null;
    if (cp) return cp;
    // Then the camp's stores (section 3.12; src/world/pack/stores.js): the wood store, the stone pile
    // and the clay slab, empty or holding a pile (then the pile's card too: Take up, Set down).
    const st = /** @type {any} */ (opts).stores?.cardAt?.(x, z) ?? null;
    if (st) return st;
    // Then an open hole you dug (docs/future/13 10.2; src/world/dig): its layer, and Dig deeper.
    const dg = /** @type {any} */ (opts).dig?.cardAt?.(x, z) ?? null;
    if (dg) return dg;
    // Then a perch stick stood in the shallows (B1 P1; src/world/creatures/perch-sticks.js): Take up.
    const ps = /** @type {any} */ (opts).perch?.cardAt?.(x, z) ?? null;
    if (ps) return ps;
    const pc = opts.pieces?.pieceAt(x, z);
    const pw = pc && words.pieces?.[pc.kind];
    if (pw && pc.kind === 'pile') {
      // A pile at camp (docs/future/13 4.1): named for what it is a pile of, its line the word for
      // how big it is (src/world/pack/piles-live.js describe). Never carried or lifted; Take up is
      // the card's own action (pile: what it holds).
      const pd = /** @type {any} */ (opts).piles?.describe?.(pc) ?? null;
      return { sp: 'piece:pile', piece: pc.id, kind: 'pile', name: pd?.name ?? pw.name, sub: null, icon: pw.icon, text: pd?.text ?? pw.cardLine,
        wx: pc.x, wz: pc.z, r: pc.size * 0.6, stage: -1, noPage: true, canCarry: false, pile: { holds: pc.holds, handfuls: pc.handfuls } };
    }
    if (pw) {
      const look = pc.kind === 'log' ? opts.pieces?.logLook?.(pc) ?? null : null;
      const isLog = !!look && !!words.species.driftwood;
      return { sp: isLog ? 'driftwood' : `piece:${pc.kind}`, piece: pc.id, kind: pc.kind, name: pw.name, sub: null, icon: pw.icon, text: pw.cardLine, wx: pc.x, wz: pc.z,
        r: pc.kind === 'log' ? (pc.length ?? 1) * 0.55 : pc.size * 0.7, stage: -1, noPage: !isLog, canCarry: !!get('unlocks')?.carry,
        ...(isLog ? { form: look.form, log: { seed: pc.seed, size: pc.size, length: pc.length ?? 1, form: look.form }, wear: look } : {}), ...liftOffer(pc) };
    }
    const hab = habitat();
    const living = identify(world.state, hab, x, z, words);
    if (living) return living;
    const kind = groundKind(hab, material(), x, z, island);
    return kind ? groundCard(kind, hab, x, z, { island, flora: flora(), journal, words }) : null;
  }

  /**
   * What a piece's card says about lifting it (L3a): Lift within reach on foot (liftPiece), else a
   * line saying to walk closer, or to go down. @param {any} pc
   */
  function liftOffer(pc) {
    const LW = words.pieces?.lift, at = opts.lift?.reach(pc);
    if (!LW || !at) return {};
    return { liftPiece: at === 'lift', liftNote: at === 'lift' ? null : LW[at] ?? null };
  }

  /**
   * After a Lift (piece:lifted from src/world/pieces/lift.js): the first lift of a stone or a log is
   * written down, and each kind found under it is found (its page inks, once). Its card now says what
   * was there and opens that page (the beetle's before the woodlice'); with nothing there, it opens
   * the Driftwood page or the Loose stone page.
   * @param {{ id: string, kind: string, from?: number[], found?: Record<string, number>, rested?: boolean, strand?: boolean }} p
   */
  function lifted(p) {
    if (!p.from) return;
    const ctx = { state: world.state, hour: hourIndex(), words };
    // A stone has a page of its own (loosestone), found at its first lift; a log's first roll is a note.
    if (p.kind === 'stone' && words.species.loosestone) commit(foundFind(journal, 'loosestone', ctx));
    else commit(liftedStone(journal, ctx, p.kind));
    const LW = words.pieces?.lift;
    if (!LW) return;
    /** @type {string[]} */ const lines = [];
    let page = null;
    for (const sp of /** @type {const} */ (['beetle', 'woodlice'])) {
      const n = p.found?.[sp] ?? 0, pg = UNDER_PAGES[sp];
      if (!n) continue;
      lines.push(LW[sp].replace('{n}', LW.numbers?.[n] ?? String(n)).replace(/^./, (/** @type {string} */ c) => c.toUpperCase()));
      page ??= pg;
      if (!words.species[pg]) continue;
      if (words.species[pg].kind === 'find' && !journal.species[pg]?.ever) commit(foundFind(journal, pg, ctx));
      const list = words.moments[momentKind(words.species[pg])];
      if (list) commit(catchMoments(journal, pg, momentsNow(list, now(-1), words.moments), { ...ctx, name: words.species[pg]?.plural ?? pg, list }));
    }
    if (!lines.length) lines.push(p.rested ? LW.rest : p.strand ? LW.strand : LW.nothing);
    page ??= p.kind === 'log' ? 'driftwood' : 'loosestone';
    const c = get('identify');
    if (c?.piece !== p.id) return;
    update('identify', () => ({ ...c, text: lines.join(' '), liftPiece: false, liftNote: null, canCarry: false,
      sp: words.species[page] ? page : c.sp, noPage: !words.species[page], at: performance.now() }));
  }

  /**
   * What a tapped log teaches the Driftwood page (its field lines' triggers): bark on a fresh one,
   * the silver and the grooves on an old one, moss on one kept in damp shade.
   * @param {{ sea: number, moss: number } | undefined} wear @param {any} rec words.species.driftwood
   */
  const logLessons = (wear, rec) => {
    const T = rec?.lessons ?? { fresh: 0.3, old: 0.7, moss: 0.2 };
    if (!wear) return [];
    return [wear.sea < T.fresh ? 'fresh' : '', wear.sea > T.old ? 'old' : '', wear.moss > T.moss ? 'moss' : ''].filter(Boolean);
  };

  /**
   * Show a card (and its ring), and catch any moment it is part of.
   * @param {any} card @param {number} x @param {number} y screen point the card sits beside
   */
  function select(card, x, y) {
    update('identify', () => (card ? { ...card, x, y, at: performance.now() } : null));
    if (!card) return;
    // A keepsake is not a find: tapping it writes nothing in the journal (the shelf is its only
    // record), but a mark seen is a first on the beachcomber's trail, kept or not (src/world/trails.js).
    if (card.keepsake && card.mark) emitDeferred('keepsake:seen', { n: card.mark });
    // The camp's tent and ring (src/world/camp) are not lives or finds, and things to gather on bare
    // ground have a card of their own: no page and no moment for either.
    if (card.keepsake || card.net || card.camp || card.gatherOnly || card.dig || card.feather) return;
    // A loose stone or a log: its card offers Lift on foot (src/world/pieces/lift.js); a tap alone
    // looks, and lifts nothing.
    if (card.piece) {
      const ctx = { state: world.state, hour: hourIndex(), words };
      // A log is a find of the Driftwood page (L2): each form found once, and what its wear shows.
      if (card.sp === 'driftwood') {
        commit(foundFind(journal, 'driftwood', ctx, card.form));
        for (const t of logLessons(card.wear, words.species.driftwood)) commit(learn(journal, 'driftwood', t, ctx));
        const list = words.moments[momentKind(words.species.driftwood)];
        commit(catchMoments(journal, 'driftwood', momentsNow(list, now(card.stage), words.moments), { ...ctx, name: 'driftwood', list }));
      }
      return;
    }
    // Tapping a frog, or a school of minnows, is finding it: its page inks (once).
    if (card.sp === 'frogs' || words.species[card.sp]?.kind === 'school' || words.species[card.sp]?.kind === 'hen') found(card.sp);
    // Tapping a find is finding it, the same way.
    // A shell is found one kind at a time, each written down once.
    const item = /** @type {any} */ (card).item ?? null;
    const fresh = item ? !journal.species[card.sp]?.learned.includes(`item:${item}`) : !journal.species[card.sp]?.ever;
    if (words.species[card.sp]?.kind === 'find' && fresh) {
      commit(foundFind(journal, card.sp, { state: world.state, hour: hourIndex(), words }, item));
    }
    // A shell a winter storm tide left: the journal notes the storm tide, once.
    if (/** @type {any} */ (card).storm) commit(stormShells(journal, { state: world.state, hour: hourIndex(), words }));
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
    // Show me's ring was on something not yet met: now it is, so the card says what it is.
    const c = get('identify');
    if (c?.pinned && c.sp === sp && c.noPage) showMe(sp);
  }

  /**
   * Ring the example nearest the middle of your view. The camera stays where it is (a game-driven
   * move is distracting); the card follows the ring on screen, and an arrow at the edge points to
   * it while it is out of view (src/ui/island-notes.js). An island note's Show me (an animal came or
   * stayed) can ring one you have not met yet: its card then keeps the riddle (`showMe.unseen`), so
   * finding it is still yours. If none is about just now, a calm line says so. An uneasy note (A9)
   * gives the spot of the pool that is failing them: that pool is ringed, with the note's words.
   * @param {string} sp @param {{ x: number, z: number }} [spot] @param {string} [text]
   */
  function showMe(sp, spot, text) {
    const view = get('view');
    const near = view?.center() ?? null;
    let card = null;
    const rec = words.species[sp];
    if (rec && spot) card = { sp, name: rec.card ?? rec.name, icon: rec.icon, text: text ?? '', wx: spot.x, wz: spot.z, r: words.showMe?.pondRingM ?? 3, stage: -1 };
    else if (rec) card = showMeSpot(sp, world.state, habitat(), words, near);
    else if (island.ground[sp]) {
      const spot = groundSpot(sp, habitat(), material(), survey(), island, near);
      if (spot) card = groundCard(spot.kind, habitat(), spot.x, spot.z, { island, flora: flora(), journal, words });
    }
    const S = words.showMe;
    if (!card) {
      if (S?.none) emitDeferred('island:notice', { text: S.none, showS: S.noneS ?? 5 });
      return;
    }
    if (words.species[sp] && !journal.species[sp]?.ever && S?.unseen) {
      card = { ...card, name: S.unseen.name, text: S.unseen.text, icon: 'find', sub: null, word: null, canName: false, suggest: [], noPage: true };
    }
    const at = view?.project(card.wx, card.wz);
    select({ ...card, pinned: true }, at?.x ?? 0, at?.y ?? 0);
  }

  // Plants that went under new ground (buried.js): each patch waits for the next game hour, and is
  // written then only if its plants are still gone (an undo straight away writes nothing). The
  // session's count runs from load or a rest to the next rest. Neither is saved.
  /** @type {{ sp: string, x: number, z: number, ids: number[], hour: number }[]} */ let buriedPatches = [];
  let buriedSession = { count: 0, shown: false };
  /** The patches whose hour has passed, as growth:lost events. @param {number} hour @param {any} state */
  function buriedLost(hour, state) {
    const due = buriedPatches.filter((b) => hour > b.hour);
    if (!due.length) return [];
    buriedPatches = buriedPatches.filter((b) => hour <= b.hour);
    const here = new Set((state?.growth?.plants ?? []).map((/** @type {any} */ q) => q.id));
    return due.map((b) => ({ b, gone: b.ids.filter((id) => !here.has(id)).length })).filter((d) => d.gone > 0)
      .map(({ b, gone }) => ({ name: 'growth:lost', payload: { species: b.sp, why: 'buried', count: gone, x: b.x, z: b.z } }));
  }

  const offs = [
    on('world:ticked', (/** @type {{ hour: number, events: any[], state: any }} */ p) => look([...(p.events ?? []), ...buriedLost(p.hour, p.state)], p.hour, p.state)),
    on('growth:buried', (/** @type {any} */ p) => {
      const hour = hourIndex();
      for (const [sp, s] of Object.entries(p.bySpecies ?? {})) buriedPatches.push({ sp, x: s.x, z: s.z, ids: s.ids, hour });
      const B = world.env.recipes?.growth?.bury;
      if (!B) return;
      const r = buriedNotice(p, buriedSession, B, habitat(), words);
      buriedSession = r.session;
      if (r.text) emitDeferred('island:notice', { text: r.text, showS: words.buried?.showS ?? 6 });
    }),
    on('growth:restored', (/** @type {{ ids: number[] }} */ p) => {
      const back = new Set(p.ids ?? []);
      buriedPatches = buriedPatches.map((b) => ({ ...b, ids: b.ids.filter((id) => !back.has(id)) })).filter((b) => b.ids.length);
    }),
    on('camp:rested', () => { buriedSession = { count: 0, shown: false }; }),
    // A plant not to pick, met for the first time (gather/index.js): its page learns why.
    on('pick:refused', (/** @type {{ species: string }} */ p) =>
      commit(learn(journal, p.species, 'pick:refused', { state: world.state, hour: hourIndex(), words }))),
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
      select(p.point ? cardAt(p.point[0], p.point[2], p.point[1]) : null, p.x, p.y)),
    // A Lift on foot (L3a): its notes, its finds, and its card.
    on('piece:lifted', lifted),
    // A living catch let go from a net's haul (src/world/nets): the first of each kind is a find.
    on('net:released', (/** @type {{ page: string }} */ p) => {
      if (words.species[p.page]?.kind === 'find' && !journal.species[p.page]?.ever) {
        commit(foundFind(journal, p.page, { state: world.state, hour: hourIndex(), words }));
      }
    }),
    // The first pick of a plant (src/world/gather): its page's Gives line inks (`picked:<species>`).
    on('plant:picked', (/** @type {{ sp: string }} */ p) => {
      const next = flag(journal, `picked:${p.sp}`);
      if (next !== journal) { journal = next; update('journal', () => journal); }
    }),
    // Digging (src/world/dig): each layer reached and each first find (a worm, a stone, a belemnite)
    // inks its band or detail on the Soil and Sand pages (`dig:<id>` flags, the sketches' labels).
    on('dig:layer', (/** @type {{ layer: string }} */ p) => {
      const next = flag(journal, `dig:${p.layer}`);
      if (next !== journal) { journal = next; update('journal', () => journal); }
    }),
    on('dig:detail', (/** @type {{ id: string }} */ p) => {
      const next = flag(journal, `dig:${p.id}`);
      if (next !== journal) { journal = next; update('journal', () => journal); }
    }),
    // The island gave you something (src/world/expansion.js): written once, shown as a card.
    on('progress:gifted', (/** @type {any} */ g) => commit(noteGift(journal, g, { state: world.state, hour: hourIndex(), words }))),
    // The camp became a known place (B1 C1, src/world/camp/gift-stone.js): written once.
    on('camp:known-rose', (/** @type {{ text: string }} */ p) => commit(noteOnce(journal, 'camp:known', p.text, { state: world.state, hour: hourIndex(), words }))),
    // Watching a frog (or a school) from close by finds it too (src/world/creatures/index.js, schools.js).
    on('creature:found', (/** @type {{ species: string }} */ p) => {
      if (p.species === 'frogs' || words.species[p.species]?.kind === 'school') found(p.species);
    }),
    // You named a frog (S6c-3, src/app.js): the moment is written, and its open card takes the name.
    // A turtle too (bonds.js): its card the same way.
    on('creature:named', (/** @type {{ species: string, id: number, name: string }} */ p) => {
      if (p.species !== 'frogs' && p.species !== 'turtles' && p.species !== 'hens') return;
      commit(namedAnimal(journal, p.name, { state: world.state, hour: hourIndex(), words }, p.species));
      const c = get('identify');
      if (c?.sp === p.species && c.id === p.id) {
        const card = p.species === 'frogs' ? frogCard({ x: c.wx, z: c.wz, id: c.id }, world.state, words, world.env.recipes?.species?.frog?.presence)
          : p.species === 'hens' ? henCard({ x: c.wx, z: c.wz }, world.state, words, world.env.recipes?.species?.hen?.presence)
          : turtleCard({ x: c.wx, z: c.wz, id: c.id }, world.state, words, world.env.recipes?.species?.turtle?.presence);
        update('identify', () => ({ ...c, ...card }));
      }
    }),
    onAction((a) => {
      // Choosing a tool or closing the card puts the tap card away.
      if (a.type === 'tool.select' || a.type === 'ui.identify') { if (get('identify')) update('identify', () => null); return; }
      if (a.type === 'journal.showMe') { showMe(a.sp, a.at, a.text); return; }
      // A note was shown on the island (src/ui/island-notes.js): it is no longer one you may have missed.
      if (a.type === 'journal.noteShown') {
        const next = markShown(journal, a.n);
        if (next !== journal) { journal = next; update('journal', () => journal); }
        return;
      }
      // A flag the first evening keeps (src/world/intro): beats done, and keeper pages had and read.
      if (a.type === 'journal.flag') {
        const next = flag(journal, a.flag);
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
      if (a.trail) patch.trail = a.trail;
      if (a.keeper !== undefined) patch.keeper = a.keeper;
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
    /** What a ground point holds, as the card a click there would open (no journal writes). */
    cardAt,
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
