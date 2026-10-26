// @ts-check
// The tea pot, live (docs/future/13 section 7; P2e): a click on the tea pot on the hearth opens its
// workspace (the stations' card, src/ui/station.js), two spots for herbs, laid from the pack, the
// drying rack (a dried bunch as 'dried:<kind>') or the hamper. Brew wants the pot full of spring
// water on the hearth over a lit fire, and the fired cup to drink from. Brew: the herbs and the
// water are taken, the walker kneels to watch it steep while the pot steams (cook.json teas.steepS),
// then sits and sips (figure.json gestures.sip, teas.sipS) with the cup in hand, and the tea's boon
// begins (boons.js; one at a time, the new replacing the old). A tea first drunk is written in the
// cook section's `teas` (found blends, tried pairs and their taste lines) for the camp page.
// Rules: brew.js (pure). Publishes `stationView` while its card is open (stations.js stands aside).

import { emit, emitDeferred } from '../../core/events.js';
import { get, update, subscribe } from '../../core/store.js';
import { onAction } from '../../input/actions.js';
import { potOnHearth, pieceOf, setWater } from './pots.js';
import { inSlot } from './model.js';
import { fireAt } from './fire.js';
import { cleanCook } from './making.js';
import { rackWord, pileWord } from '../pack/piles.js';
import { brew, herbOf, undried, tasteLine, drankLine, cleanTeaNotes, noteTea } from './brew.js';

/**
 * @param {import('./cards.js').CampKit & { o: any, cook: any, keeps: import('./keeps.js').Keeps, change: (fn: (c: import('./model.js').Camp) => import('./model.js').Camp) => void,
 *   frame: { steep: (on: boolean) => void }, boons: { drink: (id: string) => void } }} k
 */
export function createTeapot(k) {
  const C = k.cook, W = C.words ?? {}, T = W.teapot ?? {}, TE = C.teas ?? { herbs: {}, strength: [] }, R = k.R, F = R.fire;
  const o = k.o, P = o.pack?.recipe ?? {}, keeps = k.keeps;
  const spots = R.stations?.teapot?.spots ?? 2;
  /** The card open, and what is laid on it. @type {{ laid: string[], line: string | null } | null} */
  let open = null;
  /** The brew under way: steeping (its seconds), then sipping. @type {{ phase: 'steep' | 'sip', t: number, tea: import('./brew.js').Tea } | null} */
  let brewing = null;

  const isHerb = (/** @type {string} */ kind) => !!herbOf(kind, TE);
  const nameOf = (/** @type {string} */ kind) => (kind.startsWith('dried:') ? `${o.pack?.nameOf?.(undried(kind)) ?? undried(kind)}, ${T.dried ?? 'dried'}` : o.pack?.nameOf?.(kind) ?? kind);
  /** Where you kneel to brew: at the ring, as for the fire. */
  const at = () => { const r = k.where.slotAt('ring'); return r ? { x: r.x, z: r.z, stand: { x: r.x, z: r.z }, reachM: R.reach.ringM } : null; };
  const teaPotOn = () => { const c = k.camp(); return !!inSlot(c, 'hearth') && potOnHearth(c) === 'tea-pot'; };

  // ---- where herbs come from: the pack, the hamper, the rack (a dried bunch only from the rack) ----

  const packHerbs = () => {
    /** @type {Record<string, number>} */ const n = {};
    for (const [kind, h] of /** @type {[string, number][]} */ (get('pack')?.pouches ?? [])) if (isHerb(kind)) n[kind] = (n[kind] ?? 0) + h;
    return n;
  };
  const hamperHerbs = () => Object.fromEntries(Object.entries(keeps.hamper.holds()).filter(([kind]) => isHerb(kind)));
  /** The rack's bunches by what they lay as: dried ones as 'dried:<kind>'. */
  const rackHerbs = () => {
    /** @type {Record<string, { n: number, dry: number }>} */ const n = {};
    for (const b of keeps.rack.bunches()) {
      if (!isHerb(b.kind)) continue;
      const key = b.dry >= 1 ? `dried:${b.kind}` : b.kind, e = n[key] ?? { n: 0, dry: b.dry };
      n[key] = { n: e.n + b.handfuls, dry: Math.min(e.dry, b.dry) };
    }
    return n;
  };
  /** Handfuls of a laid kind to hand, less what is laid. @param {string} kind */
  function left(kind) {
    const laid = open?.laid.filter((x) => x === kind).length ?? 0;
    const rack = rackHerbs()[kind]?.n ?? 0;
    if (kind.startsWith('dried:')) return rack - laid;
    return (packHerbs()[kind] ?? 0) + (hamperHerbs()[kind] ?? 0) + rack - laid;
  }
  /** Take one handful of a laid kind: the pack, then the hamper, then the rack. @param {string} kind */
  function takeOne(kind) {
    const dried = kind.startsWith('dried:'), plain = undried(kind);
    if (!dried && (o.pack?.take(plain, 1) ?? 0) > 0) return true;
    if (!dried && keeps.hamper.take(plain, 1) > 0) return true;
    const i = keeps.rack.bunches().findIndex((b) => b.kind === plain && (b.dry >= 1) === dried);
    return i >= 0 && keeps.rack.takeUp(i, () => ({ added: 1 })).taken > 0;
  }

  // ---- what stands in the way ----

  /** Why Brew cannot go now (its line), or null. */
  function why() {
    const c = k.camp(), water = pieceOf(c, 'tea-pot')?.water ?? null;
    if (!water) return T.noWater ?? null;
    if (water !== 'fresh') return T.sea ?? null;
    if (fireAt(c.fire, k.hourNow(), F).word !== 'lit') return T.noFire ?? null;
    if (!pieceOf(c, 'cup')) return T.noCup ?? null;
    return null;
  }

  const notes = () => cleanTeaNotes(cleanCook(get('cook')).teas);
  /** The line under the herbs: a tea already known says its name; else the plain one. */
  function laidLine() {
    if (!open || !open.laid.length) return T.laid ?? null;
    const tea = brew(open.laid, C);
    if (tea && notes().found[tea.id] !== undefined) return `${W.boonNames?.[tea.id] ?? tea.id}. ${W.boonLines?.[tea.id] ?? ''}`.trim();
    return T.laid ?? null;
  }

  /** What the workspace draws now (the store slice `stationView`). */
  function view() {
    if (!open) return null;
    const stop = brewing ? null : why();
    const row = (/** @type {Record<string, number>} */ n, /** @type {(kind: string, h: number) => string} */ word) => Object.entries(n).map(([kind, h]) => ({ kind, name: nameOf(kind), handfuls: h, left: Math.max(0, Math.min(h, left(kind))), word: word(kind, h) }));
    const rack = rackHerbs();
    return {
      id: 'teapot', name: T.name ?? 'Tea pot', spots,
      laid: open.laid.map((kind) => ({ kind, name: nameOf(kind), used: true })), outlines: [],
      action: { icon: 'brew', label: T.brew ?? 'Brew', ready: !brewing && !stop && open.laid.length > 0, make: 'brew' },
      line: brewing ? T.steeping ?? null : open.line ?? stop ?? laidLine(), working: !!brewing,
      pack: row(packHerbs(), () => ''), piles: Object.entries(rack).map(([kind, e]) => ({ kind, name: nameOf(kind), handfuls: e.n, left: Math.max(0, Math.min(e.n, left(kind))), word: rackWord(e.dry, P.words?.rack ?? {}) })),
      store: row(hamperHerbs(), (_, h) => pileWord(h, P)), bench: [],
      packName: W.pack, pilesName: T.rack ?? 'On the rack', storeName: W.hamper, at: at(),
    };
  }
  let viewKey = '';
  function publish() {
    if (!open) return;
    const v = view(), key = JSON.stringify(v);
    if (key === viewKey) return;
    viewKey = key;
    update('stationView', () => v);
  }
  function close() {
    open = null;
    viewKey = '';
    update('stationView', () => null);
  }

  function lay(/** @type {string} */ kind) {
    if (!open || brewing || !isHerb(kind)) return;
    if (open.laid.length >= spots) { open.line = W.spotsFull ?? null; publish(); return; }
    if (left(kind) <= 0) return;
    open.laid = [...open.laid, kind];
    open.line = null;
    const a = at();
    o.walk.gesture('setDown', a ?? undefined);
    publish();
  }
  function unlay(/** @type {number} */ i) {
    if (!open || brewing || !open.laid[i]) return;
    open.laid = open.laid.filter((_, j) => j !== i);
    open.line = null;
    o.walk.gesture('takeUp', at() ?? undefined);
    publish();
  }

  /** Brew: the herbs and the water taken, the pot steeps while you kneel and watch it. */
  function act() {
    if (!open || brewing || !open.laid.length) return;
    const stop = why();
    if (stop) { open.line = stop; publish(); return; }
    const tea = brew(open.laid, C);
    if (!tea) return;
    if (open.laid.some((kind) => left(kind) < 0)) { open.line = T.noHerbs ?? null; publish(); return; }
    for (const kind of open.laid) takeOne(kind);
    k.change((c) => setWater(c, 'tea-pot', null));
    const a = at();
    if (a) o.walk.kneelToward(a.x, a.z, TE.steepS ?? 3, 'steep');
    k.frame.steep(true);
    brewing = { phase: 'steep', t: 0, tea };
    publish();
  }

  /** Steeped: the card closes, you pour and sit to sip. */
  function pour() {
    if (!brewing) return;
    k.frame.steep(false);
    if (open) { open.laid = []; }
    if (get('identify')?.station === 'teapot') update('identify', () => null);
    const a = at();
    if (a) o.walk.kneelToward(a.x, a.z, TE.sipS ?? 4.5, 'sip');
    brewing = { ...brewing, phase: 'sip', t: 0 };
  }

  /** Drunk: the boon begins, the tea is written, and its line said (with a taste line the first time). */
  function drunk() {
    if (!brewing) return;
    const tea = brewing.tea, hour = k.hourNow();
    brewing = null;
    k.boons.drink(tea.id);
    const before = notes();
    const first = before.found[tea.id] === undefined, firstPair = !!tea.pair && before.tried[tea.pair] === undefined;
    const taste = firstPair ? tasteLine(tea, W) : null;
    update('cook', (s) => { const c = cleanCook(s); return { ...c, teas: noteTea(cleanTeaNotes(c.teas), tea, hour, taste) }; });
    // The plant pages ink their tea hints (journal.json gives, when 'tea:<id>'; 'tea:first' for any cup).
    const flags = ['tea:first', `tea:${tea.id}`];
    update('journal', (j) => (j ? { ...j, flags: [...(j.flags ?? []), ...flags.filter((f) => !(j.flags ?? []).includes(f))] } : j));
    emit('island:notice', { text: [drankLine(tea, W), taste].filter(Boolean).join(' '), showS: 7 });
    emitDeferred('tea:drunk', { id: tea.id, pair: tea.pair, blend: tea.blend, first, hour });
  }

  const offs = [
    // The tea pot's card opens its workspace; any other card (or none) closes it, and the herbs go back.
    subscribe('identify', (/** @type {any} */ c) => {
      if (c?.station !== 'teapot') { if (open) close(); return; }
      if (!open) open = { laid: [], line: null };
      viewKey = '';
      publish();
    }),
    subscribe('pack', () => publish()),
    subscribe('camp', () => publish()),
    onAction((/** @type {any} */ a) => {
      if (!open) return;
      if (a.type === 'station.lay') lay(a.kind);
      else if (a.type === 'station.unlay') unlay(a.i);
      else if (a.type === 'station.act') act();
    }),
  ];

  return {
    /** Is the tea pot on the hearth (its card opens the workspace)? */
    teaPotOn,
    /**
     * Each frame: the steep and the sip run on; walking away closes the card (a brew under way
     * goes on). @param {number} dt
     */
    update(dt) {
      if (brewing) {
        brewing.t += dt;
        if (brewing.phase === 'steep' && brewing.t >= (TE.steepS ?? 3)) pour();
        else if (brewing.phase === 'sip' && brewing.t >= (TE.sipS ?? 4.5)) drunk();
      }
      if (!open) return;
      if (!teaPotOn() && !brewing) { update('identify', () => null); return; }
      const a = at();
      if (a && !brewing && o.walk.distTo(a.stand.x, a.stand.z) > a.reachM + (R.stations?.awayM ?? 1.2) && !k.player.busy()) update('identify', () => null);
    },
    /** The cup in your hand: while you sip. */
    sipping: () => brewing?.phase === 'sip',
    view,
    /** Tests and the test links. */
    debug: { lay, unlay, act, pour, drunk, open: () => open, brewing: () => brewing },
    dispose() { for (const off of offs) off(); },
  };
}
