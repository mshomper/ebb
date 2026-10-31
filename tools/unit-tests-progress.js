// @ts-check
// The progress archive stays closed (October 31, 2026): docs/progress.md keeps exactly the rows it
// had when entries moved to docs/progress/, so a row a branch adds to it is caught and moved into
// its own file instead. This branch's own entry is there in the entry format.

const G = 'progress';
/** Table lines in docs/progress.md when it closed: the header, its rule and 112 rows. */
const ARCHIVE_LINES = 114;
/** @param {string} p */
const text = async (p) => {
  const r = await fetch(new URL(`../${p}`, import.meta.url));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return (await r.text()).replace(/\r/g, '');
};

/** @param {(g: string, name: string, fn: () => any) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addProgressTests(test, assert, eq) {
  test(G, 'docs/progress.md is a closed archive: no row added or taken away', async () => {
    const lines = (await text('docs/progress.md')).split('\n').filter((l) => l.startsWith('|'));
    eq(lines.length, ARCHIVE_LINES, 'table lines (a new row belongs in its own file under docs/progress/: node tools/progress-move.mjs moves it)');
    return `${lines.length - 2} rows`;
  });

  test(G, 'an entry file has a title with its branch, a status line and a body', async () => {
    const s = await text('docs/progress/2026-10-31-m2-test-tooling.md');
    assert(/^# .+ \([a-z0-9-]+\)\n/.test(s), 'first line: # Step (branch)');
    assert(/\nStatus: (Done|Started|Paused)\n/.test(s), 'a Status: line');
    assert(s.split('\n\n').length >= 3, 'a body after the status');
  });
}
