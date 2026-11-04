# matcheq.py: tone matching per piece, like an engineer's match EQ across a dialogue edit.
# Founder 2's lav on Notch was buried under his jacket: 8-12 dB less 2-10 kHz than Founder 1, "under water".
# Each piece's long-term speech spectrum (1/3 octave, shape only) is pulled 80% toward the CLEARER HALF of the project's
# pieces (the middle of all pieces sat on the muffled mic, because he had most of the lines, and made Founder 1 dull):
# dull pieces come up, clear ones stay (cut 3 dB at most), nobody gets hyped. Capped, smoothed, no rumble added.
import json, os, subprocess, numpy as np
CENT = [100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500]
C = np.array(CENT); STRENGTH, LO, HI = 0.8, -3, 9
def load(path, ss, t, ch):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{ss:.3f}", "-t", f"{t:.3f}", "-i", path, "-af", f"pan=mono|c0=c{ch},highpass=f=90",
           "-ar", "48000", "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.float32)
def ltas(x):
    n = 4096; fr = [x[i:i+n] * np.hanning(n) for i in range(0, len(x) - n, 2048)]
    if len(fr) < 3: return None
    S = np.array([np.abs(np.fft.rfft(f)) ** 2 for f in fr]); e = S.sum(1); S = S[e >= np.percentile(e, 50)].mean(0)   # speech frames
    hz = np.fft.rfftfreq(n, 1 / 48000)
    out = np.array([10 * np.log10(S[(hz >= c / 2 ** (1/6)) & (hz < c * 2 ** (1/6))].mean() + 1e-20) for c in CENT])
    return out - out[(C >= 300) & (C <= 1000)].mean()
def project_ref(W, SRC, chan_of):
    """median speech spectrum over the picked takes; cached in work/eq_ref.npy (delete it to re-measure)"""
    P = os.path.join(W, "eq_ref.npy")
    if os.path.exists(P): return np.load(P)
    shapes = []
    for p in json.load(open(os.path.join(W, "picks.json"))):
        if not p.get("main", True): continue
        s = ltas(load(SRC[p["src"]], p["start"], p["end"] - p["start"], chan_of(SRC[p["src"]], p["start"], p["end"] - p["start"])))
        if s is not None: shapes.append(s)
    clar = np.array([x[C >= 2000].mean() for x in shapes])
    ref = np.median([x for x, c in zip(shapes, clar) if c >= np.median(clar)], 0); np.save(P, ref); return ref
def eq_for(shape, ref):
    if shape is None: return ""
    d = STRENGTH * (ref - shape)
    d = np.convolve(np.pad(d, 1, mode="edge"), [0.25, 0.5, 0.25], "valid")   # broad strokes, no ringing
    d[C < 200] = np.minimum(d[C < 200], 0)                                  # never add rumble back
    d = np.clip(d, LO, HI)
    return "firequalizer=gain_entry='" + ";".join(f"entry({c},{g:.1f})" for c, g in zip(CENT, d)) + "',"
