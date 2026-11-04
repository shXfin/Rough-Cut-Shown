# Notch Punch LUT: what global sliders can't do, built for flat overcast faces on South Asian skin.
# 1. luma S-curve (pivot 0.42): real midtone contrast, hue kept
# 2. skin-only: hue 5-50 deg (HSV), richer (+22% sat) and slightly brighter (+5%) -> faces pop off the background
# 3. greens: a touch less saturated and a bit deeper, so the grass sits behind the faces
# 4. density: shadows a little denser (no milky blacks), highlights eased so faces/sky never clip
import numpy as np, sys, colorsys
def f(rgb):
    r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
    y=0.2126*r+0.7152*g+0.0722*b
    # S-curve on luma, applied as a gain so hue/sat stay
    p=0.42; k=float(sys.argv[2]) if len(sys.argv)>2 else 1.35
    yc=np.where(y<p, p*(y/p)**k, 1-(1-p)*((1-y)/(1-p))**k)
    yc=yc*0.97+0.0*(1-yc)          # ease top end
    yc=np.clip(yc - 0.02*(1-yc)**3, 0, 1)   # denser shadows
    gain=np.where(y>1e-4, yc/np.maximum(y,1e-4), 1)[...,None]
    out=np.clip(rgb*gain,0,1)
    # HSV adjustments
    mx=out.max(-1); mn=out.min(-1); d=mx-mn+1e-9
    h=np.where(mx==out[...,0], ((out[...,1]-out[...,2])/d)%6, np.where(mx==out[...,1], (out[...,2]-out[...,0])/d+2, (out[...,0]-out[...,1])/d+4))*60
    s=np.where(mx>0, d/np.maximum(mx,1e-9), 0); v=mx
    skin=np.exp(-((h-25)/18)**2)*np.clip((s-0.12)/0.15,0,1)*np.clip((v-0.15)/0.15,0,1)*np.clip((0.95-v)/0.1,0,1)
    green=np.exp(-((h-105)/35)**2)*np.clip((s-0.1)/0.1,0,1)
    s=s*(1+0.22*skin)*(1-0.10*green); v=v*(1+0.11*skin)*(1-0.06*green)
    s=np.clip(s,0,1); v=np.clip(v,0,1)
    c=v*s; hp=(h/60)%6; x=c*(1-np.abs(hp%2-1)); m=v-c
    z=np.zeros_like(c)
    rr=np.select([hp<1,hp<2,hp<3,hp<4,hp<5,hp>=5],[c,x,z,z,x,c]); gg=np.select([hp<1,hp<2,hp<3,hp<4,hp<5,hp>=5],[x,c,c,x,z,z]); bb=np.select([hp<1,hp<2,hp<3,hp<4,hp<5,hp>=5],[z,z,x,c,c,x])
    return np.clip(np.stack([rr+m,gg+m,bb+m],-1),0,1)
if sys.argv[1]=="cube":
    N=33; g=np.linspace(0,1,N); B,G,R=np.meshgrid(g,g,g,indexing="ij")
    out=f(np.stack([R,G,B],-1)).reshape(-1,3)
    with open(sys.argv[3],"w") as fh:
        fh.write('TITLE "Notch Punch"\nLUT_3D_SIZE 33\n')
        for r,g_,b in out: fh.write(f"{r:.6f} {g_:.6f} {b:.6f}\n")
else:
    from PIL import Image
    im=np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(float)/255
    Image.fromarray((f(im)*255+0.5).astype(np.uint8)).save(sys.argv[3])
