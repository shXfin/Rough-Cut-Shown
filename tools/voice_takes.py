# voice_takes.py lines.json voice_dir fo_map.json   -> adds a voice clip for every non-founder line still on a crew read
# The voice folder also holds whole-scene renders (Scene5.mp3, Scene8.mp3, ...) worded like the shooting
# script, plus the restaurant owner's and plumber's lines. Each missing line is cut out of those files by
# its word timings. Hand-mapped official takes (fo_map.json) always win; these are flagged "older take".
import json, os, re, sys, glob
from rapidfuzz import fuzz
from faster_whisper import WhisperModel
LINES = json.load(open(sys.argv[1])); VDIR = sys.argv[2]; MAP = sys.argv[3]
fo_map = json.load(open(MAP)) if os.path.exists(MAP) else {}
official = {os.path.realpath(f["path"]) for v in fo_map.values() for f in v}
cache = os.path.join(os.path.dirname(os.path.abspath(MAP)), "words_voice"); os.makedirs(cache, exist_ok=True)

files = [f for f in glob.glob(os.path.join(VDIR, "*.mp3")) if os.path.realpath(f) not in official]
model = None; words = []
for f in sorted(files):
    dst = os.path.join(cache, os.path.basename(f) + ".words.json")
    if not os.path.exists(dst):
        model = model or WhisperModel("mobiuslabsgmbh/faster-whisper-large-v3-turbo", device="cpu", compute_type="int8")
        segs, _ = model.transcribe(f, word_timestamps=True)
        json.dump([dict(w=w.word.strip(), start=w.start, end=w.end) for s in segs for w in s.words], open(dst, "w"))
    words += [dict(w, src=f) for w in json.load(open(dst))]

def norm(s): return re.sub(r"[^a-z0-9' ]", " ", s.lower().replace("-", " ")).split()
for ln in LINES:
    if ln.get("who") == "SHIVANI" or not ln["main"] or ln["line"] in fo_map: continue
    tgt = norm(ln["text"]); n = len(tgt); best = None
    for i in range(len(words)):
        for L in range(max(1, n - 2), n + 3):
            j = i + L
            if j > len(words) or words[j-1]["src"] != words[i]["src"]: continue
            s = fuzz.ratio(" ".join(tgt), " ".join(norm(" ".join(x["w"] for x in words[i:j]))))
            if best is None or s > best[0]: best = (s, i, j)
    if not best or best[0] < 70: print(ln["line"], "no voice take", round(best[0], 1) if best else ""); continue
    s, i, j = best; w0, w1 = words[i], words[j-1]
    fo_map[ln["line"]] = [dict(id=os.path.basename(w0["src"]), path=w0["src"], start=max(w0["start"] - 0.06, 0),
                               end=w1["end"] + 0.12, older=True)]
    print(ln["line"], "<-", os.path.basename(w0["src"]), f'{w0["start"]:.2f}-{w1["end"]:.2f}', round(s, 1), "|", " ".join(x["w"] for x in words[i:j]))
json.dump(fo_map, open(MAP, "w"), indent=1)
