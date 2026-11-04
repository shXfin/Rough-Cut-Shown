# reference match: per-channel tone curves fitted so our frame's colour distribution matches the reference photo of
# the same scene, smoothed and monotonic; then a mild saturation trim on the result so it lands on the reference.
import sys, numpy as np
from PIL import Image
ours=np.asarray(Image.open(sys.argv[1]).convert("RGB").resize((960,540))).astype(float)/255
ref=np.asarray(Image.open(sys.argv[2]).convert("RGB").resize((960,540))).astype(float)/255
x=np.linspace(0,1,256); curves=[]
for c in range(3):
    q=np.linspace(0.002,0.998,200)
    a=np.quantile(ours[...,c],q); b=np.quantile(ref[...,c],q)
    cv=np.interp(x,a,b,left=b[0]*x[0],right=b[-1])
    # endpoints: keep true black/white reachable, smooth, monotonic
    cv=np.interp(x,np.r_[0,a,1],np.r_[0,b,1]); cv=np.convolve(np.pad(cv,8,mode="edge"),np.ones(17)/17,"valid")
    cv=np.maximum.accumulate(cv); curves.append(cv)
STR=float(sys.argv[4]) if len(sys.argv)>4 else 1.0
def f(rgb):
    out=np.stack([np.interp(rgb[...,c],x,curves[c]) for c in range(3)],-1)
    return np.clip(rgb+(out-rgb)*STR,0,1)
if sys.argv[3].endswith(".cube"):
    N=33; g=np.linspace(0,1,N); B,G,R=np.meshgrid(g,g,g,indexing="ij")
    o=f(np.stack([R,G,B],-1)).reshape(-1,3)
    with open(sys.argv[3],"w") as fh:
        fh.write('TITLE "Notch Reference Look"\nLUT_3D_SIZE 33\n'); [fh.write(f"{r:.6f} {gg:.6f} {bb:.6f}\n") for r,gg,bb in o]
else:
    full=np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(float)/255
    Image.fromarray((f(full)*255+0.5).astype(np.uint8)).save(sys.argv[3])
