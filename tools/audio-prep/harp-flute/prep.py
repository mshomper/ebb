"""ebb support kit: harp (VCSL Concert Harp, plucked) and flute (VSCO 2 CE, looped).
Usage: python3 -I prep.py  (writes processed WAVs to ../wav, encodes to the repo, results to ../results.json)"""
import os, sys, json, math, subprocess
from multiprocessing import Pool
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
sys.path.insert(0, '/tmp/ebb-audio-work/piano-prep')
import plib

KIT = '/tmp/ebb-audio-work/kit/harpflute'
REPO = '/home/claude/ebb'
VCSL_H = KIT + '/src/vcsl/Chordophones/Composite Chordophones/Concert Harp/'
VSCO_H = KIT + '/src/vsco/Strings/Harp/'
VSCO_F = KIT + '/src/vsco/Woodwinds/Flute/'
SR = 48000


def jobs():
    J = []
    # ---- harp: 19 zones B1..D7, v1 = mf, v2 = f
    hz = ['B1', 'D2', 'F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5', 'G5', 'B5', 'D6', 'F6', 'A6', 'D7']
    for n in hz:
        m = plib.parse_note(n)
        if n == 'C3':
            srcs = [(1, VSCO_H + 'KSHarp_C3_mf.wav', 'vsco'), (2, VCSL_H + 'KSHarp_C3_f2.wav', 'vcsl')]
        elif n == 'D7':
            srcs = [(1, VCSL_H + 'KSHarp_D7_f1.wav', 'vcsl'), (2, VSCO_H + 'KSHarp_D7_f.wav', 'vsco')]
        else:
            srcs = [(1, VCSL_H + f'KSHarp_{n}_mf1.wav', 'vcsl'), (2, VCSL_H + f'KSHarp_{n}_f1.wav', 'vcsl')]
        for layer, src, lib in srcs:
            J.append(dict(id='harp', set='sus', kind='pluck', note=n, midi=m, layer=layer, rr=None, src=src, lib=lib,
                          out=f'sus/{n}-v{layer}'))
    # ---- flute: names in VSCO are one octave low (C3 there sounds C4)
    nv = {'C3': (1, 3), 'E3': (1, 3), 'A3': (1, 3), 'C4': (1, 3), 'E4': (1, 3), 'A4': (1, 3), 'C5': (1, 2), 'E5': (1, 2), 'A5': (1, 3), 'C6': (1,)}
    for sn, lays in nv.items():
        m = plib.parse_note(sn) + 12; n = plib.midi_name(m)
        for i, v in enumerate(lays):
            J.append(dict(id='flute', set='nv', kind='loop', vib=False, note=n, midi=m, layer=i + 1, rr=None,
                          src=VSCO_F + f'susNV/LDFlute_susNV_{sn}_v{v}_1.wav', lib='vsco', out=f'nv/{n}-v{i + 1}'))
    vib = {'C3': 1, 'E3': 1, 'A3': 1, 'C4': 2, 'E4': 2, 'A4': 1, 'C5': 1, 'E5': 2, 'A5': 1, 'C6': 1}
    for sn, nrr in vib.items():
        m = plib.parse_note(sn) + 12; n = plib.midi_name(m)
        for rr in range(1, nrr + 1):
            J.append(dict(id='flute', set='vib', kind='loop', vib=True, note=n, midi=m, layer=1, rr=rr if nrr > 1 else None,
                          hasRR=nrr > 1, src=VSCO_F + f'susvib/LDFlute_susvib_{sn}_v1_{rr}.wav', lib='vsco',
                          out=f'vib/{n}-v1' + (f'-rr{rr}' if nrr > 1 else '')))
    return J


def eqp_fade(n):
    t = (np.arange(n) + 0.5) / n
    return np.cos(0.5 * np.pi * t)


def onset_at(x, rel_db):
    a = np.max(np.abs(x), axis=1); pk = a.max()
    idx = np.nonzero(a > pk * 10 ** (rel_db / 20))[0]
    return int(idx[0]) if len(idx) else 0


def brightness(x, sr, onset, midi):
    seg = x[onset:onset + int(0.3 * sr)]
    w = np.hanning(len(seg))[:, None]
    P = (np.abs(np.fft.rfft(seg * w, axis=0)) ** 2).sum(axis=1)
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    cut = max(1.5 * plib.midi_hz(midi), 1000.0)
    return float(P[f >= cut].sum() / P[f > 20].sum())


def decode(path, ch):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ar', str(SR), '-'], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, ch).astype(np.float64)


def lag_at(ref, dec, i, w=2048, maxlag=96):
    """Lag (samples) of dec against ref around index i, by cross-correlation (mono sum)."""
    a = ref[i - w:i + w].sum(1); best = (-2, 0)
    for L in range(-maxlag, maxlag + 1):
        b = dec[i - w + L:i + w + L].sum(1)
        if len(b) != len(a):
            continue
        c = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-20))
        if c > best[0]:
            best = (c, L)
    return best[1], round(best[0], 4)


# ---------------- loop finding -----------------
def frame_feats(y, sr, f0, hop):
    """Per-frame band levels (dB), RMS (dB) and fundamental pitch (cents re f0), 4096-pt frames centred on k*hop."""
    N = 4096; w = np.hanning(N); w2 = np.hanning(2048)
    nfr = (len(y) - N) // hop
    fr = np.fft.rfftfreq(N, 1 / sr)
    edges = f0 * 2 ** (np.arange(-0.5, 7.5, 1 / 3))
    edges = edges[edges < 16000]
    bands = [(fr >= a) & (fr < b) for a, b in zip(edges[:-1], edges[1:])]
    B = np.zeros((nfr, len(bands))); R = np.zeros(nfr); C = np.zeros(nfr)
    k0 = np.argmin(np.abs(fr - f0))
    for k in range(nfr):
        s = y[k * hop:k * hop + N]
        X = np.abs(np.fft.rfft(s * w)) ** 2
        B[k] = 10 * np.log10(np.array([X[b].sum() for b in bands]) + 1e-20)
        R[k] = 10 * np.log10(np.mean(s * s) + 1e-20)
        X = np.abs(np.fft.rfft(s[1024:3072] * w2, n=N)) ** 2   # pitch from the central 43 ms (follows vibrato)
        lo, hi = max(1, int(k0 * 0.94)), int(k0 * 1.06) + 2
        j = lo + int(np.argmax(X[lo:hi]))
        a, b, c = np.log(X[j - 1] + 1e-30), np.log(X[j] + 1e-30), np.log(X[j + 1] + 1e-30)
        d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
        C[k] = 1200 * np.log2(max((j + d) * sr / N, 1) / f0)
    centers = np.arange(nfr) * hop + N // 2
    return centers, B, R, C


def find_loop(y, sr, f0, vib, X):
    """y mono float64 at sr. Returns (ls, le, info) sample indices; crossfade length X samples."""
    hop = int(0.01 * sr)
    cen, B, R, C = frame_feats(y, sr, f0, hop)
    body = np.median(R[len(R) // 5:4 * len(R) // 5])
    # steady part: after the level first reaches body-3 dB, plus 0.35 s; before the release (last frame within 4 dB of body)
    first = int(np.argmax(R > body - 3))
    last = len(R) - 1 - int(np.argmax(R[::-1] > body - 4))
    tmin = max(cen[first] + int(0.35 * sr), int(0.6 * sr)) + X
    tmax = min(cen[last] - int(0.25 * sr), int(5.5 * sr))   # keep files short (download budget)
    Lmin, Lmax = (int(2.0 * sr), int(4.0 * sr)) if vib else (int(1.5 * sr), int(3.5 * sr))
    Lmax = min(Lmax, tmax - tmin)
    if Lmax < Lmin:
        Lmin = max(int(1.0 * sr), Lmax)
    wf = max(1, X // hop)                       # frames in the crossfade window
    fi = lambda s: int(np.clip(round((s - 2048) / hop), 0, len(cen) - 1))
    pool = []
    bw = np.clip(B - B.max(axis=1, keepdims=True) + 60, 0, None)  # weight bands that carry energy
    for L in range(Lmin, Lmax + 1, 2 * hop):
        Lf = L // hop
        i0, i1 = fi(tmin), fi(tmax - L)
        if i1 <= i0:
            continue
        a = np.arange(i0 - wf, i1 + 1)
        a = a[a >= 0]
        b = a + Lf
        ok = b < len(cen)
        a, b = a[ok], b[ok]
        wgt = (bw[a] + bw[b]) / 2 + 1e-9
        dspec = np.sum(np.abs(B[a] - B[b]) * wgt, axis=1) / np.sum(wgt, axis=1)
        dlev = np.abs(R[a] - R[b])
        dpit = np.abs(C[a] - C[b]) / 2.0
        d = dspec + 2.0 * dlev + dpit
        cs = np.concatenate([[0], np.cumsum(d)])
        js = np.arange(wf, len(d))          # window average over the crossfade frames before the loop start frame a[js]
        avg = (cs[js] - cs[js - wf]) / wf
        starts = cen[a[js]] / sr
        sc = avg + 0.6 * starts - 0.1 * (L / sr)   # prefer earlier starts (shorter files) and longer loops
        for k in list(np.argsort(sc)[:4]) + list(np.argsort(avg)[:3]):
            pool.append((float(sc[k]), int(a[js[k]]), L, float(avg[k])))
    pool.sort()
    pool2 = sorted(pool, key=lambda c: c[3])
    pool = [c for pr in zip(pool, pool2) for c in pr]   # interleave: by score with start penalty, and by match alone
    picked = []
    for c in pool:
        if all(abs(c[1] - p[1]) > 5 or abs(c[2] - p[2]) > 5 * hop for p in picked):
            picked.append(c)
        if len(picked) >= 24:
            break
    per = int(round(sr / f0))
    def upz(lo, hi):
        s = y[lo:hi]
        return lo + np.nonzero((s[:-1] < 0) & (s[1:] >= 0))[0] + 1
    W = int(0.02 * sr)
    out = []
    for scr, fls, L, avgd in picked:
        ls0 = int(cen[fls]); le0 = ls0 + L
        # sample refine: ls at an upward zero crossing near ls0; le at the upward crossing near le0 with the best waveform match
        zs = upz(ls0 - per, ls0 + per)
        ls = int(zs[np.argmin(np.abs(zs - ls0))]) if len(zs) else ls0
        ref = y[ls - W:ls + W]
        cands = upz(le0 - 3 * per, le0 + 3 * per)
        if len(cands) == 0:
            cands = np.arange(le0 - 3 * per, le0 + 3 * per)
        cc = [np.dot(ref, y[c - W:c + W]) / (np.linalg.norm(ref) * np.linalg.norm(y[c - W:c + W]) + 1e-20) for c in cands]
        le = int(cands[int(np.argmax(cc))])
        out.append((ls, le, dict(featScore=round(scr, 3), featDist=round(avgd, 3), xcorr=round(float(max(cc)), 4),
                                 searchFromS=round(tmin / sr, 3), searchToS=round(tmax / sr, 3), candidates=len(picked))))
    return out


def bake_loop(y, ls, le, X):
    """Blend the X samples before ls into the X samples before le. Tries equal-gain and equal-power, keeps the steadier."""
    t = (np.arange(1, X + 1)) / X
    tail, head = y[le - X:le], y[ls - X:ls]
    tgt = np.sqrt(np.mean(np.concatenate([tail, head]) ** 2))
    outs = {}
    for name, (ga, gb) in dict(gain=(np.cos(0.5 * np.pi * t) ** 2, np.sin(0.5 * np.pi * t) ** 2),
                               power=(np.cos(0.5 * np.pi * t), np.sin(0.5 * np.pi * t))).items():
        z = ga * tail + gb * head
        n = X // 8
        rms = [np.sqrt(np.mean(z[i:i + n] ** 2)) for i in range(0, X - n + 1, n)]
        dev = max(abs(20 * np.log10(r / tgt)) for r in rms)
        outs[name] = (dev, z)
    name = min(outs, key=lambda k: outs[k][0])
    out = y[:le].copy()
    out[le - X:le] = outs[name][1]
    return out, name, round(outs[name][0], 2)


def seam_check(d, ls, le):
    """d: decoded (n, ch). Loop region played 4 times; largest step at a seam vs the steady part, and level change across it."""
    seg = d[ls:le]
    z = np.concatenate([seg] * 4)
    L = len(seg)
    dz = np.abs(np.diff(z, axis=0)).max(axis=1)
    seams = [k * L - 1 for k in (1, 2, 3)]
    step = max(dz[s] for s in seams)
    steady = np.percentile(dz[:L - 1], 99.9)
    mx = dz[:L - 1].max()
    n = int(0.2 * SR)
    lv = []
    for s in seams:
        a = np.sqrt(np.mean(z[s - n:s + 1] ** 2)); b = np.sqrt(np.mean(z[s + 1:s + 1 + n] ** 2))
        lv.append(abs(20 * np.log10(b / a)))
    # the same 50 ms measure everywhere inside the loop, for reference
    inner = []
    for s in range(n, L - n, n):
        a = np.sqrt(np.mean(seg[s - n:s] ** 2)); b = np.sqrt(np.mean(seg[s:s + n] ** 2))
        inner.append(abs(20 * np.log10(b / a)))
    return dict(seamStep=round(float(step), 5), steadyStep999=round(float(steady), 5), steadyStepMax=round(float(mx), 5),
                seamStepRatio=round(float(step / steady), 3), seamLevelDb=round(float(max(lv)), 3),
                innerLevelDbMedian=round(float(np.median(inner)), 3), innerLevelDbMax=round(float(max(inner)), 3))


def process(job):
    x, sr0 = sf.read(job['src'], dtype='float64', always_2d=True)
    res = dict(job); probs = []
    res['srcFile'] = os.path.basename(job['src']); res.pop('src')
    res.update(srcRate=sr0, srcChannels=x.shape[1], srcLenS=round(len(x) / sr0, 3))
    if job['kind'] == 'loop':
        # mono: the louder channel of the steady part (the stereo pair is spaced; L+R cancels by up to 8 dB)
        a = x[int(0.5 * sr0):int(3 * sr0)]
        eL, eR = np.mean(a[:, 0] ** 2), np.mean(a[:, 1] ** 2)
        ch = 0 if eL >= eR else 1
        res['monoFrom'] = 'L' if ch == 0 else 'R'
        res['sumLossDb'] = round(10 * np.log10(np.mean(((a[:, 0] + a[:, 1]) / 2) ** 2) / ((eL + eR) / 2)), 1)
        x = x[:, ch:ch + 1]
    x = resample_poly(x, 160, 147, axis=0) if sr0 == 44100 else x
    sr = SR
    pk = float(np.max(np.abs(x)))
    on = onset_at(x, -50.0)
    start = max(0, on - int(round(0.003 * sr)))
    res['trimStartMs'] = round(start / sr * 1000, 1)
    res['peakDb'] = round(plib.db(pk), 2)
    seg = x[on:on + int(0.3 * sr)]
    res['attackRmsDb'] = round(plib.db(float(np.sqrt(np.mean(seg ** 2)))), 2)
    res['brightness'] = round(brightness(x, sr, on, job['midi']), 5)
    first = float(np.max(np.abs(x[start])))
    res['firstSampleDbRel'] = round(plib.db(first) - plib.db(pk), 1)
    f0 = plib.midi_hz(job['midi'])
    if job['kind'] == 'pluck':
        r = plib.measure_pitch(x, sr, on, job['midi'], 'piano')
        sq = np.mean(x[start:] ** 2, axis=1)
        st, env = plib.rms_env(sq, sr)
        thr = pk * 10 ** (-60 / 20)
        emax = int(np.argmax(env))
        below = np.nonzero(env[emax:] <= thr)[0]
        t60 = (st[emax + below[0]] + int(0.05 * sr)) / sr if len(below) else None
        natural = (len(x) - start) / sr
        L = min(t60 or natural, 4.0, natural)
        res['endReason'] = '-60 dB' if (t60 and t60 <= 4.0) else ('max length' if natural > 4.0 else 'end of source file')
        if res['endReason'] == 'end of source file':
            tl = plib.db(float(env[-1])) - plib.db(pk)
            probs.append(f"source file ends at {natural:.2f} s before reaching -60 dB or the 4 s max (level at the end {tl:.0f} dB below peak), so the fade lands on a still-audible tail")
        y = x[start:start + int(round(L * sr))].copy()
        nf = int(0.25 * sr)
        y[-nf:] *= eqp_fade(nf)[:, None]
        y[-1:] = 0
        res['fadeMs'] = 250
        res['levelAt4sDbRel'] = None
    else:
        y = x[start:, 0].copy()
        fadein = 0
        if res['firstSampleDbRel'] > -60:
            fadein = int(0.002 * sr)
            y[:fadein] *= np.sin(0.5 * np.pi * (np.arange(fadein) + 0.5) / fadein) ** 2
        res['fadeInMs'] = round(fadein / sr * 1000, 1)
        best = None
        for xms in (150, 200, 250):
            X = int(xms / 1000 * sr)
            for ls, le, info in find_loop(y, sr, f0, job['vib'], X):
                yy, xf, xfdev = bake_loop(y, ls, le, X)
                sc = seam_check(yy[:, None], ls, le)
                score = 2.5 * max(0.0, sc['seamLevelDb'] - 0.3) + 0.5 * sc['seamLevelDb'] + 0.5 * max(0.0, sc['seamStepRatio'] - 0.6) + 0.15 * xfdev + 0.3 * ls / sr - 0.1 * (le - ls) / sr
                if best is None or score < best[0]:
                    best = (score, ls, le, info, yy, xf, xfdev, xms)
        _, ls, le, info, y, xf, xfdev, xms = best
        res['loopSearch'] = info
        res['crossfade'] = dict(ms=xms, shape=xf, levelDevDb=xfdev)
        res['loopSamples'] = [ls, le]
        res['loop'] = dict(startS=round(ls / sr, 6), endS=round(le / sr, 6))
        if le - ls < int(1.5 * sr):
            probs.append(f"loop only {(le - ls) / sr:.2f} s long (steady part is short)")
        # pitch from the loop region
        mid = ls + (le - ls) // 2
        a = y[max(ls, mid - int(0.6 * sr)):min(le, mid + int(0.6 * sr))]
        r = plib.measure_pitch(a, sr, 0, job['midi'], 'fm')
        # pitch drift across the loop (start third vs end third), and vibrato depth
        y = y[:, None]
    if r.get('ok'):
        v, det = plib.note_check(r['spec'], r, job['midi'], 'fm' if job['kind'] == 'loop' else 'piano')
        res['pitch'] = dict(cents=round(r['cents'], 2), nPartials=r['nPartials'], partials=r['partialNs'],
                            residCents=None if math.isnan(r['resid']) else round(r['resid'], 2), B=float('%.3g' % r['B']), check=v)
        if v != 'ok':
            probs.append(f"pitch check '{v}' ({det})")
    else:
        res['pitch'] = None; probs.append('pitch could not be measured')
    res['lenS'] = round(len(y) / sr, 4)
    res['channels'] = y.shape[1]
    wav = os.path.join(KIT, 'wav', job['id'], job['out'] + '.wav')
    os.makedirs(os.path.dirname(wav), exist_ok=True)
    sf.write(wav, y.astype(np.float32), sr, subtype='FLOAT')
    ob = os.path.join(REPO, 'assets/audio/instruments', job['id'], job['out'])
    os.makedirs(os.path.dirname(ob), exist_ok=True)
    mono = y.shape[1] == 1
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', '56k' if mono else '80k', '-vbr', 'on',
                    '-application', 'audio', '-map_metadata', '-1', ob + '.ogg'], check=True)
    wav_m4a = wav
    if job['kind'] == 'loop':
        # AAC can come back a few samples short of the input; pad past loopEnd with the loop's own continuation
        # (the samples after loopStart), so the decoded file always reaches loopEnd and any overhang is seamless
        ls_, le_ = res['loopSamples']
        wav_m4a = wav[:-4] + '.m4apad.wav'
        sf.write(wav_m4a, np.concatenate([y[:, 0], y[ls_:ls_ + 2048, 0]]).astype(np.float32), sr, subtype='FLOAT')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav_m4a, '-c:a', 'aac', '-b:a', '80k' if mono else '128k',
                    '-map_metadata', '-1', '-movflags', '+faststart', ob + '.m4a'], check=True)
    res['oggBytes'] = os.path.getsize(ob + '.ogg'); res['m4aBytes'] = os.path.getsize(ob + '.m4a')
    ver = {}
    for ext in ('ogg', 'm4a'):
        d = decode(ob + '.' + ext, y.shape[1])
        e = dict(lenS=round(len(d) / sr, 4), durErrMs=round((len(d) - len(y)) / sr * 1000, 2))
        pts = [on - start + int(0.05 * sr)] if job['kind'] == 'pluck' else res['loopSamples']
        lags = [lag_at(y, d, p) for p in pts if p + 2200 < len(d) and p > 2200]
        e['lagSamples'] = [l[0] for l in lags]; e['lagCorr'] = [l[1] for l in lags]
        if job['kind'] == 'loop':
            e['seam'] = seam_check(d, *res['loopSamples']) if len(d) >= res['loopSamples'][1] else None
        ver[ext] = e
    res['verify'] = ver
    if job['kind'] == 'loop':
        res['seamWav'] = seam_check(y, *res['loopSamples'])
    res['problems'] = probs
    return res


if __name__ == '__main__':
    J = jobs()
    only = sys.argv[1:]
    if only:
        J = [j for j in J if any(o in j['out'] or o == j['id'] for o in only)]
    with Pool(2) as p:
        out = p.map(process, J)
    path = KIT + '/results.json'
    old = []
    if only and os.path.exists(path):
        old = [r for r in json.load(open(path)) if (r['id'], r['out']) not in {(o['id'], o['out']) for o in out}]
    json.dump(old + out, open(path, 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    for r in out:
        print(r['id'], r['out'], r.get('pitch', {}) and r['pitch']['cents'], r['lenS'], r.get('loop'), r['oggBytes'], r['problems'])
