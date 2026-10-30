// @ts-check
// The island's past, live (docs/future/13 10.6.4, 10.7.7; B1 D1): the old hearths and the marked
// stone where the seed put them (story.js), moved when the ground there can no longer be dug,
// worked out again whenever the habitat or the camp pad changes. The marked stone is drawn in the
// pieces pass (not a saved piece: it comes from the seed, cannot be carried and is not one of the
// loose stones), with the hearths' sunken ring stones; it keeps holes off itself (a footprint) and
// has a card. Read by the dig module (src/world/dig/index.js).

import { get } from '../../core/store.js';
import { packMesh } from '../creatures/bodies.js';
import { groundClass } from './layers.js';
import { storySpots, liveSpot, storyAt, storyHome } from './story.js';
import { markedStone, ringBeings } from './story-draw.js';

/**
 * @param {{ R: any, land: any, terrainSeed: number, worldSeed: number, piecesRecipe: any, pieces: any,
 *   hab: () => any, ground: (x: number, z: number) => number }} o R: recipes/world/dig.json
 */
export function createStoryLive(o) {
  const R = o.R, S = R.story;
  const seeded = storySpots(o.land, o.terrainSeed, o.worldSeed, S);
  const home = storyHome(o.land);
  // The marked stone's mesh, baked once, and the loose stones' meshes (the ring) already in the pass.
  const stone = markedStone(o.piecesRecipe, S);
  o.pieces.pass.setMesh('marked-stone', { data: packMesh(stone.mesh), indices: stone.mesh.indices });
  const shapes = o.piecesRecipe.shape.count;

  /** @type {{ h: any, key: string, spots: import('./story.js').StorySpots } | null} */ let live = null;
  /** The story spots now (moved off ground that can no longer be dug). */
  function spots() {
    const h = o.hab(), pad = get('campPad') ?? null;
    // A new habitat object each time the ground is worked out again; the pad as it stands.
    const key = pad ? `${pad.x},${pad.z},${pad.r}` : '-';
    if (live && live.h === h && live.key === key) return live.spots;
    // Diggable soil now: no pieces asked (the marked stone is not one, and a stone set down on it moves nothing).
    const ok = (/** @type {number} */ x, /** @type {number} */ z) => {
      if (!h) return true;
      const c = groundClass(x, z, { hab: h, pad }, R).cls;
      return c === 'soil' || c === 'bank';
    };
    const moved = {
      hearths: seeded.hearths.map((p) => liveSpot(p, ok, home, S)).filter((p) => !!p),
      cache: seeded.cache ? liveSpot(seeded.cache, ok, home, S) : null,
    };
    live = { h, key, spots: /** @type {import('./story.js').StorySpots} */ (moved) };
    return live.spots;
  }

  /** What the story makes of a point (story.js storyAt). @param {number} x @param {number} z */
  const at = (x, z) => storyAt(x, z, spots(), S);

  /** The marked stone and the hearths' ring stones, for the pieces pass. */
  function beings() {
    const sp = spots(), out = ringBeings(sp.hearths, o.ground, S, shapes);
    const c = sp.cache;
    if (c) {
      const sink = stone.hy * o.piecesRecipe.sink;
      out.push({ x: c.x, y: o.ground(c.x, c.z), z: c.z, yaw: (o.worldSeed % 628) / 100, size: S.stone.sizeM, mesh: 'marked-stone',
        bone: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -sink, 0, 1]), slope: [0, 0], seed: 3.1, half: [stone.hx, stone.hz] });
    }
    return out;
  }
  o.pieces.addBeings(beings);

  return {
    spots, at,
    /** The marked stone as a footprint circle (no hole on it). */
    footprint: () => { const c = spots().cache; return c ? [{ x: c.x, z: c.z, r: S.stone.footR }] : []; },
    /**
     * The marked stone's card, before and after the cache is found. @param {number} x @param {number} z
     * @param {boolean} found
     */
    cardAt(x, z, found) {
      const c = spots().cache;
      if (!c || (c.x - x) ** 2 + (c.z - z) ** 2 > (S.stone.sizeM * 0.7) ** 2) return null;
      const W = R.words;
      return { sp: 'soil', name: W.stoneName, sub: null, icon: 'rock', itemIcon: 'keep-stone', text: found ? W.stoneAfter : W.stoneBefore,
        wx: c.x, wz: c.z, r: S.stone.sizeM * 0.6, stage: -1, dig: true, markedStone: true, canCarry: false };
    },
  };
}
