// @ts-check
// The journal page test link (testing, unsaved). Run in order from src/app/systems.js.
//
// `?page=<id>&stage=0|1|2` opens the field journal on that page with its field sketch at that stage:
// 0 not yet seen (pencil, no labels), 1 found (ink, with every label learned without a moment),
// 2 caught at a moment (washed, every label). The page's knowledge is set so (the rest of the journal
// as it is), handed to the journal as catch-up hands it a journal (journal:replaced), and the page
// opened. Used to check each page's sketch, as tools/b3-review.html does.

import { emit } from '../core/events.js';
import { get as getStore, update as updateStore } from '../core/store.js';
import { loadRecipe } from '../core/recipes.js';
import { blank } from '../world/journal/observe.js';

/**
 * A journal with one page set to a sketch stage. Pure: a new journal.
 * @param {any} journal @param {string} id @param {any} rec the page's words (journal.json species[id])
 * @param {0|1|2} stage
 */
export function pageAtStage(journal, id, rec, stage) {
  const triggers = [...new Set(Object.values(rec?.sketch?.labels ?? {}).flatMap((/** @type {any} */ l) => l.learn))];
  const moment = (/** @type {string} */ t) => t === 'flower' || t.startsWith('moment:');
  let learned = stage === 0 ? [] : stage === 1 ? triggers.filter((t) => !moment(t)) : triggers;
  // Washed needs a moment learned, even where no label asks for one.
  if (stage === 2 && !learned.some(moment)) learned = [...learned, 'moment:dusk'];
  const k = { ...blank(), ...(journal.species?.[id] ?? {}), learned, ever: stage > 0, seen: stage > 0 };
  return { ...journal, species: { ...journal.species, [id]: k } };
}

/** @param {import('./context.js').AppContext} ctx */
export function page(ctx) {
  const { params, sim } = ctx;
  const id = params.get('page');
  if (!id) return;
  const stage = /** @type {0|1|2} */ (Math.max(0, Math.min(2, Number.parseInt(params.get('stage') ?? '1', 10) || 0)));
  const words = loadRecipe('world/journal');
  // Once the journal is up (and a moment more, so its first look is done), set the page and open it.
  let wait = 0, done = false;
  sim.addSystem({ id: 'page-test', async tick(/** @type {any} */ f) {
    if (done || !getStore('journal') || (wait += f.realDt) < 2) return;
    done = true;
    const W = await words;
    if (!W.species[id]) return;
    emit('journal:replaced', { journal: pageAtStage(getStore('journal'), id, W.species[id], stage) });
    updateStore('journalUi', (u) => ({ ...(u ?? {}), open: true, view: 'living', page: id, size: 'half' }));
  } });
}
