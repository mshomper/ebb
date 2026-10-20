import sys, numpy as np, soundfile as sf
sys.path.insert(0, "/home/claude/ebb-scratch/beds/wind")
import birds
for p in sys.argv[1:]:
    x, sr = sf.read(p, dtype="float32")
    ev = birds.detect(x, sr)
    name = p.split("/")[-1]
    print(f"== {name}: {len(ev)} narrowband events")
    # histogram per 10 s
    T = len(x) / sr
    bins = np.zeros(int(T // 10) + 1, int)
    for e in ev: bins[int(e[0] // 10)] += 1
    print("   per 10 s:", " ".join(f"{i*10}:{b}" for i, b in enumerate(bins)))
    for e in ev[:400]:
        print(f"   {e[0]:7.2f}-{e[1]:7.2f}s  {e[2]:6.0f} Hz  +{e[3]:.0f} dB")
