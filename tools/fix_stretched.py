# fix_stretched.py work_dir   -> rewrites takes.json in place (keeps takes.json.bak)
# Whisper sometimes stretches one word over seconds of missed speech (Notch L11: "autonomously" 606-623 s
# covered crew chatter and a first attempt). Any take with a word over MAX_WORD s is re-transcribed on its
# own stretch and reset to the most complete read of the line inside it (the later one on a near tie).
import json, os, re, shutil, subprocess, sys, tempfile, difflib
from faster_whisper import WhisperModel
W = sys.argv[1]; MAX_WORD = 1.5
P = os.path.join(W, "takes.json"); takes = json.load(open(P))
SRC = {os.path.basename(p): p for p in json.load(open(os.path.join(W, "sources.json")))}
n = lambda s: re.sub(r"[^a-z0-9' ]", " ", s.lower()).split()
bad = [t for t in takes if any(w["end"] - w["start"] > MAX_WORD for w in t["words"])]
print(len(bad), "stretched takes")
if bad:
    shutil.copy(P, P + ".bak"); model = WhisperModel("large-v3-turbo", compute_type="int8")
for t in bad:
    tmp = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t["start"] - 0.3), "-t", str(t["end"] - t["start"] + 0.6),
                    "-i", SRC[t["src"]], "-ac", "1", "-ar", "16000", tmp], check=True)
    segs, _ = model.transcribe(tmp, word_timestamps=True, initial_prompt=t["script"])
    ws = [dict(w=x.word.strip(), start=round(x.start + t["start"] - 0.3, 3), end=round(x.end + t["start"] - 0.3, 3), p=x.probability)
          for s in segs for x in s.words]
    os.remove(tmp); tgt = n(t["script"]); best = None
    for i in range(len(ws)):                      # last window that reads as the line wins
        for j in range(i + max(1, len(tgt) - 3), min(len(ws), i + len(tgt) + 3) + 1):
            r = round(difflib.SequenceMatcher(None, tgt, n(" ".join(x["w"] for x in ws[i:j]))).ratio(), 2)
            # most complete read first (a partial read drops the line's opening words); a later read wins a near tie
            if r >= 0.8 and (best is None or r > best[0] + 0.03 or (r >= best[0] - 0.03 and i > best[1])): best = (r, i, j)
    if best:
        r, i, j = best
        while i > 0 and set(n(ws[i-1]["w"])) & set(tgt[:4]) and ws[i]["start"] - ws[i-1]["end"] < 0.6: i -= 1   # keep the opening words
        old = (t["start"], t["end"])
        t.update(words=ws[i:j], start=ws[i]["start"], end=ws[j-1]["end"], text=" ".join(x["w"] for x in ws[i:j]))
        print(t["line"], "take", t["take"], old, "->", (t["start"], t["end"]), round(r, 2), t["text"])
    else: print(t["line"], "take", t["take"], "no clean read found, left as is")
json.dump(takes, open(P, "w"), indent=1)
