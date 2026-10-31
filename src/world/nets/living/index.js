// @ts-check
// The living catches (docs/future/12, K6): what a net brings up alive, always released. Each one is
// made from a seed like a keepsake: its kind and rarity are picked first (haul.js), then numbers are
// drawn that make it its own animal (size, build, its marking, sometimes the rarer colour form),
// and a mesh is built from those numbers when the tray shows it. A released one is remembered by its
// kind and seed alone (src/world/nets/model.js), so it can be built again the same for its page.
// Fish caught on the line (docs/future/17) are catch gen 2, from one fish generator (fish2.js): the
// functions here take them too, given the fishing recipe (FR), and gen 1 catches rebuild as before.

import { draws, r4 } from '../../keepsakes/families/common.js';
import { bakeCatch } from './bodies.js';
import { jellyCatch } from './jelly.js';
import { fishMeshOf, fishName, fishClear } from './fish2.js';

/**
 * @typedef {{ kind: string, gen: 1, seed: number, rarity: string, plan: string, lengthM: number, h: number, w: number,
 *   morph: boolean, blot: number[], curl: number, variant: number }} CatchNumbers
 */

/**
 * A catch's numbers from its seed, kind and rarity. Pure.
 * @param {number} seed @param {string} kind @param {string} rarity @param {any} NR recipes/world/nets.json
 * @returns {CatchNumbers}
 */
export function catchNumbers(seed, kind, rarity, NR) {
  const C = NR.catches, k = C.kinds[kind];
  const d = draws(seed);
  const size = C.tierSize[rarity] ?? 1;
  return {
    kind, gen: 1, seed: seed >>> 0, rarity, plan: k.plan,
    lengthM: r4(d.range(k.lengthM, 1) * size),
    h: k.height ? d.range(k.height, 2) : 0,
    w: k.width ? d.range(k.width, 3) : 0,
    morph: d.chance(C.tierMorph[rarity] ?? 0, 4),
    blot: [d.range([0, 40], 5), d.range([0, 40], 6), d.range([0, 40], 7)],
    curl: d.range([0.6, 1.2], 8),
    variant: Math.floor(d.u(9) * 1000),
  };
}

/** A catch's mesh from its numbers. @param {any} n gen 1 or 2 @param {any} NR @param {any} [FR] fishing.json, for gen 2 */
export function catchMesh(n, NR, FR) {
  if (n.gen === 2) return fishMeshOf(n, FR);
  const k = NR.catches.kinds[n.kind];
  return n.plan === 'jelly' ? jellyCatch(n, k) : bakeCatch(n, k);
}

/** Its name. @param {any} n @param {any} NR @param {any} [FR] */
export const catchName = (n, NR, FR) => (n.gen === 2 ? fishName(n, FR) : NR.catches.kinds[n.kind].name);

/** Its one line: the note (or its colour form's), and about how long it is. @param {any} n @param {any} NR @param {any} [FR] */
export function catchWords(n, NR, FR) {
  const cm = Math.max(1, Math.round(n.lengthM * 100));
  if (n.gen === 2) {
    const W = FR.words;
    return `${n.morphId ? W.morph[n.morphId] : ''} ${NR.sizeWord.replace('{cm}', String(cm))}`.trim();
  }
  const k = NR.catches.kinds[n.kind];
  const note = n.morph && k.morph?.note ? k.morph.note : k.note;
  return `${note} ${NR.sizeWord.replace('{cm}', String(cm))}`;
}

/** The journal page a kind's first release inks. @param {string} kind @param {any} NR */
export const catchPage = (kind, NR) => NR.catches.kinds[kind]?.journal ?? kind;

/**
 * How it moves on the tray (src/ui/haul-tray.js), and the side its sketch is traced from
 * ([yaw, pitch] in degrees; fish are seen side on, a flatfish and a crab from above).
 * @param {CatchNumbers} n @returns {{ motion: 'swim' | 'ripple' | 'flick' | 'walk' | 'pulse', view: [number, number] }}
 */
export function catchLook(n) {
  switch (n.plan) {
    case 'flat': return { motion: 'ripple', view: [90, 72] };
    case 'shrimp': return { motion: 'flick', view: [90, 10] };
    case 'crab': return { motion: 'walk', view: [180, 62] };
    case 'jelly': return { motion: 'pulse', view: [0, 42] };
    default: return { motion: 'swim', view: [90, 8] };
  }
}

/** How solid it is drawn on the tray: a jelly's rings show through its clear bell, a ghost fish's bones through its body. @param {any} n @param {any} [FR] */
export const catchAlpha = (n, FR) => (n.plan === 'jelly' ? 0.5 : n.gen === 2 && FR && fishClear(n, FR) ? 0.55 : 1);

/** Is it a distinctive one, remembered once released (rare and up, or its rarer colour form)? @param {CatchNumbers} n */
export const distinctive = (n) => n.morph || ['rare', 'veryRare', 'lifetime'].includes(n.rarity);
