# verify_sync.py words_cam_dir words_dir in.jsonl out_ok.jsonl   -> keeps only syncs confirmed word by word
# A sync is confirmed when, across the recorder file's span in camera time, >= 8 camera words land on the same
# word in the recorder within 0.3 s, and they are >= 30% of the camera's words there.
import json, os, re, sys
CAM, REC, IN, OUT = sys.argv[1:5]
k = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
def confirmed(r):
    cam = json.load(open(os.path.join(CAM, os.path.basename(r["ref"]) + ".words.json")))
    rec = json.load(open(os.path.join(REC, os.path.basename(r["other"]) + ".words.json")))
    lo = min(w["start"] for w in rec) + r["offset_s"]; hi = max(w["end"] for w in rec) + r["offset_s"]
    ck = [w for w in cam if len(k(w["w"])) > 2 and lo <= w["start"] <= hi]
    rk = [(k(w["w"]), w["start"]) for w in rec if len(k(w["w"])) > 2]
    hit = sum(1 for w in ck if any(t == k(w["w"]) and abs(s - (w["start"] - r["offset_s"])) < 0.3 for t, s in rk))
    return hit, hit / max(len(ck), 1)
keep = []
for r in (json.loads(l) for l in open(IN) if l.startswith("{")):
    h, s = confirmed(r); r["check_hits"] = h; r["check_share"] = round(s, 2)
    ok = h >= 8 and s >= 0.3; (keep.append(r) if ok else None)
    print("ok     " if ok else "dropped", os.path.basename(r["other"]), "->", os.path.basename(r["ref"])[:22], "hits", h, "share", round(s, 2))
open(OUT, "w").write("".join(json.dumps(r) + "\n" for r in keep))
print(len(keep), "confirmed")
