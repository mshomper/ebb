// @ts-check
// The journal's fish pages (docs/future/17): one page per species the island has, written from its
// roster when the island loads (each island's fish are its own, so their pages cannot sit in
// journal.json). They are finds (kind 'find', like the net fish's pages), listed in the Fish group
// under Living things (journal-list.json, words.fishOrder) once sketched and never before. A fish
// glimpsed in a net pencils a line on its page (a hint, the flag `glimpse:<id>`) without naming it.
// The five net fish keep their own pages in journal.json and take the same glimpse hint. Pure, but
// for adding to the words it is given.

/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A page for one species. @param {import('./roster.js').RosterFish} f @param {any} FR fishing.json
 * @param {number[]} sizeCm its species' typical length (cm)
 */
export function fishPage(f, FR, sizeCm) {
  const W = FR.words, P = FR.pages, water = W.waters[f.water];
  const when = f.when.length ? P.when.replace('{when}', f.when.map((c) => W.when[c]).join(` ${P.and} `)) : '';
  const bait = W.bait[f.bait];
  const name = f.name, lower = name.charAt(0).toLowerCase() + name.slice(1);
  return {
    _fish: 'A fish of this island (docs/future/17), written from its roster when the island loads.',
    name, icon: 'fish', kind: 'find', plural: `${lower}${lower.endsWith('s') ? '' : 's'}`, card: name,
    cardLine: P.cardLine.replace('{water}', water.toLowerCase()),
    place: `${P.place.replace('{water}', water.toLowerCase()).replace('{bait}', bait)}${when}.`,
    riddle: f.kind === 'rare' ? P.rareRiddle : P.riddle.replace('{water}', water.toLowerCase()),
    hints: [{ when: `glimpse:${f.id}`, text: P.glimpsed.replace('{water}', water.toLowerCase()) }],
    foundLine: P.foundLine.replace('{name}', lower),
    field: [{ text: P.field[f.water], learn: ['seen'] }],
    sketch: { scale: P.scale.replace('{cm}', String(Math.round((sizeCm[0] + sizeCm[1]) / 2))), labels: {} },
    likes: [{ text: cap(`${P.likes.replace('{bait}', bait)}`), learn: ['seen'] }],
    notes: { found: P.found.replace('{name}', lower) },
  };
}

/**
 * Add the island's fish pages to the journal's words: a page for every ordinary and rare species
 * (the net fish's own pages take their glimpse hint), and the Fish group's order.
 * @param {any} words recipes/world/journal.json (changed in place) @param {import('./roster.js').RosterFish[]} fish
 * @param {any} FR @param {(f: import('./roster.js').RosterFish) => number[]} sizeOf a species' typical length (cm)
 */
export function addFishPages(words, fish, FR, sizeOf) {
  const order = [];
  for (const f of fish) {
    if (f.kind === 'named') {
      const rec = words.species[f.page];
      if (rec && !(rec.hints ?? []).some((/** @type {any} */ h) => h.when === `glimpse:${f.id}`)) {
        rec.hints = [...(rec.hints ?? []), { when: `glimpse:${f.id}`, text: FR.pages.glimpsed.replace('{water}', FR.words.waters[f.water].toLowerCase()) }];
      }
      continue;
    }
    words.species[f.page] = fishPage(f, FR, sizeOf(f));
    order.push(f.page);
  }
  words.fishOrder = order;
  return words;
}
