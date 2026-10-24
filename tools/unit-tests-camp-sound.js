// @ts-check
// The camp's sounds (recipes/audio/camp.json; src/audio/camp-loops.js): every one-shot and loop the
// recipe names has both files, and the fire's crackle and the rain on the canvas rise and fall as
// doc 17 asks (the canvas gone by 6 m from the tent, the crackle quieter as embers, both gone from
// high above). Pure: runs in workers and in Node.

import { fireLevel, canvasLevel } from '../src/audio/camp-loops.js';

const G = 'sound: camp';

/** A recipe, by fetch in the browser and from disk in Node. */
async function recipe(name = 'camp') {
  const url = new URL(`../recipes/audio/${name}.json`, import.meta.url);
  if (typeof window === 'undefined' && typeof self === 'undefined') {
    const fs = await import('node:fs');
    return JSON.parse(fs.readFileSync(url, 'utf8'));
  }
  return (await fetch(url, { cache: 'no-cache' })).json();
}

/** Whether a repository file exists. @param {string} path */
async function exists(path) {
  const url = new URL(`../${path}`, import.meta.url);
  if (typeof window === 'undefined' && typeof self === 'undefined') {
    const fs = await import('node:fs');
    return fs.existsSync(url);
  }
  return (await fetch(url, { method: 'HEAD', cache: 'no-cache' })).ok;
}

/** @param {any} s @returns {string[]} */
const filesOf = (s) => s.files ?? [s.file];

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert
 * @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addCampSoundTests(test, assert, eq) {
  test(G, 'the strike, catch, hiss and feed each have a level and their takes', async () => {
    const R = await recipe();
    for (const n of ['strike', 'catch', 'hiss', 'feed']) {
      const s = R.sounds[n];
      assert(s && typeof s.db === 'number' && s.db <= 0 && s.db >= -30, `${n} level`);
    }
    eq(filesOf(R.sounds.strike).length, 4, 'strike takes');
  });

  test(G, 'each one-shot and loop is there as .ogg and .m4a', async () => {
    const R = await recipe();
    const want = [];
    for (const s of Object.values(R.sounds)) for (const f of filesOf(s)) want.push(`${R.root}${f}`);
    want.push(`${R.loops.root}${R.loops.fire.file}`);
    for (const f of R.loops.canvas.files) want.push(`${R.loops.root}${f}`);
    const missing = [];
    for (const f of want) for (const ext of ['ogg', 'm4a']) if (!(await exists(`${f}.${ext}`))) missing.push(`${f}.${ext}`);
    assert(missing.length === 0, `missing ${missing.join(', ')}`);
  });

  test(G, 'gathering: every pack group has a sound, and every take is there', async () => {
    const R = await recipe('gather');
    for (const g of ['fuel', 'stones', 'fibres', 'herbs', 'living', 'earth', 'sea']) assert(R.sounds[R.groups[g]], `group ${g} has no sound`);
    const missing = [];
    for (const s of Object.values(R.sounds)) {
      assert(typeof s.db === 'number' && s.db <= 0 && s.db >= -30, 'level');
      for (const f of filesOf(s)) for (const ext of ['ogg', 'm4a']) if (!(await exists(`${R.root}${f}.${ext}`))) missing.push(`${f}.${ext}`);
    }
    assert(missing.length === 0, `missing ${missing.join(', ')}`);
  });

  test(G, 'the crackle: full flame loudest, embers quieter, none cold, gone from far above', async () => {
    const F = (await recipe()).loops.fire;
    const lit = fireLevel({ fire: 'lit', level: 1, rainy: false }, 1, F);
    const low = fireLevel({ fire: 'lit', level: 0, rainy: false }, 1, F);
    const emb = fireLevel({ fire: 'embers', level: 0, rainy: false }, 1, F);
    const wet = fireLevel({ fire: 'lit', level: 1, rainy: true }, 1, F);
    assert(lit > low && low > emb && emb > 0, `lit ${lit} low ${low} embers ${emb}`);
    assert(wet < lit, 'rain keeps it low');
    eq(fireLevel({ fire: 'cold', level: 0, rainy: false }, 1, F), 0, 'cold');
    eq(fireLevel({ fire: 'lit', level: 1, rainy: false }, F.reachM + 1, F), 0, 'past reach');
    assert(fireLevel({ fire: 'lit', level: 1, rainy: false }, 6, F) < lit, 'falls with distance');
  });

  test(G, 'the canvas: only in rain, full by the tent, gone by 6 m and from high above', async () => {
    const C = (await recipe()).loops.canvas;
    eq(C.reachM, 6, 'doc 17: within 6 m');
    eq(canvasLevel(0, 1, 2, C), 0, 'dry');
    eq(canvasLevel(1, 1, 2, C), 1, 'heavy rain at the tent');
    eq(canvasLevel(1, 6.5, 8, C), 0, 'past 6 m');
    eq(canvasLevel(1, 1, C.eyeReachM + 1, C), 0, 'from above');
    const mid = canvasLevel(1, 4.5, 6, C);
    assert(mid > 0 && mid < 1, `between ${mid}`);
  });
}
