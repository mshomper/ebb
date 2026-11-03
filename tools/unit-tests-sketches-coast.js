// @ts-check
// Field sketches for tools/unit-tests.html: every page on the journal's list (words.order) and every
// find (words.findOrder) has a drawing, in DRAW (src/ui/sketches/index.js) or registered at run time
// as src/main.js does (the net catches, the under-log finds); and the five B3 ones (turnstones,
// sandpipers, eels, teal, seals) draw cleanly in all three stages, with no labels in pencil.

import { drawSketch, hasSketch } from '../src/ui/sketches/index.js';
import { registerCatchSketches } from '../src/ui/sketches/catch.js';
import { registerUnderLogSketches } from '../src/ui/sketches/under-log.js';
import { pageAtStage } from '../src/app/test-links-page.js';
import { sketchOf } from '../src/world/journal/observe.js';

const G = 'sketches-coast';
const json = (/** @type {string} */ p) => fetch(new URL(`../recipes/${p}.json`, import.meta.url)).then((r) => r.json());

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addSketchesCoastTests(test, assert, eq) {
  test(G, 'every page on the journal list and every find has a field sketch', async () => {
    const words = await json('world/journal');
    // The drawings main.js registers once their recipes are in.
    registerCatchSketches(await json('world/nets'), () => []);
    registerUnderLogSketches(await json('species/under-log'));
    const ids = [...words.order, ...words.findOrder];
    const missing = ids.filter((/** @type {string} */ id) => !hasSketch(id));
    eq(missing.join(', '), '', 'pages with no drawing');
    return `${ids.length} pages, each drawn`;
  });

  test(G, '?page=<id>&stage=N sets the page to that sketch stage', async () => {
    const words = await json('world/journal');
    for (const id of ['turnstones', 'sandpipers', 'eels', 'teals', 'seals']) {
      const rec = words.species[id];
      for (const stage of /** @type {(0|1|2)[]} */ ([0, 1, 2])) {
        const j = pageAtStage({ species: {}, flags: [], notes: [] }, id, rec, stage);
        const k = j.species[id];
        const sk = sketchOf(k, k.ever, rec.sketch);
        eq(sk.stage, stage, `${id} at stage ${stage}`);
        if (stage === 2) eq(Object.keys(sk.labels).length, Object.keys(rec.sketch.labels).length, `${id} washed has every label`);
      }
    }
    return '5 pages, three stages each';
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
