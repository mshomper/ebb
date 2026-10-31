// @ts-check
// Keeper book tests (Matt, October 30, 2026; src/world/keeper/route.js, src/world/threads): the views
// that moved out of the journal open the Keeper book on their tab, and the journal's own stay put;
// the book remembers its tab and starts a new tab on its own page; the thread writer writes each line
// once, in order, with its hour, and never changes a written one; the save section reads an older
// save as nothing written; finished threads; Things to try lists only hints already given; the
// recipe names its tests and drawn icons; and `?threads` takes all four first threads part-way.

import { keeperOfJournal, nextKeeperUi, keeperUi0, KEEPER_TABS, MOVED_VIEWS } from '../src/world/keeper/route.js';
import { writeLines, threadsOf, emptyThreads, cleanThreads, markThreadsSeen, threadsUnread } from '../src/world/threads/model.js';
import { TEST_FLAGS } from '../src/world/threads/live.js';
import { triesOf, threadsHtml, threadHtml } from '../src/ui/keeper-threads.js';
import { clean9, empty9, SECTIONS9 } from '../src/save/migrate-format9.js';
import { ICON_NAMES } from '../src/ui/icons/icons.js';

const G = 'keeper';
const js = (/** @type {any} */ v) => JSON.stringify(v);
/** @param {string} path */
const json = (path) => fetch(new URL(`../recipes/${path}.json`, import.meta.url)).then((r) => r.json());
/** The state the tests read: a journal with these flags. @param {string[]} flags */
const S = (flags) => ({ journal: { born: 0, flags, species: {}, notes: [] }, cook: { made: {} } });

/**
 * @param {(group: string, name: string, fn: () => any) => void} test
 * @param {(cond: any, msg?: string) => void} assert @param {(a: any, b: any, msg?: string) => void} eq
 */
export function addKeeperTests(test, assert, eq) {
  const threadsP = json('world/threads'), hintsP = json('world/morning-hints'), wordsP = json('world/journal');

  test(G, 'the moved views open the Keeper book on their tab; the journal keeps its own five', () => {
    eq(js(KEEPER_TABS), js(['kit', 'threads', 'trails', 'shelf', 'camp', 'chart']), 'five tabs, Kit first, and Chart once the line is made (F17)');
    eq(js(keeperOfJournal({ type: 'ui.journal', open: true, view: 'shelf', page: null })), js({ type: 'ui.keeper', tab: 'shelf', open: true, page: null }), 'the Shelf');
    eq(js(keeperOfJournal({ type: 'ui.journal', open: true, view: 'trails', trail: 'beach' })), js({ type: 'ui.keeper', tab: 'trails', open: true, page: null, trail: 'beach' }), 'a trail, by name');
    eq(keeperOfJournal({ type: 'ui.journal', view: 'herbarium' })?.page, 'herbarium', 'the herbarium under Trails');
    eq(keeperOfJournal({ type: 'ui.journal', view: 'camp' })?.tab, 'camp', 'the camp page is its own tab');
    eq(js(keeperOfJournal({ type: 'ui.journal', open: true, view: 'keeper', keeper: 'first' })), js({ type: 'ui.keeper', tab: 'threads', open: true, page: 'keeper:first' }), "a keeper page, under Threads");
    eq(keeperOfJournal({ type: 'ui.journal', view: 'keeper' })?.page, 'keeper:', 'the keeper pages list');
    eq(keeperOfJournal({ type: 'ui.journal', view: 'trails', toggle: true })?.toggle, true, 'a toggle stays a toggle');
    for (const v of ['living', 'ground', 'web', 'almanac', 'notes']) eq(keeperOfJournal({ type: 'ui.journal', open: true, view: v }), null, `${v} stays in the journal`);
    eq(keeperOfJournal({ type: 'ui.journal', open: true, page: 'frogs' }), null, 'a page of a living thing stays in the journal');
    eq(keeperOfJournal({ type: 'ui.journal', open: false }), null, 'shutting the journal is the journal\'s');
    eq(Object.keys(MOVED_VIEWS).sort().join(), 'camp,herbarium,keeper,shelf,trails', 'every moved view');
  });

  test(G, 'the book opens on the last tab; a new tab starts on its own page; I toggles where it was', () => {
    eq(keeperUi0('shelf').tab, 'shelf', 'the tab remembered on this device');
    eq(keeperUi0('nonsense').tab, 'kit', 'an unknown one: Kit');
    let u = keeperUi0();
    u = nextKeeperUi(u, { open: true, tab: 'threads', page: 'thread:cairns' });
    eq(js([u.open, u.tab, u.page]), js([true, 'threads', 'thread:cairns']));
    u = nextKeeperUi(u, { tab: 'trails' });
    eq(js([u.tab, u.page]), js(['trails', null]), 'a new tab: its own page');
    u = nextKeeperUi(u, { trail: 'forage' });
    eq(js([u.tab, u.trail]), js(['trails', 'forage']), 'a trail chosen');
    u = nextKeeperUi(u, { toggle: true });
    eq(js([u.open, u.tab, u.trail]), js([false, 'trails', 'forage']), 'I shuts it');
    u = nextKeeperUi(u, { toggle: true });
    eq(js([u.open, u.tab]), js([true, 'trails']), 'and opens it where it was');
    eq(nextKeeperUi(u, { tab: 'nope' }).tab, 'trails', 'an unknown tab changes nothing');
  });

  test(G, 'thread lines are written once, in order, each with the hour it was first true, and never change', async () => {
    const T = await threadsP;
    let st = emptyThreads();
    // The second cairn alone does not write: its line waits for the first.
    st = writeLines(T, S(['setpiece:cairns:2']), st, 10);
    eq(st.lines.length, 0, 'a later line waits for the one before');
    st = writeLines(T, S(['setpiece:cairns:1', 'setpiece:cairns:2']), st, 30);
    eq(js(st.lines), js([{ id: 'cairns.one', h: 30 }, { id: 'cairns.two', h: 30 }]), 'both, at the hour they came true');
    const same = writeLines(T, S(['setpiece:cairns:1', 'setpiece:cairns:2']), st, 99);
    assert(same === st, 'nothing new: the same state back');
    st = writeLines(T, S(['setpiece:cairns:1', 'setpiece:cairns:2', 'setpiece:cairns:added']), st, 55.7);
    eq(js(st.lines.map((l) => l.h)), js([30, 30, 55]), 'a written line keeps its hour; a new one has the game hour');
    // A flag lost later (a test link, a rebuilt journal) never unwrites a line.
    st = writeLines(T, S([]), st, 80);
    eq(st.lines.length, 3, 'written lines stay');
    const th = threadsOf(T, S([]), st).find((t) => t.id === 'cairns');
    eq(js(th?.lines.map((l) => l.id)), js(['one', 'two', 'added']), "in the thread's own order");
    eq(th?.begun, 30, 'begun at its first line');
    eq(th?.done, false, 'still open');
  });

  test(G, 'a thread is finished once all of its end tests hold; a thread with no end stays open', async () => {
    const T = await threadsP;
    const flags = ['dig:marked-stone', 'dig:cache', 'keeper:cache-starter:read', 'setpiece:boat:seen'];
    const st = writeLines(T, S(flags), emptyThreads(), 5);
    const ths = threadsOf(T, S(flags), st);
    eq(ths.find((t) => t.id === 'stone')?.done, true, 'the marked stone: the letter read');
    eq(ths.find((t) => t.id === 'boat')?.done, false, 'the lantern offshore never ends');
    const keeper = ths.find((t) => t.id === 'keeper');
    eq(keeper, undefined, 'the old keeper has not begun without its first page');
    const words = await wordsP;
    const html = threadsHtml({ T, H: { hints: [] }, s: S(flags), st, words, newDot: '' });
    assert(html.indexOf(T.words.finished) > html.indexOf('A lantern offshore'), 'open threads first, finished ones under their heading');
    assert(!threadHtml({ T, H: {}, s: S(flags), st, words, newDot: '' }, 'stone').includes(T.threads[0].pencil), 'a finished thread has no pencil line');
    assert(threadHtml({ T, H: {}, s: S(flags), st, words, newDot: '' }, 'boat').includes(T.threads[2].pencil), 'an open one ends with its pencil line');
  });

  test(G, 'the threads save section: an older save reads as nothing written; new lines show as new until seen', () => {
    assert(SECTIONS9.includes('threads'), 'written with the camp sections');
    eq(js(clean9('threads', undefined)), js(emptyThreads()), 'missing: nothing written');
    eq(js(empty9('threads')), js(emptyThreads()), 'a new island: the same');
    for (const bad of [null, 7, 'x', [], { lines: 'no' }]) eq(js(cleanThreads(bad)), js(emptyThreads()), `unreadable ${js(bad)}: nothing written`);
    const st = cleanThreads({ version: 1, lines: [{ id: 'cairns.one', h: 3 }, { id: 9, h: 1 }, { id: 'cairns.two', h: 'x' }], seen: 9 });
    eq(js(st), js({ version: 1, lines: [{ id: 'cairns.one', h: 3 }], seen: 1 }), 'bad lines dropped, seen kept in range');
    eq(cleanThreads({ version: 1, lines: [{ id: 'a.b', h: 1 }] }).seen, 1, 'a save from before read marks: all seen');
    const two = { version: /** @type {1} */ (1), lines: [{ id: 'a.b', h: 1 }, { id: 'a.c', h: 2 }], seen: 1 };
    assert(threadsUnread(two), 'one not yet seen');
    eq(markThreadsSeen(two).seen, 2, 'Threads left: both seen');
    assert(!threadsUnread(markThreadsSeen(two)), 'nothing new');
    eq(js(clean9('threads', two)), js(two), 'the section round trip');
  });

  test(G, 'Things to try: only the hints already given, newest first, done ones pencilled out without a Show me', async () => {
    const H = await hintsP, T = await threadsP;
    const s = S(['hint:gather@0', 'did:gathered', 'hint:finds@1', 'hint:animals@3', 'frogs:sign']);
    const tries = triesOf({ T, H, s, st: emptyThreads(), words: {}, newDot: '' });
    eq(js(tries.map((h) => h.id)), js(['animals', 'finds', 'gather']), 'given ones only, newest first');
    eq(js(tries.map((h) => h.done)), js([false, false, true]), 'gathering is done');
    eq(tries[2].sp, null, 'a done one offers no Show me');
    eq(tries[0].sp, 'frogs', "the animal hint's Show me rings the frogs");
    eq(tries[1].sp, 'shore', 'small finds: the shore (shown even before one is known)');
    eq(triesOf({ T, H, s, st: emptyThreads(), words: {}, newDot: '', canShow: () => false })[0].sp, null, 'nothing Show me cannot ring');
    eq(triesOf({ T, H, s: S([]), st: emptyThreads(), words: {}, newDot: '' }).length, 0, 'no hint given: none listed');
  });

  test(G, 'the threads recipe: every line names a test it has, every icon is drawn, ids are unique, each thread has a pencil line', async () => {
    const T = await threadsP;
    const ids = new Set();
    for (const th of T.threads) {
      assert(!ids.has(th.id), `${th.id} once`); ids.add(th.id);
      assert(ICON_NAMES.includes(th.icon), `${th.id}: icon ${th.icon} is drawn`);
      assert(th.pencil, `${th.id}: a pencil line`);
      const lines = new Set();
      for (const ln of th.lines) {
        assert(Array.isArray(T.tests[ln.test]), `${th.id}.${ln.id}: test ${ln.test} is in tests`);
        assert(!lines.has(ln.id), `${th.id}.${ln.id} once`); lines.add(ln.id);
        assert(!/genuine/i.test(ln.text), `${th.id}.${ln.id}: words`);
      }
      for (const e of th.end ?? []) assert(Array.isArray(T.tests[e]), `${th.id}: end test ${e} is in tests`);
    }
    eq([...ids].join(), 'stone,cairns,boat,keeper,angler', 'the first four threads, then the angler chart (F17)');
    assert(ICON_NAMES.includes('keeper') && ICON_NAMES.includes('threads'), 'the book and its Threads tab have drawn icons');
  });

  test(G, '?threads takes all four first threads part-way, none finished', async () => {
    const T = await threadsP, words = await wordsP;
    const st = writeLines(T, S(TEST_FLAGS), emptyThreads(), 200);
    const ths = threadsOf(T, S(TEST_FLAGS), st);
    eq(js(ths.map((t) => t.id).sort()), js(['boat', 'cairns', 'keeper', 'stone']), 'all four begun');
    for (const t of ths) {
      const all = T.threads.find((/** @type {any} */ x) => x.id === t.id).lines.length;
      assert(t.lines.length > 0 && t.lines.length < all, `${t.id}: part-way (${t.lines.length} of ${all})`);
      eq(t.done, false, `${t.id}: not finished`);
    }
    assert(threadHtml({ T, H: {}, s: S(TEST_FLAGS), st, words, newDot: '' }, 'keeper').includes('data-view="keeper"'), "the old keeper's thread opens the keeper's pages");
    return ths.map((t) => `${t.id} ${t.lines.length}`).join(', ');
  });
}
