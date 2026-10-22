// @ts-check
// Camp tests (E3, docs/future/13 sections 3.4 to 3.6): the fire worked out from the clock (laid,
// lit, embers, cold, the ash), lighting and feeding and banking, the camp section's cleaner and
// pitch and lay, the blackbody colours of the small lights, and the camp's standing presence while
// away (CP-13): a Tolerant frog near the camp gains a little trust once a game day in catch-up only,
// and the same hours give the same frogs twice.

import { noFire, cleanFire, fireAt, layFire, lightFire, feedFire, bankFire, settleFire } from '../src/world/camp/fire.js';
import { cleanCamp, pitchTent, layRing, pitched, ringLaid } from '../src/world/camp/model.js';
import { kelvinRgb } from '../src/world/camp/light.js';
import { applyTrust } from '../src/world/creatures/trust.js';
import { steelMesh, flintMesh } from '../src/world/camp/steel-mesh.js';

const G = 'camp: tent and fire';
const F = { flameH: 3, emberH: 24, ashFadeH: 24 };

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addCampFireTests(test, assert, eq) {
  test(G, 'a laid fire lights, burns its flame hours, sinks to embers, then goes cold and its ash fades', () => {
    const laid = layFire(noFire(), 10);
    eq(fireAt(laid, 50, F).word, 'laid', 'laid stays laid');
    const lit = /** @type {any} */ (lightFire(laid, 18, F));
    assert(lit, 'it lights');
    eq(fireAt(lit, 18.5, F).word, 'lit', 'burning');
    eq(fireAt(lit, 20.999, F).word, 'lit', 'still burning before flameH');
    eq(fireAt(lit, 21, F).word, 'embers', 'embers after flameH');
    eq(fireAt(lit, 44.99, F).word, 'embers', 'embers for emberH');
    const cold = fireAt(lit, 45, F);
    eq(cold.word, 'cold', 'cold after');
    eq(cold.ash, 1, 'ash just gone cold');
    assert(Math.abs(fireAt(lit, 57, F).ash - 0.5) < 1e-9, 'ash half faded');
    eq(fireAt(lit, 80, F).ash, 0, 'ash gone');
  });

  test(G, 'lighting needs a laid or cold ring; feeding wakes embers or adds flame; banking keeps embers a day', () => {
    eq(lightFire(noFire(), 1, F), null, 'no ring, no fire');
    const lit = /** @type {any} */ (lightFire(layFire(noFire(), 0), 18, F));
    eq(lightFire(lit, 19, F), null, 'a burning fire is not lit again');
    const more = /** @type {any} */ (feedFire(lit, 19, F));
    eq(fireAt(more, 23.5, F).word, 'lit', 'fed: three more hours');
    const banked = bankFire(lit, 19, F);
    eq(fireAt(banked, 19.1, F).word, 'embers', 'banked at once');
    eq(fireAt(banked, 42.9, F).word, 'embers', 'within a day: embers');
    eq(fireAt(banked, 43.1, F).word, 'cold', 'after a day: cold');
    const woken = /** @type {any} */ (feedFire(banked, 30, F));
    eq(fireAt(woken, 31, F).word, 'lit', 'Feed the fire brings the flame back with no steel');
    eq(woken.lightings, 1, 'feeding is not a lighting');
    eq(feedFire(banked, 50, F), null, 'a cold ring cannot be fed');
    const relit = /** @type {any} */ (lightFire(banked, 50, F));
    eq(relit.lightings, 2, 'a cold ring lights again with the steel');
  });

  test(G, 'litDays counts the days lit; settling writes the clock in without changing the answers', () => {
    let f = /** @type {any} */ (lightFire(layFire(noFire(), 0), 18, F));
    f = feedFire(f, 20, F);
    eq(f.litDays, 1, 'same day');
    f = /** @type {any} */ (lightFire(f, 24 * 3 + 18, F));
    eq(f.litDays, 2, 'another day');
    for (const h of [80, 90, 100, 130]) {
      const s = settleFire(f, h, F);
      for (const k of [h, h + 5, h + 30]) eq(fireAt(s, k, F).word, fireAt(f, k, F).word, `settled at ${h}, read at ${k}`);
    }
    eq(cleanFire({ state: 'burning' }).state, 'none', 'an unknown state is no fire');
    eq(JSON.stringify(cleanFire(JSON.parse(JSON.stringify(f)))), JSON.stringify(f), 'a fire comes back exactly');
  });

  test(G, 'the camp section: an older or new camp starts with the tent in the pack; pitch and lay fill their slots once', () => {
    const c0 = cleanCamp({ version: 1, stamped: true, pad: { x: 1, z: 2 } });
    eq(c0.kit.tent, 'pack', 'tent in the pack');
    eq(c0.pad.x, 1, "E1's pad kept");
    assert(!pitched(c0) && !ringLaid(c0), 'nothing set up');
    const c1 = pitchTent(c0, 5, 7);
    assert(pitched(c1), 'pitched');
    eq(pitchTent(c1, 6, 7), c1, 'pitching twice changes nothing');
    const c2 = layRing(c1, 7, 9);
    assert(ringLaid(c2), 'laid');
    eq(c2.fire.state, 'laid', 'the fire is laid, cold');
    const back = cleanCamp(JSON.parse(JSON.stringify(c2)));
    eq(JSON.stringify(back), JSON.stringify(cleanCamp(c2)), 'saved and loaded, the same');
    eq(back.kit.lantern, 'pole', 'only the pole is saved for the lantern');
  });

  test(G, 'the fire and lantern colours: warm blackbodies of luminance 1', () => {
    for (const k of [1400, 1800, 2200, 6500]) {
      const c = kelvinRgb(k);
      assert(Math.abs(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] - 1) < 1e-9, `${k} K luminance 1`);
    }
    const fire = kelvinRgb(1800), lamp = kelvinRgb(2200), day = kelvinRgb(6500);
    assert(fire[0] > fire[1] && fire[1] > fire[2], 'firelight is red over green over blue');
    assert(lamp[2] / lamp[0] > fire[2] / fire[0], 'the lantern is a little less red than the fire');
    assert(Math.abs(day[0] - day[2]) < 0.15, '6500 K is near white');
  });

  test(G, 'standing presence (CP-13): a camp trust event adds its gain, kept under the ceiling', () => {
    const P = { bands: [0.15, 0.4, 0.65, 0.85], ceiling: 'bonded', watch: { capS: 60, trustPerMin: 0.01 }, feedTrust: 0.06 };
    const fr = { frogs: [{ id: 1, x: 0, z: 0, trust: 0.2 }], pending: [{ kind: /** @type {const} */ ('camp'), id: 1, hour: 24, gain: 0.01 }] };
    applyTrust(fr, P);
    eq(fr.frogs[0].trust, 0.21, 'a little more');
    eq(fr.pending.length, 0, 'applied');
  });

  test(G, 'the fire steel and flint are small, closed, finite meshes', () => {
    for (const [name, m, most] of /** @type {const} */ ([['steel', steelMesh(), 0.04], ['flint', flintMesh(), 0.03]])) {
      assert(m.data.length % 8 === 0 && m.indices.length % 3 === 0, `${name} layout`);
      let far = 0;
      for (let i = 0; i < m.data.length; i += 8) {
        for (let k = 0; k < 8; k++) assert(Number.isFinite(m.data[i + k]), `${name} finite`);
        far = Math.max(far, Math.hypot(m.data[i], m.data[i + 1], m.data[i + 2]));
      }
      assert(far <= most, `${name} fits the hand (${far.toFixed(3)} m)`);
      for (const ix of m.indices) assert(ix < m.data.length / 8, `${name} index in range`);
    }
  });
}
