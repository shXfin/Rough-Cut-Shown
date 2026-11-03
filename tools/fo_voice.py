# fo_voice.py lines.json voice_dir out.json   -> which official voice file(s) replace each AI-character line
# On Wajo, Fo's lines were read off-mic by crew as placeholders (noise floor only ~8 dB under the voice).
# The real Fo voice was rendered later as separate files listed in LINES.txt. A script line can need
# more than one file ("My pleasure, Shivani." + "Hi, I'm Fo ..."), so files are matched by containment.
import json, os, re, sys, glob
from rapidfuzz import fuzz
LINES = json.load(open(sys.argv[1])); VDIR = sys.argv[2]; OUT = sys.argv[3]

def norm(s): return " ".join(re.sub(r"[^a-z0-9' ]", " ", s.lower()).split())
files = []
for row in open(os.path.join(VDIR, "FO OFFICIAL VOICE", "LINES.txt")):
    m = re.match(r'\s*(s\d-\d\d)\s+"(.+?)"', row)
    if not m: continue
    wav = glob.glob(os.path.join(VDIR, "FO OFFICIAL VOICE", "*", m.group(1) + "-*.wav"))
    if wav: files.append(dict(id=m.group(1), text=m.group(2), path=wav[0]))
extra = glob.glob(os.path.join(VDIR, "New line - Let's start*.wav"))   # rendered after LINES.txt
if extra: files.append(dict(id="new-start", text="Let's start with the video you're watching right now.", path=extra[0]))

out = {}
for ln in LINES:
    if ln.get("who") != "FO" or not ln["main"]: continue
    t = norm(ln["text"])
    got = [f for f in files if fuzz.partial_ratio(norm(f["text"]), t) >= 80 and len(norm(f["text"])) >= 0.3 * len(t)
           or fuzz.ratio(norm(f["text"]), t) >= 70]
    if got: out[ln["line"]] = [dict(id=f["id"], text=f["text"], path=f["path"]) for f in got]
json.dump(out, open(OUT, "w"), indent=1)
used = {f["id"] for v in out.values() for f in v}
for k, v in out.items(): print(k, "<-", " + ".join(f["id"] for f in v))
print("not used:", [f["id"] for f in files if f["id"] not in used])
print("Fo lines with no voice file:", [l["line"] for l in LINES if l.get("who") == "FO" and l["main"] and l["line"] not in out])
