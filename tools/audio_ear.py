# audio_ear.py mix.wav timeline_dump.txt [recorder_dir]
# An "ear" for the dialogue, line by line, on what Premiere actually plays (export the sequence as WAV first):
#   LUFS   loudness of the line (speech, EBU R128 integrated)    -> every line should sit within ~2 dB of the others
#   peak   sample peak of the line                                -> dialogue peaks belong around -6 to -10 dBFS
#   SIG    DNSMOS speech quality 1-5 (Microsoft, no reference)    -> how natural/clean the VOICE sounds (coloration, distortion)
#   BAK    DNSMOS background quality 1-5                          -> noise/hiss/room under the voice
#   dSIG   SIG of the mix minus SIG of the untouched recorder at the same moment -> < -0.2 means our processing HURT the voice
# Concurrence 2026-11-10: Shafin heard "some parts good, some parts bad" after effects were stacked on the raw lav.
import json, os, sys, glob, subprocess
import numpy as np, onnxruntime as ort
MIX, DUMP = sys.argv[1], sys.argv[2]; REC = sys.argv[3] if len(sys.argv) > 3 else "/Volumes/Sandisk1TB/Concurrence/Audio"
MODEL = "/Volumes/T7/work/tools/dnsmos/sig_bak_ovr.onnx"
sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
P_SIG = np.poly1d([-0.08397278, 1.22083953, 0.0052439]); P_BAK = np.poly1d([-0.13166888, 1.60915514, -0.39604546])
def load(path, ss, t, sr=16000, extra=""):
    af = "pan=mono|c0=c0" + ("," + extra if extra else "")
    b = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, ss):.3f}", "-t", f"{t:.3f}", "-i", path, "-af", af, "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(b, np.float32).copy()
def dnsmos(x):
    n = int(9.01 * 16000)
    if len(x) < 1600: return None, None
    while len(x) < n: x = np.concatenate([x, x])
    x = x[:n]; x = x / (np.abs(x).max() + 1e-9) * 0.5   # DNSMOS is level-independent enough; normalise so loudness doesn't fake quality
    s, b, o = sess.run(None, {"input_1": x[None, :].astype(np.float32)})[0][0]
    return float(P_SIG(s)), float(P_BAK(b))
def lufs(path, ss, t):
    o = subprocess.run(["ffmpeg", "-hide_banner", "-ss", f"{ss:.3f}", "-t", f"{t:.3f}", "-i", path, "-af", "ebur128=peak=sample", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = [l for l in o.splitlines() if l.strip().startswith("I:")]; P = [l for l in o.splitlines() if l.strip().startswith("Peak:")]
    return (float(I[-1].split()[1]) if I else None), (float(P[-1].split()[1]) if P else None)
rows = [l.split("|") for l in open(DUMP).read().splitlines() if "|" in l]
lines = [r for r in rows if r[0].startswith("A") and not r[5] and "Wireless PRO" in (r[6] if len(r) > 6 else "")]
lines.sort(key=lambda r: float(r[2]))
out = []
for r in lines:
    st, en, inp = float(r[2]), float(r[3]), float(r[4]); d = en - st
    if d < 0.8: continue
    I, pk = lufs(MIX, st, d)
    sig, bak = dnsmos(load(MIX, st, d))
    rs, rb = dnsmos(load(os.path.join(REC, os.path.basename(r[6])), inp, d))
    out.append(dict(t=st, name=r[1], track=r[0], lufs=I, peak=pk, sig=sig, bak=bak, raw_sig=rs, dsig=(sig - rs) if sig and rs else None))
L = [o["lufs"] for o in out if o["lufs"] and o["lufs"] > -60]; med = float(np.median(L)) if L else 0
def tc(s): m, x = divmod(s, 60); return f"{int(m)}:{x:05.2f}"
print(f"{'at':>8} {'LUFS':>6} {'vs med':>6} {'peak':>6} {'SIG':>5} {'raw':>5} {'dSIG':>5} {'BAK':>5}  flags")
for o in out:
    f = []
    if o["lufs"] and abs(o["lufs"] - med) > 2: f.append("LOUD" if o["lufs"] > med else "QUIET")
    if o["peak"] is not None and o["peak"] > -3: f.append("HOT PEAK")
    if o["dsig"] is not None and o["dsig"] < -0.2: f.append("PROCESSING HURTS")
    if o["sig"] is not None and o["sig"] < 3.0: f.append("POOR VOICE")
    print(f"{tc(o['t']):>8} {o['lufs'] or 0:6.1f} {((o['lufs'] or med) - med):+6.1f} {o['peak'] or 0:6.1f} {o['sig'] or 0:5.2f} {o['raw_sig'] or 0:5.2f} {o['dsig'] or 0:+5.2f} {o['bak'] or 0:5.2f}  {' '.join(f)}")
print(f"\nmedian line loudness {med:.1f} LUFS, spread {min(L):.1f} to {max(L):.1f}; mean dSIG {np.mean([o['dsig'] for o in out if o['dsig'] is not None]):+.2f}")
json.dump(out, open(os.path.splitext(MIX)[0] + ".ear.json", "w"), indent=1)
