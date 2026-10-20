"""Build the non-sea water beds. usage: build_beds.py <bed> [<bed> ...]"""
import sys; sys.path.insert(0, '/home/claude/ebb-scratch/beds/water')
import numpy as np
from bedlib import *

XF = 2.0


def lap_intervals(x, thr_db=18.0, pre=0.6, post=1.5):
    e = env_db(x, 0.05); fl = np.median(e)
    hot = np.where(e > fl + thr_db)[0] * 0.05
    dur = len(x) / SR
    bad = [(max(0, h - pre), min(dur, h + 0.05 + post)) for h in hot]
    good, t = [], 0.3
    for a, b in sorted(bad):
        if a > t: good.append((t, a))
        t = max(t, b)
    if dur - 0.3 > t: good.append((t, dur - 0.3))
    return [(a, b) for a, b in good if b - a >= 2.0], [(round(a, 2), round(b, 2)) for a, b in sorted(bad)]


def shrink(iv, m=0.5):
    return [(a + m, b - m) for a, b in iv if b - a > 2 * m + 1.0]


def build_pair(src, intervals, layer, La, Lb, seglen, xf, target, seeds, va, vb, names=('a', 'b')):
    out = []
    for name, L, seed, var in ((names[0], La, seeds[0], va), (names[1], Lb, seeds[1], vb)):
        best = None
        for k in range(6):                    # a few seeded plans; keep the cleanest seam
            segs = shuffle_plan(shrink(intervals), L + XF + 0.7, seglen, var, seed + 100 * k, src=src, xf=xf)
            y = montage(src, segs, xf)
            L2, z = best_length(y, L)
            c = seam_check(z, XF)
            sc = max(abs(c['floor_seam_dB']), abs(c['floor_xf_mid_dB']), abs(c['xf_2s_dB']))
            if best is None or sc < best[0]:
                best = (sc, z, segs)
            if sc < 0.6:
                break
        out.append((name, best[1], best[2]))
    return out


def describe(segs):
    return '; '.join(f"{a:.1f}-{b:.1f}" + ('' if r == 1 else f" x{r:g}") + (' LR' if s else '') for a, b, r, s in segs)


BEDS = {}


def bed(fn):
    BEDS[fn.__name__] = fn; return fn


@bed
def lap():
    x = load('lap-lazy-pedder')
    for f0, q in ((9366.2, 30), (18731.0, 30)):
        x = notch(x, f0, q)
    x = hp(x, 40)
    good, bad = lap_intervals(x)
    takes = build_pair(x, good, 'lap', 45.0, 53.0, (3.0, 7.0), 0.5, -30, (11, 12),
                       [(1.0, False), (0.97, True), (1.03, False)], [(0.985, True), (1.02, False), (0.96, True)])
    return takes, -30, dict(clean=good, excluded=bad, eq='notch 9.37 kHz and 18.7 kHz (steady whine in the recording)')


@bed
def trickle():
    x = hp(load('trickle-duns-debird'), 40)
    good = [(0.3, 15.4), (24.4, 63.4)]
    takes = build_pair(x, good, 'trickle', 45.0, 53.0, (4.0, 8.0), 0.6, -33, (21, 22),
                       [(1.0, False), (0.97, True)], [(0.985, True), (1.02, False)])
    return takes, -33, dict(clean=good, excluded=[(15.4, 24.4)], eq='bird calls attenuated spectrally (see report)')


@bed
def run():
    x = hp(load('trickle-springbrook-5'), 40)
    good = [(1.8, 29.2)]
    takes = build_pair(x, good, 'run', 45.0, 53.0, (3.0, 6.0), 0.5, -30, (31, 32),
                       [(1.0, False), (0.97, True), (1.03, False)], [(0.985, True), (1.02, False), (0.955, True)])
    return takes, -30, dict(clean=good, excluded=[(0, 1.8), (29.2, 29.9)], eq='none beyond high-pass')


@bed
def rain_water():
    x = hp(load('general-balcony-ido'), 40)
    good = [(0.7, 22.3), (26.4, 36.8)]
    takes = build_pair(x, good, 'rain-water', 45.0, 53.0, (3.0, 6.0), 0.5, -30, (41, 42),
                       [(1.0, False), (0.97, True), (1.03, False)], [(0.985, True), (1.02, False), (0.955, True)])
    return takes, -30, dict(clean=good, excluded=[(22.3, 26.4), (36.8, 54.0)], eq='none beyond high-pass')


def pads_src():
    x = notch(notch(load('pads-raspberry-jbond'), 16640.6, 30), 104.0, 8)
    return hp(x, 40)


PADS_GOOD = [(0.15, 3.5), (5.4, 11.6), (12.8, 23.7)]


@bed
def rain_pads():
    x = pads_src()
    takes = build_pair(x, PADS_GOOD, 'rain-pads', 45.0, 53.0, (1.5, 3.5), 0.25, -30, (51, 52),
                       [(1.0, False), (0.97, True), (1.03, False), (0.985, True)],
                       [(0.985, False), (1.015, True), (0.955, False), (1.045, True)])
    return takes, -30, dict(clean=PADS_GOOD, excluded=[(3.5, 5.4), (11.6, 12.8)], eq='notch 16.6 kHz (steady tone) and 104 Hz (faint hum)')


@bed
def drizzle():
    x = pads_src()
    x = shelf(x, 5000, -3.0, 'high')
    segs = shuffle_plan(shrink(PADS_GOOD), 49.0 + XF + 0.7, (1.5, 3.5),
                        [(0.96, True), (1.04, False), (0.99, True)], 61, src=x, xf=0.25)
    _, z = best_length(montage(x, segs, 0.25), 49.0)
    return [('a', z, segs)], -34, dict(clean=PADS_GOOD, excluded=[(3.5, 5.4), (11.6, 12.8)],
                                        eq='notch 16.6 kHz and 104 Hz, high shelf -3 dB at 5 kHz, 4 dB below the other beds')


@bed
def rain_grass():
    x = load('leaves-campground-kyles')
    x = hp(hp(x, 40), 150, order=4)          # remove the distant engine hum / rumble below 150 Hz
    x = spot_repair(x, 43.9, 44.6, 215, 295)  # faint 250 Hz squeak at 44 s
    _, a = best_length(x[int(1.0 * SR):int((1.0 + 45.4 + XF) * SR) + 16], 45.0)
    segsb = [(snap(x, 48.6), snap(x, 82.8), 1.0, False), (snap(x, 104.2), snap(x, 125.5), 1.0, False)]
    _, b = best_length(montage(x, segsb, 1.0), 53.0)
    return [('a', a, [(1.0, 48.0, 1.0, False)]), ('b', b, segsb)], -30, dict(
        clean=[(0.5, 83.3), (103.6, 134.0)], excluded=[(83.3, 103.6), (134.0, 147.1)],
        eq='extra 4th-order high-pass at 150 Hz (distant engine hum 75-95 Hz); faint 250 Hz squeak at 44.0-44.5 s pulled down spectrally')


if __name__ == '__main__':
    import json
    for b in sys.argv[1:]:
        takes, target, meta = BEDS[b]()
        layer = b.replace('_', '-')
        infos, zs = [], []
        for name, z, segs in takes:
            z, info = finish(z, layer, name, target)
            info['segments'] = describe(segs)
            infos.append(info); zs.append((f'{layer} {name}', z))
        if len(zs) == 2:
            preview(zs[0][1], zs[1][1], layer, 'all', target)
        else:
            preview(zs[0][1], zs[0][1], layer, 'all', target)
        check_plot(zs, f'{WORK}/scan/check-{layer}.png')
        dump(dict(meta=meta, takes=infos), f'{WORK}/info-{layer}.json')
        for i in infos:
            print(layer, i['name'], i['seconds'], 's', i['lufs'], 'LUFS tp', i['true_peak_dB'], 'lim', i['limiter_max_dB'], i['limiter_events'], 'seam', i['seam_dB'],
                  'xfmid', i['xf_mid_dB'], 'rand', i['random_median_abs_dB'], 'FLOOR', i['floor_seam_dB'], i['floor_xf_mid_dB'], 'r', i['random_floor_median_abs_dB'], '2s', i['xf_2s_dB'], 'r', i['random_2s_median_abs_dB'], 'step', round(i['join_step'], 4),
                  '/', round(i['p999_sample_step'], 4), 'ogg', i['ogg_KB'], 'KB dec', i['ogg_decoded_samples'] == i['samples'])
