// @ts-check
// Field journal tests (docs 13, 15) for tools/unit-tests.html: a new island's plants are noted as
// already there, the journal built over game hours is the same twice, a Plant tool refusal teaches
// a like line once, status words carry no numbers, and a tap names the nearest plant. Uses the
// made-up shoreline habitat of the growth tests.

import { initialWorldState, makeEnv, runHour } from '../src/sim/tick.js';
import { settleGrowth, plantSeed } from '../src/world/growth/coarse.js';
import { initialJournal, observe, learn, notePlanted, momentsNow, catchMoments, sketchOf, isAnimal } from '../src/world/journal/observe.js';
import { drawSketch, hasSketch } from '../src/ui/sketches/index.js';
import { describe, identify, showMeSpot } from '../src/world/journal/describe.js';
import { groundKind, groundCard, groundSurvey, describeGround } from '../src/world/journal/ground.js';
import { almanac } from '../src/world/journal/almanac.js';
import { inkWeb, describeWeb, tiesOf } from '../src/world/journal/web.js';
import { webView, tiesStrip } from '../src/ui/journal-web.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';
import { livingList, groupsOf, cleanChoice, DEFAULT_CHOICE } from '../src/world/journal/list.js';
import { washMap } from '../src/world/journal/wash.js';
import { stampNotes, markShown, markNotesSeen, markPageSeen, readOf, noteState, unread } from '../src/world/journal/read.js';
import { STAGE } from '../src/world/growth/coarse.js';
import { WORLD_CELLS } from '../src/world/terrain/grid.js';
import { shoreline, at, loadRecipes } from './unit-tests-growth.js';

/** @type {Promise<any> | null} */ let islandPromise = null;
function loadIsland() {
  islandPromise ??= fetch('../recipes/world/journal-island.json').then((r) => {
    if (!r.ok) throw new Error(`recipes/world/journal-island.json: HTTP ${r.status}`);
    return r.json();
  });
  return islandPromise;
}

/** @type {Promise<any> | null} */ let webPromise = null;
function loadWeb() {
  webPromise ??= fetch('../recipes/world/journal-web.json').then((r) => {
    if (!r.ok) throw new Error(`recipes/world/journal-web.json: HTTP ${r.status}`);
    return r.json();
  });
  return webPromise;
}

/** Painted ground for the shoreline: soil everywhere (grass, sand, rock, soil per texel). */
function soilEverywhere() {
  const m = new Uint8Array(WORLD_CELLS * WORLD_CELLS * 4);
  for (let i = 3; i < m.length; i += 4) m[i] = 255;
  return m;
}

const JOURNAL = 'journal';

/** The plant pages (animals have their own tests below). @param {any} words */
const plantsOf = (words) => words.order.filter((/** @type {string} */ sp) => !isAnimal(words.species[sp]));

/** @type {Promise<any> | null} */ let wordsPromise = null;
function loadWords() {
  wordsPromise ??= fetch('../recipes/world/journal.json').then((r) => {
    if (!r.ok) throw new Error(`recipes/world/journal.json: HTTP ${r.status}`);
    return r.json();
  });
  return wordsPromise;
}

/** The shoreline with grass painted on its dry middle. */
function grassyShoreline() {
  const hab = shoreline();
  for (let k = 0; k < hab.n * hab.n; k++) if (!hab.sea[k] && !hab.depthCm[k] && hab.salt[k] === 0 && hab.moisture[k] === 0) hab.grass[k] = 255;
  return hab;
}

/** A fresh island on the shoreline, its journal after the first look, and what is needed to go on. */
async function setup(seed = 9) {
  const recipes = await loadRecipes();
  const words = await loadWords();
  const hab = grassyShoreline();
  const env = { ...makeEnv(seed, recipes), habitat: () => hab };
  const state = settleGrowth(initialWorldState(seed), env);
  const first = observe(initialJournal(0), { state, events: [], hour: 0, habitat: hab, words });
  return { recipes, words, hab, env, state, first };
}

/** Run hours 1..n, the journal looking after each. @param {any} s */
function live(s, n) {
  let state = s.state, journal = s.first.journal;
  /** @type {string[]} */ const texts = [];
  for (let h = 1; h <= n; h++) {
    const r = runHour(state, h, s.env);
    state = r.state;
    const o = observe(journal, { state, events: r.events, hour: h, habitat: s.hab, words: s.words });
    journal = o.journal;
    for (const note of o.notes) texts.push(note.text);
  }
  return { state, journal, texts };
}

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addJournalTests(test, assert, eq) {
  test(JOURNAL, 'read marks: new notes since you looked, notes you may have missed, and pages with news', async () => {
    let j = { ...initialJournal(0), notes: [{ hour: 0, date: 'old', text: 'an old note', sp: 'reeds' }] };
    // Three notes at once; the first two shown on the island, the third lost in the burst.
    const burst = [1, 2, 3].map((i) => ({ hour: 5, date: 'd', text: `note ${i}`, sp: i === 3 ? 'frogs' : 'reeds' }));
    j = stampNotes({ ...j, notes: [...burst.slice().reverse(), ...j.notes] }, burst);
    eq(burst.map((n) => n.n).join(','), '1,2,3', 'note numbers');
    j = markShown(markShown(j, 1), 2);
    const since = readOf(j).notes;
    eq(since, 0, 'nothing read yet');
    const states = j.notes.map((n) => noteState(n, since));
    eq(states.join(','), 'missed,new,new,seen', 'newest first: missed, new, new, and the old note seen');
    let u = unread(j);
    eq(u.notes, 3, 'unread notes');
    eq([...u.pages].sort().join(','), 'frogs,reeds', 'pages with news');
    // Open the frogs page: only reeds still has news.
    j = markPageSeen(j, 'frogs');
    eq([...unread(j).pages].join(','), 'reeds', 'pages with news after opening frogs');
    // Open Notes: everything read; a later note is new again.
    j = markNotesSeen(j);
    u = unread(j);
    eq(u.notes + u.pages.size, 0, 'unread after opening Notes');
    const later = [{ hour: 6, date: 'd', text: 'later', sp: null }];
    j = stampNotes({ ...j, notes: [...later, ...j.notes] }, later);
    eq(unread(j).notes, 1, 'a later note is unread');
    eq(noteState(j.notes[0], readOf(j).notes), 'missed', 'never shown, so missed');
    return 'missed, new and seen read right; pages and Notes clear when opened';
  });

  test(JOURNAL, 'a new island: every plant on it is noted as already there', async () => {
    const { words, first } = await setup();
    for (const sp of plantsOf(words)) {
      assert(first.journal.species[sp]?.ever, `${sp} is seen at the first look`);
      assert(first.notes.some((n) => n.sp === sp && n.text === words.species[sp].notes.arrived), `${sp} has its "arrived" note`);
    }
    return `${first.notes.length} notes at the first look`;
  });

  test(JOURNAL, '96 hours twice give the same journal, and spreading is learned and noted once', async () => {
    const s = await setup();
    const a = live(s, 96);
    const b = live(s, 96);
    eq(JSON.stringify(a.journal), JSON.stringify(b.journal), 'journal of the two runs');
    const spread = plantsOf(s.words).filter((/** @type {string} */ sp) => a.journal.species[sp]?.learned.includes('spread'));
    assert(spread.length > 0, 'some species spread in 96 hours');
    for (const sp of spread) {
      const text = s.words.species[sp].notes.spread;
      eq(a.texts.filter((t) => t === text).length, 1, `${sp} spread note`);
    }
    return `spread learned by ${spread.join(', ')}; ${a.texts.length} notes in 96 hours`;
  });

  test(JOURNAL, 'a Plant tool refusal teaches a like line once', async () => {
    const { words, state, first } = await setup();
    const ctx = { state, hour: 3, words };
    const r1 = learn(first.journal, 'reeds', 'refused:dry', ctx);
    eq(r1.notes.length, 1, 'notes from the first refusal');
    assert(r1.notes[0].text.startsWith('Reeds: '), `note text "${r1.notes[0].text}"`);
    const r2 = learn(r1.journal, 'reeds', 'refused:dry', ctx);
    eq(r2.notes.length, 0, 'notes from the same refusal again');
    eq(r2.journal, r1.journal, 'the journal is unchanged by a repeat');
    const like = describe(r1.journal, 'reeds', state, null, words).likes.find((l) => l.text === 'Turns away from dry ground');
    assert(like?.known, 'the like line shows on the page');
    return r1.notes[0].text;
  });

  test(JOURNAL, 'page words: a status for every plant, with no numbers in it', async () => {
    const s = await setup();
    const a = live(s, 30);
    const lines = [];
    for (const sp of plantsOf(s.words)) {
      const d = describe(a.journal, sp, a.state, s.hab, s.words);
      assert(d.known, `${sp} known`);
      assert(d.status.length > 0, `${sp} has a status`);
      assert(!/\d/.test(d.status), `${sp} status has a number: "${d.status}"`);
      eq(d.seasons.length, 4, `${sp} season boxes`);
      assert(d.seasons[0].text, `${sp} spring box filled`);
      lines.push(d.status);
    }
    return lines.join(' / ');
  });

  test(JOURNAL, 'grass learns it drowns only when water comes over growing grass', async () => {
    const { words, env, hab } = await setup();
    for (let k = 0; k < hab.n * hab.n; k++) if (hab.depthCm[k] > 0) hab.grass[k] = 255;   // painted under the pond
    const fresh = settleGrowth(initialWorldState(9), env);
    const a = observe(initialJournal(0), { state: fresh, events: [], hour: 0, habitat: hab, words });
    assert(!a.journal.species.grass.learned.includes('grass:flooded'), 'a new island with a pond on painted grass is not flooding');
    const wet = { ...fresh, growth: { ...fresh.growth, grass: new Uint8Array(fresh.growth.grass.length).fill(255) } };
    const b = observe(a.journal, { state: wet, events: [], hour: 1, habitat: hab, words });
    assert(b.journal.species.grass.learned.includes('grass:flooded'), 'grass still growing under new water is flooding');
    eq(b.notes.filter((n) => n.text === words.species.grass.notes.flooded).length, 1, 'flooded notes');
    return words.species.grass.notes.flooded;
  });

  test(JOURNAL, 'moments: caught once when tapped at the right time, teaching a field note', async () => {
    const { words, state, first } = await setup();
    const M = words.moments;
    const list = M.plant;
    const rainyDusk = { stage: STAGE.flowering, season: 1, hourOfDay: 19, rain: 0.5, mist: 0 };
    const ids = momentsNow(list, rainyDusk, M);
    eq(ids.join(','), 'flower,rain,dusk', 'moments of a flowering clump on a rainy summer dusk');
    eq(momentsNow(list, { stage: STAGE.mature, season: 0, hourOfDay: 11, rain: 0, mist: 0 }, M).length, 0, 'moments of a plain spring noon');
    const ctx = { state, hour: 30, words, name: 'reeds', list };
    const a = catchMoments(first.journal, 'reeds', ids, ctx);
    eq(a.notes.length, 3, 'notes for three new moments');
    const b = catchMoments(a.journal, 'reeds', ids, ctx);
    eq(b.notes.length, 0, 'the same moments again');
    const d = describe(a.journal, 'reeds', state, null, words);
    eq(d.moments.filter((m) => m.date !== null).length, 3, 'filled frames');
    assert(d.field.find((f) => f.text.startsWith('Rain runs'))?.known, 'the rain field note is learned');
    return a.notes[1].text;
  });

  test(JOURNAL, "your island's story: here when you arrived, then what you planted", async () => {
    const { words, env, state, first, hab } = await setup();
    let j = first.journal;
    let s = state;
    for (const dz of [50, 52, 54]) {
      const r = plantSeed(s, 'iris', at('bank')[0], at('bank')[1] + dz, env);
      assert(r.ok, 'iris seed takes');
      s = r.state;
      j = notePlanted(j, 'iris', 5);
    }
    const d = describe(j, 'iris', s, hab, words, 6);
    eq(d.story[0], 'Iris clumps were here when you arrived.', 'first story line');
    assert(d.story.some((l) => l.startsWith('You first planted iris clumps on ')), `planted line in: ${d.story.join(' / ')}`);
    assert(d.story.includes(words.story.oldestArrived), 'oldest line');
    const spot = showMeSpot('iris', s, hab, words);
    assert(spot && spot.sp === 'iris' && spot.stage === STAGE.mature, 'with no view, Show me picks a full-grown iris');
    const near = [at('bank')[0], at('bank')[1] + 54];
    const close = showMeSpot('iris', s, hab, words, near);
    assert(close && Math.hypot(close.wx - near[0], close.wz - near[1]) < 0.5, `Show me rings the iris nearest the view: ${close?.wx}, ${close?.wz}`);
    return d.story.join(' / ');
  });

  test(JOURNAL, 'the ground: taps name water, shore and soil, with the plants that would suit', async () => {
    const { words, state, first, hab, recipes } = await setup();
    const island = await loadIsland();
    hab.band = new Uint8Array(hab.n * hab.n);
    for (let k = 0; k < hab.n * hab.n; k++) if ((k % hab.n) >= 20 && (k % hab.n) <= 22) hab.band[k] = 1;
    const mat = soilEverywhere();
    const kind = (/** @type {string} */ zone) => groundKind(hab, mat, at(zone)[0], at(zone)[1] + 10, island);
    eq(kind('sea'), 'sea', 'sea'); eq(kind('band'), 'band', 'tide band'); eq(kind('pond'), 'fresh', 'pond');
    eq(kind('dry'), 'soil', 'dry ground'); eq(kind('edge'), 'fresh', 'pond edge');
    const card = groundCard('soil', hab, at('bank')[0], at('bank')[1] + 10, { island, flora: recipes.flora, journal: first.journal, words });
    assert(card.suits.includes('Yellow flag iris'), `bank card: ${card.text} ${card.suits}`);
    const pond = groundCard('fresh', hab, at('pond')[0], at('pond')[1] + 10, { island, flora: recipes.flora, journal: first.journal, words });
    eq(pond.text, 'About waist deep, still fresh water.', 'pond card (80 cm)');
    const survey = groundSurvey(hab, mat, state, island, 1);
    const soil = describeGround(first.journal, 'soil', survey, island, words);
    assert(soil.known && soil.status.length > 0 && soil.grows.length > 0, `soil page: ${soil.status} / ${soil.grows.join(', ')}`);
    return `${card.text} ${card.suits} / ${pond.text} / ${soil.status}`;
  });

  test(JOURNAL, 'the almanac: today, weather, tide, moon, daylight and flowering in words', async () => {
    const s = await setup();
    const island = await loadIsland();
    const a = live(s, 12);
    const rows = almanac({ state: a.state, tHours: 12.5, weatherNow: { rain: 0, mist: 0, wind: 0.5 }, words: s.words, island });
    const ids = rows.map((r) => r.id);
    for (const id of ['today', 'weather', 'tide', 'moon', 'daylight', 'flowering']) assert(ids.includes(id), `row ${id}`);
    for (const r of rows) if (r.id !== 'today') assert(!/\d/.test(r.text), `${r.id} has a number: ${r.text}`);
    return rows.map((r) => `${r.label}: ${r.text}`).join(' / ');
  });

  test(JOURNAL, 'field sketches: pencil, ink, then washed, labels as they are learned, every drawing clean', async () => {
    const { words, first } = await setup();
    const island = await loadIsland();
    const rec = words.species.reeds;
    eq(sketchOf(undefined, false, rec.sketch).stage, 0, 'unseen reeds');
    const seen = sketchOf(first.journal.species.reeds, true, rec.sketch);
    eq(seen.stage, 1, 'seen reeds');
    eq(Object.keys(seen.labels).join(','), 'blade', 'labels once seen');
    const caught = catchMoments(first.journal, 'reeds', ['rain'], { state: first.journal, hour: 3, words, name: 'reeds', list: words.moments.plant });
    eq(sketchOf(caught.journal.species.reeds, true, rec.sketch).stage, 2, 'reeds caught in the rain');
    // Animals get their field sketches in S6c.
    const ids = [...plantsOf(words), ...island.groundOrder];
    for (const id of ids) {
      const sk = words.species[id]?.sketch ?? island.ground[id]?.sketch;
      assert(hasSketch(id), `a drawing for ${id}`);
      const all = Object.fromEntries(Object.entries(sk?.labels ?? {}).map(([k, v]) => [k, /** @type {any} */ (v).text]));
      for (const stage of /** @type {(0|1|2)[]} */ ([0, 1, 2])) {
        const svg = drawSketch(id, { stage, labels: all, scale: sk?.scale });
        assert(svg.startsWith('<svg') && !/NaN|undefined/.test(svg), `${id} stage ${stage} draws cleanly`);
        if (stage === 0) assert(!svg.includes('<text'), `${id} pencil has no labels`);
      }
    }
    return `${ids.length} drawings, each in three stages`;
  });

  test(JOURNAL, 'the web: links already true ink quietly, later ones write their note once', async () => {
    const { words, state, first, hab } = await setup();
    const island = await loadIsland();
    const web = await loadWeb();
    const survey = groundSurvey(hab, soilEverywhere(), state, island, 1);
    const a = inkWeb(first.journal, survey, { web, words, state, hour: 0 });
    eq(a.notes.length, 0, 'notes while the island is new');
    assert(a.journal.flags.includes('web:soil>grass'), 'grass on the soil is inked from the start');
    assert(!a.journal.flags.includes('web:midges>frogs'), 'frogs eating midges is not inked before frogs come');
    const late = words.arrivedHours + 50;
    const fed = { ...a.journal, flags: [...a.journal.flags, 'frogs:ate'] };
    const b = inkWeb(fed, survey, { web, words, state, hour: late });
    eq(b.notes.map((n) => n.text).join(' | '), 'Frogs feed on the midges.', 'notes when frogs first eat');
    eq(b.notes[0].sp, 'frogs', 'the note is about the frogs');
    const c = inkWeb(b.journal, survey, { web, words, state, hour: late + 1 });
    eq(c.notes.length, 0, 'notes a second time');
    eq(c.journal, b.journal, 'the journal is unchanged by a repeat');
    const d = describeWeb(b.journal, survey, web);
    const node = (/** @type {string} */ id) => d.byId[id];
    assert(node('soil')?.known && node('grass')?.known, 'soil and grass are known');
    assert(node('frogs')?.known, 'frogs are known once seen eating');
    assert(node('you')?.known, 'you are always known');
    assert(node('midges')?.known, 'midges are known once frogs are seen eating them');
    const before = describeWeb(a.journal, survey, web);
    assert(!before.byId.midges.known, 'midges are not known before');
    const page = webView(before, web, { trail: ['midges'], shelf: null });
    assert(!page.includes('Midges'), 'an unknown name is never written, even when tapped');
    assert(page.includes(web.unknown.hint.replace('{list}', 'reeds')), 'tapping it hints at what it needs');
    assert(d.links.find((l) => l.a === 'midges' && l.b === 'frogs')?.inked, 'the midges link is inked');
    assert(!d.links.find((l) => l.a === 'you')?.inked, 'feeding is still pencil');
    return `${b.journal.flags.filter((f) => f.startsWith('web:')).length} of ${web.links.length} links inked`;
  });

  test(JOURNAL, 'the web recipe: every ground feature, plant, find and animal is a node, with true ties and drawn icons', async () => {
    const [web, words, island] = await Promise.all([loadWeb(), loadWords(), loadIsland()]);
    const shore = await fetch('../recipes/world/shore.json').then((r) => r.json());
    const ids = Object.keys(web.nodes);
    const needed = ['soil', 'sand', 'rock', 'moss', 'fresh', 'shore', 'pool', 'stones', 'strandline', 'wrack', 'kelp', 'lichen', 'ripples', 'wetSand', 'mud',
      ...island.groundOrder, ...words.order, ...words.findOrder];
    for (const id of needed) assert(ids.includes(id) || ids.some((n) => web.nodes[n].page === id), `${id} has a node`);
    const zoneIds = shore.zones.map((/** @type {any} */ z) => z.id);
    for (const id of ids) {
      const n = web.nodes[id];
      assert(web.kinds[n.kind], `${id} has a kind with a shelf tab`);
      assert(ICON_NAMES.includes(n.icon), `${id}'s icon ${n.icon} is drawn`);
      if (n.page) assert(words.species[n.page] || island.ground[n.page], `${id}'s page ${n.page} exists`);
      for (const k of [n.on ?? []].flat()) assert([...zoneIds, 'pool', 'strandline', ...island.groundOrder].includes(k), `${id} is on ${k}, a thing the island can hold`);
      assert(n.always || n.page || n.on || n.flag, `${id} can become known`);
    }
    for (const k of Object.values(web.kinds)) assert(ICON_NAMES.includes(/** @type {any} */ (k).icon), `tab icon ${/** @type {any} */ (k).icon} is drawn`);
    const kinds = /^(grows|seen|seenOn|here|mossOnRock|flag)$/;
    for (const l of web.links) {
      assert(web.nodes[l.a] && web.nodes[l.b], `${l.a} > ${l.b} joins two nodes`);
      assert(kinds.test(l.ink.split(':')[0]), `${l.a} > ${l.b} has a known trigger`);
      assert(l.note, `${l.a} > ${l.b} has a note`);
    }
    // Ties true to the game (recipes/species/finds.json zones).
    const finds = await fetch('../recipes/species/finds.json').then((r) => r.json());
    const needs = (/** @type {string} */ b) => web.links.filter((/** @type {any} */ l) => l.b === b).map((/** @type {any} */ l) => l.a);
    const zoneNode = (/** @type {string} */ z) => (z === 'channelled' ? 'wrack' : z);
    for (const [sp, k] of Object.entries(finds.kinds)) {
      for (const z of /** @type {any} */ (k).zones) assert(needs(sp).includes(zoneNode(z)), `${sp} needs ${zoneNode(z)}, where the game puts it`);
    }
    assert(needs('anemone').includes('shore'), 'the anemone needs the tide band too');
    return `${ids.length} nodes, ${web.links.length} ties`;
  });

  test(JOURNAL, 'the web page: chips wrap, the shelf is a fixed grid, the unseen stay pencil, and a new node needs no layout', async () => {
    const web = await loadWeb();
    const blank = { flags: [], species: {} };
    const d0 = describeWeb(/** @type {any} */ (blank), null, web);
    const html = webView(d0, web, { trail: [], shelf: null });
    assert(!/NaN|undefined/.test(html), 'the page is clean');
    assert(!/width="|style="width|<svg class="ebb-jweb/.test(html), 'no fixed widths: nothing can widen the page');
    assert(html.includes(`--jw-cols: ${web.shelfCols}`), 'the shelf has its recipe column count');
    for (const id of ['frogs', 'midges', 'anemone']) assert(!html.includes(`aria-label="${web.nodes[id].label}"`), `${id} is a pencil ? on a new island`);
    // A shore with zones and pools: they are on the island, so known, and their ties ink.
    const survey = { by: { shore: { cells: 40, plants: {} }, rock: { cells: 30, plants: {} }, sand: { cells: 30, plants: {} } }, mossOnRock: 0, shore: { wrack: 12, pool: 3, kelp: 0, ripples: 5 } };
    const d1 = describeWeb(/** @type {any} */ (blank), survey, web);
    for (const id of ['wrack', 'pool', 'ripples', 'strandline']) assert(d1.byId[id].known && d1.byId[id].here, `${id} is on the island`);
    assert(!d1.byId.kelp.known && !d1.byId.mud.known, 'kelp and mud are not, yet');
    const inked = inkWeb(/** @type {any} */ ({ ...blank, born: 0, notes: [] }), survey, { web, words: await loadWords(), state: null, hour: 0 }).journal;
    assert(inked.flags.includes('web:rock>pool') && inked.flags.includes('web:rock>wrack'), 'ties to what is on the island ink');
    assert(!inked.flags.includes('web:pool>anemone'), 'a find\'s tie waits until it is found');
    // Focus the rock pool: needs rock and shore, needed by the pool lives, and the anemone is a pencil ?.
    const d2 = describeWeb(inked, survey, web);
    const t = tiesOf(d2, web, 'pool');
    eq(t.needs.map((x) => x.id).join(','), 'rock,shore', 'the rock pool needs rock and the shore');
    eq(t.neededBy.map((x) => x.id).join(','), 'anemone,hermitcrab,ediblecrab', 'the pool lives need the pool');
    assert(t.shares.some((x) => x.id === 'wrack'), 'the pool shares a home with the wrack');
    const card = webView(d2, web, { trail: ['shore', 'pool'], shelf: null });
    assert(card.includes('data-web-trail="0"'), 'the trail leads back to the shore');
    assert(!card.includes('Beadlet anemone'), 'an unfound anemone is not named');
    assert(card.includes('class="ebb-jw-chip is-unknown"'), 'it is a pencil chip');
    assert(card.includes('class="ebb-jw-chip is-ground" data-web-node="rock"'), 'rock is an inked ground chip');
    // A new species is one node and its ties.
    const more = structuredClone(web);
    more.nodes.limpet = { label: 'Limpet', kind: 'small', icon: 'periwinkle', on: 'wrack' };
    more.links.push({ a: 'rock', b: 'limpet', ink: 'here:wrack', note: 'Limpets clamp to the rock.' });
    const d3 = describeWeb(inked, survey, more);
    const shelf = webView(d3, more, { trail: ['limpet'], shelf: null });
    assert(shelf.includes('data-web-node="limpet"') && shelf.includes('<h3>Limpet</h3>'), 'the new species has a tile and a card');
    assert(tiesOf(d3, more, 'rock').neededBy.some((x) => x.id === 'limpet'), 'and rock lists it');
    const strip = tiesStrip(d2, web, 'shore');
    assert(strip.includes('data-web-node="pool"') && strip.includes('data-web-node="shore"'), 'a page\'s Ties strip links into the Web');
    return `${d0.nodes.length} tiles across ${Object.keys(web.kinds).length} tabs`;
  });

  test(JOURNAL, 'living things list: groups fold, filter by found and place, sort, and never list a small life still to find', async () => {
    const words = await loadWords();
    const list = await fetch('../recipes/world/journal-list.json').then((r) => r.json());
    const known = new Set(['grass', 'reeds', 'thrift', 'periwinkle']);
    const first = /** @type {Record<string, number>} */ ({ grass: 0, reeds: 40, thrift: 10, periwinkle: 90 });
    const entry = (/** @type {string} */ id) => ({ id, known: known.has(id), name: known.has(id) ? words.species[id].name : '' });
    const at = (/** @type {string} */ id) => first[id] ?? -1;
    const run = (/** @type {any} */ c) => livingList(list, words, { ...DEFAULT_CHOICE, ...c }, entry, at);
    const all = run({});
    eq(all.map((g) => g.id).join(','), words.species.shells ? 'plants,animals,small,shells' : 'plants,animals,small', 'groups in order (Shells once its page exists)');
    for (const id of [...words.order, ...words.findOrder]) assert(groupsOf(list, words).some((g) => g.ids.includes(id)), `${id} is in a group`);
    const g = (/** @type {any[]} */ gs, /** @type {string} */ id) => gs.find((x) => x.id === id);
    eq(g(all, 'plants').rows.slice(0, 3).join(','), 'reeds,thrift,grass', 'recently found first');
    assert(g(all, 'plants').rows.length === words.order.filter((/** @type {string} */ id) => !isAnimal(words.species[id])).length, 'not yet seen plants still listed (in pencil)');
    eq(g(all, 'small').rows.join(','), 'periwinkle', 'small lives list only what was found');
    eq(g(run({ status: 'notYet' }), 'small').rows.length, 0, 'even under Not yet');
    eq(g(run({ status: 'found' }), 'plants').rows.join(','), 'reeds,thrift,grass', 'Found keeps only the found');
    eq(g(run({ sort: 'az' }), 'plants').rows.slice(0, 3).join(','), 'Grass,Reeds,Sea thrift'.split(',').map((n) => words.order.find((/** @type {string} */ id) => words.species[id].name === n)).join(','), 'A to Z by name');
    eq(g(run({ place: 'shore' }), 'plants').rows.join(','), 'thrift', 'Shore keeps only thrift among plants');
    eq(g(run({ sort: 'place', status: 'found' }), 'plants').rows.join(','), 'reeds,grass,thrift', 'by place: pond, meadow, shore');
    assert(g(run({ shut: { plants: true } }), 'plants').shut, 'a group folds shut');
    const none = g(livingList(list, words, DEFAULT_CHOICE, (id) => ({ id, known: false, name: '' }), () => -1), 'small');
    eq(none.hint, words.smallLives.none, 'before the first find, the pencil line says where to look');
    const noShells = g(livingList(list, words, DEFAULT_CHOICE, (id) => ({ id, known: false, name: '' }), () => -1), 'shells');
    if (noShells) assert(noShells.rows.length === 0 && noShells.hint && noShells.hint !== none.hint, 'Shells has its own pencil line, and lists none unfound');
    const c = cleanChoice({ status: 'nonsense', place: 'moon', sort: 'az', shut: { plants: true } }, list);
    eq(`${c.status}|${c.place}|${c.sort}|${c.shut.plants}`, 'all|null|az|true', 'a kept choice is cleaned');
    // A shells page, once the finds branch adds it, gets its own group.
    const more = structuredClone(words);
    more.species.shells ??= { name: 'Shells', kind: 'find', icon: 'periwinkle' };
    if (!more.findOrder.includes('shells')) more.findOrder = [...more.findOrder, 'shells'];
    const withShells = groupsOf(list, more);
    assert(withShells.some((x) => x.group.id === 'shells' && x.ids.join() === 'shells'), 'Shells is its own group');
    assert(!withShells.find((x) => x.group.id === 'small')?.ids.includes('shells'), 'and not also a small life');
    return `${all.length} groups`;
  });

  test(JOURNAL, 'the wash: where it lives, where it would do well, and pencil circles for the unseen', async () => {
    const { words, state, first, hab, recipes } = await setup();
    const island = await loadIsland();
    const wash = await fetch('../recipes/world/journal-wash.json').then((r) => r.json());
    const mat = soilEverywhere();
    const ctx = { state, hab, material: mat, island, flora: recipes.flora, words, journal: first.journal, wash };
    const count = (/** @type {any} */ m, /** @type {number} */ ch) => { let c = 0; for (let k = ch; k < m.data.length; k += 2) if (m.data[k] > 128) c++; return c; };
    const reeds = washMap('reeds', ctx);
    assert(reeds && reeds.n === hab.n * 2 && reeds.cell === 0.5, 'a half-meter map over the habitat');
    assert(count(reeds, 0) > 0, 'reeds wash where reeds grow');
    eq(reeds?.circles.length, 0, 'no pencil circles for a species already seen');
    const p = state.growth.plants.find((/** @type {any} */ q) => q.sp === 'reeds');
    const at2 = (/** @type {number} */ x, /** @type {number} */ z) => (Math.floor((z - reeds.origin) * 2) * reeds.n + Math.floor((x - reeds.origin) * 2)) * 2;
    assert(reeds.data[at2(p.x, p.z)] > 200, 'full wash on a reed clump');
    const fresh = { ...first.journal, species: {} };
    const unseen = washMap('iris', { ...ctx, journal: fresh });
    eq(count(unseen, 0) + count(unseen, 1), 0, 'nothing washed for a species not yet seen');
    assert(unseen && unseen.circles.length >= 1 && unseen.circles.length <= wash.circles, `pencil circles: ${unseen?.circles.length}`);
    for (const c of unseen?.circles ?? []) eq(c[2], wash.circleM / 2, 'circle radius');
    eq(JSON.stringify(washMap('iris', { ...ctx, journal: fresh })?.circles), JSON.stringify(unseen?.circles), 'the same circles twice');
    const shore = washMap('shore', ctx);
    assert(shore && count(shore, 0) === 0, 'no tide band on this habitat, so no shore wash (the open sea is never washed)');
    eq(washMap('web', ctx), null, 'a page with no place on the island');
    return `reeds ${count(reeds, 0)} half-meter squares, would do well ${count(reeds, 1)}; ${unseen?.circles.length} pencil circles for unseen iris`;
  });

  test(JOURNAL, 'a tap names the nearest plant, or grass, or nothing', async () => {
    const { words, env, state, hab } = await setup();
    const r = plantSeed(state, 'iris', at('bank')[0], at('bank')[1] + 40, env);
    assert(r.ok, 'iris seed takes on the bank');
    const id = identify(r.state, hab, at('bank')[0] + 0.3, at('bank')[1] + 40, words);
    eq(id?.sp, 'iris', 'tap beside the iris');
    eq(id?.text, words.species.iris.stages[0], 'a seed says it is waiting');
    const g = identify(r.state, hab, at('dry')[0], at('dry')[1] + 70, words);
    eq(g?.sp, 'grass', 'tap on the painted dry ground');
    const none = identify(r.state, hab, at('pond')[0], at('pond')[1] + 90, words);
    assert(!none || none.sp === 'lilies', `tap on open water: ${none?.sp}`);
    return `${id?.name}: "${id?.text}"; ${g?.name}`;
  });

  test(JOURNAL, 'rushes: a marsh on a new island has its page, a tap names them, the wash finds them', async () => {
    const { words, state, first, hab, recipes } = await setup();
    const island = await loadIsland();
    const wash = await fetch('../recipes/world/journal-wash.json').then((r) => r.json());
    const k = first.journal.species.rushes;
    assert(k?.ever && k.seen && k.arrived, 'rushes in the pond margin are seen at the first look, as already there');
    const d = describe(first.journal, 'rushes', state, hab, words);
    assert(d.known && d.canShow && d.status.includes('rushes') && !/\d/.test(d.status), `status: "${d.status}"`);
    eq(d.icon, 'rushes', 'page icon');
    // With no plants nearby, a tap in the shallow margin names rushes; one on the painted dry ground is still grass.
    const bare = { ...state, growth: { ...state.growth, plants: [] } };
    const r = identify(bare, hab, at('edge')[0], at('edge')[1] + 60, words);
    eq(r?.sp, 'rushes', 'tap in the shallow margin');
    eq(r?.text, words.species.rushes.stages[0], 'card text');
    eq(identify(bare, hab, at('dry')[0], at('dry')[1] + 60, words)?.sp, 'grass', 'tap on the painted dry ground');
    eq(identify(bare, hab, at('pond')[0], at('pond')[1] + 60, words), null, 'tap on deep open water');
    const spot = showMeSpot('rushes', state, hab, words, [at('edge')[0], 30]);
    assert(spot && Math.abs(spot.wx - at('edge')[0]) < 2 && Math.abs(spot.wz - 30) < 1, `Show me rings rushes in the margin: ${spot?.wx}, ${spot?.wz}`);
    const ctx = { state, hab, material: soilEverywhere(), island, flora: { ...recipes.flora, ...recipes.covers }, words, journal: first.journal, wash };
    const m = washMap('rushes', ctx);
    const cellAt = (/** @type {number} */ x, /** @type {number} */ z) => (Math.floor((z - m.origin) * 2) * m.n + Math.floor((x - m.origin) * 2)) * 2;
    assert(m && m.data[cellAt(at('edge')[0], 20)] > 200, 'the wash lives in the margin');
    assert(m.data[cellAt(at('edge')[0], 20) + 1] > 200, 'and would do well there');
    eq(m.data[cellAt(at('dry')[0], 20)] + m.data[cellAt(at('pond')[0], 20)], 0, 'no wash on the dry ground or the deep pond');
    // A world that has lost its rushes says so.
    const gone = { ...state, growth: { ...state.growth, cover: { rushes: new Uint8Array(hab.n * hab.n) } } };
    const after = observe(first.journal, { state: gone, events: [], hour: 1, habitat: hab, words });
    assert(!after.journal.species.rushes.seen && after.notes.some((n) => n.text === words.species.rushes.notes.gone), 'the gone note');
    eq(describe(after.journal, 'rushes', gone, hab, words).status, words.species.rushes.none, 'status once gone');
    return `${d.status} / tap: ${r?.name}`;
  });
}
