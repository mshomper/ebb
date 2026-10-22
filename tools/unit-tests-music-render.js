// @ts-check
// The music render page's finishing (tools/music-render/finish.js): loudness by ITU-R BS.1770-4,
// normalizing under a peak ceiling, trimming silence with the room's tail kept, and the WAV file.

import { integratedLufs, normalize, trim, encodeWav, wavName, samplePeak, toDb } from './music-render/finish.js';

const G = 'music render: finishing';
const SR = 48000;

/** A sine of amplitude a at hz for s seconds. @param {number} hz @param {number} a @param {number} s */
function sine(hz, a, s) {
  const x = new Float32Array(Math.round(s * SR));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * hz * i / SR);
  return x;
}

/** @param {(g: string, n: string, fn: () => void) => void} test @param {(c: any, m?: string) => void} assert @param {(a: any, b: any, m?: string) => void} eq */
export function addMusicRenderTests(test, assert, eq) {
  test(G, 'a full-scale 1 kHz sine in one channel measures -3.0 LUFS (the standard check)', () => {
    const l = sine(1000, 1, 5), r = new Float32Array(l.length);
    const v = integratedLufs([l, r], SR);
    assert(Math.abs(v - -3.01) < 0.05, `got ${v.toFixed(3)}`);
  });
  test(G, 'the gate ignores silence: a tone with long silence measures as the tone alone', () => {
    const tone = sine(1000, 0.1, 4);
    const padded = new Float32Array(tone.length * 3);
    padded.set(tone, tone.length);
    const a = integratedLufs([tone, tone], SR), b = integratedLufs([padded, padded], SR);
    // Without the gate the padded one would read about 4.8 LU quieter; the blocks that half cover the
    // tone's edges still pass the gate, as the standard says, so it reads a few tenths lower.
    assert(Math.abs(a - b) < 0.5, `${a.toFixed(2)} vs ${b.toFixed(2)}`);
  });
  test(G, 'normalize reaches -18 LUFS, or stops at the -1.5 dBFS peak ceiling', () => {
    const q = sine(440, 0.01, 4);
    const n = normalize([q, q], SR, { targetLufs: -18, ceilingDb: -1.5 });
    assert(Math.abs(integratedLufs(n.channels, SR) - -18) < 0.05, 'quiet tone to -18');
    eq(n.peakLimited, false, 'quiet tone not limited');
    // A spiky signal: one loud click in a quiet tone, so reaching -18 would push the peak past the ceiling.
    const s = sine(440, 0.003, 4); s[1000] = 0.9;
    const m = normalize([s, s], SR, { targetLufs: -18, ceilingDb: -1.5 });
    eq(m.peakLimited, true, 'spiky signal limited');
    assert(Math.abs(toDb(samplePeak(m.channels)) - -1.5) < 0.01, 'peak at the ceiling');
  });
  test(G, 'trim keeps the tail after the last sound, fades out and starts at the first sound', () => {
    const x = new Float32Array(SR * 20);
    x.set(sine(300, 0.5, 5), SR * 2); // sound from 2 s to 7 s, with "room" ringing on at -40 dB to 15 s
    for (let i = SR * 7; i < SR * 15; i++) x[i] = 0.01 * Math.sin(i);
    const t = trim([x, x], SR, { lastS: 7, tailS: 2.75, fadeS: 0.3 });
    assert(Math.abs(t.startS - 1.99) < 0.005, `start ${t.startS}`);
    assert(Math.abs(t.endS - 9.75) < 0.001, `end ${t.endS}`);
    const d = t.channels[0];
    assert(Math.abs(d[d.length - 1]) < 1e-6, 'faded to silence');
  });
  test(G, 'the WAV header says 48 kHz stereo 24-bit, and the name reads well', () => {
    const w = new DataView(encodeWav([new Float32Array(10), new Float32Array(10)], SR, 24));
    eq(w.getUint32(24, true), SR, 'rate'); eq(w.getUint16(22, true), 2, 'channels'); eq(w.getUint16(34, true), 24, 'bits');
    eq(w.byteLength, 44 + 10 * 2 * 3, 'size');
    eq(wavName({ season: 'spring', slot: 'nocturne', seed: 4, weather: 'clear', title: 'The Stone Turns' }), 'ebb-spring-nocturne-seed4-the-stone-turns.wav');
    eq(wavName({ season: 'spring', slot: 'morning', seed: 2, weather: 'rain', title: "Song for the Rain's Cloud" }), 'ebb-spring-morning-rain-seed2-song-for-the-rain-s-cloud.wav');
  });
}
