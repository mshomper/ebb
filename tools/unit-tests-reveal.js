// @ts-check
// Reveal tests for tools/unit-tests.html (S7c, doc 02): notes ranked by kind for any species, and
// rings placed from creatures' news or a page's Show me spot.

import { planReveal, rankOf } from '../src/world/journal/reveal-plan.js';
import { loadEcologyRecipes, islandWorld } from './ecology-world.js';

const REVEAL = 'reveal';

/** @param {string} path */
async function get(path) {
  const r = await fetch(`../recipes/${path}.json`);
  if (!r.ok) throw new Error(`recipes/${path}.json: HTTP ${r.status}`);
  return r.json();
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addRevealTests(test, assert, eq) {
  test(REVEAL, 'notes rank by kind, doc 02 order, newer first within a kind', async () => {
    const words = await get('world/journal');
    const notes = [
      { hour: 5, kind: 'spread', sp: 'reeds', text: 'a' },
      { hour: 6, kind: 'season', sp: null, text: 'b' },
      { hour: 3, kind: 'sign', sp: 'frogs', text: 'c' },
      { hour: 7, kind: 'flower', sp: 'lilies', text: 'd' },
      { hour: 2, kind: 'happy', sp: 'frogs', text: 'e' },
      { hour: 9, sp: 'iris', text: 'f' },                    // an older note, no kind
      { hour: 8, kind: 'arrived', sp: 'newcomer', text: 'g' }, // a species not yet in the game
    ];
    const plan = planReveal({ notes, events: [], state: null, habitat: null, words, count: 7, places: 3 });
    eq(plan.shown.map((s) => s.note.text).join(''), 'gcebdaf', 'order');
    eq(rankOf({ kind: 'nothing-like-it' }, words.reveal.rank), words.reveal.rank.length, 'an unknown kind comes last');
    eq(plan.shown.find((s) => s.note.kind === 'season')?.place, -1, 'a season has no ring');
  });

  test(REVEAL, 'rings come from a creature\'s news or the page\'s Show me spot, merged when close', async () => {
    const words = await get('world/journal');
    const R = await loadEcologyRecipes();
    const w = islandWorld(R, 'starter-island', 1, 6);
    const events = [
      { name: 'creature:arrived', hour: 20, payload: { species: 'frogs', x: 4, z: -6 } },
      { name: 'creature:joined', hour: 30, payload: { species: 'frogs', x: 5, z: -5 } },
      { name: 'creature:arrived', hour: 31, payload: { species: 'dragonflies', x: -20, z: 12 } },
    ];
    const notes = [
      { hour: 20, kind: 'sign', sp: 'frogs', text: 'frog came' },
      { hour: 30, kind: 'joined', sp: 'frogs', text: 'another frog' },
      { hour: 31, kind: 'arrived', sp: 'dragonflies', text: 'a dragonfly' },
      { hour: 32, kind: 'flower', sp: 'lilies', text: 'lily flowered' },
    ];
    const plan = planReveal({ notes, events, state: w.state, habitat: w.model.habitat, words, count: 5, places: 3 });
    const at = (/** @type {string} */ t) => plan.shown.find((s) => s.note.text === t)?.place ?? -9;
    eq(at('another frog'), at('frog came'), 'two frog notes 1.4 m apart share a ring');
    const dragon = plan.places[at('a dragonfly')];
    assert(dragon && dragon.x === -20 && dragon.z === 12, 'a new animal rings where its news says');
    assert(at('lily flowered') >= 0, 'a plant rings at its Show me spot');
    assert(plan.places.length <= 3, 'at most three rings');
    return `${plan.places.length} rings`;
  });
}
