// @ts-check
// Life under a log, live (docs/future/11 L3a): while a lifted log or stone is up (src/world/pieces/
// lift.js), what lived under it shows on the damp ground it lay on, drawn 2.5 to 3 times real size.
// Each one freezes for a beat, then scuttles for the dark under the rolled-back log, legs stepping
// (leg-rig.js) along the way (under-log-motion.js); the beetle dashes out into the grass first, then
// turns back. As the log settles they are under it again and gone from sight. Never saved: the
// same lift on the same day plays the same way. A tap on one while it shows finds it (its card opens
// its page), through the finds module's sources.

import { packMesh } from '../creatures/bodies.js';
import { createCreaturePass } from '../../render/passes/creatures.js';
import { legRig, legBones } from './leg-rig.js';
import { underLogMeshes } from './under-log-meshes.js';
import { scuttle } from './under-log-motion.js';
import { UNDER_PAGES } from './under-log.js';

/**
 * @param {{ lift: import('../pieces/lift.js').Lift, terrain: { sampleHeight: (x: number, z: number) => number }, recipe: any }} o
 *   recipe: recipes/species/under-log.json
 */
export function createUnderLogLive(o) {
  const R = o.recipe;
  const pass = createCreaturePass({ recipe: { body: { wetSpecular: R.look.wetSpecular, contactShadow: R.look.contactShadow, scaleReal: [0.02, 0.02] } },
    name: 'under-log', maxBones: 20 });
  /** Each kind's leg rig. @type {Record<string, import('./leg-rig.js').LegRig>} */ const rigs = {};
  for (const [sp, mesh] of Object.entries(underLogMeshes(R))) {
    const rig = legRig(mesh, { bands: R[sp].legs.bands });
    rigs[sp] = rig;
    pass.setMesh(sp, { data: packMesh(mesh, rig.joints, rig.weights), indices: mesh.indices });
  }
  /** Each kind's run, scaled to the size it is drawn at. @type {Record<string, any>} */ const runs = {};
  for (const sp of Object.keys(rigs)) {
    const S = R[sp].scuttle, k = R[sp].scale;
    runs[sp] = { ...S, speedMps: S.speedMps * k, wanderM: S.wanderM * k, wanderEveryM: S.wanderEveryM * k, outM: (S.outM ?? 0) * k };
  }
  /** Bone matrices per find, reused frame to frame. @type {Map<string, Float32Array>} */ const poses = new Map();
  /** What shows now, for taps. @type {{ sp: string, x: number, z: number, item: null, reach: number }[]} */ let shown = [];

  return {
    id: 'under-log',
    pass,
    /** Each frame: where each uncovered one has run to, and its legs. */
    tick() {
      /** @type {import('../../render/passes/creatures.js').Being[]} */ const beings = [];
      /** @type {typeof shown} */ const taps = [];
      const live = new Set();
      for (const a of o.lift.active()) {
        // Shown while the piece is well up; as it settles they are under it again.
        if (a.now.up < R.look.showFromUp) continue;
        // Cover is the dark under the rolled-back log: away from where you knelt, past its middle.
        const ax = a.piece.x - a.from[0], az = a.piece.z - a.from[1], al = Math.hypot(ax, az) || 1;
        const reach = (a.piece.kind === 'log' ? a.piece.size : a.piece.size * 0.7) * R.look.coverShare;
        for (const f of a.found) {
          const rig = rigs[f.sp];
          if (!rig) continue;
          const e = { x: f.at[0], z: f.at[1], yaw: f.yaw, r: f.r, tx: f.at[0] + (ax / al) * reach, tz: f.at[1] + (az / al) * reach };
          const m = scuttle(e, a.now.e, runs[f.sp]);
          const L = R[f.sp].legs;
          const g = m.running ? L : { ...L, liftDeg: L.liftDeg * L.idleShare, sweepDeg: L.sweepDeg * L.idleShare };
          const bones = legBones(rig, m.step, g, poses.get(f.key));
          poses.set(f.key, bones);
          live.add(f.key);
          const size = R[f.sp].scale * (0.9 + 0.2 * f.r);
          beings.push({ x: m.x, y: o.terrain.sampleHeight(m.x, m.z) - 0.001, z: m.z, yaw: m.yaw, size, mesh: f.sp, bones });
          taps.push({ sp: UNDER_PAGES[/** @type {'woodlice' | 'beetle'} */ (f.sp)], x: m.x, z: m.z, item: null, reach: R.look.tapM });
        }
      }
      for (const k of poses.keys()) if (!live.has(k)) poses.delete(k);
      shown = taps;
      pass.setBeings(beings);
    },
    /** What a tap may land on now (the finds module's sources). */
    shown: () => shown,
  };
}
