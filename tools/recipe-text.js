// @ts-check
// Write a recipe back the way it was written (the creature studio's Save): only the values that
// changed are replaced, in place in the file's own text, so its hand-made layout, key order and
// notes stay exactly as they were and GitHub Desktop shows just the numbers that moved. Pure.

/**
 * Where each value sits in a JSON text: a map from its path ("body.shape.headSize", array items by
 * index, "body.albedo.back.1") to its [start, end) in the text. The root is "".
 * @param {string} text @returns {Map<string, [number, number]>}
 */
export function valueSpans(text) {
  /** @type {Map<string, [number, number]>} */ const spans = new Map();
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const join = (/** @type {string} */ p, /** @type {string | number} */ k) => (p ? `${p}.${k}` : String(k));
  function string() {
    const s = i;
    i++;
    while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
    i++;
    return JSON.parse(text.slice(s, i));
  }
  /** @param {string} path */
  function value(path) {
    ws();
    const start = i, c = text[i];
    if (c === '{') {
      i++; ws();
      if (text[i] === '}') i++;
      else {
        for (;;) {
          ws(); const key = string(); ws(); i++;   // the colon
          value(join(path, key)); ws();
          if (text[i++] === ',') continue;
          break;
        }
      }
    } else if (c === '[') {
      i++; ws();
      if (text[i] === ']') i++;
      else {
        for (let k = 0; ; k++) {
          value(join(path, k)); ws();
          if (text[i++] === ',') continue;
          break;
        }
      }
    } else if (c === '"') string();
    else while (i < text.length && !/[,\]}\s]/.test(text[i])) i++;
    spans.set(path, [start, i]);
  }
  value('');
  return spans;
}

/** A value written on one line, the way the recipes write short values. @param {any} v @returns {string} */
export function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return keys.length ? `{ ${keys.map((k) => `${JSON.stringify(k)}: ${inline(v[k])}`).join(', ')} }` : '{}';
  }
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  return JSON.stringify(v);
}

/**
 * What changed between two versions of a recipe, as paths: a leaf that differs, or a whole array
 * of numbers if any of them does (a color, a range), so it is written back as one.
 * @param {any} before @param {any} after @param {string} [path] @returns {string[]}
 */
export function changedPaths(before, after, path = '') {
  const isNumArray = (/** @type {any} */ x) => Array.isArray(x) && x.every((y) => typeof y === 'number');
  if (isNumArray(before) && isNumArray(after)) return JSON.stringify(before) === JSON.stringify(after) ? [] : [path];
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    /** @type {string[]} */ const out = [];
    for (const k of Object.keys(after)) out.push(...changedPaths(before[k], after[k], path ? `${path}.${k}` : k));
    return out;
  }
  return before === after ? [] : [path];
}

/** The value at a path. @param {any} obj @param {string} path */
export const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * The recipe text with these paths' values replaced by the new recipe's (each on one line). A path
 * the text does not have (a key the studio added) is an error: add it to the recipe by hand first.
 * @param {string} text the file as it is @param {any} next the recipe with its edits @param {string[]} paths
 */
export function patchText(text, next, paths) {
  const spans = valueSpans(text);
  const edits = paths.map((p) => {
    const s = spans.get(p);
    if (!s) throw new Error(`the recipe file has no ${p}`);
    return { s, v: inline(at(next, p)) };
  });
  edits.sort((a, b) => b.s[0] - a.s[0]);
  let out = text;
  for (const e of edits) out = out.slice(0, e.s[0]) + e.v + out.slice(e.s[1]);
  return out;
}
