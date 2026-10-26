// @ts-check
// The camp, drawn each frame (docs/future/13 sections 3.5 and E3): the tent and the lantern on its
// pole (or in your hand off the pad at night), the ring and its wood by the fire's state, the
// fire's and the lantern's lights, the flame, smoke, embers, sparks and moths (camp-fx.js), and the
// store slice `campSound` for the camp's held sounds (src/audio/camp-loops.js). Live only.

import { emit } from '../../core/events.js';
import { update } from '../../core/store.js';
import { onPad } from './layout.js';
import { pitched, ringLaid, inSlot } from './model.js';
import { fireAt } from './fire.js';
import { kelvinRgb, flicker } from './light.js';
import { starLogs, logPlace } from './star.js';
import { potOnHearth, pieceOf } from './pots.js';

const DEG = Math.PI / 180;

/**
 * @param {import('./cards.js').CampKit & { o: any, props: any, fx: any, sunAlt: () => number }} k
 *   o: createCamp's options (lighting, world); props, fx: the camp's draw passes
 */
export function createCampFrame(k) {
  const R = k.R, F = R.fire, o = k.o;
  const fireRgb = kelvinRgb(F.lightK), emberRgb = kelvinRgb(F.emberLightK), lanternRgb = kelvinRgb(R.lantern.lightK);
  /** @type {'pole' | 'carried'} */ let lantern = 'pole';
  let wasRainy = false, strikeT = -1, strikes = 0, strikeLen = 0, strikeAt = 0, flareT = 0, campSoundKey = '';
  /** The star's logs left out (tools/camp-bench.html: what the star costs to draw). */
  let starHidden = false;
  /** Another rule for laying the star (tools/hearth-check.html: the logs as they lay before). @type {typeof starLogs | null} */
  let starRule = null;
  /** The tea pot steeping after Brew (P2e): its steam thickens. */
  let steeping = false;

  /**
   * The camp drawn now, from the camp state and the fire now.
   * @param {number} dt real seconds @param {number} time real seconds (animation time)
   * @param {import('./model.js').Camp} c @param {ReturnType<typeof fireAt>} fireNow
   */
  function draw(dt, time, c, fireNow) {
    const pad = k.where.padNow(), word = fireNow.word;
    /** @type {import('../../render/passes/props.js').Prop[]} */ const list = [];
    /** @type {import('../../render/lighting.js').PointLight[]} */ const lights = [];
    const w = /** @type {any} */ (k.weatherNow());
    const rainy = w.rain > F.rainLow;
    const dark = k.sunAlt() < R.lantern.lightsAtSunDeg * DEG;
    const t = k.where.slotAt('tent'), r = k.where.slotAt('ring');
    let lanternGlass = /** @type {number[] | null} */ (null);
    if (t && pitched(c)) {
      const sh = R.props.models.tent.shade;
      list.push({ key: 'tent', x: t.x, y: t.y, z: t.z, yaw: t.yaw, shade: sh });
      // The lantern: on the front pole, or in your hand off the pad at night.
      const you = k.walk.below ? k.walk.you() : null;
      lantern = dark && you && pad && !onPad(pad, you[0], you[2]) ? 'carried' : 'pole';
      const hand = lantern === 'carried' ? k.walk.hand('l') : null;
      const at = hand ? [hand.x, hand.y - R.lantern.carryDropM, hand.z] : k.where.tentPoint(R.lantern.hangM);
      const yaw = hand ? hand.yaw : t.yaw;
      list.push({ key: 'lantern', x: at[0], y: at[1], z: at[2], yaw });
      // On the pole it hangs from its cord; carried, the cord goes with it.
      if (!hand) list.push({ key: 'hook', x: t.x, y: t.y, z: t.z, yaw: t.yaw });
      if (dark) {
        lanternGlass = [at[0], at[1] + 0.15, at[2]];
        const L = R.lantern;
        lights.push({ x: lanternGlass[0], y: lanternGlass[1], z: lanternGlass[2], rangeM: L.rangeM, cd: L.cd * flicker(time, L.flicker, L.flickerHz, 2), rgb: lanternRgb });
      }
    }
    let flame = 0, smoke = 0, embers = 0;
    flareT = Math.max(0, flareT - dt);
    if (r && ringLaid(c)) {
      list.push({ key: 'ring', x: r.x, y: r.y, z: r.z, yaw: r.yaw, shade: R.props.models.ring.shade });
      embers = word === 'embers' ? 1 : word === 'lit' ? (rainy ? 1 : 0.6) : 0;
      // The star fire (S4, star.js): logs radiating, their burnt ends meeting in the middle; the
      // ones lined up with a hearth stone stop at it. A cold ring keeps its burnt logs.
      const S = R.star, halfX = S.logLenM / 2, cy = Math.cos(r.yaw), sy = Math.sin(r.yaw);
      for (const g of starHidden ? [] : (starRule ?? starLogs)(fireNow, c.fire, k.hourNow(), F, S, { seed: inSlot(c, 'ring')?.seed ?? 1, hearth: !!inSlot(c, 'hearth'), rainy })) {
        const p = logPlace(g, halfX);
        list.push({ key: 'log', x: r.x + cy * p.x + sy * p.z, y: r.y + p.y, z: r.z - sy * p.x + cy * p.z, yaw: r.yaw + p.yaw, roll: g.roll,
          scale: g.size, stretch: g.stretch, endChar: g.endChar, halfX, char: g.endChar > 0 ? 1 : 0, glow: g.glow });
      }
      if (word === 'lit') {
        // High while the ring holds plenty, sinking toward low flames as the fuel burns down (F9);
        // a handful fed lifts it at once, flaring for a moment.
        const flare = 1 + (F.flare - 1) * Math.max(0, flareT / F.flareS);
        flame = (rainy ? F.rainFlame : 1) * (F.lowFlame + (1 - F.lowFlame) * fireNow.level) * flare;
        smoke = (rainy ? R.smoke.rainThick : 1) * (0.5 + 0.5 * fireNow.level);
        lights.push({ x: r.x, y: r.y + F.heightM, z: r.z, rangeM: F.rangeM, cd: F.cd * flame * flicker(time, F.flicker, F.flickerHz, 1), rgb: fireRgb });
      } else if (word === 'embers') {
        smoke = R.smoke.embersShare * (rainy ? R.smoke.rainThick : 1);
        lights.push({ x: r.x, y: r.y + 0.3, z: r.z, rangeM: F.rangeM * 0.5, cd: F.emberCd * flicker(time, 0.2, 0.4, 3), rgb: emberRgb });
      }
    }
    // Rain on a burning fire: a hiss as it drops low (once as the rain sets in).
    if (word === 'lit' && rainy && !wasRainy) emit('camp:sound', { name: 'hiss' });
    wasRainy = word === 'lit' && rainy;
    // For the camp's held sounds (src/audio/camp-loops.js): where the ring and tent are, the fire now.
    const heard = {
      ring: r && ringLaid(c) ? [r.x, r.y + 0.1, r.z] : null, tent: t && pitched(c) ? [t.x, t.y + 0.8, t.z] : null,
      fire: word, level: Math.round(fireNow.level * 20) / 20, rainy,
    };
    const heardKey = JSON.stringify(heard);
    if (heardKey !== campSoundKey) { campSoundKey = heardKey; update('campSound', () => heard); }
    // The steel and flint in your hands while you strike.
    if (k.player.act() === 'strike') {
      const hr = k.walk.hand('r'), hl = k.walk.hand('l');
      if (hr) list.push({ key: 'steel', x: hr.x, y: hr.y - 0.02, z: hr.z, yaw: hr.yaw + 1.2 });
      if (hl) list.push({ key: 'flint', x: hl.x, y: hl.y - 0.01, z: hl.z, yaw: hl.yaw });
    }
    k.props.setProps([...list, ...extra.flatMap((f) => f())]);
    o.lighting.setPoints(lights);
    // The fire steel's sparks, at each strike in the act.
    let sparks = null;
    if (strikeT >= 0 && r) {
      strikeT += dt;
      const share = strikeT / Math.max(0.1, strikeLen), at = R.steel.strikesAt;
      while (strikes < at.length && share >= at[strikes]) { strikes++; strikeAt = strikeT; emit('camp:sound', { name: 'strike' }); }
      const hand = k.walk.hand('r');
      if (strikes > 0 && hand) sparks = [hand.x, hand.y, hand.z, (strikeT - strikeAt) + 10 * (strikes - 1)];
    }
    const wind = w.wind * R.smoke.lean, dir = o.world.state?.weather?.today?.windDir ?? 0;
    k.fx.set(r && (flame > 0 || smoke > 0 || lanternGlass || sparks) ? {
      fire: [r.x, r.y + 0.04, r.z], flame, smoke, embers: word === 'embers' ? 1 : 0,
      wind: [Math.cos(dir) * wind, -Math.sin(dir) * wind], mist: w.mist, steam: steamNow(c, word, r),
      lantern: lanternGlass, sparks, moths: k.sunAlt() < R.moths.atSunDeg * DEG, time,
    } : null);
  }

  /**
   * A pot's steam on the hearth (P2e): a simmer while it holds water over a lit fire, thicker while
   * the tea steeps; null when the fire is not lit or the pot is dry or in your arms.
   * @param {import('./model.js').Camp} c @param {string} word @param {any} r the ring's slot
   */
  function steamNow(c, word, r) {
    const ST = R.steam, pot = potOnHearth(c);
    if (!ST || !r || word !== 'lit' || !pot || !inSlot(c, 'hearth') || k.holdingPot?.()) return null;
    const wet = !!pieceOf(c, pot)?.water;
    const amount = steeping ? ST.steep : wet ? ST.simmer : 0;
    return amount > 0 ? [r.x, r.y + R.hearth.stonesTopM + ST.topM, r.z, amount] : null;
  }

  /** Other camp things drawn with the camp's models (the stations' benches): each gives its props now. @type {(() => import('../../render/passes/props.js').Prop[])[]} */
  const extra = [];

  return {
    draw,
    /** Nothing drawn, lit or heard (the bench's "camp off" half). */
    hide() {
      k.props.setProps([]); k.fx.set(null); o.lighting.setPoints([]);
      if (campSoundKey !== 'hidden') { campSoundKey = 'hidden'; update('campSound', () => ({ ring: null, tent: null, fire: 'none', level: 0, rainy: false })); }
    },
    /** The lantern: on its pole or carried (live only). */
    lantern: () => lantern,
    /** The tea pot steeping, or done (P2e). @param {boolean} on */
    steep(on) { steeping = on; },
    /** A handful fed: the flames lift at once (live only). */
    flare() { flareT = F.flareS; },
    /** The strike act began: its sparks follow its strikes. @param {number} len the act's length (s) */
    strikeBegin(len) { strikeT = 0; strikes = 0; strikeLen = len; },
    strikeEnd() { strikeT = -1; },
    /** Draw more camp things with the camp's models each frame. @param {() => import('../../render/passes/props.js').Prop[]} f */
    addProps(f) { extra.push(f); },
    /** Leave the star's logs out, or draw them again (the bench). @param {boolean} on */
    hideStar(on) { starHidden = on; },
    /** Lay the star by another rule, or by star.js again (null; the hearth check). @param {typeof starLogs | null} f */
    starAs(f) { starRule = f; },
  };
}
