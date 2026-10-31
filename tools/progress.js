// @ts-check
// tools/progress.html: the closed archive table in docs/progress.md, then the entry files in
// docs/progress/ in date order (their names start with the date). The local server lists that
// folder at /__list/docs/progress (tools/serve.ps1); without it (GitHub Pages) the page says where
// the entries are.

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
/** The little markdown the entries use: `code`, **bold**, [links](to). Links resolve from docs/. @param {string} s */
const md = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${/^[a-z]+:/.test(href) ? href : `../docs/${href}`}">${t}</a>`);

/** @param {string} p */
async function text(p) {
  const r = await fetch(p, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return (await r.text()).replace(/\r/g, '');
}

/** @param {HTMLElement} list @param {{ step: string, status: string, meta: string, body: string[], isNew?: boolean }} e */
function add(list, e) {
  const li = document.createElement('li');
  if (e.isNew) li.className = 'new';
  li.innerHTML = `<div class="head"><span class="step">${md(e.step)}</span><span class="meta">${esc([e.status, e.meta].filter(Boolean).join(', '))}</span></div>`
    + e.body.map((b) => `<p class="body">${md(b)}</p>`).join('');
  list.append(li);
}

async function main() {
  const archive = /** @type {HTMLElement} */ (document.getElementById('archive'));
  const entries = /** @type {HTMLElement} */ (document.getElementById('entries'));
  const note = /** @type {HTMLElement} */ (document.getElementById('note'));

  const table = await text('../docs/progress.md');
  for (const line of table.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| |') || line.startsWith('|---')) continue;
    const cells = line.slice(2, line.endsWith(' |') ? -2 : undefined).split(' | ');
    add(archive, { status: cells[0], step: cells[1] ?? '', meta: '', body: [cells.slice(2).join(' | ')] });
  }

  /** @type {string[]} */
  let names = [];
  try {
    const r = await fetch('/__list/docs/progress', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    names = (await r.json()).filter((/** @type {string} */ n) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(n)).sort();
  } catch {
    note.hidden = false;
    note.textContent = 'This server cannot list docs/progress/, so only the archive shows. Open this page through play.cmd, or read the folder on GitHub (its files are named by date).';
    return;
  }
  for (const name of names) {
    const s = await text(`../docs/progress/${name}`);
    const lines = s.split('\n');
    const step = (lines.find((l) => l.startsWith('# ')) ?? `# ${name}`).slice(2);
    const status = /^Status: (.+)$/m.exec(s)?.[1] ?? '';
    const body = s.replace(/^# .*\n/, '').replace(/^Status: .*$/m, '').trim().split(/\n{2,}/).map((p) => p.replace(/\n/g, ' '));
    add(entries, { step, status, meta: name.slice(0, 10), body, isNew: true });
  }
  if (!names.length) entries.innerHTML = '<li>None yet.</li>';
}

main().catch((e) => {
  const note = /** @type {HTMLElement} */ (document.getElementById('note'));
  note.hidden = false;
  note.textContent = `Could not read the progress files: ${e instanceof Error ? e.message : e}`;
});
