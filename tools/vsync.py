# vsync.py ref.mp4 other.mp4 ...   -> picture sync for cameras with no audio (Wajo A cam)
# Both cameras see the same motion, so the frame-to-frame change curves line up. Same output
# convention as sync.py: ref_time = other_time + offset_s.
import json, subprocess, sys, numpy as np
FPS = 24000/1001
def motion(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-an", "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, 36*64).astype(np.float32)
    m = np.abs(np.diff(f, axis=0)).mean(1)
    return (m - m.mean()) / (m.std() + 1e-9)
ref = motion(sys.argv[1])
for p in sys.argv[2:]:
    o = motion(p); n = 1 << int(np.ceil(np.log2(len(ref) + len(o))))
    c = np.fft.irfft(np.fft.rfft(ref, n) * np.conj(np.fft.rfft(o, n)), n)
    c = np.concatenate([c[-(len(o)-1):], c[:len(ref)]]); lag = int(np.argmax(c)) - (len(o)-1)
    conf = float(c.max() / min(len(ref), len(o)))
    print(json.dumps(dict(ref=sys.argv[1], other=p, offset_s=round(lag/FPS, 4), frames=lag, confidence=round(conf, 3))), flush=True)
