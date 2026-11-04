# learn_swaps.py work_dir "Rough cut sequence name"   -> overrides.json learns the takes you swapped in by hand
# If you drag a take from the scrub into the rough cut yourself, its audio piece is a scrub file (take_*.wav).
# Every piece file is named in ~/.shown/takefinder.json, so this reads the rough cut in Premiere, finds scrub pieces
# in it and records "Line 7: take 4" in overrides.json. pick.py then keeps your choice on every rebuild.
import json, os, subprocess, sys
W, SEQ = os.path.abspath(sys.argv[1]), sys.argv[2]
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
FILES = json.load(open(os.path.expanduser("~/.shown/takefinder.json"))).get("files", {})
js = f"""(function(){{var q=null;for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name=={json.dumps(SEQ)})q=app.project.sequences[i];
if(!q)return 'NOSEQ';var o=[];for(var t=0;t<q.audioTracks.numTracks;t++){{var c=q.audioTracks[t].clips;for(var k=0;k<c.numItems;k++)if(c[k].projectItem)o.push(c[k].projectItem.name);}}
return o.join('|');}})()"""
out = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=300).stdout.strip().splitlines()
names = out[-1].split("|") if out else []
if names == ["NOSEQ"]: sys.exit(f"Rough cut sequence not found: {SEQ}")
takes = json.load(open(os.path.join(W, "takes.json")))
P = os.path.join(W, "overrides.json"); ov = json.load(open(P)) if os.path.exists(P) else {}
learned = 0
for n in names:
    if not n.startswith("take_") or n not in FILES: continue   # rough cut pieces (rc_*) are the picks themselves
    L, k = FILES[n]
    t = next((x for x in takes if x["line"] == L and x["take"] == k), None)
    if t and ov.get(L, {}).get("take") != k:
        ov[L] = dict(take=k, src=t["src"], how="dragged in by hand"); learned += 1
        print(f"  Line {int(L[1:])}: you put take {k} in by hand, keeping it")
json.dump(ov, open(P, "w"), indent=1)
print(f"{learned} hand swaps learned, {len(ov)} of your choices in total")
