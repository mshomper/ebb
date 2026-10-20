import sys, numpy as np, soundfile as sf
from scipy import signal
bands=[63,125,250,500,1000,2000,4000,8000,16000]
print(f"{'take':16s} cent  "+" ".join(f"{b:>6}" for b in bands))
for p in sys.argv[1:]:
    y,sr=sf.read(p); m=y.mean(1)
    F,P=signal.welch(m,sr,nperseg=8192)
    cen=(F*P).sum()/P.sum()
    tot=P.sum()
    row=[10*np.log10(P[(F>=b/1.414)&(F<b*1.414)].sum()/tot) for b in bands]
    print(f"{p.split('wav/')[1]:16s} {cen:5.0f} "+" ".join(f"{v:6.1f}" for v in row))
