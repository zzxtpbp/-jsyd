import {scenarios,makeScenario,time} from '../examples/commuteScenarios.js';
import {calculateCommuteWorkflow} from '../src/commuteWorkflow.js';
const $=id=>document.getElementById(id);
const flags=['fixedEnabled','smartEnabled','ambientEnabled'];
const minutes=['fixedMinutes','maxAdvance','preparation','buffer','extra','ambientOffset'];
const fmt=t=>!Number.isFinite(t)?'—':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(t);
let input;
for(const s of scenarios){const option=document.createElement('option');option.value=s.id;option.textContent=s.name;$('scenario').append(option);}
function reset(){input=makeScenario($('scenario').value);for(const f of flags)$(f).checked=input[f];for(const f of minutes)$(f).value=input[f];$('recheck').value=fmt(input.recheckAt);render();}
function render(){
 for(const f of flags)input[f]=$(f).checked;
 for(const f of minutes)input[f]=$(f).value===''?null:Number($(f).value);
 input.recheckAt=time($('recheck').value);
 const r=calculateCommuteWorkflow(input),s=r.summary;
 $('wake').textContent=fmt(s.wakeAt);$('mode').textContent=({fixed:'固定',smart:'智能'})[s.selectedMode]??'未选择';
 $('gap').textContent=s.gapMinutes==null?'未确认':`${s.gapMinutes} 分钟`;
 $('message').textContent=s.message;
 $('operation').textContent=`保存建议：${r.write.action} · 未执行保存。${r.write.reason}`;
 $('issues').replaceChildren();for(const issue of [...r.timing.issues,...r.timing.warnings]){const li=document.createElement('li');li.textContent=issue.message;$('issues').append(li);}
 $('timeline').replaceChildren();
 const events=[['复查',input.recheckAt],['基础闹钟（保留）',input.baseAlarmAt],['到达目标',input.arrivalAt]];
 if(s.wakeAt!=null){events.push(['建议提前唤醒',s.wakeAt]);if(input.ambientEnabled)events.push(['建议铃前环境音',s.wakeAt-input.ambientOffset*60000]);}
 for(const [label,at] of events.sort((a,b)=>a[1]-b[1])){const li=document.createElement('li');li.textContent=`${fmt(at)} · ${label}`;$('timeline').append(li);}
 $('json').textContent=JSON.stringify(r,null,2);
}
$('scenario').addEventListener('change',reset);$('controls').addEventListener('input',render);
$('controls').addEventListener('submit',e=>e.preventDefault());$('controls').addEventListener('reset',e=>{e.preventDefault();reset();});reset();
