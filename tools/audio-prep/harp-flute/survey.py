import sys, glob, os, numpy as np, soundfile as sf, hashlib
for d in sys.argv[1:]:
    for f in sorted(glob.glob(d+'/*.wav')):
        i=sf.info(f); x,_=sf.read(f,always_2d=True)
        pk=np.abs(x).max(); 
        corr=''
        if x.shape[1]==2:
            a,b=x[:,0],x[:,1]; corr='%.3f'%(np.dot(a,b)/np.sqrt(np.dot(a,a)*np.dot(b,b)+1e-30))
        print(os.path.basename(f), i.samplerate, i.channels, i.subtype, '%.2fs'%i.duration, '%.1fdB'%(20*np.log10(pk)), corr, hashlib.md5(x.tobytes()).hexdigest()[:8])
