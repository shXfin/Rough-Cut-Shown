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
        if len(e) and (best is None or np.percentile(e, 90) > np.percentile(best, 90)): best = e; t["lav_ch"] = ch
    if best is None or not len(best): t["unworded"] = 0; t["lav_db"] = -99; continue
    t["lav_db"] = round(float(np.percentile(best, 90)), 1)   # how loud the voice is on the nearest lav
    voiced = best > np.percentile(best, 90) - 18          # within 18 dB of the take's loud speech
    cov = np.zeros(len(best), bool)
    for w in t["words"]:
        cov[max(0, int(w["start"] / HOP) - a - 3):max(0, int(w["end"] / HOP) - a + 3)] = True   # +-60 ms slack
    t["unworded"] = round(float((voiced & ~cov).sum() * HOP), 2)
# off-mic voice: the cameraman reading the line for the founder to repeat (Notch L08 T2/T6, ~20 dB under the
# founders on every lav). A take over OFFMIC_DB under the median take level of its recorder file is a line feed.
OFFMIC_DB = 10
import statistics
by_src = {}
for t in takes: by_src.setdefault(t["src"], []).append(t["lav_db"])
for t in takes:
    t["off_mic"] = t["lav_db"] < statistics.median(by_src[t["src"]]) - OFFMIC_DB
# wind: low rumble (under 150 Hz) against the voice band (300 Hz-4 kHz) on the speaker's lav. Outdoors a gust
# makes a take muddy even after the high-pass ("To prove it" in Notch L03). pick.py prefers the calmer take.
pcm = {}
def lav16(src, ch):
    if (src, ch) not in pcm:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", SRC[src], "-af", f"pan=mono|c0=c{ch}", "-ar", "16000", "-f", "s16le", "-"],
                             capture_output=True, check=True).stdout
        pcm[(src, ch)] = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    return pcm[(src, ch)]
for t in takes:   # the WORST half second, not the average: one gust over "To prove it" ruins the line
    x = lav16(t["src"], t.get("lav_ch", 0))[int(t["start"] * 16000):int(t["end"] * 16000)]
    worst = -99
    for i in range(0, max(1, len(x) - 8000), 4000):
        f = np.abs(np.fft.rfft(x[i:i + 8000] * np.hanning(len(x[i:i + 8000])))) ** 2; hz = np.fft.rfftfreq(len(x[i:i + 8000]), 1 / 16000)
        lo, hi = f[(hz > 20) & (hz < 150)].sum(), f[(hz > 300) & (hz < 4000)].sum()
        if hi > 0: worst = max(worst, 10 * np.log10(lo / hi + 1e-12))
    t["wind_db"] = round(float(worst), 1)
json.dump(takes, open(P, "w"), indent=1)
print("off-mic takes (line feeds):", " ".join(f'{t["line"]}T{t["take"]}' for t in takes if t["off_mic"]))
for t in takes:
    if t["line"] in sys.argv[2:]: print(t["line"], t["take"], t["src"], t["start"], "unworded", t["unworded"])
