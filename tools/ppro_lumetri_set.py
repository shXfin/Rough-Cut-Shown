# ppro_lumetri_set.py "Sequence" "name regex" '{"20":60,"16":140}'  -> sets Lumetri properties by index on matching clips
import json, subprocess, sys, os
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
js = f"""(function(){{var q=null;for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name=={json.dumps(sys.argv[1])})q=app.project.sequences[i];
var R=new RegExp({json.dumps(sys.argv[2])}),V={sys.argv[3]},n=0;for(var t=0;t<q.videoTracks.numTracks;t++){{var cl=q.videoTracks[t].clips;for(var k=0;k<cl.numItems;k++){{var x=cl[k];if(!x.projectItem||!R.test(x.projectItem.name))continue;
for(var j=0;j<x.components.numItems;j++)if(x.components[j].displayName=="Lumetri Color"){{var m=x.components[j];for(var p in V)m.properties[parseInt(p)].setValue(V[p],true);n++;}}}}}}app.project.save();return n+" clips set";}})()"""
print(subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True).stdout.strip())
