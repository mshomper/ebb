"""Demo WAVs for harp and flute, mixed in plain Python from the decoded .ogg files (what the game plays)."""
import json, subprocess, os
import numpy as np, soundfile as sf
REPO = '/home/claude/ebb'
OUT = '/tmp/ebb-audio-work/kit/harpflute/demo'
SR = 48000
os.makedirs(OUT, exist_ok=True)
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
def midi(n):
    pc = n[:2] if n[1:2] == 's' else n[:1]
    return 12 * (int(n[len(pc):]) + 1) + NAMES.index(pc)

_cache = {}
def dec(path, ch):
    if path not in _cache:
        r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ar', str(SR), '-'], capture_output=True, check=True)
        _cache[path] = np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, ch).astype(np.float64)
    return _cache[path]


class Inst:
    def __init__(self, iid):
        self.r = json.load(open(f'{REPO}/recipes/music/instruments/{iid}.json'))
        self.ch = self.r['channels']
        self.root = REPO + '/' + self.r['root']
        # zone leveling (doc: levels are recorded, not normalized): bring each zone's layer 1 to a common level
        # with the layer step kept. harp: attackRmsDb; flute: loopRmsDb.
        key = 'loopRmsDb' if iid == 'flute' else 'attackRmsDb'
        for s in self.r['sets'].values():
            ref = np.median([z['layers'][0][key] for z in s['zones']])
            for z in s['zones']:
                z['_gainDb'] = ref - z['layers'][0][key]

    def play(self, set_, note, dur, layer=1, rr=1, rel=0.4):
        """Return the rendered note (n, ch): held dur seconds (looped if the file has a loop), then a rel-second fade."""
        m = midi(note) if isinstance(note, str) else note
        zs = self.r['sets'][set_]['zones']
        z = min(zs, key=lambda z: (abs(z['midi'] - m), z['midi']))
        cands = [l for l in z['layers'] if l['layer'] == layer] or z['layers']
        l = [c for c in cands if c.get('rr', 1) == rr] or cands
        l = l[0]
        d = dec(self.root + l['file'] + '.ogg', self.ch)
        rate = 2 ** ((m - z['midi']) / 12 - l['measuredCents'] / 1200)
        n = int((dur + rel) * SR)
        pos = np.arange(n) * rate
        if 'loop' in l:
            ls, le = round(l['loop']['startS'] * SR), round(l['loop']['endS'] * SR)
            L = le - ls
            idx = np.where(pos < ls, pos, ls + np.mod(pos - ls, L))
            ext = np.concatenate([d[:le], d[ls:ls + 2]])        # le wraps to ls for interpolation
        else:
            ok = pos < len(d) - 1
            idx = pos[ok]; ext = d
        i0 = np.floor(idx).astype(int); fr = (idx - i0)[:, None]
        y = ext[i0] * (1 - fr) + ext[i0 + 1] * fr
        g = 10 ** (z['_gainDb'] / 20)
        env = np.ones(len(y))
        nh = int(dur * SR); nr = len(y) - nh
        if nr > 0:
            env[nh:] = np.cos(0.5 * np.pi * (np.arange(nr) + 0.5) / int(rel * SR))[:nr] if nr <= int(rel * SR) else 0
        return y * env[:, None] * g


def mix(events, ch, marks, tail=1.0):
    """Each section (between marks) is normalised on its own to a -12 dBFS peak, then the sections are summed."""
    end = max(t + len(y) / SR for t, y in events) + tail
    out = np.zeros((int(end * SR), ch))
    starts = [t for _, t in marks] + [1e9]
    for a, b in zip(starts[:-1], starts[1:]):
        sec = np.zeros_like(out)
        for t, y in events:
            if a <= t < b:
                i = int(t * SR); sec[i:i + len(y)] += y
        out += sec * (10 ** (-12 / 20) / np.max(np.abs(sec)))
    return out


def write(name, out):
    out = out * (10 ** (-12 / 20) / np.max(np.abs(out)))
    sf.write(f'{OUT}/{name}', out.astype(np.float32), SR, subtype='PCM_24')
    print(name, round(len(out) / SR, 1), 's, peak %.1f dBFS' % (20 * np.log10(np.max(np.abs(out)))))


# ---------------- harp ----------------
h = Inst('harp')
ev = []; t = 0.5; marks = []
marks.append(('zone walk: every zone, mf then f', t))
for z in h.r['sets']['sus']['zones']:
    for layer in (1, 2):
        ev.append((t, h.play('sus', z['midi'], 4.0, layer=layer, rel=0.25))); t += 0.8
t += 3.0
marks.append(('rising D major arpeggio, D3 to D5', t))
for n in ['D3', 'Fs3', 'A3', 'D4', 'Fs4', 'A4', 'D5']:
    ev.append((t, h.play('sus', n, 4.0, layer=1, rel=0.25))); t += 0.65
t += 3.5
marks.append(('rolled D major chord', t))
for i, n in enumerate(['D3', 'A3', 'D4', 'Fs4', 'A4', 'D5']):
    ev.append((t + 0.07 * i, h.play('sus', n, 4.0, layer=2, rel=0.25)))
t += 5.0
marks.append(('slow chord of three zones (G3, B3, D4)', t))
for n in ['G3', 'B3', 'D4']:
    ev.append((t, h.play('sus', n, 4.0, layer=1, rel=0.25)))
write('harp-demo.wav', mix(ev, 2, marks))
hm = marks

# ---------------- flute ----------------
f = Inst('flute')
ev = []; t = 0.3; marks = []
for s in ('nv', 'vib'):
    marks.append((f'every {s} file held 6 s (looped) with a 0.4 s release', t))
    for z in f.r['sets'][s]['zones']:
        for l in z['layers']:
            ev.append((t, f.play(s, z['midi'], 6.0, layer=l['layer'], rr=l.get('rr', 1)))); t += 6.7
t += 0.5
marks.append(('slow chord of three zones (C5, E5, A5), nv', t))
for n in ['C5', 'E5', 'A5']:
    ev.append((t, f.play('nv', n, 6.0, layer=1)))
t += 7.5
for s in ('nv', 'vib'):
    marks.append((f'held A4 then F#5, E5, D5, A4 at 1.5 s each ({s})', t))
    ev.append((t, f.play(s, 'A4', 6.0, layer=2))); t += 6.0 + 0.8
    for n in ['Fs5', 'E5', 'D5', 'A4']:
        ev.append((t, f.play(s, n, 1.5, layer=2))); t += 1.5
    t += 1.5
write('flute-demo.wav', mix(ev, 1, marks))
with open(f'{OUT}/README.txt', 'w') as fh:
    for name, mk in (('harp-demo.wav', hm), ('flute-demo.wav', marks)):
        fh.write(name + '\n' + ''.join(f'  {int(t // 60)}:{t % 60:05.2f}  {m}\n' for m, t in mk))
print(open(f'{OUT}/README.txt').read())
