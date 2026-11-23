# link_takes.py in.xml [out.xml]   -> links each take's clips (A cam, B cam, recorder sound) in a build_scrub.py XML
# Editors need every piece of a take to lead back to its full source: select one and the others come with it, Match
# Frame on the sound opens the whole recorder file, and dragging an edge reveals the real footage around the take.
# build_scrub.py names a take's clips vA<n>, vB<n> and a<n> (n or n_j for a tightened piece); labels (lbl..), the FO
# voice and room tone are left unlinked. Works on any project: nothing project-specific in here.
import re, sys
from xml.etree import ElementTree as ET

IN = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else IN
raw = open(IN).read()
head = raw[:raw.index("<xmeml")]   # keep the <?xml?> and <!DOCTYPE> lines ElementTree would drop
root = ET.fromstring(raw[len(head):])
seq = root.find("sequence")
pos = {}   # clip id -> (mediatype, trackindex, clipindex), all 1-based like Premiere's own XML export
for kind in ("video", "audio"):
    for ti, tr in enumerate(seq.find("media").find(kind).findall("track"), 1):
        for ci, c in enumerate(tr.findall("clipitem"), 1):
            pos[c.get("id")] = (kind, ti, ci, c)
groups = {}
for cid, (kind, ti, ci, c) in pos.items():
    m = re.fullmatch(r"(?:v[A-Z]|a)(\d+(?:_\d+)?)", cid)
    if m: groups.setdefault(m.group(1), []).append(cid)
linked = 0
for key, ids in groups.items():
    if len(ids) < 2: continue
    for cid in ids:
        c = pos[cid][3]
        for old in c.findall("link"): c.remove(old)
        for other in ids:
            kind, ti, ci, _ = pos[other]
            ln = ET.SubElement(c, "link")
            ET.SubElement(ln, "linkclipref").text = other
            ET.SubElement(ln, "mediatype").text = kind
            ET.SubElement(ln, "trackindex").text = str(ti)
            ET.SubElement(ln, "clipindex").text = str(ci)
            if kind == "audio": ET.SubElement(ln, "groupindex").text = "1"
    linked += 1
open(OUT, "w").write(head + ET.tostring(root, encoding="unicode") + "\n")
print(f"linked {linked} takes ({sum(len(v) for v in groups.values() if len(v) > 1)} clips) -> {OUT}")
