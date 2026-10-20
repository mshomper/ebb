"""zoom.py out.png file t0 t1 fmin fmax [nper]  -> zoomed spectrogram; also prints LTAS in octave bands."""
import sys, numpy as np, soundfile as sf
from scipy import signal
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
out, path = sys.argv[1], sys.argv[2]
t0, t1, f0, f1 = map(float, sys.argv[3:7])
nper = int(sys.argv[7]) if len(sys.argv) > 7 else 2048
info = sf.info(path); sr = info.samplerate
x, _ = sf.read(path, start=int(t0 * sr), stop=int(t1 * sr), dtype="float32")
m = x.mean(1) if x.ndim > 1 else x
f, t, S = signal.stft(m, sr, nperseg=nper, noverlap=nper * 3 // 4)
P = 10 * np.log10(np.abs(S) ** 2 + 1e-14)
sel = (f >= f0) & (f <= f1)
D = P[sel]
fig, ax = plt.subplots(1, 1, figsize=(18, 6))
ax.pcolormesh(t + t0, f[sel], D, shading="auto", cmap="magma", vmin=np.percentile(D, 20), vmax=np.percentile(D, 99.8))
ax.set_xticks(np.arange(np.ceil(t0), t1, max(1, round((t1 - t0) / 40))))
ax.grid(alpha=.25); ax.set_title(f"{path.split('/')[-1]} {t0}-{t1}s")
plt.tight_layout(); plt.savefig(out, dpi=60)
# LTAS octave bands
F, Pxx = signal.welch(m, sr, nperseg=8192)
for c in [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]:
    s = (F >= c / 1.414) & (F < c * 1.414)
    print(f"{c:>7}: {10*np.log10(Pxx[s].sum()+1e-20):6.1f} dB")
