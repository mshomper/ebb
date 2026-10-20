import numpy as np, soundfile as sf, pyloudnorm as pyln
WD="/home/claude/ebb-scratch/beds/wind/wav"; OUT="/home/claude/ebb-scratch/beds/previews"; SR=48000
P={"reeds-green":["reeds/green-a","reeds/green-b"],"reeds-dry":["reeds/dry-a","reeds/dry-b"],
   "grass-spring-summer":["grass/meadow-a","grass/tall-b"],"grass-autumn":["grass/meadow-b","grass/tall-a"],
   "grass-winter":["grass/meadow-a"],"wind-all":["wind/a","wind/b"],"air-winter":["air/winter-a","air/winter-b"]}
N=20*SR; t=np.arange(N)/SR
for name,takes in P.items():
    mix=np.zeros((N,2))
    w=0.5+0.25*np.sin(2*np.pi*t/20)
    gains=[np.sqrt(w),np.sqrt(1-w)] if len(takes)==2 else [np.ones(N)]
    for k,(tk,g) in enumerate(zip(takes,gains)):
        y,_=sf.read(f"{WD}/{tk}.wav"); L=len(y)
        start=L-int((10+2*k)*SR)   # seam lands at 10 s / 12 s into the preview
        idx=(start+np.arange(N))%L
        mix+=y[idx]*g[:,None]
    f=int(0.3*SR); env=np.ones(N); env[:f]=np.linspace(0,1,f); env[-f:]=np.linspace(1,0,f)
    mix*=env[:,None]
    lu=pyln.Meter(SR).integrated_loudness(mix)
    sf.write(f"{OUT}/{name}.wav",mix,SR,subtype="PCM_16")
    print(name, takes, f"{lu:.1f} LUFS, peak {20*np.log10(np.abs(mix).max()):.1f} dBFS")
