# scrub.py lines.json words_dir sync_a_wav.jsonl takes.json
# Socrates phase 3 (find every take of every line + measure it), run locally.
# Sources are the recorder WAVs (dialogue) and any camera clip with no recorder match (camera-only).
import json, os, re, subprocess, sys, glob
import numpy as np
from rapidfuzz import fuzz

LINES = json.load(open(sys.argv[1])); WDIR = sys.argv[2]; SYNC = sys.argv[3]; OUT = sys.argv[4]

NUM = {w: str(i) for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen "
                                       "fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
NUM.update(thirty="30", forty="40", fifty="50", sixty="60", thousand="000",
           cuatro="4", ocho="8", doce="12", veinte="20")   # Wajo's Spanish order
def norm(s):   # Whisper writes "12 .30" and "1 ,000"; scripts write "twelve thirty" and "one thousand"
    toks = re.sub(r"[^a-z0-9' ]", " ", s.lower().replace("-", " ")).split()
    return [NUM.get(t, t) for t in toks]

# which setup each recorder file belongs to, from the slate ("this is hook two, take one");
# files with no slate inherit the previous file's setup
# Generic slate words; a project can override with slates.json next to lines.json (Wajo needs "hook two" vs
# its Hook 1 setup): {"slate": [[name, regex], ...], "section_of_beat": {beat: name}}
SLATE = [("hook", r"\bhook\b"), ("aha", r"\baha\b|\ba ha\b"), ("features", r"\bfeature"), ("proof", r"social proof"),
         ("closing", r"\bclos(e|ing)\b"), ("cta", r"\bcta\b|give ?away")]
SECTION_OF_BEAT = {}   # beats that may only search their own setup (only where setups share wording)
_sl = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "slates.json")
if os.path.exists(_sl):
    _c = json.load(open(_sl)); SLATE = [tuple(x) for x in _c.get("slate", SLATE)]; SECTION_OF_BEAT = _c.get("section_of_beat", {})

words = []   # master list: {w,start,end,p,src}
section = {}; cur = None
for f in sorted(glob.glob(os.path.join(WDIR, "*.words.json"))):
    src = os.path.basename(f)[:-len(".words.json")]
    ws = json.load(open(f))
    head = " ".join(w["w"] for w in ws[:40]).lower()
    cur = next((name for name, rx in SLATE if re.search(rx, head)), cur); section[src] = cur
    for w in ws:
        words.append(dict(w, src=src))
print(json.dumps(section))

def find_takes(line, min_score=70):
    tgt = norm(line); n = len(tgt); out = []
    for i in range(len(words)):
        for L in (n-2, n-1, n, n+1, n+2, n+4):
            j = i + L
            if L < 1 or j > len(words) or words[j-1]['src'] != words[i]['src']: continue
            win = words[i:j]
            s = fuzz.ratio(" ".join(tgt), " ".join(norm(" ".join(x['w'] for x in win))))
            if s >= min_score:
                out.append(dict(src=win[0]['src'], i=i, j=j, start=win[0]['start'], end=win[-1]['end'], score=round(s, 1)))
    out.sort(key=lambda t: -t['score']); keep = []
    for t in out:
        if all(t['src'] != k['src'] or t['end'] <= k['start'] or t['start'] >= k['end'] for k in keep): keep.append(t)
    return [widen(t, tgt) for t in keep]

def widen(t, tgt):
    """The best-scoring window can start or end mid-sentence ("...it or email it" for "Now with Fo, you just
    text it or email it"). Grow it to the sentence edges while the score stays within 2 points, so a take
    never opens on half a sentence."""
    def sc(i, j): return fuzz.ratio(" ".join(tgt), " ".join(norm(" ".join(x['w'] for x in words[i:j]))))
    def starts(i):   # a sentence starts here: file start, a pause, or the previous word ended a sentence
        return i == 0 or words[i-1]['src'] != words[i]['src'] or words[i]['start'] - words[i-1]['end'] >= 0.35 \
            or words[i-1]['w'].rstrip().endswith(('.', '?', '!'))
    def ends(j):
        return j == len(words) or words[j]['src'] != words[j-1]['src'] or words[j]['start'] - words[j-1]['end'] >= 0.35 \
            or words[j-1]['w'].rstrip().endswith(('.', '?', '!', ','))
    head = tgt[:2]
    def opens_line(i): return norm(" ".join(x['w'] for x in words[i:i+2])) == head
    cand = []
    for i in range(t["i"], max(t["i"] - 15, -1), -1):   # founders pad lines ("text it or call it or email it")
        if words[i]['src'] != t['src']: break
        for j in range(t["j"], min(t["j"] + 5, len(words)) + 1):
            if words[j-1]['src'] != t['src']: break
            # the line's own opening words count as a sentence start even when Whisper ran them on
            # the matched edges stay allowed: only a moved edge has to land on a sentence boundary
            if (starts(i) or opens_line(i) or i == t["i"]) and (ends(j) or j == t["j"]): cand.append((sc(i, j), i, j))
    # a window that already sits on sentence edges only moves for a near-equal score; one that starts or
    # ends mid-sentence may lose up to 12 points to reach a full sentence (half a sentence is never usable)
    slack = 4 if starts(t["i"]) and ends(t["j"]) else 12
    good = [c for c in cand if c[0] >= t["score"] - slack]
    # the founder padding a line drops the fuzzy score a lot, so also accept a sentence that opens with the
    # script line's own first two words ("Now with ...") as long as it still reads as the line (>= 60)
    good += [c for c in cand if c[0] >= 60 and opens_line(c[1])]
    if not good: return t
    opens = [c for c in good if opens_line(c[1])]
    s, bi, bj = max(opens or good, key=lambda c: (c[0], -(c[2] - c[1])))   # script's opening words first, then score
    return dict(t, i=bi, j=bj, start=words[bi]['start'], end=words[bj-1]['end'], score=round(s, 1))

# every line's hits, then resolve overlaps across lines (higher score wins; a longer line that
# contains a shorter one wins when it scores >= 85)
hits = []
for ln in LINES:
    found = []
    for k, txt in enumerate([ln["text"]] + ln.get("variants", [])):   # variants = on-set rewrites, flagged yellow
        for t in find_takes(txt) or find_takes(txt, 55):              # 55 = paraphrase fallback, flagged yellow
            t["variant"] = k > 0; found.append(t)
    sec = ln["section"] if "section" in ln else SECTION_OF_BEAT.get(ln["beat"])
    short = len(norm(ln["text"])) <= 4
    for t in found:
        t.update(line=ln["line"], beat=ln["beat"], script=ln["text"], nwords=len(norm(ln["text"])), main=ln["main"])
        if section.get(t["src"]) is None: continue          # before the first slate: sound checks, crew chatter
        if sec and section.get(t["src"]) != sec: continue
        if t["score"] >= (80 if short else 60): hits.append(t)   # short lines match crew chatter too easily
def ov(a, b):
    if a['src'] != b['src']: return 0
    o = min(a['end'], b['end']) - max(a['start'], b['start'])
    return max(o, 0) / max(min(a['end']-a['start'], b['end']-b['start']), 0.01)
# main-path lines win ties against ALT lines with near-identical wording (Hook 1 vs Hook 2 "lifesaver")
hits.sort(key=lambda t: -(t['score'] + (5 if t['score'] >= 85 else 0) + t['nwords'] * 0.05 + (8 if t['main'] else 0)))
kept = []
for h in hits:
    if all(ov(h, k) <= 0.5 for k in kept): kept.append(h)

# measure: voiced RMS of the take on the source audio
rms_cache = {}
def env(src):
    if src not in rms_cache:
        p = next(x for x in SRC_PATHS if os.path.basename(x) == src)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                             capture_output=True, check=True).stdout
        x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
        n = len(x) // 80; rms_cache[src] = np.sqrt((x[:n*80].reshape(n, 80) ** 2).mean(1))
    return rms_cache[src]
SRC_PATHS = json.load(open(os.path.join(WDIR, "..", "sources.json")))

takes = []
for ln in LINES:
    ts = sorted([k for k in kept if k['line'] == ln['line']], key=lambda t: (t['src'], t['start']))
    for n, t in enumerate(ts, 1):
        e = env(t['src'])[int(t['start']*100):int(t['end']*100)+1]
        rms = float(np.mean(np.sort(e)[len(e)//2:])) if len(e) else 0.0
        wl = [dict(w=x['w'], start=x['start'], end=x['end'], p=x['p']) for x in words[t['i']:t['j']]]
        flag = "green" if t['score'] >= 85 and not t.get('variant') else "yellow"
        takes.append(dict(line=ln['line'], beat=ln['beat'], main=ln['main'], script=ln['text'], take=n,
                          src=t['src'], start=t['start'], end=t['end'], score=t['score'], partial=False,
                          flag=flag, words=wl, rms=round(rms, 5), text=" ".join(x['w'] for x in wl)))
json.dump(takes, open(OUT, "w"), indent=1)
found = {t['line'] for t in takes}
print(json.dumps(dict(takes=len(takes), lines_found=len(found), missing=[l['line'] for l in LINES if l['line'] not in found])))
