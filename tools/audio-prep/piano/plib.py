"""Shared analysis helpers for the ebb piano sample prep."""
import numpy as np
import soundfile as sf

NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
PC = {n: i for i, n in enumerate(NAMES_SHARP)}


def parse_note(s):
    """'A#-1' -> midi number under scientific pitch (C4 = 60)."""
    if s[1:2] == '#':
        pc, octv = PC[s[:2]], int(s[2:])
    else:
        pc, octv = PC[s[:1]], int(s[1:])
    return 12 * (octv + 1) + pc


def midi_name(m, sharp='s'):
    n = NAMES[m % 12] if sharp == 's' else NAMES_SHARP[m % 12]
    return f"{n}{m // 12 - 1}"


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def load(path):
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    return x, sr


def db(v, floor=1e-12):
    return 20 * np.log10(max(v, floor))


def onset_index(x, rel_db=-50.0):
    a = np.max(np.abs(x), axis=1)
    pk = a.max()
    thr = pk * 10 ** (rel_db / 20)
    idx = np.nonzero(a > thr)[0]
    return int(idx[0]) if len(idx) else 0, pk


def rms_env(mono_sq, sr, win_s=0.05, hop_s=0.01):
    w = int(win_s * sr)
    h = int(hop_s * sr)
    c = np.concatenate([[0.0], np.cumsum(mono_sq)])
    starts = np.arange(0, max(1, len(mono_sq) - w + 1), h)
    e = (c[starts + w] - c[starts]) / w if len(mono_sq) >= w else np.array([mono_sq.mean()])
    return starts, np.sqrt(np.maximum(e, 1e-30))


# ---------------- pitch -----------------
from scipy.signal import find_peaks


class Spectrum:
    """Zero-padded Hann spectrum of a window, with prominent peaks found once."""
    def __init__(self, seg, sr, fmax, nfft=1 << 22, prom_db=10.0):
        """seg: (L,) or (L, ch). Channel power spectra are summed (no comb cancellation between mics)."""
        seg = seg if seg.ndim == 2 else seg[:, None]
        L = len(seg)
        self.T = L / sr
        w = np.hanning(L)
        while nfft < 8 * L:
            nfft <<= 1
        nb = min(nfft // 2, int(fmax / sr * nfft) + 2)
        P = np.zeros(nb)
        for c in range(seg.shape[1]):
            X = np.fft.rfft((seg[:, c] - seg[:, c].mean()) * w, n=nfft)
            P += np.abs(X[:nb]) ** 2
        self.lm = 10 * np.log10(P + 1e-30)
        self.df = sr / nfft
        self.top = float(self.lm.max())
        dist = max(1, int(0.6 / self.T / self.df))
        pk, props = find_peaks(self.lm, prominence=prom_db, distance=dist)
        keep = self.lm[pk] > self.top - 75
        pk = pk[keep]
        prom = props['prominences'][keep]
        # parabolic interpolation in dB
        a, b, c = self.lm[pk - 1], self.lm[pk], self.lm[pk + 1]
        den = a - 2 * b + c
        d = np.where(den != 0, 0.5 * (a - c) / np.where(den != 0, den, 1), 0.0)
        d = np.clip(d, -0.5, 0.5)
        self.pf = (pk + d) * self.df
        self.pdb = b - 0.25 * (a - c) * d
        self.pprom = prom
        o = np.argsort(self.pf)
        self.pf, self.pdb, self.pprom = self.pf[o], self.pdb[o], self.pprom[o]


def model(n, f0, B):
    return n * f0 * np.sqrt(1 + B * n * n)


def _nearest(spec, f):
    """Nearest peak to each predicted frequency: index, cents distance."""
    pf = spec.pf
    if len(pf) == 0:
        return np.zeros_like(f, dtype=int), np.full_like(f, 1e9)
    i = np.searchsorted(pf, f)
    i0 = np.clip(i - 1, 0, len(pf) - 1)
    i1 = np.clip(i, 0, len(pf) - 1)
    d0 = np.abs(1200 * np.log2(pf[i0] / f))
    d1 = np.abs(1200 * np.log2(pf[i1] / f))
    use1 = d1 < d0
    return np.where(use1, i1, i0), np.where(use1, d1, d0)


B_GRID = np.concatenate([[0.0], np.geomspace(1e-5, 6e-2, 160)])


def _score(spec, f0s, Bs, ns, tol, top_rel=70.0):
    F0, BB, N = np.meshgrid(f0s, Bs, ns, indexing='ij')
    pred = model(N, F0, BB)
    idx, d = _nearest(spec, pred.ravel())
    idx = idx.reshape(pred.shape); d = d.reshape(pred.shape)
    # weight a matched peak by its level above (top - top_rel) dB: strong partials count, noise peaks barely
    lvl = np.clip(spec.pdb - (spec.top - top_rel), 0, None) if len(spec.pdb) else np.zeros(1)
    w = lvl[idx]
    return np.where(d < tol, w * (1 - (d / tol) ** 2), 0.0).sum(axis=2)


def grid_score(spec, fnom, nmax, cents_span=60.0, step=1.0, tol=10.0, harmonic=False, refine=True):
    ns = np.arange(1, nmax + 1)
    cs = np.arange(-cents_span, cents_span + 1e-9, step)
    f0s = fnom * 2 ** (cs / 1200)
    Bs = np.array([0.0]) if harmonic else B_GRID
    s = _score(spec, f0s, Bs, ns, tol)
    k = np.unravel_index(np.argmax(s), s.shape)
    best, f0, B = float(s[k]), float(f0s[k[0]]), float(Bs[k[1]])
    if refine:
        f0s2 = f0 * 2 ** (np.arange(-3, 3.01, 0.1) / 1200)
        Bs2 = np.array([0.0]) if harmonic else (np.linspace(0, 3e-5, 7) if B == 0 else B * np.linspace(0.8, 1.2, 41))
        s2 = _score(spec, f0s2, Bs2, ns, tol * 0.6)
        k2 = np.unravel_index(np.argmax(s2), s2.shape)
        f0, B = float(f0s2[k2[0]]), float(Bs2[k2[1]])
    return best, f0, B


def fit_fb(ns, fs, harmonic=False, w=None):
    """Weighted least squares of (f_n/n)^2 = f0^2 + f0^2 B n^2."""
    ns = np.asarray(ns, float); fs = np.asarray(fs, float)
    w = np.ones_like(ns) if w is None else np.asarray(w, float)
    if harmonic or len(ns) < 3:
        f0 = float(np.sum(w * fs * ns) / np.sum(w * ns * ns))
        return f0, 0.0
    y = (fs / ns) ** 2; x = ns ** 2
    sw = np.sqrt(w)
    A = np.vstack([np.ones_like(x), x]).T * sw[:, None]
    (c0, c1), *_ = np.linalg.lstsq(A, y * sw, rcond=None)
    if c0 <= 0 or c1 < 0:
        f0 = float(np.sum(w * fs * ns) / np.sum(w * ns * ns))
        return f0, 0.0
    return float(np.sqrt(c0)), float(c1 / c0)


def window_for(fnom, n_avail_s):
    if fnom > 2000:
        t0, t1 = 0.03, 0.30
    elif fnom > 1000:
        t0, t1 = 0.05, 0.50
    elif fnom >= 130:
        t0, t1 = 0.15, 1.20
    else:
        t0, t1 = 0.15, 2.00   # bass: longer window resolves close partials (decay is slow)
    t1 = min(t1, n_avail_s)
    if t1 - t0 < 0.12:
        t0 = max(0.0, t1 - 0.3)
    return t0, t1


def measure_pitch(sig, sr, onset, midi, kind='piano'):
    harmonic = kind == 'fm'
    fnom = midi_hz(midi)
    t0, t1 = window_for(fnom, (len(sig) - onset) / sr)
    seg = sig[onset + int(t0 * sr): onset + int(t1 * sr)]
    bass = fnom < 110 and not harmonic
    nmax_fit = 8 if (bass or harmonic) else 6
    nmax_grid = 12 if bass else (8 if harmonic else 8)
    fmax = min(19000.0, model(nmax_grid + 1, fnom, 0.06 if not harmonic else 0) * 1.1)
    spec = Spectrum(seg, sr, fmax=fmax)
    sc, f0, B = grid_score(spec, fnom, nmax_grid, harmonic=harmonic)
    used = []
    for tol in (8.0, 5.0, 4.0):
        ns = np.arange(1, nmax_grid + 1)
        pred = model(ns, f0, B)
        idx, d = _nearest(spec, pred)
        ok = d < tol
        lo = 2 if bass else 1
        sel = [(int(n), float(spec.pf[i]), float(spec.pdb[i])) for n, i, o in zip(ns, idx, ok)
               if o and lo <= n <= nmax_fit]
        if bass and len(sel) < 3:
            sel = [(int(n), float(spec.pf[i]), float(spec.pdb[i])) for n, i, o in zip(ns, idx, ok)
                   if o and n <= nmax_fit]
        if not sel:
            break
        used = sel
        lv = np.array([u[2] for u in sel]); wts = np.maximum(10 ** ((lv - lv.max()) / 20), 0.05)
        f0, B = fit_fb([u[0] for u in sel], [u[1] for u in sel], harmonic, wts)
    if not used:
        return dict(ok=False, nPartials=0, spec=spec, gridScore=sc, window=(t0, t1))
    # strongest-peak fit (kept for reference)
    f0_pk, B_pk = f0, B
    # unison clusters: amplitude-weighted centroid of the peaks within +-15 cents of each matched partial
    # and no more than 12 dB below its strongest peak. Mistuned unison strings show up as a split.
    cen = []; splits = {}
    for (n, f, lv) in used:
        near = np.nonzero((np.abs(1200 * np.log2(spec.pf / f)) < 15) & (spec.pdb > lv - 12))[0]
        a = 10 ** (spec.pdb[near] / 20)
        fc = float(np.sum(a * spec.pf[near]) / np.sum(a))
        cen.append((n, fc, lv))
        if len(near) > 1:
            splits[n] = float(1200 * np.log2(spec.pf[near].max() / spec.pf[near].min()))
    lv = np.array([u[2] for u in cen]); wts = np.maximum(10 ** ((lv - lv.max()) / 20), 0.05)
    f0, B = fit_fb([u[0] for u in cen], [u[1] for u in cen], harmonic, wts)
    used = cen
    peak_cents = float(1200 * np.log2(model(1, f0_pk, B_pk) / fnom))
    f1 = model(1, f0, B)
    p1 = [u for u in used if u[0] == 1]
    p1c = float(1200 * np.log2(p1[0][1] / fnom)) if p1 else None
    res = [1200 * np.log2(u[1] / model(u[0], f0, B)) for u in used]
    dof = len(used) - (1 if (harmonic or len(used) < 3) else 2)
    resid = float(np.sqrt(np.sum(np.square(res)) / max(dof, 1))) if len(used) >= 2 else float('nan')
    return dict(ok=True, cents=float(1200 * np.log2(f1 / fnom)), f1=float(f1), f0=float(f0), B=float(B),
                resid=resid, nPartials=len(used), partialNs=[u[0] for u in used], p1Cents=p1c,
                f0Cents=float(1200 * np.log2(f0 / fnom)), peakFitCents=peak_cents, unisonSplitCents=splits,
                gridScore=sc, spec=spec, window=(t0, t1))


def note_check(spec, r, named, kind):
    """Wrong-note test. Returns (verdict, detail).
    explainedShare: share of the 6 strongest peaks (from 0.9*f1 to the fitted 8th partial) that sit within
    25 cents of a fitted partial. subOdd: count of strong peaks at odd multiples of f1/2 (would mean the
    file is an octave lower than named). A file is flagged when explainedShare < 0.5 or subOdd >= 2 or
    the fitted pitch is more than 50 cents from the named note."""
    if not r.get('ok'):
        return 'unmeasured', {}
    f0, B = r['f0'], r['B']
    ns = np.arange(1, 40)
    pred = model(ns, f0, B)
    fhi = min(model(8, f0, B) * 1.05, spec.df * len(spec.lm) * 0.98)
    sel = np.nonzero((spec.pf > r['f1'] * 0.9) & (spec.pf < fhi))[0]
    strong = sel[np.argsort(-spec.pdb[sel])][:6]
    strong = strong[spec.pdb[strong] > spec.top - 45]
    above = np.nonzero(spec.pf > r['f1'] * 0.9)[0]
    gtop = above[int(np.argmax(spec.pdb[above]))] if len(above) else 0
    top_is_partial = bool(np.min(np.abs(1200 * np.log2(spec.pf[gtop] / pred))) < 25)
    # octave-high test: odd partials (1,3,5,7) of the named note absent while even ones present
    oe = {}
    for k in range(1, 9):
        fk = model(k, f0, B)
        if fk > spec.df * len(spec.lm) * 0.98:
            continue
        idx, d = _nearest(spec, np.array([fk]))
        oe[k] = bool(d[0] < 20 and spec.pdb[idx[0]] > spec.top - 50)
    odd_hits = sum(v for k, v in oe.items() if k % 2 == 1)
    even_hits = sum(v for k, v in oe.items() if k % 2 == 0)
    octave_high = odd_hits == 0 and even_hits >= 2
    hit = 0
    for i in strong:
        if np.min(np.abs(1200 * np.log2(spec.pf[i] / pred))) < 25:
            hit += 1
    share = hit / max(1, len(strong))
    sub = r['f1'] / 2
    odd = 0
    for k in (1, 3, 5):
        idx, d = _nearest(spec, np.array([sub * k * np.sqrt(1 + B * k * k / 4)]))
        if d[0] < 20 and spec.pdb[idx[0]] > spec.top - 30:
            odd += 1
    verdict = 'ok'
    if r['f1'] > 1500:
        # top octaves: few partials and lots of non-partial energy; require only that the strongest peak
        # above 0.9 f1 is partial 1 or 2 of the fitted note and that the pitch is within 50 cents
        top_n = None
        for k in (1, 2):
            if abs(1200 * np.log2(spec.pf[gtop] / model(k, f0, B))) < 25:
                top_n = k
        if top_n is None or abs(r['cents']) > 50:
            verdict = 'suspect'
        return verdict, dict(explainedShare=round(share, 2), topPartial=top_n, mode='treble')
    if share < 0.5 or odd >= 2 or abs(r['cents']) > 50 or not top_is_partial or octave_high:
        verdict = 'suspect'
    return verdict, dict(explainedShare=round(share, 2), subOdd=odd, topIsPartial=top_is_partial, oddHits=odd_hits, evenHits=even_hits)
