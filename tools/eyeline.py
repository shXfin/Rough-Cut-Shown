# eyeline.py work_dir [--calibrate SRC:START:END]   -> work/eyeline.json: does everyone look at the lens while speaking?
# Notch: in most takes of the opening the founders glance away; sound can't see that. For every take this samples the
# A camera at 4 frames a second during the spoken line, finds every face (MediaPipe Face Landmarker, 478 points incl.
# irises, on-device), and measures where each person looks: head yaw/pitch from the face pose + iris offset in the eye.
# "On lens" is calibrated per person on a take the editor confirmed (the camera is rarely dead centre): within
# YAW_TOL / PITCH_TOL degrees of that person's calibrated look. Score = share of spoken frames where EVERYONE is on lens.
import json, os, subprocess, sys, numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision
W = os.path.abspath(sys.argv[1]); FPS_S = 4; YAW_TOL, PITCH_TOL = 11.0, 11.0
MAXP = int(os.environ.get("PEOPLE", "2"))   # the people on screen who speak to camera; extra faces (background, false hits) are dropped
MODEL = "/Volumes/T7/work/models/face_landmarker.task"
SRC = {os.path.basename(p): p for p in json.load(open(os.path.join(W, "sources.json")))}
SYNC = {}
for l in open(os.path.join(W, "sync_a_ok.jsonl")):
    if l.startswith("{"):
        r = json.loads(l); SYNC.setdefault(os.path.basename(r["other"]), []).append(r)
def dur(p): return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)
_d = {}
def cam_for(src, a, b):   # the verified A cam clip covering recording range a..b, and the camera time of a
    for r in SYNC.get(src, []):
        if a + r["offset_s"] >= 0 and b + r["offset_s"] <= _d.setdefault(r["ref"], dur(r["ref"])): return r["ref"], a + r["offset_s"]
    return None, None
opts = vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=MODEL), num_faces=4, min_face_detection_confidence=0.3,
                                    output_facial_transformation_matrixes=True, running_mode=vision.RunningMode.IMAGE)
det = vision.FaceLandmarker.create_from_options(opts)
def frames(path, t0, t1):
    # the model is tuned for close-ups: zoom into where heads are (top 60%, middle 80%) so medium-shot faces are big enough
    w, h = 1600, 700
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{t1 - t0:.3f}", "-i", path, "-vf", f"fps={FPS_S},crop=iw*0.8:ih*0.6:iw*0.1:0,scale={w}:{h}",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    n = len(raw) // (w * h * 3)
    return [np.frombuffer(raw[i * w * h * 3:(i + 1) * w * h * 3], np.uint8).reshape(h, w, 3) for i in range(n)]
def looks(img):   # per face, left to right: (x, yaw, pitch) with the eyes' direction folded in
    res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
    out = []
    faces = sorted(zip(res.face_landmarks, res.facial_transformation_matrixes),
                   key=lambda f: -(max(p.x for p in f[0]) - min(p.x for p in f[0])) * (max(p.y for p in f[0]) - min(p.y for p in f[0])))[:MAXP]
    for lm, mx in faces:
        R = np.array(mx)[:3, :3]
        yaw = np.degrees(np.arctan2(R[0, 2], R[2, 2])); pitch = np.degrees(np.arcsin(-np.clip(R[1, 2], -1, 1)))
        P = lambda i: np.array([lm[i].x, lm[i].y])
        def iris(c, a, b, top, bot):   # iris position inside the eye, -1..1 (0 = centred)
            e = P(b) - P(a); t = np.dot(P(c) - P(a), e) / (np.dot(e, e) + 1e-9)
            v = (P(c)[1] - P(top)[1]) / (P(bot)[1] - P(top)[1] + 1e-9)
            return 2 * t - 1, 2 * v - 1
        lx, ly = iris(468, 33, 133, 159, 145); rx, ry = iris(473, 362, 263, 386, 374)
        gx, gy = (lx + rx) / 2, (ly + ry) / 2
        out.append((float(np.mean([p.x for p in lm])), float(yaw + 35 * gx), float(pitch - 25 * gy)))
    return sorted(out)
def take_looks(src, a, b):
    path, ca = cam_for(src, a, b)
    if not path: return None
    return [looks(f) for f in frames(path, ca, ca + (b - a))]
calib = os.path.join(W, "eyeline_calib.json")
if "--calibrate" in sys.argv:   # SRC:START:END of a take where everyone looks at the lens
    s, a, b = sys.argv[sys.argv.index("--calibrate") + 1].split(":"); L = take_looks(s, float(a), float(b))
    n = max(len(f) for f in L); per = [[f[i] for f in L if len(f) == n] for i in range(n)]
    cal = [dict(x=float(np.median([p[0] for p in q])), yaw=float(np.median([p[1] for p in q])), pitch=float(np.median([p[2] for p in q]))) for q in per]
    json.dump(cal, open(calib, "w"), indent=1); print("calibrated", n, "people:", cal); sys.exit()
cal = json.load(open(calib))
if not cal: sys.exit("calibration found no faces: fix detection before scoring")
def on_lens(f):   # every calibrated person found and within tolerance
    if len(f) < len(cal): return False
    used = []
    for c in cal:
        p = min((p for p in f if p not in used), key=lambda p: abs(p[0] - c["x"]))
        used.append(p)
        if abs(p[1] - c["yaw"]) > YAW_TOL or abs(p[2] - c["pitch"]) > PITCH_TOL: return False
    return True
takes = json.load(open(os.path.join(W, "takes.json"))); out = {}
only = sys.argv[2:] and [x for x in sys.argv[2:] if x.startswith("L")]
for i, t in enumerate(takes):
    if only and t["line"] not in only: continue
    L = take_looks(t["src"], t["start"], t["end"])
    key = f'{t["line"]}|{t["take"]}|{t["src"]}'
    if not L: out[key] = dict(score=None, why="no A cam"); continue
    ok = [on_lens(f) for f in L]; found = [len(f) for f in L]
    out[key] = dict(score=round(float(np.mean(ok)), 3), frames=len(L), faces=round(float(np.mean(found)), 2))
    print(f'{t["line"]} take {t["take"]:>2}: on lens {out[key]["score"]*100:5.1f}% of {len(L)} frames', flush=True)
P = os.path.join(W, "eyeline.json"); prev = json.load(open(P)) if os.path.exists(P) else {}
prev.update(out); json.dump(prev, open(P, "w"), indent=1)
