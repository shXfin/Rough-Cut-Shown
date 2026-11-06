# ppro_grade_copy.py "From sequence" "To sequence" [name regex]  -> copies the Lumetri grade of the first graded A cam clip
# in one sequence onto every matching clip of another (adds Lumetri via QE where missing). Opens the target sequence
# (QE only works on the active one). Values copied by index, skipping HSL Secondary 101-105 (duplicate names) only if 0.
import json, subprocess, sys, os
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
src, dst = sys.argv[1], sys.argv[2]; rx = sys.argv[3] if len(sys.argv) > 3 else "^7T0A"
js = f"""(function(){{function S(n){{for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name==n)return app.project.sequences[i];}}
function L(x){{for(var j=0;j<x.components.numItems;j++)if(x.components[j].displayName=="Lumetri Color")return x.components[j];return null;}}
var a=S({json.dumps(src)}),b=S({json.dumps(dst)}),R=new RegExp({json.dumps(rx)}),RS=new RegExp({json.dumps(os.environ.get("SRC_RX", rx))});if(!a||!b)return "missing sequence";
var vals=null;for(var t=0;t<a.videoTracks.numTracks&&!vals;t++){{var cl=a.videoTracks[t].clips;for(var k=0;k<cl.numItems;k++){{var x=cl[k];if(!x.projectItem||!RS.test(x.projectItem.name))continue;var m=L(x);if(!m)continue;
 vals=[];for(var p=0;p<m.properties.numItems;p++){{var v=null;try{{v=m.properties[p].getValue();}}catch(e){{}}vals.push((typeof v=="number"||typeof v=="boolean")?v:null);}}break;}}}}
if(!vals)return "no graded clip in source";
app.project.openSequence(b.sequenceID);app.enableQE();var qs=qe.project.getActiveSequence(),fx=qe.project.getVideoEffectByName("Lumetri Color"),added=0,set=0;
for(var t=0;t<b.videoTracks.numTracks;t++){{var cl=b.videoTracks[t].clips,qt=qs.getVideoTrackAt(t);
 for(var k=0;k<cl.numItems;k++){{var x=cl[k];if(!x.projectItem||!R.test(x.projectItem.name))continue;
  if(!L(x)){{for(var q=0;q<qt.numItems;q++){{var qi=qt.getItemAt(q);if(qi&&qi.name==x.name&&Math.abs(qi.start.secs-x.start.seconds)<0.02){{qi.addVideoEffect(fx);added++;break;}}}}}}
  var m=L(x);if(!m)continue;for(var p=0;p<vals.length&&p<m.properties.numItems;p++)if(vals[p]!==null){{try{{m.properties[p].setValue(vals[p],true);}}catch(e){{}}}}set++;}}}}
app.project.save();return "Lumetri added "+added+", grade set on "+set+" clips";}})()"""
r = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=900)
print(r.stdout.strip() or "FAILED: " + r.stderr.strip())
