# coverage.py work_dir   -> run right after sync, BEFORE takes/scrub/rough cut. Stops the line early.
# For every recorder file with script dialogue, which cameras cover it and for how much of the speech.
# Prints a table and a plain-language summary; exits 2 if any camera is missing anywhere, so the run pauses
# and the editor is told (Notch 2026-11-04: B cam missing on the back half was only found at the audio step).
import json, os, subprocess, sys
W = sys.argv[1]
J = lambda n: [json.loads(l) for l in open(os.path.join(W, n)) if l.startswith("{")] if os.path.exists(os.path.join(W, n)) else []
CAMS = {"A": J("sync_a_ok.jsonl"), "B": J("sync_b_ok.jsonl"), "C": J("sync_c_ok.jsonl")}
CAMS = {c: v for c, v in CAMS.items() if v or os.path.exists(os.path.join(W, f"sync_{c.lower()}_ok.jsonl"))}
_d = {}
def dur(p):
    if p not in _d:
        _d[p] = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                     capture_output=True, text=True).stdout.strip() or 0)
    return _d[p]
takes = json.load(open(os.path.join(W, "takes.json"))) if os.path.exists(os.path.join(W, "takes.json")) else None
words_dir = os.path.join(W, "words")
gaps = {}
print(f"{'recorder':16}" + "".join(f"{c:>8}" for c in CAMS))
for f in sorted(os.listdir(words_dir)):
    src = f[:-len(".words.json")]
    ws = json.load(open(os.path.join(words_dir, f)))
    if len(ws) < 20: continue                       # sound checks, empty files
    row = []
    for c, syncs in CAMS.items():
        cov = 0
        for w in ws:
            t = (w["start"] + w["end"]) / 2
            if any(os.path.basename(r["other"]) == src and 0 <= t + r["offset_s"] <= dur(r["ref"]) for r in syncs): cov += 1
        share = cov / len(ws); row.append(share)
        if share < 0.9: gaps.setdefault(c, []).append((src, round(share * 100)))
    print(f"{src:16}" + "".join(f"{s*100:7.0f}%" for s in row))
for c, g in gaps.items():
    print(f"\nWARNING {c} cam does not cover {len(g)} recorder files: " + ", ".join(f"{s} ({p}%)" for s, p in g))
print("\nOK: every camera covers every take." if not gaps else
      "\nSTOP: tell the editor now. Either the camera stopped rolling, a card is missing, or the sync failed.")
sys.exit(2 if gaps else 0)
