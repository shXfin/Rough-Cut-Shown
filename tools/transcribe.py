# transcribe.py out_dir prompt file...   -> out_dir/{basename}.words.json (word-level, Socrates format)
# Local port of Socrates phase 3 step 1. Uses faster-whisper large-v3-turbo cached on the T7.
import json, os, subprocess, sys, time
import numpy as np
from faster_whisper import WhisperModel

OUT, PROMPT, FILES = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(OUT, exist_ok=True)

def load(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)

m = WhisperModel("mobiuslabsgmbh/faster-whisper-large-v3-turbo", device="cpu", compute_type="int8")
for f in FILES:
    dst = os.path.join(OUT, os.path.basename(f) + ".words.json")
    if os.path.exists(dst):
        continue
    t0 = time.time()
    segs, _ = m.transcribe(load(f), language="en", word_timestamps=True, vad_filter=False,
                           condition_on_previous_text=False, initial_prompt=PROMPT)
    words = [dict(w=w.word.strip(), start=round(w.start, 3), end=round(w.end, 3), p=round(w.probability, 2))
             for s in segs for w in s.words]
    json.dump(words, open(dst, "w"))
    print(f"{os.path.basename(f)}\t{len(words)} words\t{time.time() - t0:.0f}s", flush=True)
