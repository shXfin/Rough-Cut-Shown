# blend.py: two-mic dialogue blend, like an engineer with a lav and a boom. When a lav is buried under clothing
# (Notch Founder 2, L27/L30/L31: 6-9 dB less clarity than the A camera's own mic, same noise floor, less wind), EQ and
# exciters only make it sound processed ("under water"). Instead: the lav below XOVER Hz (body, closeness) + the
# camera mic above it (real top end), the camera aligned to the lav to the sample by cross-correlation and matched in
# level at the crossover. Uses the camera ORIGINAL's PCM sound, never the compressed proxy audio.
import glob, os, subprocess, numpy as np
SR = 48000; XOVER = 1500
def _rd(path, ss, t, ch, af=""):
    a = f"pan=mono|c0=c{ch}" + ("," + af if af else "")
    return np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, ss):.4f}", "-t", f"{t:.4f}", "-i", path, "-af", a, "-ar", str(SR),
                                         "-f", "f32le", "-"], capture_output=True).stdout, np.float32).copy()
def original_of(proxy):   # .../A_CAM/7T0A9139 (1)_proxy.mp4 -> the camera card's 7T0A9139 (1).MOV
    stem = os.path.basename(proxy).replace("_proxy.mp4", "")
    for root in ["/Volumes/Home Project/Notch/A_CAM", "/Volumes/Home Project/Notch/BCAM"]:
        hit = [p for p in glob.glob(os.path.join(root, "**", stem + ".*"), recursive=True) if not p.upper().endswith(".CPF")]
        if hit: return hit[0]
    return None
def _filt(x, af):
    p = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-af", af, "-f", "f32le", "-"],
                       input=x.astype(np.float32).tobytes(), capture_output=True)
    return np.frombuffer(p.stdout, np.float32)[:len(x)]
def blend(rec, ch, s0, s1, cam_file, cam_offset, out):
    d = s1 - s0; lav = _rd(rec, s0, d, ch, "highpass=f=80")
    pad = 0.15; cam = _rd(cam_file, s0 + cam_offset - pad, d + 2 * pad, 0, "highpass=f=80")
    if len(cam) < len(lav): return None
    # sample-accurate alignment on the voice band
    a = _filt(lav, "highpass=f=300,lowpass=f=3000"); b = _filt(cam, "highpass=f=300,lowpass=f=3000")
    n = 1 << int(np.ceil(np.log2(len(a) + len(b))))
    xc = np.fft.irfft(np.fft.rfft(b, n) * np.conj(np.fft.rfft(a, n)), n)
    lag = int(np.argmax(xc[:len(b)]))
    cam = cam[lag:lag + len(lav)]
    if len(cam) < len(lav): cam = np.pad(cam, (0, len(lav) - len(cam)))
    lo = _filt(_filt(lav, f"lowpass=f={XOVER}"), f"lowpass=f={XOVER}")          # 24 dB/oct (Linkwitz-Riley style)
    hi = _filt(_filt(cam, f"highpass=f={XOVER}"), f"highpass=f={XOVER}")
    # level match on the voice's body (400-1400 Hz), where the lav is NOT muffled: the camera then brings its own,
    # natural top end (matching right above the crossover copied the lav's dullness: clarity stayed at -37)
    rl = _filt(lav, "highpass=f=400,lowpass=f=1400"); rc = _filt(cam, "highpass=f=400,lowpass=f=1400")
    g = np.sqrt((rl ** 2).mean() / ((rc ** 2).mean() + 1e-12))
    y = lo + g * hi
    y.astype(np.float32).tofile(out + ".raw")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", out + ".raw", "-c:a", "pcm_f32le", out], check=True)
    os.remove(out + ".raw")
    return dict(lag_ms=round((lag / SR - pad) * 1000, 2), cam_gain_db=round(20 * np.log10(g + 1e-9), 1), corr=round(float(xc.max() / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)), 2))
