# panel_data.py work_dir "Client"   -> ~/.shown/takefinder.json + thumbnails, read by the Take Finder panel in Premiere
# For every script line: its rough-cut spot, the pick, and every take with scrub timecode, flags and A/B frames.
import json, os, subprocess, sys
W = os.path.abspath(sys.argv[1]); CLIENT = sys.argv[2] if len(sys.argv) > 2 else "Project"
PJ = (os.environ.get("PROJECT") or os.path.basename(os.path.dirname(os.path.abspath(W)))).lower()   # project name = the folder above work/ (Notch/work -> notch_*.xml); PROJECT= overrides
TH = os.path.join(W, "finder", "thumbs"); os.makedirs(TH, exist_ok=True)
LINES = {l["line"]: l for l in json.load(open(os.path.join(W, "lines.json")))}
SCRUB = json.load(open(os.path.join(W, os.environ.get("SCRUB_REPORT", f"{PJ}_SCRUB_grid.takes.json"))))
# every scrub of the project (work/scrubs.json: [{seq, report, xml}], the full one first). Each take carries where it
# sits in EACH scrub, so the panel can jump to and follow any of them (Sam's 3-take scrub, the full one, the next one).
_reg = os.path.join(W, "scrubs.json")
SCRUBS = json.load(open(_reg)) if os.path.exists(_reg) else [dict(seq=f"{CLIENT.upper()} REVIEW 2 - Scrub (every take, A and B side by side)", report=f"{PJ}_SCRUB_grid.takes.json", xml=f"{PJ}_SCRUB_grid.xml")]
AT = {}   # (line, take, src) -> {scrub seq: second}
for sc in SCRUBS:
    rp = os.path.join(W, sc["report"])
    if os.path.exists(rp):
        for r in json.load(open(rp)): AT.setdefault((r["line"], r["take"], r["src"]), {})[sc["seq"]] = r["at"]
# sound checks come straight from takes.json, so a newer check shows up without rebuilding the scrub
TK = {(t["line"], t["take"], t["src"]): t for t in json.load(open(os.path.join(W, "takes.json")))}
RC = {r["line"]: r for r in json.load(open(os.path.join(W, os.environ.get("RC_REPORT", f"{PJ}_RC_clean.takes.json"))))}
import re
FPS = 24000 / 1001
def pieces(xml, report):   # audio piece file name -> (line, take): lets the panel name any clip, wherever you move it
    out = {}
    if not os.path.exists(xml): return out
    for cid, name, st in re.findall(r'<clipitem id="(a[^"]*)"><name>([^<]+\.wav)</name>.*?<start>(\d+)</start>', open(xml).read()):
        at = int(st) / FPS
        r = next((x for x in report if abs(x["at"] - at) < 0.06), None)
        if r and name not in out: out[name] = [r["line"], r["take"]]
    return out
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
        takes.append(dict(take=r["take"], of=r["of"], scrub_at=r["at"], at=AT.get((L, r["take"], r["src"]), {}), dur=r["dur"], text=r.get("text", ""),
                          feed=bool(r.get("feed") or TK.get((L, r["take"], r["src"]), {}).get("part_feed")),
                          part_feed=TK.get((L, r["take"], r["src"]), {}).get("part_feed", ""), wind=(r.get("wind") or -99) > 12, cams=r.get("cams", ""), src=r["src"],
                          picked=bool(p and p["take"] == r["take"] and p["src"] == r["src"]),
                          thumbs={c: thumb(pth, s, f"{L}_{r['take']}_{c}.jpg") for c, (pth, s) in r.get("frames", {}).items()}))
    if not takes: continue
    p = RC.get(L)
    lines.append(dict(id=L, num=int(L[1:]), text=ln["text"], who=ln.get("who", "").replace("FOUNDER", "Founder "),
                      rc_at=p["at"] if p else None, rc_dur=p["dur"] if p else None, check=(p or {}).get("check") or [],
                      takes=sorted(takes, key=lambda t: not t["picked"])))
cfg = os.path.expanduser("~/.shown"); os.makedirs(cfg, exist_ok=True)
try:   # earlier builds' pieces stay named: the old copy in Sequences/Old (and hand-placed clips) still use them
    _pp = os.path.join(cfg, "takefinder", PJ + ".json"); _prev = json.load(open(_pp if os.path.exists(_pp) else os.path.join(cfg, "takefinder.json")))
    _old_files = _prev.get("files", {}) if _prev.get("work") == W else {}
except Exception: _old_files = {}
data = dict(client=CLIENT, rc_seq=os.environ.get("RC_SEQ", f"{CLIENT.upper()} REVIEW 1 - Rough cut (picked takes)"),
            scrub_seq=os.environ.get("SCRUB_SEQ", f"{CLIENT.upper()} REVIEW 2 - Scrub (every take, A and B side by side)"), lines=lines,
            work=W, built=__import__("time").strftime("%H:%M"),
            scrubs=[sc["seq"] for sc in SCRUBS],
            files={**_old_files, **{k: v for sc in SCRUBS[1:] for k, v in pieces(os.path.join(W, sc["xml"]), json.load(open(os.path.join(W, sc["report"])))).items()}, **pieces(os.path.join(W, os.environ.get("SCRUB_XML", f"{PJ}_SCRUB_grid.xml")), SCRUB),
                   **pieces(os.path.join(W, os.environ.get("RC_XML", f"{PJ}_RC_clean.xml")), list(RC.values()))})
# one data file PER PROJECT (the panel opens the one matching the open Premiere project's name); takefinder.json
# stays as the latest, for older panels. Concurrence 2026-11-09: the panel kept showing Notch.
os.makedirs(os.path.join(cfg, "takefinder"), exist_ok=True)
data["project"] = PJ
json.dump(data, open(os.path.join(cfg, "takefinder", PJ + ".json"), "w"), indent=1)
json.dump(data, open(os.path.join(cfg, "takefinder.json"), "w"), indent=1)
print(f"Take Finder data: {len(lines)} lines, {len(data['files'])} named pieces -> ~/.shown/takefinder/{PJ}.json")
# the panel's "Rebuild rough cut" button opens this in Terminal (Premiere can open a file, not run a script)
cmd = os.path.join(W, "Rebuild rough cut.command")
open(cmd, "w").write(f'#!/bin/bash\n"{os.path.join(os.path.dirname(os.path.abspath(__file__)), "rebuild_rc.sh")}" "{W}" "{CLIENT}"\n'
                     'echo; read -n 1 -p "Press any key to close this window"\n')
os.chmod(cmd, 0o755)
