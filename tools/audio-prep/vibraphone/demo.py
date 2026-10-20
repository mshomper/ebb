"""Demo WAVs mixed in plain Python from the decoded .ogg files, using the recipes (zones, tuning, loops)."""
import json, subprocess, sys
import numpy as np
import soundfile as sf

REPO = '/home/claude/ebb'
OUT = '/tmp/ebb-audio-work/kit/vibraphone/demo'
SR = 48000
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
_cache = {}


def midi(n):
    pc = NAMES.index(n[:-1]); return 12 * (int(n[-1]) + 1) + pc


def dec(path):
    if path not in _cache:
        r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                           capture_output=True, check=True)
        _cache[path] = np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)
    return _cache[path]


class Inst:
    def __init__(self, iid):
        self.r = json.load(open(f'{REPO}/recipes/music/instruments/{iid}.json'))
        self.root = f"{REPO}/{self.r['root']}"

    def zone(self, set_, m):
        zs = self.r['sets'][set_]['zones']
        # nearest zone; ties go to the zone above (shift down)
        return min(zs, key=lambda z: (abs(z['midi'] - m), -z['midi']))

    def voice(self, set_, note, layer=2, hold=None, release=0.4, gain_db=0.0):
        m = midi(note) if isinstance(note, str) else note
        z = self.zone(set_, m)
        L = [l for l in z['layers'] if l['layer'] == layer] or z['layers']
        L = L[0]
        x = dec(self.root + L['file'] + '.ogg')
        shift = m - z['midi'] - z['measuredCents'] / 100.0
        rate = 2 ** (shift / 12)
        lp = L.get('loop')
        if lp:
            ls, le = int(round(lp['startS'] * SR)), int(round(lp['endS'] * SR))
            n = int(hold * SR) + int(release * SR)
            p = np.arange(n) * rate
            over = p >= le
            p[over] = ls + np.mod(p[over] - ls, le - ls)
        else:
            n = int((len(x) - 1) / rate)
            if hold is not None:
                n = min(n, int((hold + release) * SR))
            p = np.arange(n) * rate
        i = np.floor(p).astype(int); f = p - i
        i1 = np.minimum(i + 1, len(x) - 1)
        if lp:
            i1 = np.where(i + 1 >= le, ls, i1)
        y = x[i] * (1 - f) + x[i1] * f
        if hold is not None:
            r0 = int(hold * SR); R = len(y) - r0
            if R > 0:
                t = (np.arange(R) + 0.5) / R
                y[r0:] *= np.cos(0.5 * np.pi * t)
        lvl = gain_db
        if lp and 'loopRmsDb' in L:
            lvl += -30.0 - L['loopRmsDb']          # level bowed/glass notes by their held level
        return y * 10 ** (lvl / 20), f"{note}<-{z['note']}({shift:+.2f}st)"


def place(buf, y, t):
    i = int(t * SR)
    if i + len(y) > len(buf):
        buf = np.concatenate([buf, np.zeros(i + len(y) - len(buf))])
    buf[i:i + len(y)] += y
    return buf


def section(events):
    buf = np.zeros(1)
    for y, t in events:
        buf = place(buf, y, t)
    return buf


def norm(y, peak_db=-12.0):
    return y * (10 ** (peak_db / 20) / np.max(np.abs(y)))


def gap(s):
    return np.zeros(int(s * SR))


def write(name, parts, log):
    y = np.concatenate(parts)
    sf.write(f'{OUT}/{name}', y.astype(np.float32), SR, subtype='PCM_24')
    print(name, f'{len(y) / SR:.1f} s, peak {20 * np.log10(np.max(np.abs(y))):.1f} dBFS')
    for l in log:
        print('  ', l)


V = Inst('vibraphone')
parts, log = [], []
# 1. slow struck D major 7 arpeggio (D4 F#4 A4 C#5), loud layer then soft layer, and a final rolled chord
for layer in (2, 1):
    ev = []
    for k, n in enumerate(['D4', 'F#4', 'A4', 'C#5']):
        y, d = V.voice('struck', n, layer=layer)
        ev.append((y, 1.1 * k)); log.append(f'struck v{layer} {d}')
    parts += [norm(section(ev)), gap(0.8)]
ev = [(V.voice('struck', n, layer=2)[0], 0.06 * k) for k, n in enumerate(['D4', 'F#4', 'A4', 'C#5'])]
parts += [norm(section(ev)), gap(1.0)]
log.append('struck rolled Dmaj7 chord, v2')
# 2. every struck zone at its own pitch, v2, 0.7 s apart
ev = [(V.voice('struck', z['midi'], layer=2)[0], 0.7 * k) for k, z in enumerate(V.r['sets']['struck']['zones'])]
parts += [norm(section(ev)), gap(1.0)]
log.append('struck: every zone F3..E6 at its own pitch, v2, 0.7 s apart')
# 3. each bowed zone held 6 s (looped), 0.4 s release
for z in V.r['sets']['bowed']['zones']:
    y, d = V.voice('bowed', z['midi'], layer=1, hold=6.0)
    parts += [norm(y), gap(0.6)]; log.append(f'bowed zone held 6 s: {d}')
# 4. bowed D4 + A4 fifth held 8 s
ev = []
for n in ('D4', 'A4'):
    y, d = V.voice('bowed', n, layer=1, hold=8.0); ev.append((y, 0.0)); log.append(f'bowed fifth: {d}')
parts += [norm(section(ev)), gap(1.0)]
# 5. three bowed notes overlapping like a glass pad (recorded zones G4, D5, A5: stacked open fifths)
ev = []
for k, n in enumerate(('G4', 'D5', 'A5')):
    y, d = V.voice('bowed', n, layer=1, hold=7.0 - 1.5 * k + 1.5, release=0.4)
    ev.append((y, 1.5 * k)); log.append(f'bowed pad, enters at {1.5 * k:.1f} s: {d}')
parts += [norm(section(ev)), gap(0.5)]
write('vibraphone-demo.wav', parts, log)

G = Inst('glass')
parts, log = [], []
for layer in (1, 2):
    for z in G.r['sets']['sus']['zones']:
        y, d = G.voice('sus', z['midi'], layer=layer, hold=6.0)
        parts += [norm(y), gap(0.6)]; log.append(f'glass v{layer} zone held 6 s: {d}')
ev = []
for k, n in enumerate(('F#5', 'B5', 'D6')):
    y, d = G.voice('sus', n, layer=1, hold=8.0 - 1.2 * k)
    ev.append((y, 1.2 * k)); log.append(f'glass chord (B minor), v1: {d}')
parts += [norm(section(ev)), gap(0.5)]
write('glass-demo.wav', parts, log)
