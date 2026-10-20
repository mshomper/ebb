"""Contamination scan: per-window features + spectrogram PNG per source."""
import sys, os, numpy as np, soundfile as sf
from scipy import signal
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def scan(path, outdir):
    x, sr = sf.read(path, dtype="float32")
    if x.ndim == 1: x = x[:, None]
    m = x.mean(1)
    name = os.path.splitext(os.path.basename(path))[0]
    nper = 4096; hop = 1024
    f, t, S = signal.stft(m, sr, nperseg=nper, noverlap=nper - hop, window="hann")
    P = np.abs(S) ** 2 + 1e-14
    def band(lo, hi): return P[(f >= lo) & (f < hi)].sum(0)
    lo = band(20, 150); tot = band(20, 20000); voice = band(150, 3000)
    hi = P[(f >= 1500) & (f < 8000)]
    # tonality in 1.5-8k: max bin over median (peakiness), per frame
    peak = 10 * np.log10(hi.max(0) / np.median(hi, 0))
    flat = np.exp(np.mean(np.log(hi), 0)) / hi.mean(0)
    # aggregate to 0.5 s windows
    w = int(0.5 * sr / hop)
    nW = len(t) // w
    rows = []
    peakabs = np.abs(x).max(1)
    for i in range(nW):
        s = slice(i * w, (i + 1) * w)
        t0 = i * 0.5
        seg = peakabs[int(t0 * sr):int((t0 + 0.5) * sr)]
        rows.append((t0, 10*np.log10(tot[s].mean()), 10*np.log10(lo[s].mean() / tot[s].mean()),
                     10*np.log10(voice[s].mean()), np.percentile(peak[s], 90), flat[s].min(),
                     20*np.log10((seg.max() if len(seg) else 0) + 1e-9)))
    rows = np.array(rows)
    np.savetxt(os.path.join(outdir, name + ".tsv"), rows, fmt="%.2f", delimiter="\t",
               header="t\ttot_dB\tlo_frac_dB\tvoice_dB\thi_peak90_dB\thi_flat_min\tpeak_dBFS")
    # figure
    fig, ax = plt.subplots(4, 1, figsize=(18, 11), sharex=True, gridspec_kw=dict(height_ratios=[3, 1, 1, 1]))
    D=10*np.log10(P[f<12000]); k=max(1,D.shape[1]//3000); D=D[:, ::k]; ax[0].pcolormesh(t[::k], f[f<12000] / 1000, D, shading="auto", cmap="magma",
                     vmin=np.percentile(D, 5), vmax=np.percentile(D, 99.7))
    ax[0].set_ylim(0, 12); ax[0].set_ylabel("kHz"); ax[0].set_title(name)
    ax[1].plot(rows[:, 0], rows[:, 1], label="total dB"); ax[1].plot(rows[:, 0], rows[:, 3], label="voice band dB"); ax[1].legend(loc="upper right")
    ax[2].plot(rows[:, 0], rows[:, 2], c="r", label="<150 Hz fraction dB"); ax[2].legend(loc="upper right")
    ax[3].plot(rows[:, 0], rows[:, 4], c="g", label="1.5-8k peakiness p90 dB"); ax[3].legend(loc="upper right")
    for a in ax: a.grid(alpha=.3)
    ax[3].set_xticks(np.arange(0, t[-1], 5))
    plt.tight_layout(); plt.savefig(os.path.join(outdir, name + ".png"), dpi=60); plt.close()
    # print summary
    print(f"== {name}: {len(m)/sr:.1f}s peak {20*np.log10(np.abs(x).max()):.1f} dBFS")
    med = np.median(rows, 0)
    for r in rows:
        flags = []
        if r[1] - med[1] > 6: flags.append(f"loud+{r[1]-med[1]:.0f}")
        if r[2] - med[2] > 6: flags.append(f"lowburst+{r[2]-med[2]:.0f}")
        if r[4] - med[4] > 8: flags.append(f"tonal+{r[4]-med[4]:.0f}")
        if r[6] > -1: flags.append("nearclip")
        if flags: print(f"  {r[0]:6.1f}s  " + " ".join(flags))

if __name__ == "__main__":
    for p in sys.argv[2:]: scan(p, sys.argv[1])
