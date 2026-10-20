"""Strings kit prep: pick files, trim, measure, find and bake loops, encode, verify. Run: python3 -I prep.py"""
import os
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
import sys, re, json, subprocess
from multiprocessing import Pool
import numpy as np
import soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import slib
from slib import SR

KIT = '/tmp/ebb-audio-work/kit/strings'
SRC = KIT + '/src/repo/Strings'
REPO = '/home/claude/ebb'
PAD_S = float(os.environ.get('PAD_S', '0'))   # continuation kept after loopEnd so codec end effects miss the seam
XF_S = 0.2           # crossfade baked before loopStart
LMIN_S, LMAX_S = 1.6, 2.4
S_SPAN_S = 0.8
HOP = int(0.01 * SR)

# id: (folder, regex with groups note, layer[, rr], {source layer: kit layer}, zones kept (actual midi), name)
INSTR = {
    'strings-celli': ('Cello Section/susvib', r'susvib_([A-G]#?\d)_v(\d)_(\d)\.wav', {'1': 1, '3': 2}, None),
    'strings-violas': ('Viola Section/susvib', r'ViolaEns_susvib_([A-G]#?\d)_v(\d)_(\d)\.wav', {'1': 1, '2': 2}, None),
    'strings-violins': ('Violin Section/susVib', r'VlnEns_susVib_([A-G]#?\d)_v(\d)()\.wav', {'1': 1, '2': 2}, None),
    'strings-basses': ('Solo Contrabass/SusVib', r'BKCtbss_SusVib_([A-G]#?\d)_v(\d)_rr(\d)\.wav', {'1': 1, '3': 2}, None),
}
# zones dropped to thin toward about a minor third (actual pitch, after the one-octave name fix)
DROP = {
    'strings-violins': {57},            # A3: G3-A3-B3 is whole tones; keep G3, B3
    'strings-violas': {50, 86},         # D3 (C3-D3-E3 whole tones); D6 (above the violas' useful bed range, violins cover it)
    'strings-basses': set(range(0, 38)) | {40, 44} | set(range(53, 128)),  # nothing below D2 (C2 reachable by stretching D2 down); E2, G#2 thinned; above E3 the celli take over
    'strings-celli': set(),
}
BITRATE = {2: ('80k', '128k'), 1: ('56k', '96k')}


def inventory():
    jobs = []
    for iid, (folder, rx, lmap, _) in INSTR.items():
        for fn in sorted(os.listdir(os.path.join(SRC, folder))):
            mt = re.fullmatch(rx, fn)
            if not mt:
                print('skip', fn); continue
            note, lay, rr = mt.group(1), mt.group(2), mt.group(3) or '1'
            midi = slib.parse_note(note) + 12          # VSCO names sit one octave low (C3 = 60 style); verified by pitch below
            if midi in DROP[iid] or lay not in lmap:
                continue
            jobs.append(dict(id=iid, src=os.path.join(SRC, folder, fn), srcname=fn, midi=midi, srcLayer=lay,
                             layer=lmap[lay], rr=int(rr)))
    return jobs


def decode(path, ch):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-'],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, ch).astype(np.float64)


def lag_of(ref, d, a, n, maxlag):
    """Lag (samples) of d against ref: the shift with the smallest residual over ref[a:a+n] (mid signals)."""
    r = ref.mean(axis=1)
    q = d.mean(axis=1)
    best, bl = np.inf, 0
    for L in range(-maxlag, maxlag + 1):
        lo = max(a, -L)
        hi = min(a + n, len(q) - L)
        if hi - lo < n // 2:
            continue
        v = float(np.mean((q[lo + L:hi + L] - r[lo:hi]) ** 2))
        if v < best:
            best, bl = v, L
    return bl


def seam_check(d, s, e):
    """Play d[:e] then the loop d[s:e] three more times (4 passes); measure the seam."""
    play = np.concatenate([d[:e], d[s:e], d[s:e], d[s:e]])
    L = e - s
    seams = [e + k * L for k in range(3)]
    step = max(float(np.max(np.abs(play[j] - play[j - 1]))) for j in seams)
    body = np.abs(np.diff(d[s:e], axis=0))
    steady_max = float(body.max())
    steady_p999 = float(np.quantile(body.max(axis=1), 0.999))
    n = int(0.25 * SR)
    lvl = lambda seg: 10 * np.log10(np.mean(seg ** 2) + 1e-24)
    jump = max(abs(lvl(play[j - n:j]) - lvl(play[j:j + n])) for j in seams)
    # the steady part's own 100 ms level wobble for comparison (median of neighbour differences)
    w = [lvl(d[k:k + n]) for k in range(s, e - n, n)]
    wob = float(np.median(np.abs(np.diff(w)))) if len(w) > 2 else 0.0
    d2 = lambda a: np.abs(np.diff(a, 2, axis=0)).max()
    curv = max(float(d2(play[j - 3:j + 3])) for j in seams)
    curv_body = float(d2(d[s:e]))
    return dict(curvRatio=round(curv / max(curv_body, 1e-12), 3), seamStep=round(step, 5), steadyMaxStep=round(steady_max, 5), steadyP999Step=round(steady_p999, 5),
                stepRatio=round(step / max(steady_max, 1e-9), 3), seamLevelDb=round(jump, 2),
                steadyWobbleDb=round(wob, 2))


def process(job):
    x = slib.load48(job['src'])
    res = dict(job)
    probs = []
    on = slib.onset_index(x)
    start = max(0, on - int(0.003 * SR))
    res['trimStartMs'] = round((start / SR) * 1000, 1)
    peak = float(np.abs(x).max())
    res['peakDb'] = round(slib.db(peak), 2)
    seg = x[on:on + int(0.3 * SR)]
    res['attackRmsDb'] = round(slib.db(np.sqrt(np.mean(seg ** 2))), 2)
    res['brightness'] = round(slib.brightness(x, on, job['midi']), 5)
    m = x.mean(axis=1)
    st, env = slib.rms_env_db(m)
    t = st / SR
    mid = (t > on / SR + 0.6) & (t < len(m) / SR - 1.5)
    P = float(np.median(env[mid])) if mid.sum() > 10 else float(np.max(env))
    res['plateauDb'] = round(P, 2)
    after = np.nonzero((st > on) & (env >= P - 3.0))[0]
    sa = int(st[after[0]] + 0.15 * SR) if len(after) else on + int(0.4 * SR)
    sa = max(sa, on + int(0.3 * SR))
    hi = np.nonzero(env >= P - 2.0)[0]
    sb = int(st[hi[-1]] + 0.05 * SR - 0.1 * SR) if len(hi) else len(m) - SR
    res['steadyS'] = [round((sa - start) / SR, 3), round((sb - start) / SR, 3)]
    # pitch
    f_exp = slib.midi_hz(job['midi'])
    tt, ff, cc = slib.track_f0(m, f_exp, sa, sb)
    good = cc > 0.8
    cents = 1200 * np.log2(ff[good] / f_exp) if good.sum() else np.array([np.nan])
    med = float(np.median(cents))
    q1, q3 = np.percentile(cents, [25, 75]) if good.sum() else (np.nan, np.nan)
    voiced = float(good.mean()) if len(cc) else 0.0
    res['measuredCents'] = round(med, 2)
    res['f0IqrCents'] = round(float(q3 - q1), 1)
    res['voicedShare'] = round(voiced, 3)
    res['tuneConfidence'] = round(voiced * float(np.clip(1 - (q3 - q1) / 60, 0, 1)), 2)
    fr, Pw = slib.avg_spectrum(m, sa, sb)
    fc = slib.comb_f0(fr, Pw, f_exp * 2 ** (med / 1200) if np.isfinite(med) else f_exp, span_cents=40)
    res['combCents'] = round(1200 * np.log2(fc / f_exp), 2)
    half, oddeven = slib.octave_check(fr, Pw, fc)
    res['halfShare'] = round(half, 3)
    res['oddEven'] = round(oddeven, 3)
    if half > 0.3:
        probs.append(f"octave check: energy between the harmonics is {half:.2f} of the harmonics (a lower octave may be sounding)")
    if oddeven < 0.1:
        probs.append(f"octave check: odd harmonics weak (odd/even {oddeven:.2f}; may sound an octave higher)")
    if np.isfinite(med) and abs(med - res['combCents']) > 6:
        probs.append(f"pitch: frame tracker {med:+.1f} c and spectrum comb {res['combCents']:+.1f} c disagree")
    if np.isfinite(med) and abs(med) > 120:
        probs.append(f"pitch {med:+.0f} cents from its name")
    # loop
    lp = slib.find_loop(x, sa, sb, int(XF_S * SR), int(LMIN_S * SR), int(LMAX_S * SR), HOP)
    if lp is None:
        res['problems'] = probs + ['no loop region of the minimum length in the steady part']
        return res
    s, e = lp['s'], lp['e']
    xf = int(XF_S * SR)
    y = slib.bake_crossfade(x, s, e, xf)[start:]
    pad = int(round(PAD_S * SR))
    if pad:
        y = np.vstack([y, x[s:s + pad]])
    s2, e2 = s - start, e - start
    res['loopSamples'] = [s2, e2]
    res['loop'] = dict(startS=round(s2 / SR, 6), endS=round(e2 / SR, 6))
    res['loopSearch'] = dict(levelDiffDb=round(lp['lvlDb'], 2), spectrumDiffDb=round(lp['specDb'], 2),
                             driftDb=round(lp['driftDb'], 2), seamJumpDb=round(lp['seamJumpDb'], 2))
    res['lenS'] = round(len(y) / SR, 4)
    res['padS'] = PAD_S
    res['wavSeam'] = seam_check(y, s2, e2)
    note = slib.midi_name(job['midi'])
    out = f"sus/{note}-v{job['layer']}" + (f"-rr{job['rr']}" if job['rr'] > 1 else "")
    res['file'] = out
    ch = y.shape[1]
    res['channels'] = ch
    wav = os.path.join(KIT, 'wav', job['id'], out + '.wav')
    os.makedirs(os.path.dirname(wav), exist_ok=True)
    sf.write(wav, y.astype(np.float32), SR, subtype='FLOAT')
    base = os.path.join(REPO, 'assets/audio/instruments', job['id'], out)
    os.makedirs(os.path.dirname(base), exist_ok=True)
    ob, ab = BITRATE[ch]
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', ob, '-vbr', 'on',
                    '-application', 'audio', '-map_metadata', '-1', base + '.ogg'], check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', ab, '-ar', str(SR),
                    '-map_metadata', '-1', '-movflags', '+faststart', base + '.m4a'], check=True)
    res['oggBytes'] = os.path.getsize(base + '.ogg')
    res['m4aBytes'] = os.path.getsize(base + '.m4a')
    ver = {}
    for ext in ('ogg', 'm4a'):
        d = decode(base + '.' + ext, ch)
        lag = lag_of(y, d, 0, int(0.3 * SR), 480)
        ver[ext] = dict(lenDiffSamples=int(len(d) - len(y)), lagSamples=int(lag))
        if ext == 'ogg':
            dd = d[:len(y)] if len(d) >= len(y) else np.vstack([d, np.zeros((len(y) - len(d), ch))])
            ver[ext]['seam'] = seam_check(dd, s2, e2)
    res['encode'] = ver
    if abs(ver['ogg']['lagSamples']) > 48 or abs(ver['ogg']['lenDiffSamples']) > 48:
        probs.append(f"ogg timing differs from the processed file by more than 1 ms: {ver['ogg']}")
    res['problems'] = probs
    res.pop('src')
    return res


if __name__ == '__main__':
    jobs = inventory()
    if len(sys.argv) > 1:
        jobs = [j for j in jobs if any(a in j['srcname'] for a in sys.argv[1:])]
    print(len(jobs), 'jobs')
    os.makedirs(KIT + '/results', exist_ok=True)
    with Pool(2) as p:
        res = p.map(process, jobs, chunksize=1)
    with open(KIT + '/results/prep.json', 'w') as f:
        json.dump(res, f, indent=1)
    for r in res:
        sm = r.get('encode', {}).get('ogg', {}).get('seam', {})
        print(f"{r['id']:16s} {r.get('file','-'):12s} {r['srcname'][:34]:34s} c {r['measuredCents']:+6.1f}/{r['combCents']:+6.1f} "
              f"conf {r['tuneConfidence']:.2f} len {r.get('lenS',0):5.2f} loop {r.get('loop')} seamR {sm.get('stepRatio')} "
              f"lvl {sm.get('seamLevelDb')} wob {sm.get('steadyWobbleDb')} ogg {r.get('encode',{}).get('ogg',{}).get('lagSamples')}/"
              f"{r.get('encode',{}).get('ogg',{}).get('lenDiffSamples')} m4a {r.get('encode',{}).get('m4a',{}).get('lagSamples')}/"
              f"{r.get('encode',{}).get('m4a',{}).get('lenDiffSamples')} {r['problems']}")
