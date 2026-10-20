"""ebb support kit: nylon guitar (University of Iowa MIS Guitar, Raimundo 118, 2011; mono 24-bit 96 kHz).

Each source file is one string at one dynamic, playing a chromatic run (the name gives the range, e.g.
Guitar.mf.sulA.C3B3.aif is C3 to B3 on the A string; sul_E is the high E string). This script:
  1. finds every pluck in every run (energy onsets), names it by its place in the run, and checks the
     name against the measured pitch (partials fit, plib.measure_pitch);
  2. for each game zone (every minor third, E2 to Bb5) and layer (v1 = pp, v2 = mf, v3 = ff: the clean,
     bright melody sound), picks the take
     on the string that plays it nearest the third fret (warm, not an open string ringing on);
  3. trims it to 3 ms before the onset, cuts it at the next pluck or 4 s (whichever first) with a
     250 ms equal-power fade, resamples to 48 kHz, keeps the recorded level, and encodes Ogg Opus
     56 kbps and AAC 80 kbps mono into assets/audio/instruments/guitar/.
Writes results.json next to the work folder for build.py.

Usage: python prep.py <source folder with the .aif files> <work folder> [<repo>]
       python prep.py <src> <work> --survey   (step 1 only: print what each run holds)
"""
import os, sys, json, math, re, subprocess
import numpy as np, soundfile as sf
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'piano'))
import plib

SRC, WORK = sys.argv[1], sys.argv[2]
REPO = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith('--') else os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SURVEY = '--survey' in sys.argv
SR = 48000
OPEN = {'sulE': 40, 'sulA': 45, 'sulD': 50, 'sulG': 55, 'sulB': 59, 'sul_E': 64}
STRING_NAME = {'sulE': 'low E', 'sulA': 'A', 'sulD': 'D', 'sulG': 'G', 'sulB': 'B', 'sul_E': 'high E'}
ZONES = list(range(40, 83, 3))            # E2, G2, Bb2, C#3 ... G5, Bb5 (every minor third)
LAYERS = {1: 'pp', 2: 'mf', 3: 'ff'}
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')


FLATS = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}


def sharp(n):
    """'Bb5' -> 'A#5' (plib reads sharps)."""
    return FLATS.get(n[:2], n[:2]) + n[2:] if len(n) == 3 and n[1] == 'b' else n


def parse_name(fn):
    """Guitar.mf.sulA.C3B3.aif -> ('mf', 'sulA', [48..59]); a single note (B3) -> [59]."""
    m = re.match(r'Gui(?:tar|atr)\.(pp|mf|ff)\.(sul_?[EADGB])\.([A-G]b?\d)([A-G]b?\d)?\.aif$', fn)
    if not m:
        return None
    dyn, st, a, b = m.groups()
    lo = plib.parse_note(sharp(a))
    hi = plib.parse_note(sharp(b)) if b else lo
    return dyn, st, list(range(lo, hi + 1))


def onsets(x, sr):
    """Every pluck onset: 10 ms RMS envelope, rises of 12 dB or more within 50 ms, at least 0.7 s apart
    (the strongest rise wins when two are closer)."""
    hop = int(0.005 * sr); win = int(0.01 * sr)
    sq = x * x
    cs = np.concatenate([[0], np.cumsum(sq)])
    idx = np.arange(0, len(x) - win, hop)
    env = 10 * np.log10((cs[idx + win] - cs[idx]) / win + 1e-20)
    look = int(0.05 * sr / hop)
    rise = np.full(len(env), -99.0)
    for k in range(look, len(env)):
        rise[k] = env[k] - env[max(0, k - look):k].min()
    peak = env.max()
    cand = [k for k in range(1, len(env) - 1) if rise[k] >= 15 and env[k] > peak - 45 and rise[k] >= rise[k - 1] and rise[k] >= rise[k + 1]]
    cand.sort(key=lambda k: -rise[k])
    picked = []
    gap = int(0.7 * sr / hop)
    for k in cand:
        if all(abs(k - p) > gap for p in picked):
            picked.append(k)
    picked.sort()
    # back up from the envelope peak of the rise to where the pluck first appears (-30 dB of its peak)
    out = []
    for k in picked:
        s = idx[max(0, k - look)]
        e = idx[min(len(idx) - 1, k + look)]
        seg = np.abs(x[s:e]); pk = seg.max()
        first = np.nonzero(seg > pk * 10 ** (-30 / 20))[0]
        out.append(int(s + (first[0] if len(first) else 0)))
    return out


def rough_midi(x, sr, lo, hi):
    """A quick pitch (fractional MIDI) by harmonic sum over the run's range, from 0.1 to 0.6 s in."""
    seg = x[int(0.1 * sr):int(0.6 * sr)]
    if len(seg) < int(0.2 * sr):
        seg = x[:int(0.5 * sr)]
    n = 1 << 18
    X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n=n))
    f = np.fft.rfftfreq(n, 1 / sr)
    best = (-1, None)
    for m10 in range(lo * 10 - 8, hi * 10 + 9):
        f0 = plib.midi_hz(m10 / 10)
        s = 0.0
        for h in range(1, 6):
            k = int(round(f0 * h * n / sr))
            if k + 3 < len(X):
                s += X[k - 3:k + 4].max() / h ** 0.5
        if s > best[0]:
            best = (s, m10 / 10)
    return best[1]

def eqp_fade(n):
    t = (np.arange(n) + 0.5) / n
    return np.cos(0.5 * np.pi * t)


def survey():
    takes = []
    for fn in sorted(os.listdir(SRC)):
        p = parse_name(fn)
        if not p:
            continue
        dyn, st, notes = p
        x, sr0 = sf.read(os.path.join(SRC, fn), dtype='float64', always_2d=True)
        x = x[:, 0]
        ons = onsets(x, sr0)
        ends = ons[1:] + [len(x)]
        checks = []
        named = {}
        # Each pluck is named by its pitch (the instrument sits 15 to 45 cents flat, so round up a little),
        # not by its place in the run, so a missed or doubled onset cannot shift the names.
        for on, end in zip(ons, ends):
            sl = x[on:end - int(0.01 * sr0)]
            m = rough_midi(sl, sr0, notes[0], notes[-1])
            midi = int(round(m + 0.25))
            if midi not in notes:
                continue
            r = plib.measure_pitch(sl[:, None], sr0, 0, midi, 'piano')
            cents = r['cents'] if r.get('ok') else None
            prev = named.get(midi)
            # several onsets name one note (ripples in a ringing string): keep the strongest attack
            att = float(np.max(np.abs(sl[:int(0.1 * sr0)])))
            if prev is not None and prev['attack'] >= att:
                continue
            named[midi] = dict(file=fn, dyn=dyn, string=st, midi=midi, note=plib.midi_name(midi), fret=midi - OPEN[st],
                               onset=on, end=end, srcRate=sr0, cents=None if cents is None else round(cents, 2),
                               peakDb=round(plib.db(float(np.max(np.abs(x[on:end])))), 2), attack=att)
        # each note ends where the next note's attack begins
        order = sorted(named.values(), key=lambda d: d['onset'])
        for a, b in zip(order, order[1:] + [None]):
            a['end'] = b['onset'] if b else len(x)
            a['gapS'] = round((a['end'] - a['onset']) / sr0, 3)
        takes += order
        checks = [named[m]['cents'] if m in named else None for m in notes]
        bad = [f'{plib.midi_name(m)} {"?" if c is None else round(c)}' for m, c in zip(notes, checks) if c is None or abs(c) > 45]
        print(f"{fn:34s} {len(named):2d} of {len(notes):2d} notes ({len(ons)} plucks)  peak {plib.db(float(np.max(np.abs(x)))):6.1f} dB"
              + (f"  OFF PITCH OR UNMEASURED: {bad}" if bad else ''), flush=True)
    return takes


def choose(takes):
    """For each zone and layer, the take nearest the third fret (no open strings unless nothing else)."""
    sel = []
    for z in ZONES:
        for layer, dyn in LAYERS.items():
            c = [t for t in takes if t['midi'] == z and t['dyn'] == dyn and t['cents'] is not None and abs(t['cents']) <= 70]
            if not c:
                print('no usable take for', plib.midi_name(z), dyn); continue
            c.sort(key=lambda t: (t['fret'] == 0, abs(t['fret'] - 3), -OPEN[t['string']]))
            sel.append(dict(c[0], layer=layer))
    return sel


def process(t):
    x, sr0 = sf.read(os.path.join(SRC, t['file']), dtype='float64', always_2d=True)
    x = x[:, :1]
    start = max(0, t['onset'] - int(round(0.003 * sr0)))
    end = min(t['end'] - int(0.02 * sr0), start + int(4.0 * sr0))
    y = x[start:end].copy()
    y = resample_poly(y, 1, 2, axis=0) if sr0 == 96000 else resample_poly(y, SR, sr0, axis=0)
    nf = int(0.25 * SR)
    nf = min(nf, len(y) // 3)
    y[-nf:] *= eqp_fade(nf)[:, None]
    y[-1:] = 0
    on = int(round(0.003 * SR))
    pk = float(np.max(np.abs(y)))
    seg = y[on:on + int(0.3 * SR)]
    r = plib.measure_pitch(y, SR, on, t['midi'], 'piano')
    out = f"pluck/{plib.midi_name(t['midi'])}-v{t['layer']}"
    res = dict(t, out=out, lenS=round(len(y) / SR, 4), trimStartMs=round(start / sr0 * 1000, 1),
               peakDb=round(plib.db(pk), 2), attackRmsDb=round(plib.db(float(np.sqrt(np.mean(seg ** 2)))), 2),
               endReason='next pluck' if end < start + int(4.0 * sr0) else 'max length', channels=1)
    res['pitch'] = dict(cents=round(r['cents'], 2), nPartials=r['nPartials'], partials=r['partialNs'],
                        residCents=None if math.isnan(r['resid']) else round(r['resid'], 2)) if r.get('ok') else None
    wav = os.path.join(WORK, 'wav', out + '.wav')
    os.makedirs(os.path.dirname(wav), exist_ok=True)
    sf.write(wav, y.astype(np.float32), SR, subtype='FLOAT')
    ob = os.path.join(REPO, 'assets', 'audio', 'instruments', 'guitar', out)
    os.makedirs(os.path.dirname(ob), exist_ok=True)
    subprocess.run([FFMPEG, '-y', '-v', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', '56k', '-vbr', 'on',
                    '-application', 'audio', '-map_metadata', '-1', ob + '.ogg'], check=True)
    subprocess.run([FFMPEG, '-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '80k',
                    '-map_metadata', '-1', '-movflags', '+faststart', ob + '.m4a'], check=True)
    res['oggBytes'] = os.path.getsize(ob + '.ogg'); res['m4aBytes'] = os.path.getsize(ob + '.m4a')
    return res


if __name__ == '__main__':
    os.makedirs(WORK, exist_ok=True)
    takes = survey()
    json.dump(takes, open(os.path.join(WORK, 'takes.json'), 'w'), indent=1)
    if SURVEY:
        sys.exit(0)
    sel = choose(takes)
    out = [process(t) for t in sel]
    json.dump(out, open(os.path.join(WORK, 'results.json'), 'w'), indent=1)
    for r in out:
        print(r['out'], STRING_NAME[r['string']], 'fret', r['fret'], r['pitch'] and r['pitch']['cents'], r['lenS'], r['endReason'], r['oggBytes'])
    print('total ogg', sum(r['oggBytes'] for r in out), 'bytes,', len(out), 'files')
