"""Analysis helpers for the ebb strings kit: pitch of bowed (harmonic) tones, loop search, crossfade."""
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

SR = 48000
NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
PC = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def parse_note(s):
    """'F#3' -> midi under the convention the file names use (C4 = 60). Caller adds the octave fix."""
    if s[1:2] == '#':
        return 12 * (int(s[2:]) + 1) + PC[s[:2]]
    return 12 * (int(s[1:]) + 1) + PC[s[:1]]


def midi_name(m):
    return f"{NAMES[m % 12]}{m // 12 - 1}"


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def db(v, floor=1e-12):
    return float(20 * np.log10(max(float(v), floor)))


def load48(path):
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    if sr != SR:
        g = np.gcd(SR, sr)
        x = resample_poly(x, SR // g, sr // g, axis=0)
    return x


def onset_index(x, rel_db=-50.0):
    a = np.max(np.abs(x), axis=1)
    thr = a.max() * 10 ** (rel_db / 20)
    idx = np.nonzero(a > thr)[0]
    return int(idx[0]) if len(idx) else 0


def rms_env_db(m, win=0.05, hop=0.01):
    w, h = int(win * SR), int(hop * SR)
    c = np.concatenate([[0.0], np.cumsum(m * m)])
    st = np.arange(0, max(1, len(m) - w), h)
    e = (c[st + w] - c[st]) / w
    return st, 10 * np.log10(np.maximum(e, 1e-24))


# ---------------- pitch ----------------
def track_f0(m, f_expect, a, b, win=None, hop=0.01, span_cents=150):
    """Frame-wise f0 by normalized square difference (McLeod NSDF) restricted to +-span around f_expect.
    Returns (times, f0, clarity)."""
    T0 = SR / f_expect
    if win is None:
        win = int(max(2048, 4 * T0 * 2 ** (span_cents / 1200)))
    lo = int(np.floor(T0 * 2 ** (-span_cents / 1200))) - 1
    hi = int(np.ceil(T0 * 2 ** (span_cents / 1200))) + 1
    hs = int(hop * SR)
    out_t, out_f, out_c = [], [], []
    nfft = 1
    while nfft < 2 * win:
        nfft <<= 1
    for s in range(a, b - win, hs):
        fr = m[s:s + win]
        fr = fr - fr.mean()
        F = np.fft.rfft(fr, nfft)
        r = np.fft.irfft(F * np.conj(F), nfft)[:hi + 2]
        sq = np.concatenate([[0.0], np.cumsum(fr * fr)])
        # m'(tau) = sum x[j]^2 + x[j+tau]^2 over the overlap
        taus = np.arange(hi + 2)
        mt = sq[win - taus] + (sq[win] - sq[taus])
        nsdf = 2 * r / np.maximum(mt, 1e-20)
        seg = nsdf[lo:hi + 1]
        k = int(np.argmax(seg)) + lo
        if k <= lo or k >= hi:
            continue
        y0, y1, y2 = nsdf[k - 1], nsdf[k], nsdf[k + 1]
        den = y0 - 2 * y1 + y2
        d = 0.5 * (y0 - y2) / den if den != 0 else 0.0
        tau = k + d
        out_t.append((s + win / 2) / SR)
        out_f.append(SR / tau)
        out_c.append(y1 - 0.25 * (y0 - y2) * d)
    return np.array(out_t), np.array(out_f), np.array(out_c)


def avg_spectrum(m, a, b, nfft=1 << 16):
    seg = m[a:b]
    hop = nfft // 2
    w = np.hanning(nfft)
    P = np.zeros(nfft // 2 + 1)
    n = 0
    for s in range(0, max(1, len(seg) - nfft), hop):
        P += np.abs(np.fft.rfft(seg[s:s + nfft] * w)) ** 2
        n += 1
    f = np.fft.rfftfreq(nfft, 1 / SR)
    return f, P / max(n, 1)


def band_energy(f, P, fc, cents=40):
    lo, hi = fc * 2 ** (-cents / 1200), fc * 2 ** (cents / 1200)
    return float(P[(f >= lo) & (f <= hi)].sum())


def comb_f0(f, P, f_expect, span_cents=100, nh=8):
    grid = f_expect * 2 ** (np.arange(-span_cents, span_cents + 0.01, 0.5) / 1200)
    logP = np.log(P + P.max() * 1e-9)
    best, bf = -np.inf, f_expect
    df = f[1]
    for g in grid:
        idx = (np.arange(1, nh + 1) * g / df)
        v = np.interp(idx, np.arange(len(logP)), logP)
        sc = np.sum(v * (1.0 / np.arange(1, nh + 1) ** 0.5))
        if sc > best:
            best, bf = sc, g
    return bf


def octave_check(f, P, f0):
    """Energy between harmonics (sub-octave series) and odd/even balance, relative to harmonics."""
    harm = sum(band_energy(f, P, n * f0) for n in range(1, 7))
    half = sum(band_energy(f, P, (n + 0.5) * f0) for n in range(0, 6))
    odd = sum(band_energy(f, P, n * f0) for n in (1, 3, 5))
    even = sum(band_energy(f, P, n * f0) for n in (2, 4, 6))
    return half / max(harm, 1e-30), odd / max(even, 1e-30)


def brightness(x, onset, midi):
    """Share of energy above max(1.5 x the fundamental, 1 kHz) in the first 300 ms after onset (piano kit rule)."""
    seg = x[onset:onset + int(0.3 * SR)]
    w = np.hanning(len(seg))[:, None]
    P = (np.abs(np.fft.rfft(seg * w, axis=0)) ** 2).sum(axis=1)
    fr = np.fft.rfftfreq(len(seg), 1 / SR)
    cut = max(1.5 * midi_hz(midi), 1000.0)
    tot = P[fr > 20].sum()
    return float(P[fr >= cut].sum() / tot) if tot > 0 else None


# ---------------- loops ----------------
def third_octave_frames(m, xf, hop):
    """Band energies (dB) of windows of length xf starting every hop samples. Bands 1/3 octave, 50 Hz to 12 kHz."""
    nfft = 1
    while nfft < xf:
        nfft <<= 1
    edges = 50 * 2 ** (np.arange(0, 28) / 3)
    edges = edges[edges < 12000]
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    bi = np.digitize(fr, edges)
    w = np.hanning(xf)
    starts = np.arange(0, len(m) - xf, hop)
    out = np.zeros((len(starts), len(edges) + 1))
    lev = np.zeros(len(starts))
    for i, s in enumerate(starts):
        seg = m[s:s + xf]
        P = np.abs(np.fft.rfft(seg * w, nfft)) ** 2
        out[i] = np.bincount(bi, weights=P, minlength=len(edges) + 1)
        lev[i] = np.mean(seg * seg)
    return starts, 10 * np.log10(out[:, 1:-1] + 1e-20), 10 * np.log10(lev + 1e-24)


def upward_zc(m, i, radius):
    """Upward zero crossings of m within i +- radius: returns indices k with m[k-1] < 0 <= m[k]."""
    a, b = max(1, i - radius), min(len(m) - 1, i + radius)
    seg = m[a - 1:b]
    k = np.nonzero((seg[:-1] < 0) & (seg[1:] >= 0))[0] + a
    return k


def find_loop(x, steady_a, steady_b, xf, Lmin, Lmax, hop, top=40, size_db_per_s=0.35):
    """Search the whole steady part for loop start s and end e (samples). A vectorised score ranks every
    (s, L) on a hop grid; the best `top` are baked and checked at the seam, and the best of those wins."""
    m = x.mean(axis=1)
    starts, B, lev = third_octave_frames(m, xf, hop)
    n4 = int(0.4 * SR) // hop * hop
    cs = np.concatenate([[0.0], np.cumsum(m * m)])
    nk = len(lev)
    k4 = np.arange(nk)
    p4 = np.full(nk, -240.0)
    ok = k4 * hop + n4 < len(m)
    p4[ok] = 10 * np.log10((cs[k4[ok] * hop + n4] - cs[k4[ok] * hop]) / n4 + 1e-24)
    s_lo = -(-(steady_a + xf) // hop)
    s_hi = (steady_b - Lmin) // hop
    if s_hi < s_lo:
        return None
    si = np.arange(s_lo, s_hi + 1)[:, None]
    Li = np.arange(Lmin // hop, Lmax // hop + 1)[None, :]
    ei = si + Li
    xh = xf // hop
    valid = (ei * hop <= steady_b) & (ei < nk) & (ei - 2 * xh >= 0)
    ei_c = np.where(valid, ei, s_lo + Lmin // hop)
    sib = np.broadcast_to(si, ei.shape)
    lvlAB = np.abs(lev[ei_c - xh] - lev[sib - xh])
    prepost = np.abs(lev[ei_c - 2 * xh] - lev[sib])
    spec = np.mean(np.abs(B[ei_c - xh] - B[sib - xh]), axis=-1)
    drift = np.abs(p4[np.maximum(ei_c - n4 // hop, 0)] - p4[sib])
    emin = (s_lo + Lmin // hop)
    score = lvlAB + prepost + 0.5 * spec + drift + size_db_per_s * (ei_c - emin) * hop / SR
    score = np.where(valid, score, np.inf)
    order = np.argsort(score, axis=None)
    picked = []
    for idx in order:
        if not np.isfinite(score.flat[idx]):
            break
        i, j = np.unravel_index(idx, score.shape)
        s0, e0 = int(si[i, 0] * hop), int(ei[i, j] * hop)
        if any(abs(s0 - a) < 0.05 * SR and abs(e0 - b) < 0.05 * SR for a, b, _ in picked):
            continue
        picked.append((s0, e0, float(score[i, j])))
        if len(picked) >= top:
            break
    if not picked:
        return None
    best = None
    n = int(0.25 * SR)
    lv = lambda seg: 10 * np.log10(np.mean(seg ** 2) + 1e-24)
    for s0, e0, sc in picked:
        s1, e1 = snap(m, s0, e0)
        y = bake_crossfade(x, s1, e1, xf)
        jump = abs(lv(y[e1 - n:e1]) - lv(y[s1:s1 + n]))
        step = float(np.max(np.abs(y[s1] - y[e1 - 1])))
        body = float(np.max(np.abs(np.diff(y[s1:e1], axis=0))))
        tot = 2.0 * jump + 0.5 * sc + 0.5 * step / max(body, 1e-9) + size_db_per_s * (e1 - emin * hop) / SR
        if best is None or tot < best['total']:
            i = int(round(e1 / hop))
            best = dict(s=s1, e=e1, total=tot, score=sc, seamJumpDb=jump,
                        lvlDb=float(abs(lev[min(i, nk - 1) - xh] - lev[int(round(s1 / hop)) - xh])),
                        specDb=float(np.mean(np.abs(B[min(i, nk - 1) - xh] - B[int(round(s1 / hop)) - xh]))),
                        driftDb=float(abs(lv(m[e1 - n:e1]) - lv(m[s1:s1 + n]))))
    return best


def snap(m, s, e):
    """Move s and e to upward zero crossings of the mid signal (within 4 ms), e chosen for a matching slope."""
    zs = upward_zc(m, s, int(0.004 * SR))
    if len(zs):
        s = int(zs[np.argmin(np.abs(zs - s))])
    slope_s = m[s] - m[s - 1]
    ze = upward_zc(m, e, int(0.004 * SR))
    if len(ze):
        sl = m[ze] - m[ze - 1]
        e = int(ze[np.argmin(np.abs(sl - slope_s) / (abs(slope_s) + 1e-9) + np.abs(ze - e) / (0.004 * SR))])
    return s, e


def bake_crossfade(x, s, e, xf):
    """Blend x[s-xf:s] (fading in) into x[e-xf:e] (fading out), power-normalised for the measured correlation
    per channel, so that a jump from e back to s continues seamlessly. Returns a copy cut at e."""
    y = x[:e].copy()
    t = (np.arange(xf) + 0.5) / xf
    a = np.cos(0.5 * np.pi * t)
    b = np.sin(0.5 * np.pi * t)
    for c in range(x.shape[1]):
        A = x[e - xf:e, c]
        Bv = x[s - xf:s, c]
        r = float(np.dot(A, Bv) / (np.sqrt(np.dot(A, A) * np.dot(Bv, Bv)) + 1e-30))
        r = max(-0.9, min(0.9, r))
        norm = np.sqrt(a * a + b * b + 2 * r * a * b)
        y[e - xf:e, c] = (A * a + Bv * b) / norm
    return y
