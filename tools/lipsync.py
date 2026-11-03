# lipsync.py out.jsonl sync_b_wav.jsonl sources.json
# Sync a silent, locked-off camera (Wajo A cam) to the recorder by matching the talker's movement to
# the loudness of her voice. A clip n and B clip n are the same take (same clip number, matching
# lengths), so the recorder file B is synced to is the one A should match; only the offset is unknown.
# Output uses sync.py's convention against the WAV: a_time = wav_time + offset_s.
import json, os, subprocess, sys, numpy as np
OUT, WAVSYNC, SRCS = sys.argv[1:4]
SRC = {os.path.basename(p): p for p in json.load(open(SRCS))}
FPS = 24000/1001; HOP = 0.05   # 50 ms analysis steps

def motion(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-an", "-vf", "scale=128:72,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, 72*128).astype(np.float32)
    m = np.abs(np.diff(f, axis=0)).mean(1)                       # per-frame change: she is the only thing moving
    t = np.arange(len(m)) / FPS
    return np.interp(np.arange(0, t[-1], HOP), t, m)
def loudness(p, ch=4):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-af", f"pan=mono|c0=c{ch-1}", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768; k = int(8000*HOP); n = len(x)//k
    return np.log(np.sqrt((x[:n*k].reshape(n, k)**2).mean(1)) + 1e-5)
def z(x):
    x = np.convolve(x, np.ones(6)/6, "same"); return (x - x.mean()) / (x.std() + 1e-9)

rows = [json.loads(l) for l in open(WAVSYNC)]
with open(OUT, "w") as fh:
    for r in rows:
        bclip = os.path.basename(r["ref"]); n = bclip[4:8]
        aname = next((k for k in SRC if k.startswith("B029" + n)), None)
        if not aname: continue
        m, a = z(motion(SRC[aname])), z(loudness(SRC[os.path.basename(r["other"])]))
        guess = r["offset_s"]   # B's offset against this WAV; A started within a few seconds of B
        best = None
        for lag_s in np.arange(guess - 4, guess + 4, HOP):      # a_time = wav_time + lag
            lag = int(round(lag_s / HOP))
            if lag >= 0: x, y = m[lag:], a
            else: x, y = m, a[-lag:]
            k = min(len(x), len(y))
            if k < 200: continue
            c = float(np.dot(x[:k], y[:k]) / k)
            if best is None or c > best[0]: best = (c, lag_s)
        # second best peak away from the best tells how clear the answer is
        fh.write(json.dumps(dict(ref=SRC[aname], other=r["other"], offset_s=round(best[1], 3),
                                 corr=round(best[0], 3), b_offset_s=guess)) + "\n")
        print(aname, os.path.basename(r["other"]), "a-b =", round(best[1] - guess, 2), "s  corr", round(best[0], 3), flush=True)
