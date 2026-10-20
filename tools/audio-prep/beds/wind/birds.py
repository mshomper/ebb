"""Narrowband tonal-event (bird / insect chirp) detector and optional spectral repair.

detect(x, sr, f_lo, f_hi) -> list of (t_start, t_end, f_center, excess_dB)
repair(x, sr, f_lo, f_hi) -> x with flagged bins replaced by the time-median magnitude (phase kept)
"""
import numpy as np
from scipy import signal, ndimage

N, H = 1024, 256

def _mask(mag, f, sr, f_lo, f_hi, thr_db=9.0, fpeak_db=8.0):
    band = (f >= f_lo) & (f <= f_hi)
    B = mag[band]
    w = int(0.6 * sr / H) | 1
    med_t = ndimage.median_filter(B, size=(1, w), mode="reflect") + 1e-12
    med_f = ndimage.median_filter(B, size=(31, 1), mode="reflect") + 1e-12
    ex = 20 * np.log10(B / med_t)
    pk = 20 * np.log10(B / med_f)
    m = (ex > thr_db) & (pk > fpeak_db)
    m = ndimage.binary_opening(m, structure=np.ones((2, 2)))
    return band, B, med_t, ex, m

def detect(x, sr, f_lo=1500, f_hi=10000, thr_db=9.0, min_ms=25, max_ms=1500):
    mono = x.mean(1) if x.ndim > 1 else x
    f, t, S = signal.stft(mono, sr, nperseg=N, noverlap=N - H)
    mag = np.abs(S)
    band, B, med_t, ex, m = _mask(mag, f, sr, f_lo, f_hi, thr_db)
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    fb = f[band]
    ev = []
    for sl, k in zip(ndimage.find_objects(lab), range(1, n + 1)):
        dur = (sl[1].stop - sl[1].start) * H / sr * 1000
        nb = sl[0].stop - sl[0].start
        if dur < min_ms or dur > max_ms or nb > 60: continue
        region = lab[sl] == k
        if region.sum() < 6: continue
        exv = ex[sl][region].max()
        ev.append((t[sl[1].start], t[min(sl[1].stop, len(t) - 1)], fb[sl[0]].mean(), exv))
    return ev

def repair(x, sr, f_lo, f_hi, thr_db=9.0):
    out = np.empty_like(x)
    for c in range(x.shape[1]):
        f, t, S = signal.stft(x[:, c], sr, nperseg=N, noverlap=N - H)
        mag = np.abs(S)
        band, B, med_t, ex, m = _mask(mag, f, sr, f_lo, f_hi, thr_db)
        # also use the mono mask so both channels are repaired at the same spots
        m = ndimage.binary_dilation(m, structure=np.ones((5, 5)))
        idx = np.where(band)[0]
        Sb = S[idx]
        Sb[m] = Sb[m] / (np.abs(Sb[m]) + 1e-12) * med_t[m]
        S[idx] = Sb
        _, y = signal.istft(S, sr, nperseg=N, noverlap=N - H)
        out[:, c] = y[: len(x)]
    return out
