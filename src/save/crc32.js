// @ts-check
// CRC-32 (IEEE polynomial, as gzip and PNG use) for the .ebb file's sections and the whole file
// (doc 18). Pure and worker-safe.

/** @type {Uint32Array | null} */ let table = null;

function makeTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

/**
 * CRC-32 of some bytes. Pass the previous result as `crc` to continue over more bytes.
 * @param {Uint8Array} bytes @param {number} [crc]
 * @returns {number} uint32
 */
export function crc32(bytes, crc = 0) {
  table ??= makeTable();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
