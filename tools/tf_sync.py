# tf_sync.py takefinder.json timeline_dump.txt work_dir
# Brings the Take Finder data in line with the LIVE rough cut (the editor's own cuts, swaps and moves included):
# every sound clip on the audio tracks is named to its line and take (piece manifests, the scrub file list, AI voice
# names), then each line gets its real position (rc_at / rc_dur) and the take that is actually in the cut is marked.
# Concurrence 2026-11-10: after hand edits and relinks the panel still used build-time positions and jumped to the
# wrong lines, and it couldn't follow the playhead because the rough cut's clip names weren't in its file list.
import json, os, re, sys, glob
TF, DUMP, W = sys.argv[1:4]
D = json.load(open(TF))
man = {}
for f in sorted(glob.glob(os.path.join(W, "*.pieces.json")), key=os.path.getmtime): man.update(json.load(open(f)))
rows = [l.split("|") for l in open(DUMP).read().splitlines() if "|" in l]
files = D.setdefault("files", {})
def who(name, path):
    if name in files: return tuple(files[name])
    b = os.path.basename(path) if path else ""
    m = re.search(r"CON (L\d+) Agent", name) or re.search(r"(L\d+) Agent", name)
    if m: return (m.group(1), None)
    for k in (name, b):
        if k in man: return (man[k]["line"], man[k].get("take"))
        if k in files: return tuple(files[k])
    return None
span, picked = {}, {}
for r in rows:
    if not r[0].startswith("A"): continue
    w = who(r[1], r[6] if len(r) > 6 else "")
    if not w: continue
    files[r[1]] = [w[0], w[1]]
    s, e = float(r[2]), float(r[3])
    a, b = span.get(w[0], (1e9, -1)); span[w[0]] = (min(a, s), max(b, e))
    if w[1] is not None: picked[w[0]] = w[1]
n = 0
for l in D["lines"]:
    if l["id"] in span:
        a, b = span[l["id"]]; l["rc_at"], l["rc_dur"] = round(a, 3), round(b - a, 3); n += 1
    else:
        l["rc_at"] = None; l["rc_dur"] = 0
    if l["id"] in picked:
        for t in l["takes"]: t["picked"] = (t["take"] == picked[l["id"]])
json.dump(D, open(TF, "w"))
print(f"{n} lines placed from the live cut, {len(picked)} picks, {len(files)} clip names known")
