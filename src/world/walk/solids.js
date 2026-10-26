// @ts-check
// Solid things the walker cannot pass through (doc 23; Matt, October 26, 2026: he stood inside the
// workbench): camp pieces, logs and stones, and the like, each a circle or a turned rectangle on the
// ground. Steering tests each step against them exactly, grown by the walker's own half width
// (bodyM), so you slide along an edge; the walk grid closes the cells whose middles they cover, so
// click walks path round them and stop at their edge. Small things you walk over (twigs, pebbles,
// shells, low plants) are never solids. Pure: safe to import from tools pages and tests.

/**
 * A solid: a circle (r) or a rectangle (hw, hd half sizes along its own x and z, turned by yaw about
 * +y, as the walker's facing). World meters.
 * @typedef {{ x: number, z: number, r?: number, hw?: number, hd?: number, yaw?: number, id?: string }} Solid
 */

/**
 * How far a point is outside a solid (m; 0 or less inside it).
 * @param {Solid} s @param {number} x @param {number} z
 */
export function solidGap(s, x, z) {
  const dx = x - s.x, dz = z - s.z;
  if (s.r !== undefined) return Math.hypot(dx, dz) - s.r;
  const c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
  // Into the solid's own frame (its +z along its facing).
  const lx = c * dx - sn * dz, lz = sn * dx + c * dz;
  const ox = Math.abs(lx) - (s.hw ?? 0), oz = Math.abs(lz) - (s.hd ?? 0);
  return Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) + Math.min(Math.max(ox, oz), 0);
}

/** The half size of a square round a solid (for the cells it may touch). @param {Solid} s */
const reach = (s) => (s.r !== undefined ? s.r : Math.hypot(s.hw ?? 0, s.hd ?? 0));

/**
 * The solids now, and whether the walker's middle may stand at a point.
 * @param {number} bodyM the walker's half width
 */
export function createSolids(bodyM) {
  /** @type {Solid[]} */ let list = [];
  return {
    get list() { return list; },
    /** Replace them all. @param {Solid[]} next */
    set(next) { list = next.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.z)); },
    /** Would the walker standing here overlap a solid? @param {number} x @param {number} z */
    hit(x, z) {
      for (const s of list) if (Math.abs(x - s.x) < reach(s) + bodyM && Math.abs(z - s.z) < reach(s) + bodyM && solidGap(s, x, z) < bodyM) return true;
      return false;
    },
    /**
     * Close the walk grid's cells whose middles a solid covers, grown by the walker's half width.
     * @param {import('./grid.js').WalkGrid} grid
     */
    mark(grid) {
      grid.blocked.fill(0);
      for (const s of list) {
        const e = reach(s) + bodyM;
        const i0 = Math.max(0, Math.floor((s.x - e - grid.minX) / grid.cellM)), i1 = Math.min(grid.w - 1, Math.floor((s.x + e - grid.minX) / grid.cellM));
        const j0 = Math.max(0, Math.floor((s.z - e - grid.minZ) / grid.cellM)), j1 = Math.min(grid.h - 1, Math.floor((s.z + e - grid.minZ) / grid.cellM));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * grid.w + i, [cx, cz] = grid.center(k);
          if (solidGap(s, cx, cz) < bodyM) grid.blocked[k] = 1;
        }
      }
    },
  };
}

/** @typedef {ReturnType<typeof createSolids>} Solids */
