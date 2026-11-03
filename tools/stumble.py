# stumble.py work_dir   -> adds "unworded" (seconds) to every take in takes.json
# Whisper writes a stumbled take as clean text ("Notch got the brand's Shopify..."), dropping the false start,
# the "uh" and the repeated half-word. The sound still has them: voiced time inside the take that no word covers.
# pick.py penalises it, so the take where the founder trips is not picked over a clean one (Notch L08).
import json, os, subprocess, sys
import numpy as np
W = sys.argv[1]; P = os.path.join(W, "takes.json"); takes = json.load(open(P))
SRC = {os.path.basename(p): p for p in json.load(open(os.path.join(W, "sources.json")))}
HOP = 0.02; cache = {}
def env(src, ch):
    k = (src, ch)
    if k not in cache:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", SRC[src], "-af", f"pan=mono|c0=c{ch}", "-ar", "8000", "-f", "s16le", "-"],
                             capture_output=True, check=True).stdout
        x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768; n = int(8000 * HOP); m = len(x) // n
        cache[k] = 20 * np.log10(np.sqrt((x[:m * n].reshape(m, n) ** 2).mean(1)) + 1e-9)
    return cache[k]
for t in takes:
    a, b = int(t["start"] / HOP), int(t["end"] / HOP) + 1
    best = None
    for ch in (0, 1):   # the speaker's own lav
        e = env(t["src"], ch)[a:b]
        if len(e) and (best is None or np.percentile(e, 90) > np.percentile(best, 90)): best = e
    if best is None or not len(best): t["unworded"] = 0; continue
    voiced = best > np.percentile(best, 90) - 18          # within 18 dB of the take's loud speech
    cov = np.zeros(len(best), bool)
    for w in t["words"]:
        cov[max(0, int(w["start"] / HOP) - a - 3):max(0, int(w["end"] / HOP) - a + 3)] = True   # +-60 ms slack
    t["unworded"] = round(float((voiced & ~cov).sum() * HOP), 2)
json.dump(takes, open(P, "w"), indent=1)
for t in takes:
    if t["line"] in sys.argv[2:]: print(t["line"], t["take"], t["src"], t["start"], "unworded", t["unworded"])
