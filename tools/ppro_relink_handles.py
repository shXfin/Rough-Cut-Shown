# ppro_relink_handles.py work_dir   -> swaps in pieces that now carry handles, keeping every edit exactly where it was
# rebake_map.json: old piece -> [new file, offset]. The new file starts `offset` seconds EARLIER in the recording
# than the old one, so after changeMediaPath every clip using it (in EVERY sequence) slides its source in/out and its
# volume/pan keyframes by +offset: same position, same length, same sound, and now draggable past the old edges.
# TEST=<sequence name>: no swap, only slide that one sequence's clips (to check on a copy first)
import json, os, subprocess, sys
W = os.path.abspath(sys.argv[1]); M = json.load(open(os.path.join(W, "rebake_map.json")))
M = {k: v for k, v in M.items() if isinstance(v, list)}
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
TEST = os.environ.get("TEST", "")
js = "(function(){var TEST=" + json.dumps(TEST) + ",M=" + json.dumps(M) + r""",ids={},n=0,s=0,k=0,bad=[];
function walk(b){for(var i=0;i<b.children.numItems;i++){var c=b.children[i];if(c.type==2)walk(c);else if(M[c.name]){var off=M[c.name][1];
  if(TEST){ids[c.nodeId]=off;}else if(c.changeMediaPath(M[c.name][0],true)){ids[c.nodeId]=off;n++;}else bad.push(c.name);}}}
walk(app.project.rootItem);
function T(x){var t=new Time();t.seconds=x;return t;}
for(var q=0;q<app.project.sequences.numSequences;q++){var sq=app.project.sequences[q];if(TEST&&sq.name!=TEST)continue;
 for(var t=0;t<sq.audioTracks.numTracks;t++){var cl=sq.audioTracks[t].clips;
  for(var i=0;i<cl.numItems;i++){var x=cl[i];if(!x.projectItem)continue;var off=ids[x.projectItem.nodeId];if(off===undefined)continue;
   var a=x.inPoint.seconds+off,b=x.outPoint.seconds+off;x.inPoint=T(a);x.outPoint=T(b);
   if(Math.abs(x.inPoint.seconds-a)>0.01)bad.push(sq.name+' '+x.projectItem.name);else s++;
   for(var c=0;c<x.components.numItems;c++){var m=x.components[c];for(var p=0;p<m.properties.numItems;p++){var pr=m.properties[p];
     try{if(!pr.isTimeVarying())continue;var ks=pr.getKeys();if(!ks||!ks.length)continue;var kv=[];
       for(var j=0;j<ks.length;j++)kv.push([ks[j].seconds,pr.getValueAtKey(ks[j])]);
       var keep={};for(var j=0;j<kv.length;j++){var nt=kv[j][0]+off;pr.addKey(T(nt));pr.setValueAtKey(T(nt),kv[j][1],true);keep[nt.toFixed(3)]=1;k++;}
       for(var j=0;j<kv.length;j++)if(!keep[kv[j][0].toFixed(3)])pr.removeKey(T(kv[j][0]));
     }catch(e){bad.push('keys '+x.projectItem.name+': '+e);}}}}}}
if(!TEST)app.project.save();return n+' pieces swapped, '+s+' clips slid, '+k+' keyframes moved'+(bad.length?' | PROBLEMS: '+bad.join('; '):'');})()"""
r = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=900)
print(r.stdout.strip() or "FAILED: " + r.stderr.strip())
