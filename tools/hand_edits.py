# hand_edits.py work_dir "Sequence name" [--report | --check SIG]   -> your Premiere edits, kept on the next rebuild
# A rebuild makes the rough cut fresh. Before it does, this reads the sequence you've been working in and turns what
# you did into overrides.json, which build_scrub.py / pick.py follow:
#   - a take swapped in (a scrub piece, or any piece of another take)  -> that take
#   - a line trimmed at its start or end                                -> that exact in and out on the recording
#   - a line deleted                                                    -> left out
# Everything else (extra clips, effects, keyframes, moved room tone) is listed as NOT carried: it stays in the copy in
# Sequences/Old. Every audio piece is named in <build>.pieces.json (line, take, recording range), so nothing is guessed.
# --check SIG: exit 3 if the sequence changed since SIG was taken (you edited while a rebuild was running).
import glob, hashlib, json, os, subprocess, sys
W, SEQ = os.path.abspath(sys.argv[1]), sys.argv[2]
REPORT = "--report" in sys.argv
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
js = f"""(function(){{var q=null;for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name=={json.dumps(SEQ)})q=app.project.sequences[i];
if(!q)return 'NOSEQ';var o=[];
for(var t=0;t<q.audioTracks.numTracks;t++){{var c=q.audioTracks[t].clips;for(var k=0;k<c.numItems;k++){{var x=c[k];
  o.push(['A'+(t+1),x.projectItem?x.projectItem.name:'?',x.start.seconds,x.end.seconds,x.inPoint.seconds,x.outPoint.seconds].join(','));}}}}
for(var t=0;t<q.videoTracks.numTracks;t++){{var c=q.videoTracks[t].clips;for(var k=0;k<c.numItems;k++){{var x=c[k];
  o.push(['V'+(t+1),x.projectItem?x.projectItem.name:'?',x.start.seconds,x.end.seconds,x.inPoint.seconds,x.outPoint.seconds].join(','));}}}}
return o.join('\\n');}})()"""
out = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=300).stdout.strip()
if out.endswith("NOSEQ") or not out: sys.exit(f"Sequence not found in Premiere: {SEQ}")
rows = [r.split(",") for r in out.splitlines() if r.count(",") == 5]
sig = hashlib.md5("\n".join(",".join(r[:2] + [f"{float(x):.2f}" for x in r[2:]]) for r in rows).encode()).hexdigest()
if "--check" in sys.argv:
    want = sys.argv[sys.argv.index("--check") + 1]
    sys.exit(0 if want == sig else 3)
# what every piece is: the builds' manifests; older builds without one fall back to the Take Finder's names
PIECES = {}
for f in sorted(glob.glob(os.path.join(W, "*.pieces.json")), key=os.path.getmtime): PIECES.update(json.load(open(f)))
takes = json.load(open(os.path.join(W, "takes.json")))
TK = {(t["line"], t["take"]): t for t in takes}
try: FILES = json.load(open(os.path.expanduser("~/.shown/takefinder.json"))).get("files", {})
except Exception: FILES = {}
def piece(name):
    if name in PIECES: return PIECES[name], 0.08
    if name in FILES:
        L, k = FILES[name]; t = TK.get((L, k))
        if t: h = 0.5 if name.startswith("take_") else 0.2   # the handle that build used (estimate: no manifest then)
        if t: return dict(line=L, take=k, src=t["src"], s0=max(0, t["start"] - h), s1=t["end"] + h), 0.3
    return None, 0
def flen(name):   # the piece file's real length
    for d in ("vo_RC", "vo_SCRUB"):
        f = os.path.join(W, d, name)
        if os.path.exists(f):
            o = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout
            return float(o.strip() or 1e9)
    return 1e9
P = os.path.join(W, "overrides.json"); ov = json.load(open(P)) if os.path.exists(P) else {}
picks = {p["line"]: p for p in json.load(open(os.path.join(W, "picks.json"))) if p.get("main", True)}
by_line, other = {}, []
for tr, name, st, en, i, o in rows:
    st, en, i, o = map(float, (st, en, i, o))
    if not tr.startswith("A"): continue
    pc, tol = piece(name)
    if pc: by_line.setdefault(pc["line"], []).append((st, pc, i, o, tol, name))
    elif not name.startswith("roomtone"): other.append(f"{name} on {tr} at {int(st // 60)}:{st % 60:04.1f}")
said, n = [], 0
for L, cl in sorted(by_line.items()):
    cl.sort(); takes_here = {c[1]["take"] for c in cl}
    k = max(takes_here, key=lambda k: sum(c[3] - c[2] for c in cl if c[1]["take"] == k))
    mine = [c for c in cl if c[1]["take"] == k]
    pc = mine[0][1]; tol = max(c[4] for c in mine)
    src_in = pc["s0"] - pc.get("pre", 0) + mine[0][2]; src_out = mine[-1][1]["s0"] - mine[-1][1].get("pre", 0) + mine[-1][3]   # pre: handle
    built_in, built_out = pc["s0"], mine[-1][1]["s1"]
    p = picks.get(L, {}); swapped = k != p.get("take")
    # a trim = you moved the clip's own in or out point (each piece starts at 0 and runs to its end when built)
    last_len = flen(mine[-1][5])
    pre0, pre1 = pc.get("pre", 0), mine[-1][1].get("pre", 0)   # with handles the edit starts at `pre`, not 0
    core_end = pre1 + (mine[-1][1]["s1"] - mine[-1][1]["s0"]) if pre1 else last_len
    trimmed = abs(mine[0][2] - pre0) > 0.04 or abs(mine[-1][3] - core_end) > 0.04
    if swapped or trimmed:
        e = dict(take=k, src=pc["src"], how="your edit in Premiere")
        if trimmed: e.update(src_in=round(src_in, 3), src_out=round(src_out, 3))
        if ov.get(L) != e: ov[L] = e; n += 1
        said.append(f"  Line {int(L[1:])}: " + ", ".join(x for x in [f"take {k}" if swapped else "", "your trim" if trimmed else ""] if x))
gone = [L for L in picks if L not in by_line]
if by_line and len(gone) < len(picks) / 2:   # a working copy, not an empty or foreign sequence
    for L in gone:
        if not ov.get(L, {}).get("drop"): ov[L] = dict(drop=True, how="you deleted it in Premiere"); n += 1
        said.append(f"  Line {int(L[1:])}: deleted, stays out")
print(f"Your edits in {SEQ}:"); print("\n".join(said) if said else "  none to carry")
if other: print("NOT carried (they stay in the copy in Sequences/Old):\n  " + "\n  ".join(other))
if not REPORT:
    json.dump(ov, open(P, "w"), indent=1); print(f"{n} new, {len(ov)} of your choices kept in overrides.json")
open(os.path.expanduser("~/.shown/live.sig"), "w").write(sig)
