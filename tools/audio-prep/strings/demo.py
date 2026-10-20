"""Strings kit demos, rendered from the decoded .ogg files with their loops, the way the sampler plays them."""
import os, json, subprocess
import numpy as np
import soundfile as sf

KIT = '/tmp/ebb-audio-work/kit'
REPO = '/home/claude/ebb'
SR = 48000
OUT = KIT + '/strings/demo'
os.makedirs(OUT, exist_ok=True)
IDS = ['strings-violins', 'strings-violas', 'strings-celli', 'strings-basses']
REC = {i: json.load(open(f"{REPO}/recipes/music/instruments/{i}.json")) for i in IDS}
NAMES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
_cache = {}


def midi_of(n):
    pc = NAMES[n[0]] + (1 if n[1:2] in ('#', 's') else 0)
    return 12 * (int(n.lstrip('ABCDEFG#s')) + 1) + pc


def decode(path):
    if path not in _cache:
        r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-'],
                           capture_output=True, check=True)
        _cache[path] = np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    return _cache[path]


def pick(iid, midi, layer):
    zs = REC[iid]['sets']['sus']['zones']
    z = min(zs, key=lambda z: (abs(z['midi'] - midi), z['midi'] < midi))   # nearest; a tie plays from above
    L = next(l for l in z['layers'] if l['layer'] == layer)
    return z, L


def voice(iid, midi, layer, hold, rel=0.4):
    """One held note: the file from its start, looping startS..endS, released with a 0.4 s equal-power fade."""
    z, L = pick(iid, midi, layer)
    d = decode(f"{REPO}/{REC[iid]['root']}{L['file']}.ogg")
    s = int(round(L['loop']['startS'] * SR))
    e = int(round(L['loop']['endS'] * SR))
    rate = 2 ** ((midi - z['midi'] - z['measuredCents'] / 100) / 12)
    n = int((hold + rel) * SR)
    p = np.arange(n) * rate
    i0 = np.floor(p).astype(np.int64)
    fr = p - i0

    def wrap(k):
        k = np.maximum(k, 0)
        return np.where(k < e, k, s + (k - s) % (e - s))
    ym1, y0, y1, y2 = (d[wrap(i0 + o)] for o in (-1, 0, 1, 2))
    f = fr[:, None]
    # 4-point cubic Hermite
    c1 = 0.5 * (y1 - ym1)
    c2 = ym1 - 2.5 * y0 + 2 * y1 - 0.5 * y2
    c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1)
    out = ((c3 * f + c2) * f + c1) * f + y0
    nr = int(rel * SR)
    t = (np.arange(nr) + 0.5) / nr
    out[-nr:] *= np.cos(0.5 * np.pi * t)[:, None]
    return out


def place(buf, x, at):
    i = int(at * SR)
    if i + len(x) > len(buf):
        buf = np.vstack([buf, np.zeros((i + len(x) - len(buf), 2))])
    buf[i:i + len(x)] += x
    return buf


def norm(x, peak_db=-12.0):
    pk = np.abs(x).max()
    return x * (10 ** (peak_db / 20) / pk) if pk > 0 else x


def gap(s=0.8):
    return np.zeros((int(s * SR), 2))


def write(name, parts):
    y = np.vstack(parts)
    sf.write(f"{OUT}/{name}.wav", y.astype(np.float32), SR, subtype='PCM_24')
    print(name, round(len(y) / SR, 1), 's', 'peak', round(20 * np.log10(np.abs(y).max()), 1))


CHORDS = {  # a slow chord of three zones per instrument (zone pitches, so nothing is repitched)
    'strings-violins': ['D4', 'Fs4', 'A4'],
    'strings-violas': ['D4', 'F4', 'A4'],
    'strings-celli': ['D3', 'A3', 'F3'],
    'strings-basses': ['D2', 'A2', 'Fs2'],
}

for iid in IDS:
    parts = []
    for z in REC[iid]['sets']['sus']['zones']:
        parts += [norm(voice(iid, z['midi'], 1, 6.0)), gap()]
    for layer in (1, 2):
        buf = np.zeros((1, 2))
        for k, n in enumerate(CHORDS[iid]):
            buf = place(buf, voice(iid, midi_of(n), layer, 8.0 - 1.0 * k), 1.0 * k)   # entering one by one, released together
        parts += [norm(buf), gap()]
    write(f"{iid}-demo", parts)

# family demos
parts = []
buf = np.zeros((1, 2))
for iid, n in (('strings-celli', 'D3'), ('strings-violas', 'A3'), ('strings-violins', 'Fs4'), ('strings-violins', 'D5')):
    buf = place(buf, voice(iid, midi_of(n), 1, 8.0), 0.0)
parts += [norm(buf), gap(1.2)]
write('family-1-d-major-bed', [norm(buf)])
buf2 = np.zeros((1, 2))
for iid, n in (('strings-basses', 'D2'), ('strings-basses', 'A2'), ('strings-celli', 'D3'), ('strings-celli', 'A3'),
               ('strings-violas', 'A4')):
    buf2 = place(buf2, voice(iid, midi_of(n), 1, 8.0), 0.0)
parts += [norm(buf2), gap(1.2)]
write('family-2-winter-open-fifths', [norm(buf2)])
# the line: no solo cello exists in VSCO 2 CE or VCSL, so the cello section stands in (loud layer, legato overlaps)
buf3 = np.zeros((1, 2))
t = 0.0
for n, dur in (('A3', 2.0), ('B3', 2.0), ('D4', 3.2), ('A3', 2.6)):
    buf3 = place(buf3, voice('strings-celli', midi_of(n), 2, dur + 0.25), t)
    t += dur
parts += [norm(buf3)]
write('family-3-cello-line-section-standin', [norm(buf3)])
write('family-all', parts)
