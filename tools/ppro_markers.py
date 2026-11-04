# ppro_markers.py work_dir "Scrub sequence name"   -> editor-friendly markers on the scrub, inside Premiere
# 1. One RANGE marker per script line spanning all its takes, alternating green / blue, named
#    "Line 1: We raised $8M to build Notch (19 takes)": where one line's takes end and the next begins is obvious.
# 2. A CLIP marker on every take's own audio piece: "PICKED, take 6 of 19" or "ALT, take 3 of 19" (red if it's the
#    cameraman reading the line). The pieces are scrub-only files, so these never show up in the rough cut.
# Premiere doesn't import marker colours or clip markers from XML, so this runs after ppro_swap.py.
import json, os, subprocess, sys
W, SEQ = os.path.abspath(sys.argv[1]), sys.argv[2]
PJ = (os.environ.get("PROJECT") or os.path.basename(os.path.dirname(os.path.abspath(W)))).lower()   # project name = the folder above work/ (Notch/work -> notch_*.xml); PROJECT= overrides
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
LINES = {l["line"]: l for l in json.load(open(os.path.join(W, "lines.json")))}
SC = json.load(open(os.path.join(W, os.environ.get("SCRUB_REPORT", f"{PJ}_SCRUB_grid.takes.json"))))
RC = {r["line"]: r for r in json.load(open(os.path.join(W, os.environ.get("RC_REPORT", f"{PJ}_RC_clean.takes.json"))))}
groups, order = {}, []
for r in SC:
    if r["line"] not in groups: groups[r["line"]] = []; order.append(r["line"])
    groups[r["line"]].append(r)
ranges = []
for i, L in enumerate(order):
    g = groups[L]; a = g[0]["at"]; b = g[-1]["at"] + g[-1]["dur"]
    txt = LINES[L]["text"]; txt = txt if len(txt) <= 60 else txt[:57] + "..."
    ranges.append(dict(a=a, b=b, name=f"Line {int(L[1:])}: {txt} ({len(g)} takes)", color=0 if i % 2 == 0 else 6,
                       comment=LINES[L]["text"]))
takes = []
for r in SC:
    p = RC.get(r["line"]); picked = bool(p and p["take"] == r["take"] and p["src"] == r["src"])
    tag = "PICKED" if picked else "CAMERAMAN READING, skip" if r.get("feed") else "ALT"
    takes.append(dict(at=r["at"], name=f"{tag}, take {r['take']} of {r['of']}", color=0 if picked else 1 if r.get("feed") else 5))
data = json.dumps(dict(ranges=ranges, takes=takes))
js = f"""(function(){{var D={data};var q=null;for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name=={json.dumps(SEQ)})q=app.project.sequences[i];
if(!q)return 'scrub not found';
var M=q.markers,old=[],m=M.getFirstMarker();while(m){{old.push(m);m=M.getNextMarker(m);}}for(var k=0;k<old.length;k++)M.deleteMarker(old[k]);
for(var k=0;k<D.ranges.length;k++){{var r=D.ranges[k],x=M.createMarker(r.a);x.name=r.name;x.comments=r.comment;x.end=r.b;x.setColorByIndex(r.color);}}
var tr=q.audioTracks[0],n=0;
for(var c=0;c<tr.clips.numItems;c++){{var cl=tr.clips[c],t=cl.start.seconds,hit=null;
  for(var k=0;k<D.takes.length;k++)if(Math.abs(D.takes[k].at-t)<0.06){{hit=D.takes[k];break;}}
  if(!hit||!cl.projectItem)continue;
  var cm=cl.projectItem.getMarkers(),o2=[],y=cm.getFirstMarker();while(y){{o2.push(y);y=cm.getNextMarker(y);}}for(var j=0;j<o2.length;j++)cm.deleteMarker(o2[j]);
  var z=cm.createMarker(cl.inPoint.seconds);z.name=hit.name;z.end=cl.outPoint.seconds;z.setColorByIndex(hit.color);n++;}}
app.project.save();return D.ranges.length+' line markers, '+n+' take tags';}})()"""
print(subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=900).stdout.strip().splitlines()[-1])
