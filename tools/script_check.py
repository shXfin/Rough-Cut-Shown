# script_check.py work_dir rc.xml   -> line-by-line check of the built rough cut against the script.
# Each piece's audio, exactly as the timeline plays it, is transcribed on its own (no script prompt) and compared
# word by word with its script line. Run after EVERY rebuild; any line under 90% is listed for the editor.
import json, os, re, subprocess, sys, difflib, urllib.parse
from faster_whisper import WhisperModel
W, XML = sys.argv[1], sys.argv[2]
n = lambda s: re.sub(r"[^a-z0-9' ]", " ", s.lower().replace("-", " ")).split()
NUM = {"8m": "8 million", "1b": "1 billion", "24x7": "24 7"}
LINES = {l["line"]: l for l in json.load(open(os.path.join(W, "lines.json")))}
R = json.load(open(XML.replace(".xml", ".takes.json")))
x = open(XML).read(); aud = x[x.index("<audio><track>"):]; aud = aud[:aud.index("</track>")]
paths = {m.group(1): urllib.parse.unquote(m.group(2)) for m in re.finditer(r'<file id="([^"]+)"><name>[^<]*</name><pathurl>file://localhost([^<]+)</pathurl>', x)}
F = 24000 / 1001; clips = []
for m in re.finditer(r'<clipitem id="a(\d+)(?:_\d+)?">.*?<start>(\d+)</start><end>\d+</end><in>(\d+)</in><out>(\d+)</out><file id="([^"]+)"', aud):
    clips.append((int(m.group(1)), paths[m.group(5)], int(m.group(3)) / F, int(m.group(4)) / F))
model = WhisperModel("large-v3-turbo", compute_type="int8"); tmpd = os.path.join(W, "check_lines"); os.makedirs(tmpd, exist_ok=True)
bad = []; print(f"{'line':5} {'match':>6}  heard")
for i, r in enumerate(R):
    parts = [c for c in clips if c[0] == i]
    lst = os.path.join(tmpd, f"{i}.txt"); out = os.path.join(tmpd, f"{i}.wav")
    open(lst, "w").write("".join(f"file '{p}'\ninpoint {a:.4f}\noutpoint {b:.4f}\n" for _, p, a, b in parts))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-ac", "1", "-ar", "16000", out], check=True)
    segs, _ = model.transcribe(out); heard = " ".join(s.text.strip() for s in segs)
    script = " ".join(NUM.get(w, w) for w in n(LINES[r["line"]]["text"]))
    sc = difflib.SequenceMatcher(None, n(script), n(heard), autojunk=False).ratio() * 100
    print(f"{r['line']:5} {sc:5.0f}%  {heard}")
    if sc < 90: bad.append((r["line"], round(sc), LINES[r["line"]]["text"], heard))
print(f"\n{len(R) - len(bad)} of {len(R)} lines match the script (90%+).")
for b in bad: print(f"CHECK {b[0]} ({b[1]}%)\n  script: {b[2]}\n  heard:  {b[3]}")
