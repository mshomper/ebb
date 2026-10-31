// @ts-check
// The action handler (src/input/actions.js): every action, below and above.
// Run in order from src/app/systems.js; reads and adds to the start-up context (src/app/context.js).

import * as clock from '../core/clock.js';
import { emit, emitDeferred } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { setVerdict } from '../audio/music/hearts.js';
import { cleanShelf, keep as keepShelf, letGo as letGoShelf, readLetter, swap as swapShelf } from '../world/keepsakes/shelf.js';
import { chooseLetter } from '../world/keepsakes/letters.js';
import { takeFeather, featherLying, nameHen } from '../world/hen/trust.js';
import { takeEgg } from '../world/hen/eggs.js';
import { cleanName, nameFrog } from '../world/creatures/trust.js';
import { bondOf, turtleTrust, nameTurtle } from '../world/creatures/bonds.js';
import { onAction, dispatch } from '../input/actions.js';
import { attachDesktopInput } from '../input/desktop.js';

/** @param {import('./context.js').AppContext} ctx */
export function start(ctx) {
  const { aimAt, baker, bottleMessages, camRecipe, camera, camp, canvas, carryTap, clampSize, clickBelow, currentBrush, feedHere, feedTap, finishShapingDrag, finishStroke, fishing, fishingRecipe, frogRecipe, gather, groundAt, hen, keepsakes, keepsakesRecipe, kit, lift, looseStoneTap, nets, noteKept, pack, palettes, photo, pieceSpot, pieceUnderTap, pieces, piles, plantTap, presence, rb, refreshStoreCard, runHistory, shapingDragTo, shoreLetters, sowing, speciesRecipes, springTap, stoneTap, terrain, terrainRecipe, tools, treats, walk, walkerRecipe, world, ww, zoneTap, zones } = ctx;
  // The input's shared state (src/app/pointer.js): the pointer, the stroke, a held pour.
  const S = ctx.input;
  const unAction = onAction((a) => {
    // Photo mode first: while it is open it takes the view actions and the rest wait.
    if (photo.action(a)) return;
    // A zone (src/world/zones): mid-fade, taps and walking wait; down in one, a tap walks its floor
    // and opens its own cards, and Go up climbs back to the island.
    if (zones.busy() && (a.type === 'look.tap' || a.type.startsWith('walk.'))) return;
    if (zones.active() && walk.below) {
      if (a.type === 'look.tap') { zoneTap(a.x, a.y); return; }
      if (a.type === 'walk.up') { zones.back(); return; }
    }
    // Below (the walker): a drag looks around you, a zoom stays on you, a tap walks there, and the
    // shaping tools are put away until you go up.
    if (walk.below) {
      if (a.type === 'camera.pan') { camera.orbit(a.dx, a.dy); return; }
      if (a.type === 'camera.zoom') { camera.zoom(a.factor); return; }
      if (a.type === 'look.tap') {
        // One click walks and uses (src/world/walk/click.js): a thing walks you to it and opens its
        // card; a creature's card opens where you stand; grass, sand and shingle only near you.
        // The line out (F17): a click anywhere pulls it in, a fish with it if the float is under.
        if (fishing.out()) { if (!fishing.ease()) fishing.reel(); return; }
        const point = aimAt(a.x, a.y);
        if (!point) return;
        // Carrying (a lantern lifted on foot, B2 L1): the click sets it down there instead.
        if (pieces.carrying()) { carryTap(a.x, a.y); return; }
        // A seed, a gift, the net or the line in hand: the click sows, places, sets or casts it instead (D1a).
        if (sowing.click(a.x, a.y, point)) return;
        sowing.cancelWalk();
        // Low down, the ray grazes past a log or stone onto the ground behind it: try it first.
        const pc = pieceUnderTap(a.x, a.y, point);
        clickBelow(a.x, a.y, pc ? [pc.x, point[1], pc.z] : point);
        return;
      }
      // The pouches (src/world/pack): a pouch's card, Set down at camp, Empty.
      if (a.type === 'pack.open') { pack.open(a.i, a.x, a.y); return; }
      if (a.type === 'pack.setDown') { pack.setDown(a.i); return; }
      // A pile's card: Set down one pouch of its kind, then the card again with the pile's new size.
      if (a.type === 'pack.setDownKind') {
        pack.setDownKind(a.kind);
        refreshStoreCard();
        return;
      }
      if (a.type === 'pack.empty') { pack.empty(a.i); return; }
      if (a.type === 'gather.take') { gather.take(a.n); return; }
      if (a.type === 'gather.heapHere') { gather.heapHere(); walk.gesture('heapHere'); return; }
      if (a.type === 'gather.leaveBe') { updateStore('identify', () => null); return; }
      if (a.type === 'gather.spreadAsh') { if (gather.spreadAsh()) { walk.gesture('empty'); updateStore('identify', () => null); } return; }
      // Set out a treat (P2h): its line on the island, as Feed's.
      if (a.type === 'treats.setOut') {
        const line = treats.setOut(a.kind);
        updateStore('identify', () => null);
        if (line) emitDeferred('island:notice', { text: line, showS: walkerRecipe.words.noticeS });
        return;
      }
      // A pile's Take up fills a pouch; with no room, the full card (without Set down here).
      if (a.type === 'pile.takeUp') {
        const r = piles?.takeUp(a.id, pack);
        if (r?.taken) walk.gesture('takeUp', pieceSpot(a.id));
        if (r?.full) updateStore('identify', (c) => (c ? { ...c, full: { kind: r.kind, g: { heap: -1 } }, text: pack.recipe.words.full } : c));
        // A store's card stays, with what is left (or Empty); a heap's goes with it.
        else if (getStore('identify')?.store) refreshStoreCard();
        else updateStore('identify', () => null);
        return;
      }
      if (a.type === 'walk.up') { sowing.putAway(); sowing.cancelWalk(); fishing.reel(true); walk.up(); return; }
      // Fishing (src/world/fishing): the bar's Line again reels in, Ease it in brings a fish on.
      if (a.type === 'fishing.reel') { sowing.putAway(); fishing.reel(); return; }
      if (a.type === 'fishing.empty') { emitDeferred('island:notice', { text: fishingRecipe.words.noWorms, showS: 5 }); return; }
      if (a.type === 'fishing.release') { fishing.release(a.id); return; }
      if (a.type === 'fishing.redraw') { fishing.redraw(a.id); return; }
      if (a.type === 'fishing.close') { fishing.closeTray(); return; }
      if (a.type === 'walk.stuck') { sowing.cancelWalk(); walk.stuck(); return; }
      if (a.type === 'walk.posture') { walk.posture(a.posture); return; }
      if (a.type === 'walk.feed') { feedHere(); return; }
      // The seed tin, the gift spot and the net (D1a): pick one into your hand, or put it away.
      if (a.type === 'hand.pick') { sowing.pick({ kind: a.kind, id: a.id }); updateStore('identify', () => null); return; }
      if (a.type === 'hand.putAway') { sowing.putAway(); return; }
      if (a.type === 'tool.select' || a.type.startsWith('tool.') || a.type === 'brush.resize') return;
    }
    switch (a.type) {
      case 'walk.down':
        finishStroke();
        S.pouring = null;
        pieces.cancelCarry();
        updateStore('tools', (t) => { t.tool = null; });
        terrain.setRing({ visible: false, level: null });
        walk.down();
        break;
      case 'camera.orbit': camera.orbit(a.dx, a.dy); break;
      case 'camera.pan': camera.pan(a.dx, a.dy); break;
      case 'camera.zoom': camera.zoom(a.factor, a.x, a.y); break;
      case 'camera.twist': camera.twist(a.angle); break;
      case 'camera.focus': camera.focus(a.x, a.z, a.distance, a.pitchDeg, a.y); break;
      case 'tool.select': {
        const next = a.toolId && a.toolId !== tools().tool ? a.toolId : null;
        if (!next) finishStroke();
        S.pouring = null;
        // Choosing a tool, or Escape, puts a carried piece back.
        pieces.cancelCarry();
        updateStore('tools', (t) => { t.tool = next; });
        emitDeferred('tool:selected', { toolId: next });
        break;
      }
      case 'brush.set': {
        updateStore('tools', (t) => {
          Object.assign(t, a.patch);
          t.size = clampSize(t.size);
          t.strength = Math.min(1, Math.max(0, t.strength));
          const [hMin, hMax] = terrainRecipe.cliff.heightM;
          t.cliffHeight = Math.min(hMax, Math.max(hMin, t.cliffHeight ?? terrainRecipe.cliff.heightDefault));
        });
        // A new flow step applies to the selected spring too (undoable).
        if (a.patch.springRate) ww.rateSelected(a.patch.springRate);
        if (a.patch.waterMode && a.patch.waterMode !== 'spring') ww.syncSprings(null);
        if (a.patch.sculptMode && a.patch.sculptMode !== 'loosestone') pieces.deselect();
        if (a.patch.sculptMode || a.patch.waterMode) pieces.deselectShaping();
        break;
      }
      case 'water.springRemove':
        ww.removeSpring(a.id);
        break;
      case 'pieces.remove':
        pieces.remove(a.id);
        break;
      case 'pieces.removeRun':
        pieces.removeRun(a.run);
        break;
      // Carry (the turtles' gift): the card's Carry lifts the piece; the next tap on land sets it
      // down (look.tap below); a tap on the card, its close, a tool or Escape puts it back.
      case 'pieces.carry':
        if (getStore('unlocks')?.carry && pieces.carry(a.id)) updateStore('identify', (c) => (c ? { ...c, carrying: true, carryNote: null, pinned: false } : c));
        break;
      case 'pieces.carryCancel':
        pieces.cancelCarry();
        updateStore('identify', () => null);
        break;
      // Lift (on foot, L3a): the card's Lift rolls the piece back; the journal shows what was under it.
      case 'pieces.lift':
        lift.lift(a.id);
        break;
      // A keepsake's card: Leave it to the sea (docs/future/12). It goes, and the next tide takes it.
      case 'keepsakes.leave':
        keepsakes.leave(a.id);
        updateStore('identify', () => null);
        emitDeferred('keepsake:sound', { name: 'leave' });
        break;
      // Keep it: onto the shelf (src/world/keepsakes/shelf.js), and off the shore. A full shelf
      // opens in the journal and asks which one to let go; nothing is kept until you choose.
      case 'keepsakes.keep': {
        const k0 = keepsakes.toKeep(a.id);
        if (!k0) break;
        // A bottle whose letter was read on the beach keeps that letter.
        const k = shoreLetters.has(a.id) ? { ...k0, letter: shoreLetters.get(a.id) } : k0;
        const r = keepShelf(cleanShelf(getStore('keepsakes')), k);
        if (r.kept) {
          updateStore('keepsakes', () => r.state);
          noteKept(k.n);
          keepsakes.leave(a.id);
          updateStore('identify', () => null);
          emitDeferred('keepsake:sound', { name: k.n.family === 'bottle' ? 'keep-glass' : 'keep' });
        } else {
          updateStore('shelfPending', () => ({ shoreId: a.id, ...k }));
          updateStore('identify', () => null);
          dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: true, tab: 'shelf', page: null }));
        }
        break;
      }
      case 'keepsakes.swap': {
        const p = getStore('shelfPending');
        if (!p) break;
        updateStore('keepsakes', (s) => swapShelf(cleanShelf(s), a.out, p));
        noteKept(p.n);
        // One from a net's haul: the tray's keepsake is answered.
        if (String(p.shoreId).startsWith('net:')) nets.answered();
        keepsakes.leave(p.shoreId);
        updateStore('shelfPending', () => null);
        emitDeferred('keepsake:sound', { name: p.n?.family === 'bottle' ? 'keep-glass' : 'keep' });
        break;
      }
      case 'keepsakes.letGo':
        updateStore('keepsakes', (s) => letGoShelf(cleanShelf(s), a.id));
        emitDeferred('keepsake:sound', { name: 'leave' });
        break;
      case 'keepsakes.cancelKeep':
        updateStore('shelfPending', () => null);
        break;
      // Read a bottle's letter (src/world/keepsakes/letters.js), on the beach (shoreId) or on the
      // shelf (entryId). Its letter is chosen the first time it is read, then kept with it; every
      // letter read is kept with the shelf to read again, and the journal opens on it.
      case 'keepsakes.read': {
        const s0 = cleanShelf(getStore('keepsakes'));
        const entry = a.entryId !== undefined ? s0.shelf.find((e) => e.id === a.entryId) : null;
        const k = entry ?? (a.shoreId ? keepsakes.toKeep(a.shoreId) : null);
        if (!k || k.n.family !== 'bottle' || !k.n.message) break;
        let id = entry?.letter ?? (a.shoreId ? shoreLetters.get(a.shoreId) : undefined);
        if (!id) {
          const season = ['spring', 'summer', 'autumn', 'winter'][clock.seasonOf(k.hour * 3600).index];
          id = chooseLetter(k.n.messageIndex, { rarity: k.n.rarity, season, hour: clock.worldT() / 3600, read: s0.letters },
            bottleMessages, keepsakesRecipe.rarity.order)?.id;
        }
        if (!id) break;
        const letter = id;
        if (a.shoreId) shoreLetters.set(a.shoreId, letter);
        updateStore('keepsakes', (s) => {
          const c = readLetter(cleanShelf(s), letter);
          return entry ? { ...c, shelf: c.shelf.map((e) => (e.id === entry.id ? { ...e, letter } : e)) } : c;
        });
        updateStore('identify', () => null);
        updateStore('shelfUi', () => ({ letter }));
        dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: true, tab: 'shelf', page: null }));
        emitDeferred('keepsake:sound', { name: 'letter' });
        break;
      }
      // The nets (src/world/nets): the net's card lifts it (the haul goes on the tray) or brings it in;
      // the tray lets living catches go, keeps or returns its keepsake, and closes.
      case 'nets.lift':
        if (nets.lift(a.id)) updateStore('identify', () => null);
        break;
      case 'nets.bringIn': {
        const id = a.id ?? nets.nets().find((/** @type {any} */ n) => n.at)?.id;
        if (id !== undefined) nets.bringIn(id);
        updateStore('identify', () => null);
        break;
      }
      case 'nets.release':
        nets.release(a.id);
        break;
      case 'nets.close':
        nets.closeTray();
        break;
      case 'nets.leave':
        nets.answered(true);
        emitDeferred('keepsake:sound', { name: 'leave' });
        break;
      case 'nets.keep': {
        const h = getStore('haul');
        if (!h?.haul.keepsake || h.kept) break;
        const k = { n: structuredClone(h.haul.keepsake.n), hour: h.hour, spring: h.springTide };
        const r = keepShelf(cleanShelf(getStore('keepsakes')), k);
        if (r.kept) {
          updateStore('keepsakes', () => r.state);
          noteKept(k.n);
          nets.answered();
          emitDeferred('keepsake:sound', { name: 'keep' });
        } else {
          // A full shelf asks which to let go, in the journal; the tray waits underneath.
          updateStore('shelfPending', () => ({ shoreId: h.haul.keepsake.id, ...k }));
          dispatch(/** @type {any} */ ({ type: 'ui.keeper', open: true, tab: 'shelf', page: null }));
        }
        break;
      }
      case 'ui.identify':
        pieces.cancelCarry();
        break;
      case 'brush.resize':
        updateStore('tools', (t) => { t.size = clampSize(t.size * a.factor); });
        break;
      case 'tool.hover':
        S.pointer.x = a.x;
        S.pointer.y = a.y;
        S.pointer.inside = a.inside;
        break;
      case 'tool.begin':
      case 'tool.move': {
        if (!tools().tool) break;
        if (tools().tool === 'plant') { if (a.type === 'tool.begin') plantTap(a.x, a.y); break; }
        if (tools().tool === 'feed') { if (a.type === 'tool.begin') feedTap(a.x, a.y); break; }
        if (tools().tool === 'sculpt' && tools().sculptMode === 'stone') { if (a.type === 'tool.begin') stoneTap(a.x, a.y); break; }
        if (tools().tool === 'sculpt' && tools().sculptMode === 'loosestone') { if (a.type === 'tool.begin') looseStoneTap(a.x, a.y); break; }
        if (tools().tool === 'sculpt' && (tools().sculptMode === 'pondstones' || tools().sculptMode === 'steps')) { shapingDragTo(a.type, a.x, a.y); break; }
        if (tools().tool === 'water') {
          if (tools().waterMode === 'spring') { if (a.type === 'tool.begin') springTap(a.x, a.y); }
          // The net and the raft are set on foot now (D1a): their old modes from above do nothing.
          else if (tools().waterMode === 'net' || tools().waterMode === 'raft') { /* set on foot */ }
          else if (a.type === 'tool.begin' || S.pouring) S.pouring = { x: a.x, y: a.y };
          break;
        }
        if (a.type === 'tool.begin') { S.wantStroke = true; S.shiftHeld = !!a.shift; }
        if (!S.wantStroke) break;
        const p = groundAt(a.x, a.y);
        if (!p) break;
        presence.edit(p[0], p[2]);
        if (!S.stroking) S.stroking = terrain.beginStroke(currentBrush(), p, a.pressure);
        else terrain.strokeTo(p, a.pressure);
        break;
      }
      case 'tool.end':
      case 'tool.cancel': {
        // A pour ended: the first evening's shape beat reads where (src/world/intro).
        const pourEnd = S.pouring && tools().tool === 'water' ? groundAt(S.pouring.x, S.pouring.y) : null;
        if (pourEnd) emitDeferred('water:pour-ended', { x: pourEnd[0], z: pourEnd[2], tool: 'water', mode: tools().waterMode });
        S.pouring = null;
        finishStroke();
        finishShapingDrag();
        break;
      }
      // A tap with no tool: the journal names what grows there (src/world/journal).
      // Carrying, the tap sets the piece down instead.
      case 'look.tap':
        if (pieces.carrying()) carryTap(a.x, a.y);
        else {
          // The keepsake shelf stands tall: a tap on it from above would land on the ground behind (B2).
          const r = camera.ray(a.x, a.y), shelfHit = camp.shelf.underRay(r.o, r.d), g = groundAt(a.x, a.y);
          emitDeferred('look:tapped', { x: a.x, y: a.y, point: shelfHit && g ? [shelfHit.x, g[1], shelfHit.z] : g });
        }
        break;
      case 'history.undo': if (!S.stroking) runHistory('undo'); break;
      case 'history.redo': if (!S.stroking) runHistory('redo'); break;
      case 'time.flow':
        clock.setFlow(a.flow);
        updateStore('meta', (m) => { m.flow = a.flow; });
        break;
      case 'look.palette':
        if (!palettes[a.id]) break;
        baker.setPalette(palettes[a.id]);
        updateStore('settings', (s) => { s.palette = a.id; });
        emitDeferred('palette:changed', { id: a.id });
        break;
      // Settings (src/ui/settings.js): growing while away belongs to the island; the rest are
      // this device's settings (src/save/prefs.js keeps them).
      case 'time.keepGrowing':
        updateStore('meta', (m) => { m.keepGrowing = a.on; });
        break;
      // A heart or a thumbs-down on the piece playing (src/ui/now-playing.js), kept with the island:
      // a heart plays it more often; a thumbs-down fades it out and it never comes back.
      case 'music.heart':
        updateStore('music', (m) => setVerdict(m, a.heart, 'heart'));
        break;
      case 'music.pass':
        updateStore('music', (m) => setVerdict(m, a.heart, 'pass'));
        break;
      // The hen's tail feather taken up (docs/future/15 slice 2b): the hen-feather hat band, worn at once.
      // An egg taken from her scrape or the nest box (docs/future/15 slice 4): into its own pouch, a few at most.
      case 'hen.egg': {
        const n = hen.nestAt(), EW = speciesRecipes.hen.eggs?.words ?? {};
        if (!n || n.eggs <= 0) break;
        const put = pack.add('egg', 1);
        if (!put.added) { emit('island:notice', { text: EW.full, showS: 5 }); break; }
        world.state = takeEgg(world.state);
        updateStore('world', () => world.state);
        walk.kneelToward(n.x, n.z, 1.2);
        emit('island:notice', { text: EW.took, showS: 4 });
        emitDeferred('hen:egg-taken', { where: n.where, hour: clock.hourIndex() });
        if (getStore('identify')?.henNest) updateStore('identify', () => hen.nestCard(n.x, n.z));
        break;
      }
      case 'hen.feather': {
        if (!featherLying(world.state?.creatures?.hens)) break;
        world.state = takeFeather(world.state, clock.hourIndex());
        updateStore('world', () => world.state);
        kit.giveBand('hen-feather');
        if (getStore('identify')?.feather) updateStore('identify', () => null);
        const W = speciesRecipes.hen.fond?.feather?.words ?? {};
        emitDeferred('progress:gifted', { id: 'hen-feather', title: W.title, line: W.gift, icon: 'feather', page: 'hens' });
        break;
      }
      case 'settings.set':
        updateStore('settings', (s) => { Object.assign(s, a.patch); });
        break;
      // A name for a frog that knows you well enough (S6c-3, the tap card): kept with the island.
      case 'creature.name': {
        const name = cleanName(a.name);
        // The hen (docs/future/15): once she knows you to presence.namingTrust.
        if (a.sp === 'hens') {
          const next = nameHen(world.state, name, clock.hourIndex(), speciesRecipes.hen.presence);
          if (next === world.state) break;
          world.state = next;
          updateStore('world', () => world.state);
          emitDeferred('creature:named', { species: 'hens', id: 1, name });
          break;
        }
        // A turtle (bonds.js): its own trust, the group's and what it ate, reaches namingTrust.
        if (a.sp === 'turtles') {
          const S = world.state?.creatures?.turtles, P = world.env.recipes?.species?.turtle?.presence;
          if (!name || !S || !P?.namingTrust || bondOf(S, a.id)?.name || turtleTrust(S, a.id, P) < P.namingTrust) break;
          world.state = nameTurtle(world.state, a.id, name, clock.hourIndex());
          updateStore('world', () => world.state);
          emitDeferred('creature:named', { species: 'turtles', id: a.id, name });
          break;
        }
        const f = world.state?.creatures?.frogs?.frogs?.find((/** @type {any} */ g) => g.id === a.id);
        if (!name || !f || f.name || (f.trust ?? 0) < frogRecipe.presence.namingTrust) break;
        world.state = nameFrog(world.state, a.id, name, clock.hourIndex());
        updateStore('world', () => world.state);
        emitDeferred('creature:named', { species: 'frogs', id: a.id, name });
        break;
      }
    }
  });
  const detachDesktop = attachDesktopInput(canvas, camRecipe, rb);
  Object.assign(ctx, { unAction, detachDesktop });
}
