"""Prep VCSL vibraphone (struck soft mallets, bowed) and wine glasses for ebb.

All processing happens at 48 kHz mono (float), so loop points in samples match the decoded Opus.
Writes processed WAVs to <work>/wav, encodes .ogg/.m4a into the repo, verifies, dumps results JSON.
"""
import sys, os, json, glob, re, subprocess
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, '/tmp/ebb-audio-work/piano-prep')
import plib

KIT = '/tmp/ebb-audio-work/kit/vibraphone'
SRC = KIT + '/src/vcsl/Idiophones'
REPO = '/home/claude/ebb'
SR = 48000
XF_S = 0.25          # baked loop crossfade
STRUCK_MAX_S = 5.0
FADE_S = 0.25
OPUS_K, AAC_K = '56k', '80k'


def jobs():
    out = []
    vib = SRC + '/Struck Idiophones/Vibraphone'
    for p in sorted(glob.glob(vib + '/Soft Mallets/*.wav')):
        m = re.search(r'Vibes_soft_([A-G]#?\d)_v(\d)_rr(\d)', os.path.basename(p))
        midi = plib.parse_note(m.group(1)) + 12          # VCSL vibes names sit one octave low (measured)
        out.append(dict(inst='vibraphone', set='struck', src=p, midi=midi, layer=int(m.group(2)), kind='struck'))
    for p in sorted(glob.glob(vib + '/Bowed/*.wav')):
        m = re.search(r'Vibes_bowed_([A-G]#?\d)_rr', os.path.basename(p))
        midi = plib.parse_note(m.group(1)) + 12
        out.append(dict(inst='vibraphone', set='bowed', src=p, midi=midi, layer=1, kind='loop'))
    gl = SRC + '/Friction Idiophones/Wine Glasses/Sustains'
    # glasses are untuned household glasses: place each at its nearest note by measurement (see measure_glass)
    for speed, layer in (('Slow', 1), ('Fast', 2)):
        for p in sorted(glob.glob(f'{gl}/{speed}/*.wav')):
            out.append(dict(inst='glass', set='sus', src=p, midi=None, layer=layer, kind='loop', speed=speed))
    groups = {}
    for j in out:
        j['srcName'] = os.path.basename(j['src'])
        g = (j['inst'], j['set'], re.sub(r'_(v\d_rr\d|Slow_\d|Fast_\d)_', '_', j['srcName']).lower())
        x, xsr = plib.load(j['src'])
        on = plib.onset_index(x)[0]
        # the microphone that carries more of the ring (energy from 0.8 s after the onset on)
        groups.setdefault(g, []).append((j, np.sum(x[on + int(0.8 * xsr):] ** 2, axis=0)))
    for g, items in groups.items():
        e = sum(v for _, v in items)
        ch = int(np.argmax(e))
        for j, _ in items:
            j['ch'] = ch
            j['chName'] = 'left' if ch == 0 else 'right'
    return out


def to48_mono(x, sr, ch):
    L, R = x[:, 0], x[:, 1] if x.shape[1] > 1 else x[:, 0]
    st = dict(lrCorr=round(float(np.corrcoef(L, R)[0, 1]), 3),
              midLossDb=round(plib.db(np.sqrt(np.mean(((L + R) / 2) ** 2))) -
                              plib.db(np.sqrt((np.mean(L ** 2) + np.mean(R ** 2)) / 2)), 2),
              lrBalanceDb=round(plib.db(np.sqrt(np.mean(L ** 2))) - plib.db(np.sqrt(np.mean(R ** 2))), 2))
    m = x[:, ch].copy()      # the louder microphone of this note (the one nearer the bar)
    if sr != SR:
        m = resample_poly(m, 160, 147) if sr == 44100 else resample_poly(m, SR, sr)
    return m, st


def f1_measure(y, a, b, fnom, search_c=80):
    """Partial-1 frequency from a zero-padded Hann FFT, searched within +-search_c cents of fnom."""
    seg = y[a:b] - y[a:b].mean()
    L = len(seg)
    n = 1 << 22
    while n < 8 * L:
        n <<= 1
    P = np.abs(np.fft.rfft(seg * np.hanning(L), n=n)) ** 2
    df = SR / n
    lo = int(fnom * 2 ** (-search_c / 1200) / df); hi = int(fnom * 2 ** (search_c / 1200) / df) + 1
    k = lo + int(np.argmax(P[lo:hi]))
    la, lb, lc = np.log(P[k - 1:k + 2] + 1e-30)
    d = 0.5 * (la - lc) / (la - 2 * lb + lc)
    f = (k + d) * df
    # level of partial 1 vs strongest component below 8 kHz
    top = P[int(40 / df):int(8000 / df)].max()
    return f, 10 * np.log10(P[k] / top)


def brightness(y, on, midi):
    seg = y[on:on + int(0.3 * SR)]
    P = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    cut = max(1.5 * plib.midi_hz(midi), 1000.0)
    tot = P[f > 20].sum()
    return float(P[f >= cut].sum() / tot)


def env_db(y, win=0.05, hop=0.01):
    st, e = plib.rms_env(y * y, SR, win, hop)
    return st, 20 * np.log10(e + 1e-12)


def band_db(seg):
    """1/3-octave band levels 100 Hz..12 kHz of a segment."""
    P = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    edges = 100 * 2 ** (np.arange(0, 22) / 3)
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        k = (f >= a) & (f < b)
        out.append(10 * np.log10(P[k].sum() + 1e-20))
    return np.array(out)


def find_loop(y, midi, min_len=1.5, max_len=4.0, max_end=None, env_win=0.1, tol_db=4.5):
    """Pick loop [s, e) in the steady part. Returns dict with samples and scores."""
    X = int(XF_S * SR)
    st, ed = env_db(y, env_win, 0.01)
    imax = int(np.argmax(ed))
    pk = ed[imax]
    # steady part: from the first frame within 4 dB of the max level (after the swell), to the last such frame
    ok = ed > pk - tol_db
    first = int(np.argmax(ok))
    last = len(ok) - 1 - int(np.argmax(ok[::-1]))
    t_first = st[first] / SR + 0.35            # skip the end of the swell / attack
    t_last = st[last] / SR
    if max_end:
        t_last = min(t_last, max_end)
    t_first = max(t_first, XF_S + 0.1)
    hop = 0.02
    starts = np.arange(t_first, t_last - min_len, hop)
    # precompute per 20 ms grid: RMS and band levels of the X window ending at t
    grid = np.arange(t_first - 0.001, t_last + hop, hop)
    st2, ed2 = env_db(y, 0.02, 0.01)          # fine envelope, 10 ms hop
    feats = {}
    def feat(t):
        key = round(t / hop)
        if key not in feats:
            i = int(round(t * SR))
            seg = y[i - X:i]
            k = int(round(t / 0.01))
            feats[key] = (plib.db(np.sqrt(np.mean(seg ** 2))), band_db(seg), ed2[k - 25:k + 10])
        return feats[key]
    best = None
    for s in starts:
        Ls = np.arange(min_len, min(max_len, t_last - s) + 1e-9, hop)
        for Lt in Ls:
            e = s + Lt
            ls, bs, es = feat(s); le, be, ee = feat(e)
            w = bs > bs.max() - 40
            spec = float(np.mean(np.abs(bs[w] - be[w])))
            shape = float(np.mean(np.abs(es - ee)))      # envelope shape around both ends (warble phase)
            sc = abs(ls - le) * 1.5 + shape * 1.0 + spec * 0.6 + max(0, pk - max(ls, le) - 2) * 0.5 - 0.25 * Lt
            if best is None or sc < best[0]:
                best = (sc, s, e, ls - le, spec)
    _, s, e, dlev, spec = best
    si = int(round(s * SR)); ei = int(round(e * SR))
    # snap start to an upward zero crossing near si
    z = np.nonzero((y[si - 2000:si + 2000 - 1] <= 0) & (y[si - 2000 + 1:si + 2000] > 0))[0] + si - 2000 + 1
    si = int(z[np.argmin(np.abs(z - si))])
    # choose end by correlation of the X windows (coherent crossfade), within +-12 ms, end on an upward crossing
    ref = y[si - X:si]
    best_r, best_e = -2, ei
    for cand in range(ei - int(0.012 * SR), ei + int(0.012 * SR)):
        if not (y[cand - 1] <= 0 < y[cand]):
            continue
        w = y[cand - X:cand]
        r = float(np.dot(ref, w) / np.sqrt(np.dot(ref, ref) * np.dot(w, w)))
        if r > best_r:
            best_r, best_e = r, cand
    return dict(s=si, e=best_e, r=best_r, coarseLevelDiffDb=round(float(dlev), 2), coarseSpecDb=round(spec, 2),
                plateau=(round(t_first, 2), round(t_last, 2)))


def bake_loop(y, s, e, r):
    """Blend the X samples before s into the X samples before e (correlation-aware equal-power law)."""
    X = int(XF_S * SR)
    t = (np.arange(X) + 0.5) / X
    a = np.sin(0.5 * np.pi * t)          # incoming (pre-start material)
    b = np.cos(0.5 * np.pi * t)          # outgoing (pre-end material)
    rr = max(0.0, min(1.0, r))
    norm = np.sqrt(a * a + b * b + 2 * rr * a * b)
    a, b = a / norm, b / norm
    out = y[:e].copy()
    out[e - X:e] = y[e - X:e] * b + y[s - X:s] * a
    return out


def decode(path, ch=1):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(SR), '-'],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).astype(np.float64)


def lag_of(a, b, maxlag=2400):
    """Lag (samples) of decoded b against processed a, from full-length FFT cross-correlation (+-50 ms)."""
    n = 1 << int(np.ceil(np.log2(len(a) + len(b))))
    c = np.fft.irfft(np.fft.rfft(b, n) * np.conj(np.fft.rfft(a, n)), n)
    cand = np.concatenate([c[:maxlag + 1], c[-maxlag:]])
    lags = np.concatenate([np.arange(maxlag + 1), np.arange(-maxlag, 0)])
    return int(lags[int(np.argmax(cand))])


def seam_check(d, s, e, reps=4):
    """Play [0,s) then [s,e) reps times. Largest step at seams vs the steady part; level change across seams."""
    loop = d[s:e]
    y = np.concatenate([d[:s]] + [loop] * reps)
    seams = [s + k * (e - s) for k in range(1, reps)]
    dif = np.abs(np.diff(y))
    steady = dif[s:e - 1]
    steady_max = float(steady.max()); steady_p999 = float(np.percentile(steady, 99.9))
    seam_step = max(float(dif[q - 1]) for q in seams)          # step from sample q-1 to q
    w = int(0.05 * SR)
    lev = []
    for q in seams:
        lev.append(abs(plib.db(np.sqrt(np.mean(y[q - w:q] ** 2))) - plib.db(np.sqrt(np.mean(y[q:q + w] ** 2)))))
    nat = []
    for q in range(s + w, e - w, int(0.01 * SR)):
        nat.append(abs(plib.db(np.sqrt(np.mean(y[q - w:q] ** 2))) - plib.db(np.sqrt(np.mean(y[q:q + w] ** 2)))))
    return dict(seamStep=seam_step, steadyMaxStep=steady_max, steadyP999=steady_p999,
                seamToSteadyMax=round(seam_step / steady_max, 3), seamLevelDb=round(max(lev), 3),
                naturalLevelDbMedian=round(float(np.median(nat)), 3), naturalLevelDbP95=round(float(np.percentile(nat, 95)), 3))


def process(job):
    x, sr = plib.load(job['src'])
    y, chst = to48_mono(x, sr, job['ch'])
    res = dict(job); res.update(chst); res['srcRate'] = sr; res['srcChannels'] = x.shape[1]
    res['srcLenS'] = round(len(x) / sr, 3)
    probs = []
    pk0 = float(np.max(np.abs(y)))
    on = plib.onset_index(y[:, None], -50.0)[0]
    start = max(0, on - int(round(0.003 * SR)))
    y = y[start:]; on -= start
    res['trimStartMs'] = round(start / SR * 1000, 1)
    # glass: name from measurement
    if job['inst'] == 'glass':
        # household glasses, not tuned: each is placed at the note nearest its measured pitch (survey.py, both
        # rubbing speeds averaged); the file names are an octave low and, for glass3, a semitone off
        nm = re.search(r'glass\d_([A-G]#?\d)_', job['srcName']).group(1)
        res['namedNote'] = nm
        place = {'D#4': 'D#5', 'F#4': 'F#5', 'A#4': 'B5', 'D5': 'D6'}[nm]
        job['midi'] = res['midi'] = plib.parse_note(place)
    midi = job['midi']
    fnom = plib.midi_hz(midi)
    res['note'] = plib.midi_name(midi)
    seg = y[on:on + int(0.3 * SR)]
    res['attackRmsDb'] = round(plib.db(float(np.sqrt(np.mean(seg ** 2)))), 2)
    res['brightness'] = round(brightness(y, on, midi), 5)
    # pitch: two windows, report the mean and their spread
    if job['kind'] == 'struck':
        wins = [(0.2, 1.0), (1.0, 2.0)] if fnom < 1000 else [(0.1, 0.6), (0.6, 1.2)]
    else:
        wins = None
    if job['kind'] == 'struck':
        e0 = len(y)
        st, ed = env_db(y)
        pk_db = ed.max()
        imax = int(np.argmax(ed))
        below = np.nonzero(ed[imax:] <= pk_db - 60)[0]
        cut = st[imax + below[0]] + int(0.05 * SR) if len(below) else len(y)
        cut = min(cut, int(STRUCK_MAX_S * SR), len(y))
        res['tailCut'] = 'minus60dB' if cut < int(STRUCK_MAX_S * SR) and len(below) else 'maxLen'
        res['tailLevelAtCutDb'] = round(float(ed[min(len(ed) - 1, max(0, cut // int(0.01 * SR) - 5))] - pk_db), 1)
        y = y[:cut].copy()
        F = int(FADE_S * SR)
        t = (np.arange(F) + 0.5) / F
        y[-F:] *= np.cos(0.5 * np.pi * t)
        res['loop'] = None
    else:
        if job['inst'] == 'vibraphone':
            lp = find_loop(y, midi, min_len=1.5, max_len=4.0)
        else:   # glass: warbling level, so judge the steady part on a 0.8 s envelope; keep files short
            lp = find_loop(y, midi, min_len=1.5, max_len=3.5, max_end=8.0, env_win=0.8, tol_db=6.0)
        res['loopSearch'] = dict(r=round(lp['r'], 4), coarseLevelDiffDb=lp['coarseLevelDiffDb'],
                                 coarseSpecDb=lp['coarseSpecDb'], steadyS=lp['plateau'])
        y = bake_loop(y, lp['s'], lp['e'], lp['r'])
        res['loopSamples'] = (lp['s'], lp['e'])
        res['loop'] = dict(startS=round(lp['s'] / SR, 6), endS=round(lp['e'] / SR, 6))
        wins = [(lp['s'] / SR - 1.0, lp['s'] / SR), (lp['s'] / SR, lp['e'] / SR)]
        lr = y[lp['s']:lp['e']]
        res['loopRmsDb'] = round(plib.db(float(np.sqrt(np.mean(lr ** 2)))), 2)
    cents = []
    for a, b in wins:
        f, rel = f1_measure(y, int(max(0, a) * SR) + on, int(b * SR) + on if job['kind'] == 'struck' else int(b * SR), fnom)
        cents.append(1200 * np.log2(f / fnom))
    res['measuredCents'] = round(float(np.mean(cents)), 2)
    res['windowSpreadCents'] = round(float(abs(cents[0] - cents[1])), 2)
    res['partial1RelDb'] = round(float(rel), 1)
    res['peakDb'] = round(plib.db(float(np.max(np.abs(y)))), 2)
    res['lenS'] = round(len(y) / SR, 4)
    # write and encode
    wav = f"{KIT}/wav/{job['inst']}/{job['set']}/{res['note']}-v{job['layer']}.wav"
    os.makedirs(os.path.dirname(wav), exist_ok=True)
    sf.write(wav, y.astype(np.float32), SR, subtype='FLOAT')
    base = f"{REPO}/assets/audio/instruments/{job['inst']}/{job['set']}/{res['note']}-v{job['layer']}"
    os.makedirs(os.path.dirname(base), exist_ok=True)
    res['file'] = f"{job['set']}/{res['note']}-v{job['layer']}"
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', OPUS_K, '-vbr', 'on',
                    '-application', 'audio', '-map_metadata', '-1', base + '.ogg'], check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', AAC_K, '-ar', str(SR),
                    '-map_metadata', '-1', '-movflags', '+faststart', base + '.m4a'], check=True)
    res['oggBytes'] = os.path.getsize(base + '.ogg'); res['m4aBytes'] = os.path.getsize(base + '.m4a')
    ver = {}
    for ext in ('ogg', 'm4a'):
        d = decode(base + '.' + ext)
        lag = lag_of(y, d)
        v = dict(lenDiffMs=round((len(d) - len(y)) / SR * 1000, 3), lagMs=round(lag / SR * 1000, 3))
        if res['loop']:
            s, e = res['loopSamples']
            dd = d[lag:] if lag >= 0 else np.concatenate([np.zeros(-lag), d])
            v['seam'] = seam_check(dd, s, e)
            # the same check on the processed WAV, for reference
        ver[ext] = v
    if res['loop']:
        s, e = res['loopSamples']
        ver['wav'] = dict(seam=seam_check(y, s, e))
    res['verify'] = ver
    if abs(ver['ogg']['lagMs']) > 1:
        probs.append(f"decoded .ogg is offset by {ver['ogg']['lagMs']} ms")
    res['problems'] = probs
    res.pop('src')
    return res


if __name__ == '__main__':
    J = jobs()
    with ProcessPoolExecutor() as ex:
        R = list(ex.map(process, J))
    json.dump(R, open(KIT + '/results.json', 'w'), indent=1, default=float)
    for r in R:
        lp = r.get('loop')
        print(f"{r['inst']:10s} {r['file']:14s} {r['srcName']:36s} pk{r['peakDb']:6.1f} att{r['attackRmsDb']:6.1f} "
              f"br{r['brightness']:.3f} c{r['measuredCents']:+6.2f} sp{r['windowSpreadCents']:.2f} len{r['lenS']:6.2f} "
              f"ogg{r['oggBytes']:7d} {r['chName'][0]} "
              f"lag ogg {r['verify']['ogg']['lagMs']} m4a {r['verify']['m4a']['lagMs']} dlen m4a {r['verify']['m4a']['lenDiffMs']} ogg {r['verify']['ogg']['lenDiffMs']}")
        if lp:
            so = r['verify']['ogg']['seam']; sw = r['verify']['wav']['seam']
            print(f"      loop {lp} r={r['loopSearch']['r']} ogg seam/steadyMax {so['seamToSteadyMax']} lev {so['seamLevelDb']} dB (natural med {so['naturalLevelDbMedian']} p95 {so['naturalLevelDbP95']}) | wav {sw['seamToSteadyMax']} lev {sw['seamLevelDb']} | m4a {r['verify']['m4a']['seam']['seamToSteadyMax']}")
