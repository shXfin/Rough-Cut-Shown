# ppro_swap.py "Bin/Path" "Sequence name" file.xml [more "Bin/Path" "name" file.xml ...]
# The ONE way sequences go into Premiere. For each: import the XML, find the sequence it created (by comparing
# sequence ids before/after, never by name), check it has clips, and only then delete the old sequence of that
# name in THAT bin path, rename the new one and move it there. If the import fails, the old one is kept.
# Bins are found by full path from the project root ("Notch/Sequences/Takes by line"), never by name alone.
# Also: loose footage from the import goes to <project>/Footage, A cam proxies get square pixels.
import json, subprocess, sys, os
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
def js(code):
    o = subprocess.run([BR, "eval", "ppro", code], capture_output=True, text=True, timeout=900)
    if o.returncode: raise SystemExit(o.stderr.strip() or o.stdout.strip())
    return o.stdout.strip().splitlines()[-1] if o.stdout.strip() else ""
HELP = r"""
function binAt(path){var b=app.project.rootItem, p=path.split('/'); for(var i=0;i<p.length;i++){var f=null; for(var j=0;j<b.children.numItems;j++){var c=b.children[j]; if(c.type==2&&c.name==p[i]) f=c;} if(!f) f=b.createBin(p[i]); b=f;} return b;}
function ids(){var o={}; for(var i=0;i<app.project.sequences.numSequences;i++) o[app.project.sequences[i].sequenceID]=1; return o;}
"""
args = sys.argv[1:]
for k in range(0, len(args), 3):
    bin_, name, xml = args[k], args[k+1], os.path.abspath(args[k+2])
    top = bin_.split("/")[0]
    r = js(HELP + f"""
var before=ids(); app.project.importFiles([{json.dumps(xml)}],true,app.project.rootItem,false);
var nw=null; for(var i=0;i<app.project.sequences.numSequences;i++){{var q=app.project.sequences[i]; if(!before[q.sequenceID]) nw=q;}}
if(!nw) 'FAILED: import made no sequence, old one kept';
else {{ var clips=0; for(var t=0;t<nw.videoTracks.numTracks;t++) clips+=nw.videoTracks[t].clips.numItems;
  if(!clips) 'FAILED: new sequence is empty, old one kept';
  else {{ var dest=binAt({json.dumps(bin_)}); var gone=0;
    for(var i=app.project.sequences.numSequences-1;i>=0;i--){{var q=app.project.sequences[i]; if(q.sequenceID!=nw.sequenceID&&q.name=={json.dumps(name)}&&q.projectItem.treePath.indexOf(dest.treePath+'\\\\')==0){{app.project.deleteSequence(q); gone++;}}}}
    nw.name={json.dumps(name)}; nw.projectItem.moveBin(dest);
    var fb=binAt({json.dumps(top + '/Footage')}), r=app.project.rootItem, m=[];
    for(var i=0;i<r.children.numItems;i++){{var c=r.children[i]; if(c.type!=2&&!c.isSequence()) m.push(c);}}
    for(var j=0;j<m.length;j++){{var c=m[j]; if(c.name.match(/^7T0A.*_proxy/)){{var x=c.getFootageInterpretation(); if(x&&x.pixelAspectRatio!=1){{x.pixelAspectRatio=1; c.setFootageInterpretation(x);}}}} c.moveBin(fb);}}
    app.project.save(); 'ok: '+nw.projectItem.treePath+' ('+clips+' video clips, replaced '+gone+')'; }} }}""")
    print(r)
    if r.startswith("FAILED"): sys.exit(1)
