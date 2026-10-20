"""Contamination scan: spectrogram + envelopes + bird tonality metric per source.
usage: python3 -I scan.py <wav> <outpng> [t0 t1]
"""
import sys, numpy as np, soundfile as sf
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import signal

path, out = sys.argv[1], sys.argv[2]
x, sr = sf.read(path, dtype='float32')
t0 = float(sys.argv[3]) if len(sys.argv) > 3 else 0
t1 = float(sys.argv[4]) if len(sys.argv) > 4 else len(x) / sr
x = x[int(t0*sr):int(t1*sr)]
L, R = x[:, 0], x[:, 1]
m = 0.5 * (L + R)
dur = len(m) / sr
print(f"{path}: dur {dur:.1f}s peak {np.abs(x).max():.3f} "
      f"clip>0.999: {(np.abs(x) > 0.999).sum()}  LRcorr {np.corrcoef(L, R)[0,1]:.3f}  "
      f"L-R rms {20*np.log10(np.sqrt(np.mean((L-R)**2))+1e-12):.1f} dB")

nper = 2048; hop = 512
hop = 512 if dur < 130 else 1024
f, t, Z = signal.stft(m.astype(np.float32), sr, nperseg=nper, noverlap=nper-hop)
Z = Z.astype(np.complex64)
S = (np.abs(Z) ** 2 + 1e-14).astype(np.float32); del Z
SdB = 10 * np.log10(S)
t = t + t0
# envelopes
def band(lo, hi):
    k = (f >= lo) & (f < hi)
    return 10 * np.log10(S[k].sum(0))
tot = 10 * np.log10(S.sum(0))
low = band(20, 150)
# bird metric: whiten each bin by its time median, then in 1.5-8k compute
# (95th pct over freq) - (median over freq); tonal chirps -> high
k = (f >= 1500) & (f < 8000)
W = SdB[k] - np.median(SdB[k], axis=1, keepdims=True)
W = signal.medfilt2d(W, (3, 1))
bird = np.percentile(W, 99, axis=0) - np.median(W, axis=0)
# voice-ish: 300-3k energy modulation not computed; eyeball spectrogram

fig, ax = plt.subplots(4, 1, figsize=(18, 11), sharex=True,
                       gridspec_kw=dict(height_ratios=[3, 1, 1, 1]))
ax[0].pcolormesh(t, f, SdB, shading='auto', vmin=np.percentile(SdB, 5), vmax=np.percentile(SdB, 99.7), cmap='magma')
ax[0].set_yscale('symlog', linthresh=500); ax[0].set_ylim(30, 20000)
ax[0].set_title(path.split('/')[-1])
ax[1].plot(t, tot, lw=.6); ax[1].set_ylabel('total dB')
ax[2].plot(t, low, lw=.6, c='g'); ax[2].set_ylabel('<150Hz dB')
ax[3].plot(t, bird, lw=.6, c='r'); ax[3].set_ylabel('bird tonal')
step = 5 if dur < 130 else 10
for a in ax:
    a.set_xticks(np.arange(np.ceil(t0/step)*step, t0+dur, step)); a.grid(alpha=.3)
plt.tight_layout(); plt.savefig(out, dpi=60)
# list bird-metric events
thr = np.median(bird) + 4 * np.median(np.abs(bird - np.median(bird))) * 1.4826
ev = t[bird > max(thr, 12)]
if len(ev):
    groups = np.split(ev, np.where(np.diff(ev) > 0.5)[0] + 1)
    print("bird-ish events (s):", ", ".join(f"{g[0]:.1f}-{g[-1]:.1f}" for g in groups[:60]))
lthr = np.median(low) + 10
lev = t[low > lthr]
if len(lev):
    groups = np.split(lev, np.where(np.diff(lev) > 0.5)[0] + 1)
    print("low bursts >+10dB (s):", ", ".join(f"{g[0]:.1f}-{g[-1]:.1f}" for g in groups[:60]))
