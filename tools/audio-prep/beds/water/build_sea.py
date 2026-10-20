import sys; sys.path.insert(0, '/home/claude/ebb-scratch/beds/water')
import numpy as np
from scipy import ndimage
from bedlib import *

XF = 2.0


def find_seam(x, s_range, L_range, step=0.05):
    """Pick start s and length L so both 2 s crossfade windows sit in wave troughs."""
    e = env_db(x, step)                                   # 50 ms envelope
    e = ndimage.uniform_filter1d(e, int(0.5 / step))      # 0.5 s smoothing
    n2 = int(XF / step)
    best = None
    for s in np.arange(*s_range, step):
        i = int(s / step)
        if i + n2 >= len(e): break
        w0 = e[i:i + n2]
        for L in np.arange(*L_range, step):
            j = int((s + L) / step)
            if j + n2 >= len(e): break
            w1 = e[j:j + n2]
            score = w0.max() + w1.max() + 2 * abs(w0.mean() - w1.mean())
            if best is None or score < best[0]:
                best = (score, round(s, 2), round(L, 2), w0.max(), w1.max())
    med = np.median(e)
    return best, med


def underlay(pei, segs, L):
    """Loop the PEI floor to length L, then rotate it half a loop so its seam
    falls mid-take, away from the waves' seam."""
    y = montage(pei, segs, 1.0) if len(segs) > 1 else pei[int(segs[0][0] * SR):int((segs[0][1] + XF) * SR)]
    u = make_loop(y, L, XF)
    return np.roll(u, len(u) // 2, axis=0)


infos = []
pei = hp(load('surf-distant-pei'), 40)

# ---- take a: slow stony waves ----
stony = hp(load('surf-slow-stony'), 40)
(best, med) = find_seam(stony, (134, 195), (44.0, 46.6))
print('stony seam', best, 'median env', med)
_, s, L, _, _ = best
wa = make_loop(stony[int(s * SR):int((s + L + XF) * SR) + 16], L, XF)
ua = underlay(pei, [(3.0, 3.0 + L)], L)
gain = (lufs(wa) - 8) - lufs(ua)
mixa = wa + ua * 10 ** (gain / 20)
za, ia = finish(mixa, 'sea', 'a'); ia['stretch'] = f'surf-slow-stony {s:.2f}-{s + L + XF:.2f} s; PEI 3.00-{3 + L + XF:.2f} s'
infos.append(ia); print(ia)

# ---- take b: calm sea (HarryPeeks), hum notched ----
hpk = load('surf-calm-harrypeeks')
for f0, q in ((79.1, 12), (54.2, 12), (158.2, 20)):
    hpk = notch(hpk, f0, q)
hpk = hp(hpk, 40)
(best, med) = find_seam(hpk, (0.3, 6.0), (51.5, 54.2))
print('harrypeeks seam', best, 'median env', med)
_, s, L, _, _ = best
wb = make_loop(hpk[int(s * SR):int((s + L + XF) * SR) + 16], L, XF)
# PEI for b: 50-86 s, then 3-24 s played 3% slower with channels swapped (different from take a)
need = L + XF
segs = [(50.0, 85.8, 1.0, False)]
rem = need - (85.8 - 50.0) + 1.0
segs.append((4.0, 4.0 + rem * 0.97, 0.97, True))
ub = underlay(pei, segs, L)
gain = (lufs(wb) - 8) - lufs(ub)
mixb = wb + ub * 10 ** (gain / 20)
zb, ib = finish(mixb, 'sea', 'b')
ib['stretch'] = f'surf-calm-harrypeeks {s:.2f}-{s + L + XF:.2f} s; PEI 50.0-85.8 s + 4.0-{4 + rem * 0.97:.1f} s (3% slower, L/R swapped)'
infos.append(ib); print(ib)
preview(za, zb, 'sea', 'all'); check_plot([('sea a', za), ('sea b', zb)], f'{WORK}/scan/check-sea.png')
dump(infos, f'{WORK}/info-sea.json')
