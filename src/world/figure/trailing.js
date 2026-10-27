// @ts-check
// What trails the walker a beat late on springs (doc 23, W5; split from motion.js): the hat tip,
// the coat skirt and the pack. Live animation only.

import { qmul, qaxis, DEG, Spring } from './kinematics.js';

/**
 * @param {any} R recipes/world/figure.json
 * @param {Record<string, number>} I bone indices by name
 * @param {(i: number, mv: import('../creatures/pose.js').BoneMove | null) => void} set
 */
export function createTrailing(R, I, set) {
  const springs = { tip: new Spring(2, R.springs.hatTip), skirt: new Spring(2, R.springs.skirt), pack: new Spring(1, R.springs.pack) };
  return {
    /**
     * The hat tip lags: it tips back as you speed up, dips as the body rises, and swings out on a turn.
     * @param {number} dt @param {{ speed: number, accel: number, pelvisVy: number, yawRate: number }} f
     */
    hatTip(dt, { speed, accel, pelvisVy, yawRate }) {
      const HT = R.springs.hatTip;
      const tip = springs.tip.step([(-0.05 * speed - (HT.accelGain ?? 0.03) * accel + 0.5 * pelvisVy) * HT.gain, -0.08 * yawRate * HT.gain], dt);
      set(I.hatTip, { q: qmul(qaxis([1, 0, 0], tip[0]), qaxis([0, 0, 1], tip[1])) });
    },
    /**
     * The coat skirt: pushed forward by the front knee, flaring back with speed, swaying to the side
     * of the leg that is forward with each step, swung on a turn; over the thighs when sitting. Then
     * the pack: it follows the body's rise and fall a beat late, tipping as it lags, and rocks with
     * the hips' twist.
     * @param {number} dt
     * The baked pack is folded away to nothing while another carrier is worn (packShown false, P2f);
     * the bone still moves, for the carrier hung on it.
     * @param {{ legIK: { knee: number[] }[], m: number, standW: number, sitW: number, kneelW: number, crawlW: number,
     *   speed: number, yawRate: number, sitSkirtDeg: number, pelvisWorldY: number, accel: number, twist: number, packShown?: boolean }} f
     */
    skirtAndPack(dt, { legIK, m, standW, sitW, kneelW, crawlW, speed, yawRate, sitSkirtDeg, pelvisWorldY, accel, twist, packShown = true }) {
      const SK = R.springs.skirt;
      const kneeFwd = Math.max(legIK[0].knee[2], legIK[1].knee[2]) - 0.04;
      const sway = (legIK[0].knee[2] - legIK[1].knee[2]) * (SK.strideSway ?? 0) * m * standW;
      const sk = springs.skirt.step([
        ((Math.max(0, kneeFwd) * 1.4 - (SK.speedFlare ?? 0.03) * speed) * standW + sitSkirtDeg * DEG * sitW + 0.25 * kneelW + 0.3 * crawlW) * SK.gain,
        (-0.05 * yawRate + sway) * SK.gain,
      ], dt);
      set(I.skirt, { q: qmul(qaxis([1, 0, 0], -sk[0]), qaxis([0, 0, 1], sk[1])) });
      const PK = R.springs.pack;
      const pk = springs.pack.step([pelvisWorldY], dt)[0], lag = pk - pelvisWorldY;
      set(I.pack, { t: [0, lag * PK.gain, 0], q: qmul(qaxis([1, 0, 0], -0.01 * accel + lag * (PK.tiltGain ?? 0)), qaxis([0, 0, 1], twist * (PK.rock ?? 0))),
        ...(packShown ? {} : { s: [1e-4, 1e-4, 1e-4] }) });
    },
  };
}
