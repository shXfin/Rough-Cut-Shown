# live_script_check.py work_dir "Sequence name" [out.txt]   -> 1:1 check of the cut AS IT IS in Premiere, against the script
# Reads every sound clip on the sequence's first audio track (with your trims, swaps and re-orders), works out its
# script line from the piece manifests, plays exactly the part of the file the clip uses, transcribes it with no
# script hint, and compares word by word. Lines missing from the cut, out of order, or under 90% are flagged.
import difflib, glob, json, os, re, subprocess, sys, tempfile
W, SEQ = os.path.abspath(sys.argv[1]), sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else None
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
js = f"""(function(){{var q=null;for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name=={json.dumps(SEQ)})q=app.project.sequences[i];
if(!q)return 'NOSEQ';var o=[],c=q.audioTracks[0].clips;for(var k=0;k<c.numItems;k++){{var x=c[k];if(!x.projectItem)continue;
o.push([x.projectItem.name,x.projectItem.getMediaPath(),x.start.seconds,x.inPoint.seconds,x.outPoint.seconds].join('|'));}}return o.join('\\n');}})()"""
out = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=300).stdout.strip()
if out.endswith("NOSEQ") or not out: sys.exit("Sequence not found: " + SEQ)
clips = [r.split("|") for r in out.splitlines() if r.count("|") == 4]
PIECES = {}
for f in sorted(glob.glob(os.path.join(W, "*.pieces.json")), key=os.path.getmtime): PIECES.update(json.load(open(f)))
try: FILES = json.load(open(os.path.expanduser("~/.shown/takefinder.json"))).get("files", {})
except Exception: FILES = {}
LINES = [l for l in json.load(open(os.path.join(W, "lines.json"))) if l.get("main", True)]
def line_of(name):
    if name in PIECES: return PIECES[name]["line"]
    if name in FILES: return FILES[name][0]
    return None
per, order = {}, []
for name, path, st, a, b in clips:
    L = line_of(name)
    if not L: continue
    per.setdefault(L, []).append((float(st), path, float(a), float(b)))
    if not order or order[-1] != L: order.append(L)
from faster_whisper import WhisperModel
model = WhisperModel("small.en", compute_type="int8")
norm = lambda s: re.sub(r"[^a-z0-9$ ]", " ", s.lower().replace("-", " ")).split()
NUM = {"8m": "8 million", "1b": "1 billion", "$1b": "1 billion dollars", "$8m": "8 million dollars"}
rows, flags = [], []
tmp = tempfile.mkdtemp()
for i, ln in enumerate(LINES):
    L = ln["line"]; script = ln["text"]
    if L not in per: rows.append((L, script, "", 0)); flags.append(f"Line {int(L[1:])}: MISSING from the cut"); continue
    parts = []
    for k, (st, path, a, b) in enumerate(sorted(per[L])):
        f = os.path.join(tmp, f"{L}_{k}.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", path, "-ac", "1", "-ar", "16000", f])
        parts.append(f)
    lst = os.path.join(tmp, f"{L}.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    joined = os.path.join(tmp, f"{L}.wav"); subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", joined])
    segs, _ = model.transcribe(joined, beam_size=5, condition_on_previous_text=False)
    heard = " ".join(s.text.strip() for s in segs)
    sw = norm(" ".join(NUM.get(w.lower(), w) for w in script.split())); hw = norm(heard)
    sc = round(100 * difflib.SequenceMatcher(None, sw, hw).ratio())
    rows.append((L, script, heard, sc))
    if sc < 90:
        miss = [w for w in sw if w not in hw]; extra = [w for w in hw if w not in sw]
        flags.append(f"Line {int(L[1:])} ({sc}%): missing [{' '.join(miss)}]  extra [{' '.join(extra)}]")
want = [l["line"] for l in LINES if l["line"] in per]
if [L for L in order if L in want] != want: flags.append("ORDER: lines are not in script order: " + " ".join(order))
txt = [f"1:1 SCRIPT CHECK: {SEQ} (as it is in Premiere now)", ""]
for L, script, heard, sc in rows:
    txt += [f"Line {int(L[1:])}  {sc}%", f"  script: {script}", f"  heard:  {heard or '(not in the cut)'}", ""]
txt += ["NEEDS A LOOK:"] + (flags or ["nothing: every line is in, in order, at 90%+"])
s = "\n".join(txt); print("\n".join(["NEEDS A LOOK:"] + (flags or ["nothing"])))
print(f"{sum(1 for r in rows if r[3] >= 90)} of {len(rows)} lines match")
if OUT: open(OUT, "w").write(s)
