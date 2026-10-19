import json, subprocess, sys, numpy as np
R='/home/claude/ebb/'
def decode(path):
    out = subprocess.run(['ffmpeg','-v','error','-i',path,'-f','f32le','-ac','1','-ar','48000','-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32)
for rid in sys.argv[1:]:
    p=R+f'recipes/music/instruments/{rid}.json'; d=json.load(open(p))
    for st in d['sets'].values():
        for z in st.get('zones',[]):
            for L in z.get('layers',[]):
                if not L.get('loop') or L.get('loopRmsDb') is not None: continue
                x=decode(R+d['root']+L['file']+'.ogg')
                a,b=int(L['loop']['startS']*48000),int(L['loop']['endS']*48000)
                seg=x[a:b]
                L['loopRmsDb']=round(float(10*np.log10(np.mean(seg.astype(np.float64)**2)+1e-20)),2)
    json.dump(d, open(p,'w'), indent=2); open(p,'a').write('\n')
    print(rid,'done')
