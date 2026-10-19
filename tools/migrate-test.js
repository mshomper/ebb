// @ts-check
// Save upgrades page (doc 18, Migrations): opens every sample save in tools/save-samples with this
// build, brings it up to this build's save format, and shows whether it opened and its world
// fingerprint. One file picked from disk goes through the same steps, with more detail.

import { decode } from '../src/save/world-file.js';
import { FORMAT, migrate } from '../src/save/migrate.js';
import { restore } from '../src/save/sections.js';
import { hashWorldState } from '../src/sim/tick.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {number} h */
const hex = (h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
/** @param {any} s */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CHECK = '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>';
const WARN = '<path d="M12 3.5L2.8 19.8h18.4z"/><path d="M12 9.5v4.8"/><path d="M12 17.2v.1"/>';
/** @param {boolean} ok */
function icon(ok) {
  const color = ok ? '#5F7F5B' : '#B5654A';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ok ? CHECK : WARN}</svg>`;
}

/**
 * @typedef {Object} Result
 * @property {boolean} ok
 * @property {string} [reason]
 * @property {any} [from]  format in the file
 * @property {number} [to]  format after upgrading
 * @property {number} [fingerprint]
 * @property {any} [header]
 * @property {string[]} [damaged]
 * @property {number} [chunks]
 * @property {boolean} [fileOk]
 */

/**
 * Decode, upgrade and sort one save, the way the game opens it.
 * @param {Uint8Array} bytes @returns {Promise<Result>}
 */
async function openSave(bytes) {
  /** @type {any} */ let header;
  try {
    const d = await decode(bytes);
    header = d.header;
    const sections = migrate(d.sections, Number(header.format));
    const r = restore(sections);
    const damaged = [...new Set([...d.bad, ...r.bad])];
    const base = { from: header.format, to: FORMAT, header, damaged, chunks: r.chunks.length, fileOk: d.fileOk };
    if (!r.world) return { ok: false, reason: 'the world section is missing or damaged', ...base };
    if (!r.meta) return { ok: false, reason: 'the island details section is missing or damaged', ...base };
    return { ok: true, fingerprint: hashWorldState(r.world), ...base };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, reason, from: header?.format, header };
  }
}

/**
 * One result row, as HTML.
 * @param {string} name @param {string} note @param {Result} r @param {string | null} [expect]
 */
function rowHtml(name, note, r, expect) {
  const status = r.ok
    ? `<span class="v ok">${icon(true)}opened</span>`
    : `<span class="v bad">${icon(false)}<span>did not open: ${esc(r.reason)}</span></span>`;
  const from = r.from === undefined || r.from === null ? 'unknown' : esc(r.from);
  const fmt = `<span>${r.to === undefined ? `format ${from}, not upgraded` : `format ${from} to ${r.to}`}</span>`;
  const fp = r.fingerprint === undefined
    ? '<span class="hash">no fingerprint</span>'
    : `<span class="hash">${hex(r.fingerprint)}<small>world fingerprint</small></span>`;
  let match = '';
  if (expect) {
    const same = r.fingerprint !== undefined && hex(r.fingerprint) === String(expect).toUpperCase();
    match = `<span class="v ${same ? 'ok' : 'bad'}">${icon(same)}<span>${same ? 'matching' : 'not matching'}<small>expected ${esc(String(expect).toUpperCase())}</small></span></span>`;
  }
  return `<div class="row"><span class="label">${esc(name)}${note ? `<small>${esc(note)}</small>` : ''}</span>${status}${fmt}${fp}${match}</div>`;
}

/** @param {string} url */
async function fetchBytes(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`could not fetch ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function runSamples() {
  const list = $('samples');
  /** @type {any} */ let index;
  try {
    const res = await fetch('./save-samples/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    index = await res.json();
  } catch (e) {
    $('status').innerHTML = `${icon(false)}<span>Could not read save-samples/index.json</span>`;
    list.innerHTML = `<p class="muted">${esc(e instanceof Error ? e.message : e)}</p>`;
    return;
  }
  const samples = Array.isArray(index?.samples) ? index.samples : [];
  if (!samples.length) {
    $('status').textContent = 'No sample saves yet';
    list.innerHTML = '<p class="muted">No sample saves yet. When the save format first changes, saves from the old format go here.</p>';
    return;
  }
  let html = '', good = 0;
  for (const s of samples) {
    const file = String(s?.file ?? '');
    /** @type {Result} */ let r;
    if (!/^[\w.-]+\.ebb$/i.test(file)) r = { ok: false, reason: 'the list names a file that is not a plain .ebb name' };
    else {
      try { r = await openSave(await fetchBytes(`./save-samples/${encodeURIComponent(file)}`)); }
      catch (e) { r = { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
    }
    const expect = typeof s?.expect === 'string' && s.expect ? s.expect : null;
    const matches = !expect || (r.fingerprint !== undefined && hex(r.fingerprint) === expect.toUpperCase());
    if (r.ok && matches) good++;
    html += rowHtml(file || 'no file name', String(s?.note ?? ''), r, expect);
  }
  list.innerHTML = html;
  const all = good === samples.length;
  $('status').innerHTML = `${icon(all)}<span>${all ? `All ${samples.length} sample saves opened` : `${samples.length - good} of ${samples.length} sample saves need a look`}</span>`;
}

/** @param {File} file */
async function checkFile(file) {
  const out = $('pickResult');
  out.innerHTML = '<p class="muted">Opening</p>';
  /** @type {Result} */ let r;
  try { r = await openSave(new Uint8Array(await file.arrayBuffer())); }
  catch (e) { r = { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  const h = r.header ?? {};
  const saved = Number.isFinite(h.savedAt) ? new Date(h.savedAt).toLocaleString() : 'unknown';
  const damaged = r.damaged?.length ? r.damaged.map(esc).join(', ') : 'none';
  const facts = [
    ['Island id', h.island ?? 'unknown'],
    ['Seed', h.seed ?? 'unknown'],
    ['Saved', saved],
    ['Chunks', r.chunks ?? 'unknown'],
  ];
  out.innerHTML = rowHtml(file.name, '', r) +
    '<dl class="facts">' + facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('') +
    `<dt>Damaged sections</dt><dd>${damaged}</dd>` +
    (r.fileOk === false ? '<dt>Whole file</dt><dd>its overall checksum does not match</dd>' : '') +
    '</dl>';
}

$('formatLine').textContent = `This build writes save format ${FORMAT}`;
const pick = /** @type {HTMLInputElement} */ ($('pick'));
pick.addEventListener('change', () => {
  const f = pick.files?.[0];
  if (f) checkFile(f);
  pick.value = '';
});
runSamples();
