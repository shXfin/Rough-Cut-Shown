# sync.py ref other...   -> offset of each other file vs ref (other_time = ref_time - offset)
# Socrates phase 2 audio sync, unchanged apart from printing JSON lines.
import sys, subprocess, json, numpy as np
SR=8000
def load(p):
    raw=subprocess.run(['ffmpeg','-v','error','-i',p,'-vn','-ac','1','-ar',str(SR),'-f','s16le','-'],capture_output=True,check=True).stdout
    return np.frombuffer(raw,np.int16).astype(np.float32)/32768
def env(x,hop=80):
    n=len(x)//hop; e=np.log(np.sqrt((x[:n*hop].reshape(n,hop)**2).mean(1)+1e-9)); return np.maximum(np.diff(e,prepend=e[0]),0)
def xcorr(a,b):
    n=1<<int(np.ceil(np.log2(len(a)+len(b)))); c=np.fft.irfft(np.fft.rfft(a-a.mean(),n)*np.conj(np.fft.rfft(b-b.mean(),n)),n)
    c=np.concatenate([c[-(len(b)-1):],c[:len(a)]]); return int(np.argmax(c))-(len(b)-1), float(c.max()/(np.sqrt(((a-a.mean())**2).sum()*((b-b.mean())**2).sum())+1e-9))
ref=load(sys.argv[1]); er=env(ref)
for p in sys.argv[2:]:
    o=load(p); lag,score=xcorr(er,env(o)); coarse=lag*80; s=max(coarse,0)
    r=ref[s:s+SR*20]; q=o[max(-coarse,0):max(-coarse,0)+SR*20]; m=min(len(r),len(q)); fine=0; best=-1
    for d in range(-320,321,2):
        if m<=SR: break
        v=float(np.dot(r[max(d,0):m+min(d,0)],q[max(-d,0):m-max(d,0)]))
        if v>best: best,fine=v,d
    print(json.dumps(dict(ref=sys.argv[1],other=p,offset_s=round((coarse+fine)/SR,4),confidence=round(score,3))),flush=True)
