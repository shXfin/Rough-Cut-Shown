# sync_check.py work_dir timeline_dump.txt [audio_dir_for_recorder]
# Lip sync check on the LIVE edit (your hand edits included): for every picture clip, the camera's own scratch audio is
# cross-correlated with the lav sound playing under it on A1. The lag is how far picture and sound are apart.
# The dump is lines "TRACK|name|start|end|inPoint|DIS|mediaPath" (V tracks and A1), made by the Premiere dump snippet.
# Concurrence 2026-11-10: text-sync said every line was within 40 ms, yet Shafin saw L18 off. Measure, don't trust the pairing.
import json, os, sys, glob, subprocess
import numpy as np
W = sys.argv[1]; DUMP = sys.argv[2]; REC = sys.argv[3] if len(sys.argv) > 3 else None
SR = 8000
man = {}
for f in sorted(glob.glob(os.path.join(W, "*.pieces.json")), key=os.path.getmtime): man.update(json.load(open(f)))
rows = [l.split("|") for l in open(DUMP).read().splitlines() if "|" in l]
V = [r for r in rows if r[0].startswith("V") and r[0] != "V1" and not r[5]]   # V1 holds the B cam alternate
A = [r for r in rows if r[0] == "A1"]
def load(path, ss, t):
    b = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, ss):.3f}", "-t", f"{t:.3f}", "-i", path, "-ac", "1", "-ar", str(SR),
                        "-af", "highpass=f=150,lowpass=f=3000", "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(b, np.float32)
def env(x):
    n = SR // 100; m = len(x) // n
    e = np.sqrt((x[:m * n].reshape(m, n) ** 2).mean(1) + 1e-12); e = np.log(e); return (e - e.mean()) / (e.std() + 1e-9)
def recfile(src):
    if REC and os.path.exists(os.path.join(REC, src)): return os.path.join(REC, src)
    hits = glob.glob(f"/Volumes/*/*/Audio/{src}") + glob.glob(f"/Volumes/*/*/*/Audio/{src}"); return hits[0] if hits else None
out = []
for v in V:
    vs, ve, vin = float(v[2]), float(v[3]), float(v[4])
    cam = os.path.join(W, "audio_A", os.path.splitext(os.path.basename(v[6]))[0] + ".wav")
    if not os.path.exists(cam): continue
    a = next((x for x in A if float(x[2]) <= (vs + ve) / 2 < float(x[3])), None)
    if not a: continue
    pc = man.get(a[1]) or man.get(os.path.basename(a[6]))
    if not pc: out.append((v[2], v[1], a[1], None, "AI or unknown sound")); continue
    rec = recfile(pc["src"]);  pre = pc.get("pre", 2.0)
    if not rec: continue
    t0 = max(vs, float(a[2])); t1 = min(ve, float(a[3])); d = t1 - t0
    if d < 1.2: continue
    c0 = vin + (t0 - vs); r0 = pc["s0"] - pre + float(a[4]) + (t0 - float(a[2]))
    S = 0.6; x = env(load(cam, c0 - S, d + 2 * S)); y = env(load(rec, r0, d))
    if len(y) < 50 or len(x) < len(y): continue
    cc = np.array([np.dot(x[k:k + len(y)], y) / len(y) for k in range(len(x) - len(y) + 1)])
    k = int(np.argmax(cc)); lag = (k / 100.0) - S   # + = the picture is AHEAD of the sound
    out.append((v[2], v[1], a[1], round(lag, 2), f"match {cc[k]:.2f}"))
bad = 0
for s, vn, an, lag, note in out:
    flag = "" if lag is None else ("  <-- OFF" if abs(lag) > 0.06 and "match 0.0" not in note else "")
    bad += bool(flag); print(f"{float(s):8.2f}  {vn[:38]:38s} {an[:24]:24s} lag {lag if lag is not None else '-':>6}  {note}{flag}")
print(f"\n{bad} clips off by more than 60 ms (1.5 frames)")
