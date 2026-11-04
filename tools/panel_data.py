# panel_data.py work_dir "Client"   -> ~/.shown/takefinder.json + thumbnails, read by the Take Finder panel in Premiere
# For every script line: its rough-cut spot, the pick, and every take with scrub timecode, flags and A/B frames.
import json, os, subprocess, sys
W = os.path.abspath(sys.argv[1]); CLIENT = sys.argv[2] if len(sys.argv) > 2 else "Project"
TH = os.path.join(W, "finder", "thumbs"); os.makedirs(TH, exist_ok=True)
LINES = {l["line"]: l for l in json.load(open(os.path.join(W, "lines.json")))}
SCRUB = json.load(open(os.path.join(W, os.environ.get("SCRUB_REPORT", "notch_SCRUB_work.takes.json"))))
RC = {r["line"]: r for r in json.load(open(os.path.join(W, os.environ.get("RC_REPORT", "notch_RC_clean.takes.json"))))}
def thumb(path, sec, name):
    out = os.path.join(TH, name)
    if not os.path.exists(out):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(sec, 0):.2f}", "-i", path, "-frames:v", "1",
                        "-vf", "scale=-2:120,setsar=1", "-q:v", "5", out])
    return out if os.path.exists(out) else None
lines = []
for L, ln in LINES.items():
    takes = []
    for r in (x for x in SCRUB if x["line"] == L):
        p = RC.get(L)
        takes.append(dict(take=r["take"], of=r["of"], scrub_at=r["at"], dur=r["dur"], text=r.get("text", ""),
                          feed=r.get("feed", False), wind=(r.get("wind") or -99) > 12, cams=r.get("cams", ""), src=r["src"],
                          picked=bool(p and p["take"] == r["take"] and p["src"] == r["src"]),
                          thumbs={c: thumb(pth, s, f"{L}_{r['take']}_{c}.jpg") for c, (pth, s) in r.get("frames", {}).items()}))
    if not takes: continue
    p = RC.get(L)
    lines.append(dict(id=L, num=int(L[1:]), text=ln["text"], who=ln.get("who", "").replace("FOUNDER", "Founder "),
                      rc_at=p["at"] if p else None, rc_dur=p["dur"] if p else None, check=(p or {}).get("check") or [],
                      takes=sorted(takes, key=lambda t: not t["picked"])))
cfg = os.path.expanduser("~/.shown"); os.makedirs(cfg, exist_ok=True)
data = dict(client=CLIENT, rc_seq=os.environ.get("RC_SEQ", f"{CLIENT.upper()} REVIEW 1 - Rough cut (picked takes)"),
            scrub_seq=os.environ.get("SCRUB_SEQ", f"{CLIENT.upper()} REVIEW 2 - Scrub (every take, A and B side by side)"), lines=lines)
json.dump(data, open(os.path.join(cfg, "takefinder.json"), "w"), indent=1)
print(f"Take Finder data: {len(lines)} lines -> ~/.shown/takefinder.json")
