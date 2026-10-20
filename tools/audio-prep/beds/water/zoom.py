"""Zoomed spectrogram. usage: zoom.py wav out.png t0 t1 [fmin fmax] [nper]"""
import sys, numpy as np, soundfile as sf
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import signal
p, out, t0, t1 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
fmin = float(sys.argv[5]) if len(sys.argv) > 5 else 500
fmax = float(sys.argv[6]) if len(sys.argv) > 6 else 10000
nper = int(sys.argv[7]) if len(sys.argv) > 7 else 1024
info = sf.info(p); sr = info.samplerate
x, _ = sf.read(p, start=int(t0*sr), stop=int(t1*sr), dtype='float32')
m = x.mean(1) if x.ndim > 1 else x
f, t, Z = signal.stft(m, sr, nperseg=nper, noverlap=nper*3//4)
S = 20*np.log10(np.abs(Z)+1e-9); t = t + t0
k = (f >= fmin) & (f <= fmax)
S = S[k]; f = f[k]
Sw = S - np.median(S, axis=1, keepdims=True)  # whitened
fig, ax = plt.subplots(2, 1, figsize=(18, 9), sharex=True)
ax[0].pcolormesh(t, f, S, shading='auto', vmin=np.percentile(S, 5), vmax=np.percentile(S, 99.8), cmap='magma')
ax[1].pcolormesh(t, f, Sw, shading='auto', vmin=0, vmax=20, cmap='magma')
ax[0].set_title(f"{p.split('/')[-1]} {t0}-{t1}s  (bottom: whitened per bin)")
step = 1 if t1 - t0 <= 30 else 2
for a in ax:
    a.set_xticks(np.arange(np.ceil(t0), t1, step)); a.grid(alpha=.25)
plt.tight_layout(); plt.savefig(out, dpi=60)
