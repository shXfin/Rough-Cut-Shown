# top3.py work_dir [N]   -> top3.json + top3.txt: the N best takes per script line, for Sam's short scrub
# A take is ranked on its sound (pick.py's rank: wording, stumbles, pauses, wind, cameraman/no-voice excluded) PLUS
# eyeline (eyeline.py: share of the spoken line where every founder looks at the lens). Eyeline is a must: a take
# under EYE_MIN is only used when a line has no better ones, and is flagged so the editor knows.
import json, os, sys
W = os.path.abspath(sys.argv[1]); N = int(sys.argv[2]) if len(sys.argv) > 2 else 3
EYE_W, EYE_MIN = 45.0, 0.7
T = json.load(open(os.path.join(W, "takes.json"))); E = json.load(open(os.path.join(W, "eyeline.json")))
LINES = {l["line"]: l for l in json.load(open(os.path.join(W, "lines.json")))}
by = {}
for t in T:
    if t.get("rank", 0) < -500: continue   # cameraman reading it, no voice
    e = E.get(f'{t["line"]}|{t["take"]}|{t["src"]}', {}).get("score")
    t["_eye"] = e; t["_score"] = t.get("rank", 0) + EYE_W * (e if e is not None else 0.5)
    by.setdefault(t["line"], []).append(t)
out, txt = {}, []
for L in sorted(by):
    ts = sorted(by[L], key=lambda t: -t["_score"])
    good = [t for t in ts if t["_eye"] is not None and t["_eye"] >= EYE_MIN]
    pick = (good + [t for t in ts if t not in good])[:N]
    out[L] = [dict(take=t["take"], src=t["src"], eyeline=t["_eye"], score=round(t["_score"], 1)) for t in pick]
    txt.append(f"Line {int(L[1:])}: " + ", ".join(f"take {t['take']} (eyes {'n/a' if t['_eye'] is None else str(round(t['_eye']*100))+'%'})" + ("" if t in good else " LOOKING AWAY") for t in pick)
               + f"   [{len(ts)} takes]")
json.dump(out, open(os.path.join(W, "top3.json"), "w"), indent=1)
open(os.path.join(W, "top3.txt"), "w").write("\n".join(txt)); print("\n".join(txt))
