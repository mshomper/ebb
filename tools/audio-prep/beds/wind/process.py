"""Bed pipeline for helper 'wind'.  python3 -I process.py <job> [<job> ...]   (or 'all')"""
import sys, os, json, subprocess, numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy import signal
sys.path.insert(0, "/home/claude/ebb-scratch/beds/wind")
import birds

SR = 48000
WD = "/home/claude/ebb-scratch/beds/wind"
SRC = WD + "/src"
OUT = "/home/claude/ebb-beds/assets/audio/beds"
XF = 2.0

# ---------------- filters ----------------
def hp(fc, order=2):
    return ("sos", signal.butter(order, fc, "highpass", fs=SR, output="sos"))

def lp(fc, order=2):
    return ("sos", signal.butter(order, fc, "lowpass", fs=SR, output="sos"))

def _biquad(b, a):
    return ("sos", signal.tf2sos(np.array(b) / a[0], np.array(a) / a[0]))

def shelf_hi(fc, gain_db, S=0.7):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * fc / SR; c, s = np.cos(w), np.sin(w)
    al = s / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2)
    b = [A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al), -2 * A * ((A - 1) + (A + 1) * c),
         A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al)]
    a = [(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al, 2 * ((A - 1) - (A + 1) * c),
         (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al]
    return _biquad(b, a)

def shelf_lo(fc, gain_db, S=0.7):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * fc / SR; c, s = np.cos(w), np.sin(w)
    al = s / 2 * np.sqrt((A + 1 / A) * (1 / S - 1) + 2)
    b = [A * ((A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al), 2 * A * ((A - 1) - (A + 1) * c),
         A * ((A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al)]
    a = [(A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al, -2 * ((A - 1) + (A + 1) * c),
         (A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al]
    return _biquad(b, a)

def peak(fc, gain_db, Q=1.0):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * fc / SR; c, s = np.cos(w), np.sin(w); al = s / (2 * Q)
    return _biquad([1 + al * A, -2 * c, 1 - al * A], [1 + al / A, -2 * c, 1 - al / A])

def notch(fc, Q=30):
    b, a = signal.iirnotch(fc, Q, fs=SR)
    return _biquad(b, a)

def debird(lo, hi, thr=9.0):
    return ("fn", lambda x: birds.repair(x, SR, lo, hi, thr))

def detick(ceiling_db=12.0):
    """Look-ahead tick limiter: hold each sample's peak to ceiling_db above the local 50 ms RMS.
    Snowfall ticks stay audible as texture but lose their sharp edge."""
    def f(x):
        from scipy.ndimage import minimum_filter1d
        m = np.abs(x).max(1)
        w = int(0.05 * SR)
        rms = np.sqrt(np.convolve(m ** 2, np.ones(w) / w, "same")) + 1e-12
        g = np.minimum(1.0, rms * 10 ** (ceiling_db / 20) / (m + 1e-12))
        g = minimum_filter1d(g, int(0.004 * SR))
        k = np.hanning(int(0.003 * SR)); k /= k.sum()
        g = np.convolve(g, k, "same")
        return x * g[:, None]
    return ("fn", f)

def apply_chain(x, chain):
    for kind, obj in chain:
        if kind == "sos":
            x = signal.sosfilt(obj, x, axis=0)
        else:
            x = obj(x)
    return x.astype(np.float64)

# ---------------- jobs ----------------
HP40 = hp(40, 2)
JOBS = {
    # reeds, green: Yle Vanjarvi. HP 400 Hz removes distant engine glides (100-300 Hz) and LF wind bursts.
    "reeds/green-a": dict(src="reeds-yle-vanjarvi", t0=23.0, dur=45.0,
        chain=[HP40, hp(400, 4), shelf_lo(1200, 3.0), peak(3500, -3.0, 1.0), shelf_hi(4500, -6.0), peak(8500, -3.5, 0.8), lp(14000, 2)]),
    "reeds/green-b": dict(src="reeds-yle-vanjarvi", t0=70.0, dur=53.0,
        chain=[HP40, hp(400, 4), shelf_lo(1200, 3.0), peak(3500, -3.0, 1.0), shelf_hi(4500, -6.0), peak(8500, -3.5, 0.8), lp(14000, 2)]),
    # reeds, dry: Chile. HP 150 Hz removes mic wind rumble (63-125 Hz) -> drier; +3 dB shelf for crispness.
    "reeds/dry-a": dict(src="standin-dry-chile", t0=120.0, dur=45.0,
        chain=[HP40, hp(300, 2), shelf_hi(2500, 5.0)]),
    "reeds/dry-b": dict(src="standin-dry-chile", t0=48.0, dur=53.0,
        chain=[HP40, hp(300, 2), shelf_hi(2500, 5.0)]),
    # grass, meadow: szelestamas. Minimal EQ: 70 Hz HP (instead of 40) to tame mic thumps 20-80 Hz.
    "grass/meadow-a": dict(src="short-field-szelestamas", t0=1.5, dur=45.0, chain=[HP40, hp(90, 2)]),
    "grass/meadow-b": dict(src="short-field-szelestamas", t0=56.0, dur=53.0, chain=[HP40, hp(90, 2)]),
    # grass, tall: strangy, voice is 1.3-7 s (skipped); HP 250 Hz removes a faint engine drone (180-250 Hz) and mic bumps.
    "grass/tall-a": dict(src="tall-strangy", t0=10.0, dur=45.0, chain=[HP40, hp(250, 2)]),
    "grass/tall-b": dict(src="tall-strangy", t0=60.0, dur=53.0, chain=[HP40, hp(250, 2)]),
    # wind: cribbler (a) with 38/114 Hz hum notches; pinklakes (b) with bird-call repair 5.5-8.8 kHz.
    "wind/a": dict(src="soft-cribbler", t0=4.0, dur=45.0, chain=[HP40, notch(38, 20), notch(114, 30)]),
    "wind/b": dict(src="open-pinklakes", t0=150.0, dur=53.0, chain=[HP40, debird(2200, 8800, 8.0), shelf_hi(1500, 3.0)]),
    # air, winter: snowfall. HP 2.5 kHz (4th) removes city wash, 190 Hz hum and traffic swells; soft de-tick.
    "air/winter-a": dict(src="winter-snowfall-kinoton", t0=50.0, dur=45.0,
        chain=[HP40, hp(3500, 6), detick(12.0)]),
    "air/winter-b": dict(src="winter-snowfall-kinoton", t0=99.0, dur=53.0,
        chain=[HP40, hp(3500, 6), detick(12.0)]),
}

def true_peak_db(y):
    up = signal.resample_poly(y, 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max() + 1e-12)

def seam_check(y):
    """RMS of a 200 ms window centred on the seam vs the 4 windows around it; and the sample step."""
    n = len(y); w = int(0.2 * SR)
    tiled = np.concatenate([y[-3 * w:], y[:3 * w]])  # seam at 3w
    def r(a): return 10 * np.log10(np.mean(a ** 2) + 1e-20)
    seam = r(tiled[int(2.5 * w):int(3.5 * w)])
    nb = [r(tiled[int(k * w):int((k + 1) * w)]) for k in (1, 2, 3, 4)]
    step = np.abs(y[0] - y[-1]).max()
    typ = np.percentile(np.abs(np.diff(y, axis=0)), 99)
    return seam - np.mean(nb), step, typ, nb, seam

def build(name, job, encode=True):
    x, sr = sf.read(f"{SRC}/{job['src']}.wav", dtype="float32", always_2d=True)
    assert sr == SR
    pre = 1.0
    a = int((job["t0"] - pre) * SR); b = int((job["t0"] + job["dur"] + XF) * SR)
    a0 = max(a, 0)
    seg = apply_chain(x[a0:b].astype(np.float64), job["chain"])[int((job["t0"] * SR) - a0):]
    N = int(job["dur"] * SR); X = int(XF * SR)
    body = seg[:N].copy(); tail = seg[N:N + X]
    th = (np.arange(X) + 0.5) / X * np.pi / 2
    body[:X] = tail * np.cos(th)[:, None] + body[:X] * np.sin(th)[:, None]
    meter = pyln.Meter(SR)
    L = meter.integrated_loudness(np.concatenate([body, body]))
    y = body * 10 ** ((-30 - L) / 20)
    tp = true_peak_db(y)
    if tp > -3.0:
        raise SystemExit(f"{name}: true peak {tp:.1f} dBTP above -3")
    d, step, typ, nb, seam = seam_check(y)
    res = dict(name=name, lufs_in=L, gain_db=-30 - L, true_peak=tp, seam_dev_db=d, seam_step=step,
               typ_step=typ, nb=[round(v, 1) for v in nb], seam=round(seam, 1), dur=len(y) / SR)
    os.makedirs(f"{WD}/wav/{os.path.dirname(name)}", exist_ok=True)
    sf.write(f"{WD}/wav/{name}.wav", y.astype(np.float32), SR, subtype="FLOAT")
    if encode:
        os.makedirs(f"{OUT}/{os.path.dirname(name)}", exist_ok=True)
        w = f"{WD}/wav/{name}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w, "-c:a", "libopus", "-b:a", "56k", "-vbr", "on",
                        "-application", "audio", f"{OUT}/{name}.ogg"], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w, "-c:a", "aac", "-b:a", "64k", f"{OUT}/{name}.m4a"], check=True)
        dec = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                              f"{OUT}/{name}.ogg"], capture_output=True, text=True, check=True).stdout.strip()
        res["ogg_dur"] = float(dec)
        res["ogg_kb"] = os.path.getsize(f"{OUT}/{name}.ogg") / 1024
        res["m4a_kb"] = os.path.getsize(f"{OUT}/{name}.m4a") / 1024
    return res

if __name__ == "__main__":
    names = list(JOBS) if sys.argv[1:] == ["all"] else sys.argv[1:]
    enc = os.environ.get("NOENC") is None
    for n in names:
        r = build(n, JOBS[n], enc)
        print(json.dumps({k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()}))
        with open(f"{WD}/wav/{n.replace('/', '_')}.json", "w") as fh: json.dump(r, fh)
