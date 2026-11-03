# pick.py takes.json picks.json   -> best take per line, with runner-up and close calls
# Socrates phase 4 scoring, unchanged. Angle choice happens in build_xml.py (it knows which angles exist).
import json, sys, re, statistics as st
T = json.load(open(sys.argv[1])); FILL = {"um","uh","erm","ah","hmm","like","basically","literally"}
def rate(t, line_rms):
    w = t["words"]; dur = max(w[-1]["end"]-w[0]["start"], 0.1); n = len(w)
    s = 0.45*t["score"]
    s += 20*st.mean(x["p"] for x in w)
    toks = [re.sub(r"[^a-z']", "", x["w"].lower()) for x in w]
    scr = set(re.sub(r"[^a-z' ]", "", t.get("script","").lower()).split())
    s -= 6*sum(x in FILL and x not in scr for x in toks)
    s -= 6*sum(toks[i] == toks[i+1] for i in range(n-1))
    s -= 4*sum(w[i+1]["start"]-w[i]["end"] > 0.6 for i in range(n-1))
    # halting delivery: pause time mid-sentence (not after a comma or full stop) reads as a stumble on screen
    s -= 10*sum(max(0, w[i+1]["start"]-w[i]["end"]-0.3) for i in range(n-1) if not w[i]["w"].rstrip().endswith((",", ".", "?", "!", ":")))
    s -= 8*t.get("unworded", 0)   # stumble.py: talking that no word covers (false start, "uh", repeated half-word)
    # a dragged word ("brand'sss... Shopify") is voiced hesitation: silence checks miss it (Notch L08 T3, 0.74 s)
    s -= min(5, 30*max(0, max(x["end"]-x["start"] for x in w if len(x["w"]) < 12) - 0.65)) if any(len(x["w"]) < 12 for x in w) else 0
    # capped at 5: exact wording outweighs a dragged word (a reworded take that drops "Notch got" is worse)
    wps = n/dur; s += 15-min(15, 10*max(0, 2.4-wps, wps-3.4))
    s += min(5, max(-5, 8*(t["rms"]/line_rms-1))) if line_rms else 0
    s += min(3, t["take"]-1)
    if t.get("partial"): s -= 30
    if t["flag"] == "red": s -= 100
    return round(s, 1)
lines = {}
for t in T: lines.setdefault(t["line"], []).append(t)
for L, ts in lines.items():
    m = st.median(t["rms"] for t in ts)
    for t in ts: t["rank"] = rate(t, m)
    # no voice: Whisper, prompted with the script, "hears" the line in near-silence (Notch L15 take 2, 22 dB
    # under the others). A take over 12 dB quieter than the line's median is never picked.
    for t in ts:
        if m and t["rms"] < 0.25 * m: t["rank"] -= 1000; t["no_voice"] = True
        if t.get("off_mic"): t["rank"] -= 1000   # stumble.py: someone off-mic (cameraman feeding the line) is never a pick
    ts.sort(key=lambda t: -t["rank"])

# Keep a running moment in one take. Picking each line's best take on its own stitched Wajo's hook from
# take 3 ("...excited to introduce") into take 1 ("oh shoot"), cutting her off mid-phrase. Lines the
# founder performed back to back in one take get a bonus for staying together, chosen over the whole
# script at once (Viterbi), so a slightly weaker take wins when it keeps a moment unbroken.
CONTINUITY = 25
# same take, next line starts within 5 s (a reaction beat like "you to, hang on" before "oh shoot") or
# overlaps by up to a second (neighbouring matches sharing a word)
def flows(a, b): return a["src"] == b["src"] and -1.0 <= b["start"] - a["end"] < 5.0
def good(t, L):   # close to the line's best on delivery and on wording
    return t["rank"] >= lines[L][0]["rank"] - 10 and t["score"] >= max(x["score"] for x in lines[L]) - 6
main = sorted(L for L, ts in lines.items() if ts[0]["main"])
best = {}   # line -> {take index: (score, back pointer)}
for k, L in enumerate(main):
    best[L] = {}
    for i, t in enumerate(lines[L]):
        if k == 0: best[L][i] = (t["rank"], None); continue
        P = main[k-1]
        # continuity never rescues a clearly worse take on either side of the join
        # (Wajo: it picked a flubbed "...the last week" read because the next line followed it)
        cands = [(s + t["rank"] + (CONTINUITY if good(t, L) and good(lines[P][j], P) and flows(lines[P][j], t) else 0), j)
                 for j, (s, _) in best[P].items()]
        best[L][i] = max(cands)
chosen = {}
if main:
    i = max(best[main[-1]], key=lambda i: best[main[-1]][i][0])
    for L in reversed(main):
        chosen[L] = i; i = best[L][i][1]
picks = []
for L in sorted(lines):
    ts = lines[L]; b = ts[chosen.get(L, 0)]
    picks.append(dict(line=L, beat=b["beat"], main=b["main"], take=b["take"], of=len(ts), src=b["src"],
                      start=b["start"], end=b["end"], rank=b["rank"], flag=b["flag"], text=b["text"],
                      runner_up=(f"T{ts[1]['take']} ({ts[1]['rank']})" if len(ts) > 1 else "-"),
                      close_call=len(ts) > 1 and ts[0]["rank"]-ts[1]["rank"] < 3,
                      for_continuity=b is not ts[0]))   # not the best take on its own, chosen to keep the moment whole
json.dump(picks, open(sys.argv[2], "w"), indent=1)
json.dump(T, open(sys.argv[1], "w"), indent=1)   # takes now carry their rank
for p in picks: print(f'{p["line"]} {p["beat"]:6} T{p["take"]}/{p["of"]} {p["rank"]:6} ru={p["runner_up"]:12} {"CLOSE" if p["close_call"] else ""} {p["src"]} {p["text"][:60]}')
