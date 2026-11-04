# polish.py: the hand work an audio engineer does after the chain, on the cleaned piece (float wav in, float wav out)
# 1. dewind: wind comes in gusts (quarter-second bursts of rumble under the voice: Notch L30/L31, "a tad of wind" in
#    L09 T9). A fixed high-pass strong enough for the gusts thins every clean moment, so the low band (under ~220 Hz)
#    is pulled down only while a gust is on, with 40 ms ramps.
# 2. despike: pops, lav bumps and clicks 10-80 ms long that jump 4+ dB over the piece's normal speech peaks (the "dot"
#    at Notch 1:24:10, L17; L36) are turned down to that level, like drawing clip gain by hand. Words are untouched.
import subprocess, numpy as np
SR = 48000
def _read(path, af=None):
    af = "pan=mono|c0=c0" + ("," + af if af else "")   # pieces are mono or dual-mono: never sum channels
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-af", af, "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).copy()
def _ramp(g, n):   # smooth a per-window gain curve to samples, with ~40 ms ramps
    k = int(0.04 * SR); x = np.repeat(g, n)
    return np.convolve(x, np.ones(k) / k, "same")
def dewind(path, out, over_db=7.0, depth=0.75):
    # a gust = the band under ~350 Hz jumping while the voice band (0.8-3 kHz) does not (Notch L30 at 1.3 s: low +14 dB,
    # voice +4). Measured against the piece's own usual balance, since male voices also live at 100-300 Hz.
    x = _read(path); hi = _read(path, "highpass=f=350:poles=2,highpass=f=350:poles=2")
    mid = _read(path, "highpass=f=800,lowpass=f=3000"); m = min(len(x), len(hi), len(mid)); x, hi, mid = x[:m], hi[:m], mid[:m]
    low = x - hi; n = int(0.05 * SR); w = m // n
    if w < 4: return 0
    lo_e = (low[:w * n].reshape(w, n) ** 2).mean(1); mi_e = (mid[:w * n].reshape(w, n) ** 2).mean(1)
    ratio = 10 * np.log10((lo_e + 1e-12) / (mi_e + 1e-12))
    # against the CALMEST moments of the piece (its 10th percentile), not the middle: on a windy take the wind is in
    # most pauses, so the middle is already windy (Notch L30: calm ~2 dB, gusts between words 8-15 dB)
    ratio = np.convolve(ratio, np.ones(3) / 3, "same") - np.percentile(ratio, 10)   # 150 ms: a gust lasts, a plosive doesn't
    cut = depth * np.clip((ratio - over_db) / 6, 0, 1)                      # up to -14 dB on the low band, only in gusts
    g = _ramp(cut, n); g = np.pad(g, (0, m - len(g)), "edge")[:m]
    y = x - g * low
    y.astype(np.float32).tofile(out + ".raw"); _write(out + ".raw", out)
    return float((cut > 0.3).mean())
def despike(path, out, over_db=5.0):
    x = _read(path); n = int(0.005 * SR); w = len(x) // n
    if w < 20: return 0
    pk = np.abs(x[:w * n]).reshape(w, n).max(1); db = 20 * np.log10(pk + 1e-9)
    speech = db[db > db.max() - 30]
    ref = np.percentile(speech, 75) if len(speech) else db.max()
    over = np.maximum(0, db - (ref + over_db))
    # only short events: a run of loud 5 ms windows longer than 80 ms is a loud word, not a pop
    hit = over > 0; i = 0; fixed = 0
    while i < w:
        if hit[i]:
            j = i
            while j < w and hit[j]: j += 1
            if (j - i) * 0.005 > 0.08: hit[i:j] = False
            else: fixed += 1
            i = j
        else: i += 1
    gdb = np.where(hit, -over, 0.0); g = 10 ** (gdb / 20)
    k = int(0.003 * SR); gs = np.convolve(np.repeat(g, n), np.ones(k) / k, "same"); gs = np.minimum(gs, np.repeat(g, n))
    y = x.copy(); y[:len(gs)] *= gs
    y.astype(np.float32).tofile(out + ".raw"); _write(out + ".raw", out)
    return fixed
def _write(raw, out):
    import os
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", raw, "-c:a", "pcm_f32le", out], check=True)
    os.remove(raw)
def deknock(path, out, jump_db=15.0, max_len=0.2):
    """A knock, lav bump or tap IN A PAUSE (Notch 1:23:07, L17: 90 ms, 15 dB over the voice, ringing out after): it
    starts out of quiet, so it is not a word. Taken down to the pause's level, with its ring-out, 3 ms ramps."""
    x = _read(path); n = int(0.005 * SR); w = len(x) // n
    if w < 40: return 0
    pk = 20 * np.log10(np.abs(x[:w * n]).reshape(w, n).max(1) + 1e-9)
    g = np.zeros(w); i = 20; fixed = 0
    while i < w:
        before = np.median(pk[i - 20:i])                       # the 100 ms before
        if pk[i] - before >= jump_db:
            j = i
            while j < w and pk[j] - before >= jump_db - 6 and (j - i) * 0.005 < max_len: j += 1
            if (j - i) * 0.005 < max_len:                        # short: a knock. Long: a word starting loud, leave it
                k = j
                while k < w and pk[k] > before + 3 and (k - j) * 0.005 < 0.25: k += 1   # its ring-out
                g[i:k] = np.minimum(0, before + 3 - pk[i:k]); fixed += 1; i = k; continue
            i = j
        i += 1
    lin = 10 ** (g / 20); r = int(0.003 * SR)
    gs = np.convolve(np.repeat(lin, n), np.ones(r) / r, "same"); gs = np.minimum(gs, np.repeat(lin, n))
    y = x.copy(); y[:len(gs)] *= gs
    y.astype(np.float32).tofile(out + ".raw"); _write(out + ".raw", out)
    return fixed
