"""Build the Steinway B phone ("mobile") set for ebb.
Usage: python3 -I mobile.py encode|measure
encode: shapes and encodes every candidate file into scratch/piano-prep/mobile-out/ (all three layers
        of each zone, so the layer choice can be made from numbers; only the chosen ones go to the repo).
measure: decodes each .ogg at 48 kHz and measures peak, attack level, length, brightness and pitch,
         the same way the game set and the first prep did. Writes mobile-measure.json."""
import sys, os, json, subprocess, warnings
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
warnings.filterwarnings('ignore')
import numpy as np
import soundfile as sf
from multiprocessing import Pool
import plib

SP = '/tmp/ebb-audio-work'
SRC = SP + '/piano-prep/wav/piano-steinway-b'
PED = SP + '/piano-prep/wav/piano-knight-upright'
OUT = SP + '/piano-prep/mobile-out'
REC = '/home/claude/ebb/recipes/music/instruments/piano-steinway-b.json'
TAIL = 2.5          # seconds, sustain tails (game set: 4)
FADE = 0.25         # seconds, the game set's quarter-cosine fade
OPUS = '60k'        # mono Opus (game set mono: 60k)
AAC = '80k'         # mono AAC (game set mono: 80k)
ZONES = list(range(34, 99, 4))   # A#1 to D7, every major third
PEDAL = ['down-1', 'down-3', 'up-1', 'up-3']


def shape(x, sr, cut):
    if x.ndim == 1:
        x = x[:, None]
    n = min(len(x), int(cut * sr)) if cut else len(x)
    y = x[:n].copy()
    if n < len(x):
        f = int(FADE * sr)
        y[-f:] *= np.cos(np.linspace(0, np.pi / 2, f))[:, None]
    # Mono from the left mic alone: averaging the spaced pair cancels the fundamental of some notes
    # (A#3, F#5, D6 and A#6 lost 4 to 11 dB), and the left mic alone tracks the pair's colour best.
    return y[:, :1].astype(np.float32)


PARTNER = {'sus': 1, 'nosus': 2}   # the soft mobile layer each set's loud layer (v3) is lined up with


def shift(x, k):
    """Delay (k > 0) or advance (k < 0) a recording by k samples; the length stays the same."""
    y = np.zeros_like(x)
    if k >= 0:
        y[k:] = x[:len(x) - k]
    else:
        y[:len(x) + k] = x[-k:]
    return y


def align_lag(soft, loud, sr, midi):
    """Samples to delay the loud recording so its attack lines up in phase with the soft one, over the
    first 125 ms (both files start 3 ms before their onset), searched within one period of the
    fundamental and never more than 2 ms. Mixing two layers in a velocity blend then adds instead of
    partly cancelling (measured: up to 4.8 dB lost at A#6 without it)."""
    a = soft[:, 0]; b = loud[:, 0]; n = min(int(0.125 * sr), len(a), len(b))
    lim = min(int(round(sr / plib.midi_hz(midi))), int(0.002 * sr))
    best, bk = -np.inf, 0
    for k in range(-lim, lim + 1):
        if k >= 0: c = np.dot(a[k:n], b[:n - k])
        else: c = np.dot(a[:n + k], b[-k:n])
        if c > best: best, bk = c, k
    return bk


def enc(a):
    src, out, cut, lag = a
    x, sr = sf.read(src, dtype='float32', always_2d=True)
    if lag:
        x = shift(x, lag)
    y = shape(x, sr, cut)
    if out.startswith('pedal/'):
        # The sampler plays the pedal sound at a fixed level (no leveling), so the left mic alone is
        # brought to the pair's attack loudness, which is what the desktop files have.
        a = np.abs(x).max(1); on = int(np.argmax(a > a.max() * 10 ** (-50 / 20))); n = int(0.3 * sr)
        g = np.sqrt(np.mean(x[on:on + n] ** 2) / np.mean(y[on:on + n] ** 2))
        y = (y * g).astype(np.float32)
    tmp = f'{OUT}/tmp/{out}.wav'
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    sf.write(tmp, y, sr, subtype='FLOAT')
    o = f'{OUT}/{out}'
    os.makedirs(os.path.dirname(o), exist_ok=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-c:a', 'libopus', '-b:a', OPUS, '-vbr', 'on',
                    '-application', 'audio', '-ar', '48000', o + '.ogg'], check=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-c:a', 'aac', '-b:a', AAC, o + '.m4a'], check=True)
    os.remove(tmp)
    return out, os.path.getsize(o + '.ogg'), os.path.getsize(o + '.m4a')


def jobs():
    rec = json.load(open(REC))
    j = []
    for s in ('sus', 'nosus', 'rel'):
        for z in rec['sets'][s]['zones']:
            if z['midi'] not in ZONES:
                continue
            by = {L['layer']: L for L in z['layers']}
            for L in z['layers']:
                lag = 0
                if s in PARTNER and L['layer'] == 3:
                    soft, sr = sf.read(f"{SRC}/{by[PARTNER[s]]['file']}.wav", dtype='float32', always_2d=True)
                    loud, _ = sf.read(f"{SRC}/{L['file']}.wav", dtype='float32', always_2d=True)
                    lag = align_lag(soft, loud, sr, z['midi'])
                    LAGS[L['file']] = lag
                j.append((f"{SRC}/{L['file']}.wav", L['file'], None if s == 'rel' else TAIL, lag))
    for p in PEDAL:
        j.append((f'{PED}/pedal/{p}.wav', f'pedal/{p}', TAIL, 0))
    return j


LAGS = {}


def dec(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def brightness(x, sr, onset, midi):
    seg = x[onset:onset + int(0.3 * sr)]
    w = np.hanning(len(seg))
    P = np.abs(np.fft.rfft(seg * w)) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    cut = max(1.5 * plib.midi_hz(midi), 1000.0)
    tot = P[f > 20].sum()
    return float(P[f >= cut].sum() / tot) if tot > 0 else None


def meas(a):
    file, midi, s = a
    x = dec(f'{OUT}/{file}.ogg')
    sr = 48000
    ab = np.abs(x)
    pk = ab.max()
    on = int(np.argmax(ab > pk * 10 ** (-50 / 20)))
    w = x[on:on + int(0.3 * sr)]
    r = dict(peakDb=round(float(20 * np.log10(pk + 1e-12)), 2),
             attackRmsDb=round(float(10 * np.log10(np.mean(w ** 2) + 1e-20)), 2),
             lenS=round(len(x) / sr, 3), channels=1)
    if midi is not None:
        r['brightness'] = round(brightness(x, sr, on, midi), 5)
    if s in ('sus', 'nosus'):
        p = plib.measure_pitch(x[:, None], sr, on, midi, 'piano')
        if p.get('ok'):
            r['pitch'] = dict(cents=round(p['cents'], 2), nPartials=p['nPartials'], partials=p['partialNs'],
                              resid=None if np.isnan(p['resid']) else round(p['resid'], 2), B=float('%.3g' % p['B']))
    return file, r


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'encode':
        jl = jobs()
        json.dump(LAGS, open(f'{SP}/piano-prep/mobile-lags.json', 'w'), indent=1)
        with Pool(os.cpu_count()) as pool:
            res = pool.map(enc, jl, chunksize=1)
        json.dump({o: [a, b] for o, a, b in res}, open(f'{OUT}/sizes.json', 'w'), indent=1)
        print(len(res), 'files; ogg', sum(r[1] for r in res), 'm4a', sum(r[2] for r in res))
    elif mode == 'measure':
        rec = json.load(open(REC))
        a = []
        for s in ('sus', 'nosus', 'rel'):
            for z in rec['sets'][s]['zones']:
                if z['midi'] in ZONES:
                    for L in z['layers']:
                        a.append((L['file'], z['midi'], s))
        for p in PEDAL:
            a.append((f'pedal/{p}', None, 'pedal'))
        with Pool(os.cpu_count()) as pool:
            m = dict(pool.map(meas, a, chunksize=1))
        json.dump(m, open(f'{SP}/piano-prep/mobile-measure.json', 'w'), indent=1)
        print(len(m), 'measured')
