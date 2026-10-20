"""Survey VCSL vibraphone and wine glass files: f0 vs name, peak, envelope, tremolo."""
import sys, glob, os, re
import numpy as np
sys.path.insert(0, '/tmp/ebb-audio-work/piano-prep')
import plib

SRC = sys.argv[1]
pat = re.compile(r'_([A-G]#?-?\d)_')


def f0_est(x, sr, a, b, fnom):
    seg = x[a:b].mean(axis=1)
    L = len(seg)
    n = 1 << 21
    while n < 8 * L:
        n <<= 1
    P = np.abs(np.fft.rfft((seg - seg.mean()) * np.hanning(L), n=n)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    m = (f > 40) & (f < 8000)
    k = np.argmax(P * m)
    # parabolic
    la, lb, lc = np.log(P[k - 1:k + 2] + 1e-30)
    d = 0.5 * (la - lc) / (la - 2 * lb + lc)
    fp = (k + d) * sr / n
    # strongest few peaks
    return fp


for path in sorted(glob.glob(os.path.join(SRC, '**/*.wav'), recursive=True)):
    x, sr = plib.load(path)
    name = os.path.basename(path)
    mm = pat.search(name)
    midi = plib.parse_note(mm.group(1)) if mm else None
    pk = np.max(np.abs(x))
    on = plib.onset_index(x)[0]
    sq = np.mean(x ** 2, axis=1)
    st, env = plib.rms_env(sq, sr, 0.05, 0.01)
    envdb = 20 * np.log10(env / pk)
    imax = int(np.argmax(env))
    t60 = np.nonzero(envdb[imax:] < -60)[0]
    t60 = (st[imax + t60[0]] / sr) if len(t60) else None
    a = on + int(0.3 * sr); b = min(len(x), on + int(2.0 * sr))
    fp = f0_est(x, sr, a, b, None)
    m_est = 69 + 12 * np.log2(fp / 440)
    # tremolo: modulation spectrum of the envelope between 0.5 and 3 s after onset (detrended in dB)
    i0 = (on + int(0.5 * sr)) // int(0.01 * sr); i1 = min(len(env), (on + int(3.5 * sr)) // int(0.01 * sr))
    seg = envdb[i0:i1]
    trem = None
    if len(seg) > 100:
        t = np.arange(len(seg))
        seg = seg - np.polyval(np.polyfit(t, seg, 2), t)
        M = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n=4096))
        fm = np.fft.rfftfreq(4096, 0.01)
        mk = (fm > 1.5) & (fm < 15)
        j = np.argmax(M * mk)
        trem = (round(float(fm[j]), 2), round(float(np.std(seg)), 2))
    print(f"{name:42s} sr{sr} ch{x.shape[1]} len{len(x)/sr:6.2f} pk{plib.db(pk):6.1f} on{on/sr:5.3f} "
          f"envmax@{st[imax]/sr:5.2f} t60 {t60} f={fp:8.2f} est={plib.midi_name(int(round(m_est)))} "
          f"{(m_est-round(m_est))*100:+5.1f}c named={mm.group(1) if mm else '?'} trem(Hz,dBsd)={trem}")
