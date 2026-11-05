# ppro_twins_relink.py twins_dir proxies_dir   -> camera originals in the project point at their local ProRes twins
# Same length + timecode, so changeMediaPath keeps every clip's in/out, position, motion and grade. Proxies re-attached.
# A twin of a file the project only has as a proxy (an editor's swap) is imported to <Notch>/Footage/4K twins instead.
import glob, json, os, subprocess, sys
TW, PX = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
twins = {os.path.basename(p)[:-len("_4K.mov")]: p for p in glob.glob(os.path.join(TW, "*_4K.mov")) if not os.path.exists(p + ".lock")}   # finished only
prox = {os.path.basename(p)[:-len("_proxy.mp4")]: p for p in glob.glob(os.path.join(PX, "*", "*_proxy.mp4"))}
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
js = "(function(){var TW=" + json.dumps(twins) + ",PX=" + json.dumps(prox) + r""",n=0,p=0,bad=[],seen={};
var have={};
function walk(b){for(var i=0;i<b.children.numItems;i++){var c=b.children[i];if(c.type==2){walk(c);continue;}if(c.isSequence())continue;have[c.name]=1;
 var m=c.name.match(/^(.*)\.(MOV|MP4)$/i);if(!m||!TW[m[1]])continue;if(c.getMediaPath().indexOf("/Volumes/Home Project/")!=0)continue;
 if(c.changeMediaPath(TW[m[1]],true)){n++;seen[m[1]]=1;if(PX[m[1]]&&!c.hasProxy()){c.attachProxy(PX[m[1]],0);}if(c.hasProxy())p++;}else bad.push(c.name);}}
walk(app.project.rootItem);var extra=[];for(var k in TW)if(!seen[k]&&!have[k+"_4K.mov"]&&!/^A_0001C/.test(k)){var isOrig=false;for(var h in have)if(h.indexOf(k+".")==0&&!/_4K\.mov$/.test(h)&&!/_proxy/.test(h))isOrig=true;if(!isOrig)extra.push(TW[k]);}
if(extra.length){var b=app.project.rootItem,path=["Notch","Footage","4K twins"];for(var i=0;i<path.length;i++){var f=null;for(var j=0;j<b.children.numItems;j++)if(b.children[j].type==2&&b.children[j].name==path[i])f=b.children[j];if(!f)f=b.createBin(path[i]);b=f;}
 app.project.importFiles(extra,true,b,false);}
app.project.save();return n+" files now on local 4K twins, "+p+" with proxies"+(extra.length?" | imported to Notch/Footage/4K twins: "+extra.length:"")+(bad.length?" | FAILED: "+bad.join(", "):"");})()"""
r = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=900)
print(r.stdout.strip() or "FAILED: " + r.stderr.strip())
