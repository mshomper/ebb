// @ts-check
// Evening director tests (docs/future/13 section 2): with stand-ins for the walker, the camp and the
// pack, the director runs the beats in order, shows one hint at a time and never again after its beat,
// waits for sunset before dusk, plays the drink act before the page, resumes on the first beat
// without its flag, skips only at beat 0, runs the short evening without hints, and turns an older
// island's save into intro:done and intro:older with one notice and one glow.

import { createIntro } from '../src/world/intro/index.js';
import { createBus } from '../src/core/events.js';
import { keeperCardHtml } from '../src/ui/keeper-card.js';
import { keeperEntry } from '../src/ui/journal-keeper.js';

const G = 'intro: director';

async function recipe() {
  const url = new URL('../recipes/world/intro.json', import.meta.url);
  if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
  return (await fetch(url)).json();
}

/** A stand-in world the checks read, and a director over it. @param {any} R @param {{ flags?: string[], mode?: 'full' | 'short' }} [s] */
function rig(R, s = {}) {
  const bus = createBus();
  const flags = s.flags ?? [];
  const W = { x: 0, z: 0, posture: 'stand', below: true, journal: false, pack: /** @type {Record<string, number>} */ ({ fuel: 0, stones: 0 }), lit: false, sunsetInH: 10,
    day: 0, sunUp: true, stores: /** @type {Record<string, number>} */ ({}),
    camp: /** @type {Record<string, boolean>} */ ({ tent: false, ring: false }) };
  /** @type {{ hints: any[], acts: string[], pages: string[], notices: string[], glows: string[], emitted: string[], flows: number[], skipped: number }} */
  const log = { hints: [], acts: [], pages: [], notices: [], glows: [], emitted: [], flows: [], skipped: 0 };
  const spring = { x: 10, z: 0 }, ring = { x: 20, z: 0 }, pad = { x: 20, z: 0 };
  const intro = createIntro({
    R, mode: s.mode,
    on: (n, fn) => bus.on(n, fn),
    emit: (n, p) => { log.emitted.push(n); if (n === 'intro:hint') log.hints.push(p); bus.emit(n, p); },
    flags: () => flags,
    setFlag: (f) => { if (!flags.includes(f)) flags.push(f); },
    ctx: {
      walker: () => W, onLand: (x) => x >= 0, spring: () => spring, journalOpen: () => W.journal,
      packHolds: (need) => Object.entries(need).every(([k, n]) => (/** @type {any} */ (W.pack)[k] ?? 0) >= n),
      // The pad reaches from x 16 up; a stroke's rect comes as terrain:stroke-ended sends it.
      offPad: (rect, at) => (rect ? rect.x1 < 16 : !!at && at.x < 16), ring: () => ring, fireLit: () => W.lit,
      campHas: (part) => !!W.camp[part],
      sunsetInH: () => W.sunsetInH, day: () => W.day, sunUp: () => W.sunUp, pad: () => pad,
      storeOf: (k) => ({ 'drift-twigs': 'sticks', pebbles: 'stones' })[k] ?? null, storeHolds: (s) => W.stores[s] ?? 0,
    },
    effects: {
      act: (n) => log.acts.push(n), openPage: (id) => { log.pages.push(id); W.journal = true; },
      skipCamp: () => { log.skipped++; }, notice: (t) => log.notices.push(t), glow: (sl) => log.glows.push(sl),
      flow: (n) => log.flows.push(n),
    },
  });
  const line = () => log.hints[log.hints.length - 1]?.text ?? null;
  return { bus, flags, W, log, intro, line, spring, ring };
}

/** A stroke's rect well off the pad (which reaches from x 16 up). */
const OFF = { x0: 4, z0: 0, x1: 8, z1: 4 };
/** Flags for every beat before `id`, as a save that far along has them. @param {any} R @param {string} id */
const before = (R, id) => R.beats.slice(0, R.beats.findIndex((/** @type {any} */ b) => b.id === id)).map((/** @type {any} */ b) => `intro:${b.id}`).concat('intro:begun');
/** @param {any} R @param {string} id */
const beatOf = (R, id) => R.beats.find((/** @type {any} */ b) => b.id === id);

/** Play the whole evening on the stand-ins, beat by beat. @param {ReturnType<typeof rig>} r @param {string} [until] */
function play(r, until) {
  const { bus, W, intro } = r;
  const steps = /** @type {Record<string, () => void>} */ ({
    landfall: () => bus.emit('walk:arrived', { x: 2, z: 0 }),
    spring: () => { W.x = 10.5; W.posture = 'kneel'; intro.update(0.1); bus.emit('walk:act-done', { name: 'drink' }); W.posture = 'stand'; },
    page: () => { intro.update(0.1); W.journal = false; intro.update(0.1); },
    pitch: () => bus.emit('camp:pitched', {}),
    gather: () => { W.pack = { fuel: 1, stones: 2 }; bus.emit('pack:changed', {}); },
    ring: () => bus.emit('camp:ring-laid', {}),
    shape: () => {
      W.below = false; bus.emit('walk:went-up', {});
      for (const mode of ['raise', 'lower', 'smooth', 'paint']) bus.emit('terrain:stroke-ended', { rect: OFF, tool: mode === 'raise' || mode === 'lower' ? 'sculpt' : mode, mode });
      bus.emit('water:pour-ended', { x: 5, z: 2, tool: 'water', mode: 'pour' });
    },
    plant: () => {
      W.below = true; bus.emit('walk:went-down', {});
      for (let i = 0; i < 3; i++) bus.emit('sow:landed', { species: 'reeds', x: 4, z: 1, ok: true });
      bus.emit('sow:landed', { species: 'lilies', x: 5, z: 2, ok: true });
    },
    store: () => {
      W.pack = { ...W.pack, 'drift-twigs': 2 }; bus.emit('pack:changed', {});
      W.pack = { ...W.pack, 'drift-twigs': 0 }; bus.emit('pack:set-down', { kind: 'drift-twigs', handfuls: 2, pile: 'p1' });
      W.pack = { ...W.pack, stones: 2 }; bus.emit('pack:changed', {});
      W.pack = { ...W.pack, stones: 0 }; bus.emit('pack:set-down', { kind: 'pebbles', handfuls: 2, pile: 'p2' });
    },
    dusk: () => { W.sunsetInH = -0.1; intro.update(0.1); W.lit = true; bus.emit('camp:lit', {}); W.x = 20.5; W.posture = 'sit'; for (let i = 0; i < 210; i++) intro.update(0.1); W.posture = 'stand'; },
    rest: () => bus.emit('camp:rested', {}),
  });
  for (const id of Object.keys(steps)) {
    if (id === until) return;
    if (intro.current?.id === id) steps[id]();
  }
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addIntroTests(test, assert, eq) {
  test(G, 'the whole evening runs in order and ends with intro:done', async () => {
    const r = rig(await recipe());
    r.intro.start({ fresh: true });
    eq(r.intro.current?.id, 'landfall', 'first beat');
    eq(r.line(), 'Click the grass above the beach to walk there.');
    eq(r.log.hints[0].skip, 'Skip the first evening', 'skip offered at beat 0');
    const order = /** @type {string[]} */ ([]);
    r.bus.on('intro:beat-done', (/** @type {any} */ p) => order.push(p.id));
    play(r);
    eq(order.join(','), 'landfall,spring,page,pitch,gather,ring,shape,plant,store,dusk,rest');
    assert(!r.flags.includes('intro:morning'), 'nothing left for the morning');
    assert(r.flags.includes('intro:done') && r.flags.includes('intro:begun'), 'done and begun flags');
    assert(!r.flags.includes('intro:skipped'), 'not skipped');
    eq(r.line(), null, 'no hint after the evening');
    eq(r.log.acts.join(','), 'drink', 'the drink act played');
    eq(r.log.pages.join(','), 'first', 'the first page opened');
    assert(r.log.emitted.includes('intro:curlew'), 'the curlew called when the fire was lit');
    return `${order.length} beats`;
  });

  test(G, 'after the ring, the shape beat opens on its own first line (no store aside)', async () => {
    const R = await recipe();
    const r = rig(R);
    r.intro.start({ fresh: true });
    play(r, 'shape');
    eq(r.intro.current?.id, 'shape');
    eq(r.line(), beatOf(R, 'shape').parts[0].hint, 'go up');
    assert(!R.hints?.store, 'the old store aside is gone from the recipe');
  });

  test(G, 'a walk that ends in the sea is not landfall', async () => {
    const r = rig(await recipe());
    r.intro.start({ fresh: true });
    r.bus.emit('walk:arrived', { x: -3, z: 0 });
    eq(r.intro.current?.id, 'landfall');
    r.bus.emit('walk:arrived', { x: 1, z: 0 });
    eq(r.intro.current?.id, 'spring');
  });

  test(G, 'kneeling at the spring plays drink, and the page waits for the act to end', async () => {
    const r = rig(await recipe(), { flags: ['intro:begun', 'intro:landfall'] });
    r.intro.start({ fresh: false });
    r.W.x = 13; r.W.posture = 'kneel'; r.intro.update(0.1);
    eq(r.log.acts.length, 0, 'too far from the pool');
    r.W.x = 11; r.intro.update(0.1);
    eq(r.log.acts.join(','), 'drink');
    r.intro.update(0.1);
    eq(r.intro.current?.id, 'spring', 'still drinking');
    r.bus.emit('walk:act-done', { name: 'drink' });
    eq(r.intro.current?.id, 'page');
    assert(r.flags.includes('keeper:first'), 'the page is kept in the journal');
  });

  test(G, 'each hint shows only in its beat, and never comes back', async () => {
    const r = rig(await recipe());
    r.intro.start({ fresh: true });
    play(r, 'shape');
    const pitch = r.log.hints.filter((h) => h.id === 'pitch').length;
    play(r);
    eq(r.log.hints.filter((h) => h.id === 'pitch').length, pitch, 'the pitch line did not show again');
    // Each beat's lines show in one run, never split by another beat's.
    const ids = r.log.hints.map((h) => h.id?.split(/[:.]/)[0]).filter(Boolean);
    const runs = ids.filter((id, i) => id !== ids[i - 1]);
    eq(new Set(runs).size, runs.length, 'no beat shows again after another');
  });

  test(G, 'shape: a pond tool by tool, each by one stroke of its own off the pad', async () => {
    const R = await recipe();
    const S = beatOf(R, 'shape').parts;
    const r = rig(R, { flags: before(R, 'shape') });
    r.intro.start({ fresh: false });
    eq(r.line(), S[0].hint, 'go up');
    r.W.below = false; r.bus.emit('walk:went-up', {});
    eq(r.line(), S[1].hint, 'raise');
    r.bus.emit('terrain:stroke-ended', { rect: OFF, tool: 'sculpt', mode: 'lower' });
    eq(r.line(), S[1].hint, 'a Lower stroke is not Raise');
    r.bus.emit('terrain:stroke-ended', { rect: { x0: 18, z0: 0, x1: 22, z1: 2 }, tool: 'sculpt', mode: 'raise' });
    eq(r.line(), S[1].hint, 'a Raise stroke on the pad does not count');
    r.bus.emit('terrain:stroke-ended', { rect: OFF });
    eq(r.line(), S[1].hint, 'nor an edit with no mode (an undo, a boulder)');
    r.bus.emit('terrain:stroke-ended', { rect: OFF, tool: 'sculpt', mode: 'raise' });
    // The Lower stroke made before it was asked for counts: straight on to Smooth.
    eq(r.line(), S[3].hint, 'raise done, and lower done early');
    r.bus.emit('terrain:stroke-ended', { rect: OFF, tool: 'smooth', mode: 'smooth' });
    eq(r.line(), S[4].hint, 'paint');
    r.bus.emit('terrain:stroke-ended', { rect: OFF, tool: 'paint', mode: 'paint' });
    eq(r.line(), S[5].hint, 'pour');
    r.bus.emit('water:pour-ended', { x: 5, z: 2, tool: 'water', mode: 'drain' });
    eq(r.intro.current?.id, 'shape', 'a drain is not a pour');
    r.bus.emit('water:pour-ended', { x: 18, z: 2, tool: 'water', mode: 'pour' });
    eq(r.intro.current?.id, 'shape', 'a pour on the pad does not count');
    r.bus.emit('water:pour-ended', { x: 5, z: 2, tool: 'water', mode: 'pour' });
    eq(r.intro.current?.id, 'plant', 'a pour off the pad ends the beat');
    for (let i = 0; i < S.length; i++) assert(r.flags.includes(`intro:shape.${i}`), `part ${i} flagged`);
  });

  test(G, 'plant: go down, three reeds that take, one lily; three refused lilies add the depth line', async () => {
    const R = await recipe();
    const S = beatOf(R, 'plant').parts;
    const r = rig(R, { flags: before(R, 'plant') });
    r.W.below = false;
    r.intro.start({ fresh: false });
    eq(r.line(), S[0].hint, 'go down');
    r.W.below = true; r.bus.emit('walk:went-down', {});
    eq(r.line(), S[1].hint, 'reeds');
    r.bus.emit('sow:landed', { species: 'reeds', x: 4, z: 1, ok: true });
    r.bus.emit('sow:landed', { species: 'reeds', x: 4, z: 2, ok: false });
    r.bus.emit('sow:landed', { species: 'reeds', x: 4, z: 3, ok: true });
    eq(r.line(), S[1].hint, 'two took, one refused: still reeds');
    r.bus.emit('sow:landed', { species: 'reeds', x: 4, z: 4, ok: true });
    eq(r.line(), S[2].hint, 'lilies');
    r.intro.update(0.1);
    for (let i = 0; i < 2; i++) r.bus.emit('sow:landed', { species: 'lilies', x: 5, z: 2, ok: false });
    eq(r.line(), S[2].hint, 'two misses: the line as it was');
    r.bus.emit('sow:landed', { species: 'lilies', x: 5, z: 2, ok: false });
    eq(r.line(), `${S[2].hint} ${S[2].more.hint}`, 'three misses: the depth line added');
    r.bus.emit('sow:landed', { species: 'lilies', x: 6, z: 2, ok: true });
    eq(r.intro.current?.id, 'store', 'a lily took');
  });

  test(G, 'store: two handfuls of twigs set down at the wood store, then two of pebbles at the stone pile', async () => {
    const R = await recipe();
    const S = beatOf(R, 'store').parts;
    const r = rig(R, { flags: before(R, 'store') });
    r.intro.start({ fresh: false });
    eq(r.line(), S[0].hint, 'gather twigs');
    r.W.pack = { 'drift-twigs': 1 }; r.bus.emit('pack:changed', {});
    eq(r.line(), S[0].hint, 'one handful is not two');
    r.W.pack = { 'drift-twigs': 2 }; r.bus.emit('pack:changed', {});
    eq(r.line(), S[1].hint, 'set them down');
    r.bus.emit('pack:set-down', { kind: 'pebbles', handfuls: 2, pile: 'p2' });
    eq(r.line(), S[1].hint, 'pebbles are not twigs');
    r.W.pack = {}; r.bus.emit('pack:set-down', { kind: 'drift-twigs', handfuls: 2, pile: 'p1' });
    // The pebbles set down before they were asked for count: the beat is done.
    eq(r.intro.current?.id, 'dusk', 'twigs and (early) pebbles set down');
    eq(r.line(), beatOf(R, 'store').later, 'the time button line now comes after the stores');
    // A store that already holds its handfuls passes at once.
    const q = rig(R, { flags: before(R, 'store') });
    q.W.stores = { sticks: 3, stones: 2 };
    q.intro.start({ fresh: false });
    q.intro.update(0.1);
    eq(q.intro.current?.id, 'dusk', 'the stores hold them already');
  });

  test(G, 'night comes first: the sun sets mid-shape, the day beats are set aside, and dusk starts on time', async () => {
    const R = await recipe();
    const S = beatOf(R, 'shape').parts;
    const r = rig(R, { flags: before(R, 'shape') });
    r.intro.start({ fresh: false });
    r.W.below = false; r.bus.emit('walk:went-up', {});
    r.bus.emit('terrain:stroke-ended', { rect: OFF, tool: 'sculpt', mode: 'raise' });
    eq(r.line(), S[2].hint, 'two parts in');
    r.W.sunsetInH = -0.05; r.intro.update(0.1);
    eq(r.intro.current?.id, 'dusk', 'dusk at sunset');
    eq(r.line(), beatOf(R, 'dusk').hint[0], 'with its usual line');
    for (const id of ['shape', 'plant', 'store']) assert(!r.flags.includes(`intro:${id}`), `${id} set aside, not done`);
    // A reload in the night opens on dusk, not on the set-aside beat.
    const again = rig(R, { flags: r.flags.slice() });
    again.W.sunsetInH = -1;
    again.intro.start({ fresh: false });
    eq(again.intro.current?.id, 'dusk', 'reload at night: dusk');
    // Resting ends the evening as now, and the first morning picks up the pond from where it stopped.
    r.W.below = true;
    r.bus.emit('camp:rested', {});
    assert(r.flags.includes('intro:done') && r.flags.includes('intro:morning'), 'done, with a morning list');
    eq(r.intro.current?.id, 'shape', 'the morning starts on the pond');
    eq(r.line(), R.morning.open.shape, 'with one opening line');
    r.intro.tuck();
    eq(r.line(), S[2].hint, 'tapped away: lower, where it stopped');
    r.bus.emit('terrain:stroke-ended', { rect: OFF, tool: 'sculpt', mode: 'lower' });
    eq(r.line(), S[3].hint, 'on through the parts');
    // The opening line also moves on by itself after its time.
    const t = rig(R, { flags: r.flags.filter((f) => !f.startsWith('intro:shape.')) });
    t.intro.start({ fresh: false });
    eq(t.intro.current?.id, 'shape', 'reload: still the morning list');
    eq(t.line(), S[0].hint, 'no opening line on a reload');
    // No deadline: the next sunset sets nothing aside in the morning.
    r.W.sunsetInH = -0.5; r.W.day = 1; r.intro.update(0.1);
    eq(r.intro.current?.id, 'shape', 'the morning list waits as long as it needs');
    // The rest of it, in order, then quiet.
    play(r);
    r.W.pack = { 'drift-twigs': 2, stones: 2 };
    r.bus.emit('pack:set-down', { kind: 'drift-twigs', handfuls: 2 });
    r.bus.emit('pack:set-down', { kind: 'pebbles', handfuls: 2 });
    r.intro.update(0.1);
    eq(r.intro.current, null, 'the morning list is done');
    eq(r.line(), null, 'and no line shows');
  });

  test(G, 'the morning opening line moves on after its time', async () => {
    const R = await recipe();
    const r = rig(R, { flags: before(R, 'plant') });
    r.W.below = false;
    r.intro.start({ fresh: false });
    r.W.sunsetInH = -0.05; r.intro.update(0.1);
    r.bus.emit('camp:rested', {});
    eq(r.intro.current?.id, 'plant');
    eq(r.line(), R.morning.open.plant, 'the planting opening line');
    for (let i = 0; i < (R.morning.showS ?? 10) * 10 + 5; i++) r.intro.update(0.1);
    eq(r.line(), beatOf(R, 'plant').parts[0].hint, 'then the beat\'s own line');
  });

  test(G, 'never sleeps: the first dawn ends the evening, with the card, the undone beats on the morning list', async () => {
    const R = await recipe();
    // Through the gathering; the ring never laid, the tent pitched.
    const r = rig(R, { flags: before(R, 'ring') });
    r.W.camp.tent = true;
    r.intro.start({ fresh: false });
    eq(r.intro.current?.id, 'ring');
    r.W.sunsetInH = -1; r.intro.update(0.1);
    eq(r.intro.current?.id, 'ring', 'night: the ring still waits');
    r.W.day = 1; r.W.sunUp = false; r.W.sunsetInH = 12; r.intro.update(0.1);
    assert(!r.flags.includes('intro:done'), 'still the evening before sunrise');
    r.W.sunUp = true; r.intro.update(0.1);
    for (const f of ['intro:done', 'intro:stayed-up', 'intro:morning', 'intro:dusk', 'intro:rest', 'keeper:first']) assert(r.flags.includes(f), f);
    assert(r.log.emitted.includes('intro:stayed-up'), 'the adapter is told (the wake card)');
    eq(r.intro.current?.id, 'ring', 'the morning list starts at the ring');
    eq(r.line(), R.morning.stayedUp.tent, 'the stayed-up line, tent pitched');
    r.bus.emit('camp:ring-laid', {});
    eq(r.intro.current?.id, 'shape', 'then the pond');
    // No tent: the other line, and pitching first.
    const q = rig(R, { flags: before(R, 'pitch') });
    q.intro.start({ fresh: false });
    q.W.day = 1; q.intro.update(0.1);
    eq(q.intro.current?.id, 'pitch', 'pitching first');
    eq(q.line(), R.morning.stayedUp.noTent, 'the stayed-up line, no tent');
    // Landfall and the spring missed: left as Skip leaves them.
    const s = rig(R, { flags: ['intro:begun'] });
    s.intro.start({ fresh: true });
    s.W.day = 1; s.intro.update(0.1);
    for (const f of ['intro:landfall', 'intro:spring', 'intro:page', 'keeper:first']) assert(s.flags.includes(f), f);
    eq(s.intro.current?.id, 'pitch', 'the morning list begins with the tent');
    // The short evening is unchanged: no dawn ending.
    const sh = rig(R, { mode: 'short', flags: ['intro:begun'] });
    sh.intro.start({ fresh: false });
    sh.W.day = 1; sh.intro.update(0.1);
    assert(!sh.flags.includes('intro:done'), 'the short evening waits as before');
  });

  test(G, 'dusk needs the fire lit, then 20 s sitting within reach', async () => {
    const R = await recipe();
    const r = rig(R, { flags: before(R, 'dusk') });
    r.W.sunsetInH = -1;
    r.intro.start({ fresh: false });
    r.W.x = 20.5; r.W.posture = 'sit';
    for (let i = 0; i < 300; i++) r.intro.update(0.1);
    eq(r.intro.current?.id, 'dusk', 'unlit: sitting does nothing');
    r.W.lit = true; r.bus.emit('camp:lit', {});
    eq(r.line(), beatOf(R, 'dusk').hint[1], 'the sit line');
    for (let i = 0; i < 150; i++) r.intro.update(0.1);
    r.W.posture = 'stand'; r.intro.update(0.1); r.W.posture = 'sit';
    for (let i = 0; i < 150; i++) r.intro.update(0.1);
    eq(r.intro.current?.id, 'dusk', 'standing up starts the sitting over');
    for (let i = 0; i < 60; i++) r.intro.update(0.1);
    eq(r.intro.current?.id, 'rest');
  });

  test(G, 'a reload resumes on the first beat without its flag, with its hint', async () => {
    const R = await recipe();
    const r = rig(R);
    r.intro.start({ fresh: true });
    play(r, 'gather');
    const flags = r.flags.slice();
    const again = rig(R, { flags });
    again.intro.start({ fresh: false });
    eq(again.intro.current?.id, 'gather');
    eq(again.line(), R.beats[4].steps[0].hint);
    assert(!again.flags.includes('intro:older'), 'a begun island is not older');
  });

  test(G, 'skip works at beat 0 only and leaves every flag set', async () => {
    const R = await recipe();
    const r = rig(R);
    r.intro.start({ fresh: true });
    assert(r.intro.skip(), 'skipped');
    eq(r.log.skipped, 1, 'camp left ready');
    for (const b of R.beats) assert(r.flags.includes(`intro:${b.id}`), `flag ${b.id}`);
    for (const f of ['intro:skipped', 'intro:done', 'keeper:first']) assert(r.flags.includes(f), f);
    eq(r.line(), null, 'no hints follow');
    const late = rig(R);
    late.intro.start({ fresh: true });
    late.bus.emit('walk:arrived', { x: 1, z: 0 });
    assert(!late.intro.skip(), 'no skip after beat 0');
  });

  test(G, 'the short evening runs its beats with no hint lines', async () => {
    const R = await recipe();
    const r = rig(R, { mode: 'short' });
    const order = /** @type {string[]} */ ([]);
    r.bus.on('intro:beat-done', (/** @type {any} */ p) => order.push(p.id));
    r.intro.start({ fresh: true });
    play(r);
    eq(order.join(','), R.short.join(','));
    assert(r.log.hints.every((h) => h.text === null), 'no lines');
    assert(r.flags.includes('intro:done'));
  });

  test(G, 'an older island gets done and older, one notice, and one glow near the pad', async () => {
    const R = await recipe();
    const r = rig(R, { flags: ['frogs:seen'] });
    r.intro.start({ fresh: false });
    assert(r.flags.includes('intro:done') && r.flags.includes('intro:older'), 'flags');
    eq(r.log.notices.length, 1, 'one notice');
    eq(r.intro.current, null, 'no evening');
    r.W.x = 0; r.intro.update(0.1);
    eq(r.log.glows.length, 0, 'far from the pad');
    r.W.x = 10; r.intro.update(0.1); r.intro.update(0.1);
    eq(r.log.glows.join(','), 'tent', 'one glow within 12 m');
    const again = rig(R, { flags: r.flags.slice() });
    again.intro.start({ fresh: false });
    eq(again.log.notices.length, 0, 'the notice shows once');
  });

  test(G, 'gathering says what is still needed: twigs, then two handfuls of pebbles, then one more', async () => {
    const R = await recipe();
    const S = R.beats[4].steps;
    const r = rig(R, { flags: R.beats.slice(0, 4).map((/** @type {any} */ b) => `intro:${b.id}`).concat('intro:begun') });
    r.intro.start({ fresh: false });
    eq(r.line(), S[0].hint, 'twigs first');
    r.W.pack = { fuel: 1, stones: 0 }; r.bus.emit('pack:changed', {}); r.intro.update(0.1);
    eq(r.line(), S[1].hint, 'then pebbles');
    r.W.pack = { fuel: 1, stones: 1 }; r.intro.update(0.1);
    eq(r.line(), S[2].hint, 'then one more');
    r.W.pack = { fuel: 0, stones: 2 }; r.intro.update(0.1);
    eq(r.line(), S[0].hint, 'pebbles first, twigs still needed');
    r.W.pack = { fuel: 1, stones: 2 }; r.bus.emit('pack:changed', {});
    eq(r.intro.current?.id, 'ring');
  });

  test(G, 'the tent pitched before its beat came: the pitch beat is done as soon as it starts', async () => {
    const R = await recipe();
    const r = rig(R, { flags: ['intro:begun', 'intro:landfall', 'intro:spring', 'intro:page'] });
    r.W.camp.tent = true;
    r.intro.start({ fresh: false });
    r.intro.update(0.1);
    eq(r.intro.current?.id, 'gather');
  });

  test(G, 'the live off-pad check reads a stroke rect as terrain sends it, and a pour by its point', async () => {
    const { offPadOf } = await import('../src/world/intro/adapter.js');
    const pad = { x: 0.6, z: -33.3, r: 4, lockFadeM: 1 };
    assert(!offPadOf(pad, { x0: -1, z0: -35, x1: 2, z1: -32 }), 'a stroke inside the pad stays on it');
    assert(offPadOf(pad, { x0: -15.5, z0: -15.25, x1: -3.5, z1: 5.25 }), 'a stroke by the spring is off the pad');
    assert(offPadOf(pad, null, { x: -12, z: 1.4 }), 'a pour away from camp is off the pad');
    assert(!offPadOf(pad, null, { x: 1, z: -33 }), 'a pour on the pad is not');
  });

  test(G, 'dusk with the fire already lit: the sit line at once, the call sounds, and time at its own pace', async () => {
    const R = await recipe();
    const r = rig(R, { flags: before(R, 'dusk') });
    r.W.lit = true; r.W.sunsetInH = -0.5;
    r.intro.start({ fresh: false });
    eq(r.line(), beatOf(R, 'dusk').hint[1], 'straight to sitting');
    assert(r.log.emitted.includes('intro:curlew'), 'the dusk call');
    eq(r.log.flows.join(','), '1', 'time flows at 1x from dusk');
  });

  test(G, 'resting in the tent at dusk, before sitting by the fire, ends the evening (never stuck at night)', async () => {
    const r = rig(await recipe());
    r.intro.start({ fresh: true });
    play(r, 'dusk');
    eq(r.intro.current?.id, 'dusk', 'at the dusk beat');
    r.W.sunsetInH = -0.1; r.intro.update(0.1);
    r.bus.emit('camp:rested', {});
    assert(r.flags.includes('intro:dusk') && r.flags.includes('intro:rest') && r.flags.includes('intro:done'), 'dusk, rest and done');
    eq(r.intro.current, null, 'no beat left');
  });

  test(G, 'a tucked hint stays away until its next line', async () => {
    const R = await recipe();
    const r = rig(R, { flags: before(R, 'shape') });
    r.intro.start({ fresh: false });
    r.intro.tuck();
    eq(r.line(), null, 'tucked');
    r.W.below = false; r.bus.emit('walk:went-up', {});
    eq(r.line(), beatOf(R, 'shape').parts[1].hint, 'the next line shows');
  });

  test(G, 'the waking card: the keeper page the recipe names, in paragraphs, kept after the first page', async () => {
    const R = await recipe();
    const K = await json('../recipes/world/keeper-pages.json');
    const p = K.pages.find((/** @type {any} */ x) => x.id === R.wakePage);
    assert(p, `keeper-pages.json has the wake page "${R.wakePage}"`);
    eq(K.pages.indexOf(p), 1, 'it comes after the first page');
    const html = keeperCardHtml(p);
    eq((html.match(/<p>/g) ?? []).length, p.body.filter((/** @type {string} */ l) => !l.trim()).length + 1, 'one paragraph per block of lines');
    assert(html.includes(p.title) && !/undefined/.test(html), 'title, and clean');
    assert(/creatures will find it/.test(p.body.join(' ')), 'the creatures line (October 25, 2026)');
    const words = p.body.join(' ').split(/\s+/).filter(Boolean).length;
    assert(words < 60, `under 60 words (${words})`);
    // One page had: the entry names it; two: the entry leads to the list of them.
    assert(keeperEntry(K, ['keeper:first'], '').includes(K.words.entry), 'one page: its own name');
    const two = keeperEntry(K, ['keeper:first', `keeper:${p.id}`], '');
    assert(two.includes(K.words.title) && two.includes('data-keeper=""'), 'two pages: the list');
  });
}

/** A recipe file, in the browser or in Node. @param {string} rel */
async function json(rel) {
  const url = new URL(rel, import.meta.url);
  if (url.protocol === 'file:') { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(url, 'utf8')); }
  return (await fetch(url)).json();
}
