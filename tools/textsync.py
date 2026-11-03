# textsync.py out.jsonl ref_words_dir other_words_dir [--paths sources.json]
# Sync by transcript instead of waveform: the same 4 words spoken on two devices give the offset.
# Writes the sync.py format: ref_time = other_time + offset_s. Used when waveform sync is weak
# (Wajo: proxies carry no timecode and the camera scratch audio correlates poorly with the recorder).
import json, os, re, sys, glob, statistics as st
OUT, RDIR, ODIR, PATHS = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
MIN_EXTRA = 6   # 4-word matches needed to keep a second (third...) camera clip for the same recorder file
SRC = {os.path.basename(p): p for p in json.load(open(PATHS))}
def load(d):
    out = {}
    for f in glob.glob(os.path.join(d, "*.words.json")):
        ws = json.load(open(f)); toks = [re.sub(r"[^a-z0-9]", "", w["w"].lower()) for w in ws]
        grams = {}
        for i in range(len(ws) - 3):
            g = " ".join(toks[i:i+4])
            if all(toks[i:i+4]): grams.setdefault(g, []).append(ws[i]["start"])
        out[os.path.basename(f)[:-len(".words.json")]] = grams
    return out
RF = re.compile(sys.argv[5]) if len(sys.argv) > 5 else re.compile(".")   # ref name filter, e.g. "^B029" (A cam)
OF = re.compile(sys.argv[6]) if len(sys.argv) > 6 else re.compile(".")   # other name filter
R = {k: v for k, v in load(RDIR).items() if RF.search(k)}
O = {k: v for k, v in load(ODIR).items() if OF.search(k)}
with open(OUT, "w") as fh:
    for o, og in O.items():
        if o in R: continue
        found = []   # EVERY camera clip that matches this recorder file: a camera that stopped and restarted
        # during one recorder take has two clips for it (Notch: A cam 9126/9129/9132/9135 and lines 13-15 lost A cam
        # when only the single best clip was kept)
        for r, rg in R.items():
            if r == o: continue
            offs = [rt - ot for g in og.keys() & rg.keys() for ot in og[g] for rt in rg[g]]
            if not offs: continue
            offs.sort(); top = []   # densest 0.15 s cluster of offsets
            j = 0
            for i in range(len(offs)):
                while offs[i] - offs[j] > 0.15: j += 1
                if i - j + 1 > len(top): top = offs[j:i+1]
            found.append((r, len(top), st.median(top)))
        found.sort(key=lambda x: -x[1])
        for k, (r, n, off) in enumerate(found):
            if k == 0 or n >= MIN_EXTRA:   # verify_sync.py confirms each one against the words
                fh.write(json.dumps(dict(ref=SRC[r], other=SRC[o], offset_s=round(off, 3),
                                         confidence=round(min(1.0, n / 20), 3), matches=n)) + "\n")
print(open(OUT).read())
