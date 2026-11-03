# align.py words_dir out_dir file...   -> out_dir/{basename}.words.json with WhisperX forced-aligned word times
# Whisper's own word times drift (endings run early), which is what clipped last syllables on Wajo.
# WhisperX keeps the words we already have and re-times each one against the audio (wav2vec2
# forced alignment). Words it can't align (e.g. the Spanish order on the English model) keep their
# Whisper times and are marked aligned=False.
import json, os, sys
import whisperx
WDIR, OUT, FILES = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(OUT, exist_ok=True)
model, meta = whisperx.load_align_model(language_code="en", device="cpu")

def segments(words, gap=1.0):   # group our words back into sentences for the aligner
    segs, cur = [], []
    for w in words:
        if cur and w["start"] - cur[-1]["end"] > gap:
            segs.append(cur); cur = []
        cur.append(w)
    if cur: segs.append(cur)
    return [dict(start=s[0]["start"], end=s[-1]["end"], text=" ".join(x["w"] for x in s), words=s) for s in segs]

for f in FILES:
    name = os.path.basename(f); dst = os.path.join(OUT, name + ".words.json")
    if os.path.exists(dst): continue
    words = json.load(open(os.path.join(WDIR, name + ".words.json")))
    segs = segments(words)
    audio = whisperx.load_audio(f)
    res = whisperx.align([dict(start=s["start"], end=s["end"], text=s["text"]) for s in segs], model, meta, audio, "cpu",
                         return_char_alignments=False)
    out = []; moved = []
    aw = [a for r in res["segments"] for a in r.get("words", []) if "start" in a and "end" in a]
    # match our words to the aligner's word by word on their letters ("invite -only" and "11 a .m." split
    # differently), and only trust a new time near the old one (a 6 s jump is a wrong match, not a fix)
    import difflib, re
    key = lambda s: re.sub(r"[^a-z0-9']", "", s.lower())
    sm = difflib.SequenceMatcher(None, [key(w["w"]) for w in words], [key(a["word"]) for a in aw], autojunk=False)
    new = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            w, a = words[blk.a + k], aw[blk.b + k]
            if abs(a["start"] - w["start"]) < 0.6 and abs(a["end"] - w["end"]) < 0.6 and a["end"] > a["start"]:
                new[blk.a + k] = a
    for i, w in enumerate(words):
        if i in new:
            moved.append(abs(new[i]["end"] - w["end"]))
            out.append(dict(w, start=round(new[i]["start"], 3), end=round(new[i]["end"], 3), aligned=True))
        else:
            out.append(dict(w, aligned=False))
    json.dump(out, open(dst, "w"))
    n = sum(w["aligned"] for w in out)
    print(f"{name}\t{n}/{len(out)} words aligned\tword ends moved {sum(moved)/max(len(moved),1)*1000:.0f} ms on average", flush=True)
