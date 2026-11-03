// @ts-check
// Field sketches of B3's coast and pond lives (src/ui/sketches/coast.js) for tools/unit-tests.html:
// every animal page in the journal has a drawing, and the five B3 ones (turnstones, sandpipers,
// eels, teal, seals) draw cleanly in all three stages, with no labels in pencil.

import { drawSketch, hasSketch } from '../src/ui/sketches/index.js';
import { isAnimal } from '../src/world/journal/observe.js';

const G = 'sketches-coast';
const json = (/** @type {string} */ p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSketchesCoastTests(test, assert, eq) {
  test(G, 'every animal on the journal list has a field sketch', async () => {
    const words = await json('world/journal');
    const animals = words.order.filter((/** @type {string} */ id) => isAnimal(words.species[id]));
    const missing = animals.filter((/** @type {string} */ id) => !hasSketch(id));
    eq(missing.join(', '), '', 'animals with no drawing');
    return `${animals.length} animals, each drawn`;
  });

  test(G, 'the B3 sketches draw cleanly in pencil, ink and wash', async () => {
    const words = await json('world/journal');
    const ids = ['turnstones', 'sandpipers', 'eels', 'teals', 'seals'];
    for (const id of ids) {
      const sk = words.species[id].sketch;
      const all = Object.fromEntries(Object.entries(sk.labels).map(([k, v]) => [k, /** @type {any} */ (v).text]));
      for (const stage of /** @type {(0|1|2)[]} */ ([0, 1, 2])) {
        const svg = drawSketch(id, { stage, labels: all, scale: sk.scale });
        assert(svg.startsWith('<svg') && !/NaN|undefined/.test(svg), `${id} stage ${stage} draws cleanly`);
        if (stage === 0) assert(!svg.includes('<text'), `${id} pencil has no labels`);
        else for (const lines of Object.values(all)) assert(svg.includes(lines[0]), `${id} shows "${lines[0]}"`);
      }
    }
    // The seal's pup is drawn only once the page has learned it.
    const sk = words.species.seals.sketch;
    const noPup = Object.fromEntries(Object.entries(sk.labels).filter(([k]) => k !== 'pup').map(([k, v]) => [k, /** @type {any} */ (v).text]));
    const withPup = { ...noPup, pup: sk.labels.pup.text };
    assert(drawSketch('seals', { stage: 1, labels: withPup }).length > drawSketch('seals', { stage: 1, labels: noPup }).length, 'the pup appears once learned');
    return `${ids.length} drawings, each in three stages`;
  });
}
