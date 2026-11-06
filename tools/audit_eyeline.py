# audit_eyeline.py work_dir clips.txt [ref_clip_name]  -> eyeline audit of an EDITED timeline (report only, changes nothing)
# For every visible main-camera clip (topmost enabled 7T0A* clip): samples its frames at 4 fps, checks every founder
# is on the lens (calibrated on the reference clip the editor chose), lists the off-lens stretches with timeline TC,
# the line playing under it, and better takes of that line (eyeline.json + sound rank).
import glob, json, os, subprocess, sys, numpy as np
sys.argv_saved = list(sys.argv)
W, CL = os.path.abspath(sys.argv[1]), sys.argv[2]; REF = sys.argv[3] if len(sys.argv) > 3 else None
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path="/Volumes/T7/work/models/face_landmarker.task"),
      num_faces=4, min_face_detection_confidence=0.3, output_facial_transformation_matrixes=True))
PX = {os.path.basename(p)[:-10]: p for p in glob.glob(os.path.join(W, "..", "proxies", "A_CAM", "*_proxy.mp4"))}
TW = {os.path.basename(p)[:-len("_4K.mov")]: p for p in glob.glob(os.path.join(W, "..", "4K_local", "*_4K.mov"))}
TW.update({os.path.basename(p)[:-len("_4K_opening.mov")] + "|opening": p for p in glob.glob(os.path.join(W, "..", "4K_local", "*_4K_opening.mov"))})
def proxy_of(name):   # the sharpest LOCAL picture of this clip: the 4K twin (faces 4x bigger than the proxy), else the proxy
    if name.endswith("_4K_opening.mov"): return TW.get(name[:-len("_4K_opening.mov")] + "|opening")
    stem0 = name.replace("_4K.mov", "").replace("_proxy.mp4", "").rsplit(".", 1)[0]
    if stem0 in TW: return TW[stem0]
    return proxy_of_px(name)
def proxy_of_px(name):
    stem = name.replace("_4K_opening.mov", "").replace("_4K.mov", "").replace("_proxy.mp4", "").rsplit(".", 1)[0]
    return PX.get(stem)
def frames(path, t0, d):
    w, h = 1600, 700
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{d:.3f}", "-i", path, "-vf", f"fps=4,crop=iw*0.8:ih*0.6:iw*0.1:0,scale={w}:{h}",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    n = len(raw) // (w * h * 3); return [np.frombuffer(raw[i*w*h*3:(i+1)*w*h*3], np.uint8).reshape(h, w, 3) for i in range(n)]
def looks(img):
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
    fs = sorted(zip(r.face_landmarks, r.facial_transformation_matrixes), key=lambda f: -(max(p.x for p in f[0]) - min(p.x for p in f[0])))[:2]
    out = []
    for lm, mx in fs:
        R = np.array(mx)[:3, :3]; yaw = np.degrees(np.arctan2(R[0, 2], R[2, 2])); pitch = np.degrees(np.arcsin(-np.clip(R[1, 2], -1, 1)))
        P = lambda i: np.array([lm[i].x, lm[i].y])
        def iris(c, a, b, t, bo):
            e = P(b) - P(a); u = np.dot(P(c) - P(a), e) / (np.dot(e, e) + 1e-9); v = (P(c)[1] - P(t)[1]) / (P(bo)[1] - P(t)[1] + 1e-9); return 2*u-1, 2*v-1
        lx, ly = iris(468, 33, 133, 159, 145); rx, ry = iris(473, 362, 263, 386, 374)
        out.append((float(np.mean([p.x for p in lm])), float(yaw + 35*(lx+rx)/2), float(pitch - 25*(ly+ry)/2)))
    return sorted(out)
rows = [l.strip().split("|") for l in open(CL) if l.count("|") == 5]
vid = [(int(t), n, float(a), float(b), float(i), int(d)) for t, n, a, b, i, d in rows if t != "A"]
aud = [(n, float(a), float(b)) for t, n, a, b, i, d in rows if t == "A"]
def visible(t):   # topmost enabled clip at timeline t
    c = [v for v in vid if v[2] <= t < v[3] and not v[5]]; return max(c, key=lambda v: v[0]) if c else None
# calibration on the reference clip
ref = next(v for v in vid if REF and REF in v[1]); L = [looks(f) for f in frames(proxy_of(ref[1]), ref[4], ref[3] - ref[2])]
two = [f for f in L if len(f) == 2]
cal = [dict(x=float(np.median([f[i][0] for f in two])), yaw=float(np.median([f[i][1] for f in two])), pitch=float(np.median([f[i][2] for f in two]))) for i in range(2)]
TOL = 9.0   # stricter: eye-only glances (head on lens, eyes off) count
def on(f):
    if len(f) < 2: return False
    for c in cal:
        p = min(f, key=lambda p: abs(p[0] - c["x"]))
        if abs(p[1] - c["yaw"]) > TOL or abs(p[2] - c["pitch"]) > TOL: return False
    return True
PIECES = {}
for f in sorted(glob.glob(os.path.join(W, "*.pieces.json")), key=os.path.getmtime): PIECES.update(json.load(open(f)))
FILES = json.load(open(os.path.expanduser("~/.shown/takefinder.json"))).get("files", {})
def line_at(t):
    for n, a, b in aud:
        if a <= t < b:
            if n in PIECES: return PIECES[n]["line"]
            if n in FILES: return FILES[n][0]
            if n.startswith("open9128_"): return n.split("_")[1][:3]
    return None
E_ = json.load(open(os.path.join(W, "eyeline.json"))); TK = json.load(open(os.path.join(W, "takes.json")))
tc = lambda s: f"{int(s//60):02d}:{int(s%60):02d}:{int(round((s%1)*24)):02d}"
seen = set(); report = []
for v in sorted(vid, key=lambda v: v[2]):
    if v[5] or not v[1].startswith("7T0A") or v in seen: continue
    p = proxy_of(v[1])
    if not p: continue
    seen.add(v); fr = frames(p, v[4], v[3] - v[2]); ok = []
    for i, f in enumerate(fr):
        t = v[2] + i / 4
        if visible(t) != v: continue   # covered by another clip on top
        ok.append((t, on(looks(f))))
    if not ok: continue
    score = np.mean([o for _, o in ok]); bad = [t for t, o in ok if not o]
    runs = []
    for t in bad:
        if runs and t - runs[-1][1] <= 0.3: runs[-1][1] = t
        else: runs.append([t, t])
    runs = [r for r in runs if r[1] - r[0] >= 0.5]   # a blink-length glance is fine; flag 0.5 s+
    if score < 0.8 or runs:
        L_ = line_at((v[2] + v[3]) / 2)
        alts = sorted([t for t in TK if t["line"] == L_ and t.get("rank", 0) > -500], key=lambda t: -(E_.get(f'{t["line"]}|{t["take"]}|{t["src"]}', {}).get("score") or 0) * 45 - t.get("rank", 0))[:3]
        report.append(dict(clip=v[1], start=tc(v[2]), end=tc(v[3]), on_lens=round(float(score) * 100), off=[f"{tc(a)}-{tc(b + 0.25)}" for a, b in runs], line=L_,
                           better=[f'take {t["take"]} (eyes {round((E_.get(t["line"] + "|" + str(t["take"]) + "|" + t["src"], {}).get("score") or 0) * 100)}%)' for t in alts]))
json.dump(report, open(os.path.join(W, "eyeline_audit.json"), "w"), indent=1)
print(f"reference: {ref[1]} ({len(two)} of {len(L)} frames with both faces) | {len(seen)} clips checked, {len(report)} flagged")
for r in report: print(f'{r["start"]}-{r["end"]}  {r["clip"]}  on lens {r["on_lens"]}%  off at {", ".join(r["off"]) or "-"}  | Line {r["line"]}  better: {", ".join(r["better"])}')
