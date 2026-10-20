"""Gentle spectral attenuation of bird calls in trickle-duns.
Above 1.3 kHz, any time-frequency cell that sits more than 5 dB above the local
(+-1.5 s) median of its bin, and stays there for at least ~40 ms, is pulled down
to that median. Short water ticks (one or two frames) are left alone.
usage: debird.py in.wav out.wav win_s thr_db
"""
import sys, numpy as np, soundfile as sf
from scipy import signal, ndimage

x, sr = sf.read(sys.argv[1], dtype='float64')
nper, hop = 2048, 512
f, t, Z = signal.stft(x.T, sr, nperseg=nper, noverlap=nper - hop)   # (2, F, T)
M = np.abs(Z).mean(0)                                  # shared mask from mid
band = (f >= 1300) & (f <= 9500)
win = int(round(float(sys.argv[3]) * sr / hop)) | 1   # median window (s)
med = ndimage.median_filter(M[band], size=(1, win), mode='reflect')
ratio = M[band] / (med + 1e-12)
mask = ratio > 10 ** (float(sys.argv[4]) / 20)
# persistence: keep only regions lasting >= 4 frames (~43 ms) in time
mask = ndimage.binary_opening(mask, structure=np.ones((1, 4)))
# also require some width in frequency (birds and chatter cover >= 3 bins)
mask = ndimage.binary_opening(mask, structure=np.ones((3, 1)))
mask = ndimage.binary_dilation(mask, structure=np.ones((3, 5)))
G = np.ones_like(M)
g = np.where(mask, np.minimum(1.0, med / (M[band] + 1e-12)), 1.0)
g = ndimage.uniform_filter(g, size=(3, 3))             # soften edges (less musical noise)
G[band] = g
Z2 = Z * G[None]
_, y = signal.istft(Z2, sr, nperseg=nper, noverlap=nper - hop)
y = y.T[:len(x)]
sf.write(sys.argv[2], y.astype(np.float32), sr, subtype='FLOAT')
frac = mask.mean()
red = 20 * np.log10(np.sqrt((np.abs(Z2) ** 2).sum() / (np.abs(Z) ** 2).sum()))
# per-second report of how much was removed in the band
Eb = (np.abs(Z[:, band]) ** 2).sum((0, 1)); Eb2 = (np.abs(Z2[:, band]) ** 2).sum((0, 1))
sec = (t).astype(int)
out = []
for s in range(sec.max() + 1):
    k = sec == s
    d = 10 * np.log10(Eb2[k].sum() / Eb[k].sum())
    if d < -0.8: out.append(f"{s}s:{d:.1f}")
print(f"mask fraction {frac:.3f}, overall change {red:.2f} dB; seconds with >0.8 dB cut in 1.3-9.5 kHz:", " ".join(out))
