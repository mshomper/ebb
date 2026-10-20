"""Shared helpers for the water beds: filters, montage, loop, loudness, checks, encode."""
import os, subprocess, json, numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy import signal
from fractions import Fraction

SR = 48000
WORK = '/home/claude/ebb-scratch/beds/water'
REPO = '/home/claude/ebb-beds/assets/audio/beds'
PREV = '/home/claude/ebb-scratch/beds/previews'
_meter = pyln.Meter(SR)


def load(name):
    x, sr = sf.read(f'{WORK}/src/{name}.wav', dtype='float64')
    assert sr == SR
    return x


# ---------- filters (RBJ biquads, applied forward like a normal EQ) ----------
def hp(x, fc, order=2):
    sos = signal.butter(order, fc, 'highpass', fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def notch(x, f0, q):
    b, a = signal.iirnotch(f0, q, fs=SR)
    return signal.lfilter(b, a, x, axis=0)


def shelf(x, f0, gain_db, kind='high', S=0.7):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w), np.sin(w)
    alpha = sw / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2)
    sA = 2 * np.sqrt(A) * alpha
    if kind == 'high':
        b = [A * ((A + 1) + (A - 1) * cw + sA), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sA)]
        a = [(A + 1) - (A - 1) * cw + sA, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sA]
    else:
        b = [A * ((A + 1) - (A - 1) * cw + sA), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sA)]
        a = [(A + 1) + (A - 1) * cw + sA, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sA]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=0)


# ---------- level helpers ----------
def lufs(x):
    return _meter.integrated_loudness(x)


def true_peak_db(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max() + 1e-12)


def env_db(x, win=0.05):
    m = x.mean(1) if x.ndim > 1 else x
    w = int(win * SR); n = len(m) // w
    return 10 * np.log10(np.mean(m[:n * w].reshape(n, w) ** 2, 1) + 1e-14)


# ---------- montage ----------
def snap(src, t, radius=0.25, win=0.03):
    """Move a cut time to the quietest 30 ms within +-radius s."""
    a = max(0, int((t - radius) * SR)); b = min(len(src), int((t + radius) * SR))
    m = src[a:b].mean(1) ** 2
    w = int(win * SR)
    if len(m) <= w:
        return t
    e = np.convolve(m, np.ones(w) / w, 'valid')
    return (a + int(np.argmin(e)) + w // 2) / SR


def rate_resample(seg, rate):
    """rate < 1 plays slower (longer, lower). Uses a rational polyphase resample."""
    if abs(rate - 1) < 1e-9:
        return seg
    fr = Fraction(1 / rate).limit_denominator(400)
    return signal.resample_poly(seg, fr.numerator, fr.denominator, axis=0)


def montage(src, segs, xf):
    """segs: list of (t0, t1, rate, swap). Each piece carries xf/2 extra on both ends
    (in source time) and joins its neighbour with an equal-power crossfade of xf s."""
    X = int(xf * SR)
    out = None
    for (t0, t1, rate, swap) in segs:
        a = int((t0 - xf / 2 * rate) * SR); b = int((t1 + xf / 2 * rate) * SR)
        a = max(a, 0); b = min(b, len(src))
        p = rate_resample(src[a:b], rate)
        if swap:
            p = p[:, ::-1]
        if out is None:
            out = p
            continue
        th = np.linspace(0, np.pi / 2, X)[:, None]
        mix = out[-X:] * np.cos(th) + p[:X] * np.sin(th)
        out = np.concatenate([out[:-X], mix, p[X:]])
    return out


def shuffle_plan(intervals, total, seglen, variants, seed, src=None, xf=0.5):
    """Draw segments from clean intervals in a seeded shuffled order, cycling through
    'variants' (rate, swap) once per pass so a region is never reused with the same
    transform inside a take. Returns segs whose summed output length >= total."""
    rng = np.random.default_rng(seed)
    pieces = []
    for (a, b) in intervals:
        t = a
        while b - t >= seglen[0] + xf:
            L = rng.uniform(*seglen)
            if b - (t + L) < seglen[0]:
                L = b - t - xf / 2
            pieces.append((t + xf / 2, min(t + L, b - xf / 2)))
            t += L
    segs, acc, vi = [], 0.0, 0
    last = None
    while acc < total:
        rate, swap = variants[vi % len(variants)]
        order = rng.permutation(len(pieces))
        if last is not None and order[0] == last and len(order) > 1:
            order = np.roll(order, 1)
        for k in order:
            t0, t1 = pieces[k]
            if src is not None:
                t0, t1 = snap(src, t0), snap(src, t1)
            segs.append((t0, t1, rate, swap))
            acc += (t1 - t0) / rate
            last = k
            if acc >= total:
                break
        vi += 1
    return segs


# ---------- loop ----------
def make_loop(y, L_s, xf=2.0):
    """y holds at least L+xf seconds. Crossfade y[L:L+xf] (cos) into y[0:xf] (sin)."""
    L = int(round(L_s * SR)); X = int(xf * SR)
    assert len(y) >= L + X, (len(y) / SR, L_s)
    out = y[:L].copy()
    th = np.linspace(0, np.pi / 2, X)[:, None]
    out[:X] = y[:X] * np.sin(th) + y[L:L + X] * np.cos(th)
    return out


def seam_check(z, xf=2.0):
    """Loop-seam checks on the file tiled twice.
    seam_dB / xf_mid_dB: RMS of the 200 ms window straddling the seam (and the middle of the
    2 s crossfade) minus the mean of the ten 200 ms windows around it.
    floor_*: the same, but each 200 ms window is measured by the median of its 10 ms RMS
    values, so a single raindrop or lap does not dominate (the fair test for sparse textures).
    xf_2s_dB: whole 2 s crossfade region vs the 2 s windows around it.
    random_*: the same statistics at 40 random non-seam spots, for scale.
    join_step: sample jump across the end->start join vs the 99.9th pct sample step."""
    zz = np.concatenate([z, z])
    L = len(z); w = int(0.2 * SR); w10 = int(0.01 * SR)

    def r_raw(a):
        s_ = zz[a:a + w]; return 10 * np.log10(np.mean(s_ ** 2) + 1e-14)

    def r_floor(a):
        s_ = zz[a:a + w].mean(1) if zz.ndim > 1 else zz[a:a + w]
        e = np.mean(s_[:20 * w10].reshape(20, w10) ** 2, 1)
        return 10 * np.log10(np.median(e) + 1e-14)

    def dev(c, r, ww=w):
        centre = r(c - ww // 2)
        around = [r(c - ww // 2 + k * ww) for k in (-5, -4, -3, -2, -1, 1, 2, 3, 4, 5)]
        return centre - np.mean(around)

    X = int(xf * SR)

    def r2(a):
        s_ = zz[a:a + X]; return 10 * np.log10(np.mean(s_ ** 2) + 1e-14)
    rng = np.random.default_rng(1)
    pos = rng.uniform(L + 1.5 * SR, 2 * L - 1.5 * SR, 40).astype(int)
    pos2 = rng.uniform(L + 11 * SR, 2 * L - 11 * SR, 20).astype(int) if L > 24 * SR else pos
    out = dict(
        seam_dB=dev(L, r_raw), xf_mid_dB=dev(L + X // 2, r_raw),
        floor_seam_dB=dev(L, r_floor), floor_xf_mid_dB=dev(L + X // 2, r_floor),
        xf_2s_dB=dev(L + X // 2, r2, X) if L > 24 * SR else float('nan'),
        random_median_abs_dB=float(np.median([abs(dev(c, r_raw)) for c in pos])),
        random_floor_median_abs_dB=float(np.median([abs(dev(c, r_floor)) for c in pos])),
        random_2s_median_abs_dB=float(np.median([abs(dev(c, r2, X)) for c in pos2])) if L > 24 * SR else float('nan'))
    out = {k: round(float(v), 2) for k, v in out.items()}
    out['join_step'] = float(np.abs(z[0] - z[-1]).max())
    out['p999_sample_step'] = float(np.percentile(np.abs(np.diff(z, axis=0)), 99.9))
    return out


def normalize(z, target):
    g = target - lufs(z)
    z = z * 10 ** (g / 20)
    tp = true_peak_db(z)
    return z, tp


def encode(z, layer, name):
    d = f'{REPO}/{layer}'; os.makedirs(d, exist_ok=True)
    tmp = f'{WORK}/out/{layer}-{name}.wav'; os.makedirs(f'{WORK}/out', exist_ok=True)
    sf.write(tmp, z.astype(np.float32), SR, subtype='FLOAT')
    ogg, m4a = f'{d}/{name}.ogg', f'{d}/{name}.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'libopus', '-b:a', '56k', '-vbr', 'on',
                    '-application', 'audio', ogg], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'aac', '-b:a', '64k', m4a], check=True)
    # decode check
    dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', ogg, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-'],
                         capture_output=True, check=True).stdout
    n = len(dec) // 8
    return dict(ogg=ogg, m4a=m4a, samples=len(z), ogg_decoded_samples=n,
                ogg_KB=round(os.path.getsize(ogg) / 1024, 1), m4a_KB=round(os.path.getsize(m4a) / 1024, 1))


def finish(z, layer, name, target=-30.0, xf=2.0):
    red, nev = 0.0, 0
    for _ in range(4):
        z = z * 10 ** ((target - lufs(z)) / 20)
        z, r, n = limit(z, -3.3)
        red = max(red, r); nev = max(nev, n)
    tp = true_peak_db(z)
    if tp > -3.0:
        z = z * 10 ** ((-3.1 - tp) / 20); tp = true_peak_db(z)
    info = dict(layer=layer, name=name, seconds=round(len(z) / SR, 3), lufs=round(lufs(z), 2),
                true_peak_dB=round(tp, 2), limiter_max_dB=round(red, 1), limiter_events=nev)
    info.update(seam_check(z, xf))
    info.update(encode(z, layer, name))
    return z, info


def preview(za, zb, layer, name, target=-30.0, start=35.0, dur=20.0):
    """Both takes looping together; emphasis drifts slowly a -> b -> a (constant power)."""
    n = int(dur * SR); s = int(start * SR)
    def tile(z):
        idx = (np.arange(n) + s) % len(z); return z[idx]
    a, b = tile(za), tile(zb)
    t = np.arange(n) / SR
    ga = np.sqrt(0.5 + 0.35 * np.cos(2 * np.pi * t / dur))[:, None]
    gb = np.sqrt(0.5 - 0.35 * np.cos(2 * np.pi * t / dur))[:, None]
    mix = a * ga + b * gb
    mix *= 10 ** ((target - lufs(mix)) / 20)
    fade = int(0.05 * SR); r = np.linspace(0, 1, fade)[:, None]
    mix[:fade] *= r; mix[-fade:] *= r[::-1]
    os.makedirs(PREV, exist_ok=True)
    p = f'{PREV}/{layer}-{name}.wav'
    sf.write(p, np.clip(mix, -1, 1), SR, subtype='PCM_16')
    return p


def dump(info, path):
    with open(path, 'w') as f:
        json.dump(info, f, indent=1, default=float)


def check_plot(takes, out):
    """takes: list of (label, z). Each take tiled twice; seam marked in red."""
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(2 * len(takes), 1, figsize=(18, 4.2 * len(takes)))
    for i, (lab, z) in enumerate(takes):
        zz = np.concatenate([z, z]); L = len(z) / SR
        e = env_db(zz, 0.05); t = np.arange(len(e)) * 0.05
        m = zz.mean(1)
        f, tt, S = signal.spectrogram(m.astype(np.float32), SR, nperseg=2048, noverlap=1024)
        a0, a1 = ax[2 * i], ax[2 * i + 1]
        a0.pcolormesh(tt, f, 10 * np.log10(S + 1e-14), shading='auto', cmap='magma',
                      vmin=np.percentile(10 * np.log10(S + 1e-14), 5), vmax=np.percentile(10 * np.log10(S + 1e-14), 99.7))
        a0.set_yscale('symlog', linthresh=500); a0.set_ylim(40, 20000); a0.set_title(f'{lab}: tiled twice, seam at {L:.2f} s (red)')
        a1.plot(t, e, lw=.5); a1.set_ylabel('50 ms dB')
        for a in (a0, a1):
            a.axvline(L, c='r', lw=1.2); a.axvspan(L, L + 2, color='r', alpha=.08); a.set_xlim(0, 2 * L)
    plt.tight_layout(); plt.savefig(out, dpi=55); plt.close(fig)


def tp_env(x):
    """Per-sample true-peak magnitude (4x oversampled, max over channels and the 4 phases)."""
    up = np.abs(signal.resample_poly(x, 4, 1, axis=0)).max(1)
    n = len(x)
    return up[:4 * n].reshape(n, 4).max(1)


def limit(x, ceiling_db=-3.3, attack_ms=4.0, hold_ms=30.0):
    """Look-ahead peak limiter: gain only dips around peaks above the ceiling, ramps
    over 2*attack (linear), holds hold_ms after the peak. Never touches the floor between drops."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    c = 10 ** (ceiling_db / 20)
    req = np.minimum(1.0, c / (tp_env(x) + 1e-12))
    if req.min() >= 1.0:
        return x, 0.0, 0
    A = int(attack_ms * SR / 1000); H = int(hold_ms * SR / 1000)
    size = A + H + 1
    # window [n-H, n+A]: minimum_filter1d centre is size//2; origin shifts it
    origin = (size // 2) - H
    g = minimum_filter1d(req, size=size, origin=origin, mode='nearest')
    g = uniform_filter1d(g, size=2 * A + 1, mode='nearest')
    g = np.minimum(g, req)
    red = -20 * np.log10(g.min())
    ev = np.diff((g < 0.999).astype(int)) == 1
    return x * g[:, None], float(red), int(ev.sum())


def best_length(y, L, span=0.4, step=0.05, xf=2.0):
    """Try loop lengths L +- span; keep the one whose seam windows sit closest to their neighbours."""
    best = None
    for Lc in np.arange(L - span, L + span + 1e-9, step):
        if len(y) < int(round((Lc + xf) * SR)): break
        z = make_loop(y, Lc, xf)
        c = seam_check(z, xf)
        score = max(abs(c['floor_seam_dB']), abs(c['floor_xf_mid_dB']), abs(c['xf_2s_dB'])) \
            + 0.25 * max(abs(c['seam_dB']), abs(c['xf_mid_dB']))
        if best is None or score < best[0]:
            best = (score, round(float(Lc), 2), z)
    return best[1], best[2]


def spot_repair(x, t0, t1, f0, f1, ctx=1.5):
    """Pull one time-frequency box down to the median level of the same bins in the
    surrounding +-ctx seconds (phase kept). For a short faint tone in an otherwise clean bed."""
    a = max(0, int((t0 - ctx) * SR)); b = min(len(x), int((t1 + ctx) * SR))
    seg = x[a:b]
    nper, hop = 4096, 1024
    f, t, Z = signal.stft(seg.T, SR, nperseg=nper, noverlap=nper - hop)
    M = np.abs(Z)
    tt = t + a / SR
    kf = (f >= f0) & (f <= f1); kt = (tt >= t0) & (tt <= t1)
    ref = np.median(M[:, kf][:, :, ~kt], axis=2, keepdims=True)
    box = M[:, kf][:, :, kt]
    g = np.minimum(1.0, ref / (box + 1e-12))
    G = np.ones_like(M)
    sub = G[:, kf]; sub[:, :, kt] = g; G[:, kf] = sub
    _, y = signal.istft(Z * G, SR, nperseg=nper, noverlap=nper - hop)
    y = y.T[:len(seg)]
    # blend the repaired span back in with short equal-power fades at the context edges
    out = x.copy(); n = len(seg); r = int(0.3 * SR)
    w = np.ones(n); w[:r] = np.sin(np.linspace(0, np.pi / 2, r)) ** 2; w[-r:] = w[:r][::-1]
    out[a:b] = seg * (1 - w[:, None]) + y * w[:, None]
    return out
