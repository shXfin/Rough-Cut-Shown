# style.py out.json video...   -> how a rough cut is paced, measured the same way for any cut
# Used to learn Shown's editors' standard from their own rough cuts and to compare ours against it:
# pauses between sentences, long holds, shot lengths, where picture cuts land (in a pause or over
# speech), and whether alternate takes are left in.
import json, os, re, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
from rapidfuzz import fuzz
OUT, FILES = sys.argv[1], sys.argv[2:]
model = WhisperModel("mobiuslabsgmbh/faster-whisper-large-v3-turbo", device="cpu", compute_type="int8")

def cuts(path):
    log = subprocess.run(["ffmpeg", "-v", "info", "-i", path, "-vf", "scdet=threshold=8", "-an", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return [float(x) for x in re.findall(r"lavfi\.scd\.time: ([0-9.]+)", log)]
def duration(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                capture_output=True, text=True).stdout)

res = {}
for f in FILES:
    name = os.path.basename(f); D = duration(f)
    segs, _ = model.transcribe(f, language="en", word_timestamps=True, vad_filter=True)
    W = [dict(w=w.word.strip(), s=w.start, e=w.end) for s in segs for w in s.words]
    sents, cur = [], []
    for w in W:
        cur.append(w)
        if w["w"].endswith((".", "?", "!")): sents.append(cur); cur = []
    if cur: sents.append(cur)
    gaps = np.array([b[0]["s"] - a[-1]["e"] for a, b in zip(sents, sents[1:])]) if len(sents) > 1 else np.array([0.0])
    C = cuts(f); shots = np.diff([0.0] + C + [D])
    def in_speech(t): return any(w["s"] + 0.05 < t < w["e"] - 0.05 for w in W)
    def near_sentence_gap(t): return any(a[-1]["e"] - 0.1 <= t <= b[0]["s"] + 0.1 for a, b in zip(sents, sents[1:]))
    texts = [" ".join(x["w"] for x in s).lower() for s in sents]
    repeats = sum(1 for i in range(len(texts)) for j in range(i+1, min(i+40, len(texts)))
                  if len(texts[i]) > 25 and fuzz.ratio(texts[i], texts[j]) > 85)
    speech = sum(w["e"] - w["s"] for w in W)
    res[name] = dict(
        duration_s=round(D, 1), sentences=len(sents), words_per_min=round(len(W) / D * 60, 1),
        speech_share=round(speech / D, 2),
        pause_between_sentences_median_s=round(float(np.median(gaps)), 2),
        pause_p75_s=round(float(np.percentile(gaps, 75)), 2), pause_p90_s=round(float(np.percentile(gaps, 90)), 2),
        holds_over_1s=int((gaps > 1.0).sum()), holds_over_2s=int((gaps > 2.0).sum()),
        picture_cuts=len(C), shot_median_s=round(float(np.median(shots)), 2), shot_p90_s=round(float(np.percentile(shots, 90)), 2),
        cuts_over_speech_share=round(sum(map(in_speech, C)) / max(len(C), 1), 2),
        cuts_in_sentence_gap_share=round(sum(map(near_sentence_gap, C)) / max(len(C), 1), 2),
        repeated_sentences=repeats,
        head_s=round(W[0]["s"], 2) if W else None, tail_s=round(D - W[-1]["e"], 2) if W else None)
    print(name, json.dumps(res[name]), flush=True)
json.dump(res, open(OUT, "w"), indent=1)
