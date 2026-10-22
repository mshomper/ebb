// @ts-check
// Evening director tests (docs/future/13 section 2): with stand-ins for the walker, the camp and the
// pack, the director runs the beats in order, shows one hint at a time and never again after its beat,
// waits for sunset before dusk, plays the drink act before the page, resumes on the first beat
// without its flag, skips only at beat 0, runs the short evening without hints, and turns an older
// island's save into intro:done and intro:older with one notice and one glow.

import { createIntro } from '../src/world/intro/index.js';
import { createBus } from '../src/core/events.js';

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
  const W = { x: 0, z: 0, posture: 'stand', below: true, journal: false, pack: { fuel: 0, stones: 0 }, lit: false, sunsetInH: 10 };
  /** @type {{ hints: any[], acts: string[], pages: string[], notices: string[], glows: string[], emitted: string[], skipped: number }} */
  const log = { hints: [], acts: [], pages: [], notices: [], glows: [], emitted: [], skipped: 0 };
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
      offPad: (rect, at) => (rect ? rect.maxX < 16 : !!at && at.x < 16), ring: () => ring, fireLit: () => W.lit,
      sunsetInH: () => W.sunsetInH, pad: () => pad,
    },
    effects: {
      act: (n) => log.acts.push(n), openPage: (id) => { log.pages.push(id); W.journal = true; },
      skipCamp: () => { log.skipped++; }, notice: (t) => log.notices.push(t), glow: (sl) => log.glows.push(sl),
    },
  });
  const line = () => log.hints[log.hints.length - 1]?.text ?? null;
  return { bus, flags, W, log, intro, line, spring, ring };
}

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
    shape: () => { bus.emit('walk:went-up', {}); bus.emit('terrain:stroke-ended', { rect: { minX: 4, minZ: 0, maxX: 8, maxZ: 4 } }); },
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
    eq(r.line(), 'Click the sand to walk there.');
    eq(r.log.hints[0].skip, 'Skip the first evening', 'skip offered at beat 0');
    const order = /** @type {string[]} */ ([]);
    r.bus.on('intro:beat-done', (/** @type {any} */ p) => order.push(p.id));
    play(r);
    eq(order.join(','), 'landfall,spring,page,pitch,gather,ring,shape,dusk,rest');
    assert(r.flags.includes('intro:done') && r.flags.includes('intro:begun'), 'done and begun flags');
    assert(!r.flags.includes('intro:skipped'), 'not skipped');
    eq(r.line(), null, 'no hint after the evening');
    eq(r.log.acts.join(','), 'drink', 'the drink act played');
    eq(r.log.pages.join(','), 'first', 'the first page opened');
    assert(r.log.emitted.includes('intro:curlew'), 'the curlew called when the fire was lit');
    return `${order.length} beats`;
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
    const ids = r.log.hints.map((h) => h.id?.split(':')[0]).filter(Boolean);
    const runs = ids.filter((id, i) => id !== ids[i - 1]);
    eq(new Set(runs).size, runs.length, 'no beat shows again after another');
  });

  test(G, 'shape: the second line waits for going up, and a stroke on the pad does not count', async () => {
    const R = await recipe();
    const r = rig(R, { flags: ['intro:begun', 'intro:landfall', 'intro:spring', 'intro:page', 'intro:pitch', 'intro:gather', 'intro:ring'] });
    r.intro.start({ fresh: false });
    eq(r.line(), R.beats[6].hint[0]);
    r.bus.emit('walk:went-up', {});
    eq(r.line(), R.beats[6].hint[1]);
    r.bus.emit('terrain:stroke-ended', { rect: { minX: 18, minZ: 0, maxX: 22, maxZ: 2 } });
    eq(r.intro.current?.id, 'shape', 'on the pad');
    r.bus.emit('water:pour-ended', { x: 5, z: 2 });
    eq(r.intro.current?.id, 'dusk', 'a pour off the pad');
    eq(r.line(), R.beats[6].later, 'early: the time button line shows while dusk waits');
    r.W.sunsetInH = -0.2; r.intro.update(0.1);
    eq(r.line(), R.beats[7].hint[0], 'after sunset the dusk line');
  });

  test(G, 'dusk needs the fire lit, then 20 s sitting within reach', async () => {
    const R = await recipe();
    const r = rig(R, { flags: R.beats.slice(0, 7).map((/** @type {any} */ b) => `intro:${b.id}`).concat('intro:begun') });
    r.W.sunsetInH = -1;
    r.intro.start({ fresh: false });
    r.W.x = 20.5; r.W.posture = 'sit';
    for (let i = 0; i < 300; i++) r.intro.update(0.1);
    eq(r.intro.current?.id, 'dusk', 'unlit: sitting does nothing');
    r.W.lit = true; r.bus.emit('camp:lit', {});
    eq(r.line(), R.beats[7].hint[1], 'the sit line');
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
    eq(again.line(), R.beats[4].hint[0]);
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

  test(G, 'a tucked hint stays away until its next line', async () => {
    const R = await recipe();
    const r = rig(R, { flags: R.beats.slice(0, 6).map((/** @type {any} */ b) => `intro:${b.id}`).concat('intro:begun') });
    r.intro.start({ fresh: false });
    r.intro.tuck();
    eq(r.line(), null, 'tucked');
    r.bus.emit('walk:went-up', {});
    eq(r.line(), R.beats[6].hint[1], 'the next line shows');
  });
}
