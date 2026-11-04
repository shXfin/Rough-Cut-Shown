# ppro_grid.py "Sequence name"   -> tiles the cameras of a scrub built with GRID=1 side by side, for a multicam
# review export (Premiere can't export the multicam monitor). Top track = A camera on the left, the track under it
# = B camera on the right, each scaled to fit half the frame. One sound track, so the review file never doubles up.
import json, subprocess, sys, os
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge"); name = sys.argv[1]
js = f"""(function(){{var q=null;for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name=={json.dumps(name)})q=app.project.sequences[i];
if(!q)return 'missing';var W=q.frameSizeHorizontal,n=0,T=q.videoTracks.numTracks;
for(var t=0;t<T;t++){{var tr=q.videoTracks[t],left=(t==T-1);
  for(var c=0;c<tr.clips.numItems;c++){{var cl=tr.clips[c],m=null;
    for(var k=0;k<cl.components.numItems;k++)if(cl.components[k].displayName=='Motion')m=cl.components[k];
    if(!m)continue;var w=cl.projectItem.getFootageInterpretation?0:0;
    var fw=parseInt((cl.projectItem.getProjectMetadata().match(/VideoInfo>(\\d+) x/)||[0,W/2])[1]);
    for(var p=0;p<m.properties.numItems;p++){{var pr=m.properties[p];
      if(pr.displayName=='Position')pr.setValue([left?0.25:0.75,0.5],true);
      if(pr.displayName=='Scale')pr.setValue((W/2)/fw*100,true);}}
    n++;}}}}
app.project.save();return 'tiled '+n+' clips';}})()"""
print(subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=900).stdout.strip())
