import {createImportantAlarm,transitionImportantAlarm} from '../src/importantAlarm.js';
const $=id=>document.getElementById(id);
let state=null,sequence=0,context=null,timer=null,holdTimer=null,held=false,starting=false;
const busy=()=>state?.status==='ringing';
function stopSound(){if(timer!=null)clearInterval(timer);timer=null;if(context){context.close().catch(()=>{});context=null;}}
async function startSound(){
 stopSound();const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('浏览器不支持音频播放。');
 context=new Audio();await context.resume();if(context.state!=='running'){stopSound();throw new Error('声音尚未获准播放，请重试。');}
 context.onstatechange=()=>{if(busy())render('音频状态已更新；如中断请恢复声音。');};
 const pulse=()=>{if(!context)return;const start=context.currentTime;for(let i=0;i<2;i++){
  const o=context.createOscillator(),g=context.createGain();o.type='square';o.frequency.value=i?880:660;
  g.gain.setValueAtTime(0,start+i*.18);g.gain.linearRampToValueAtTime(.07,start+i*.18+.01);g.gain.setValueAtTime(.07,start+i*.18+.12);g.gain.linearRampToValueAtTime(0,start+i*.18+.15);
  o.connect(g);g.connect(context.destination);o.start(start+i*.18);o.stop(start+i*.18+.16);o.onended=()=>{o.disconnect();g.disconnect();};
 }};pulse();timer=setInterval(pulse,650);
}
function render(message){
 const running=busy(),done=state?.status==='completed';
 $('phase').textContent=({armed:'已准备',ringing:'正常响铃 · 步数任务中',completed:'步数达标',manual_exit:'手动退出 · 未达标'})[state?.status]||'尚未开始';
 $('steps').textContent=state?.steps??0;$('goal').textContent=state?.targetSteps??$('target').value;
 $('progress').max=state?.targetSteps||20;$('progress').value=state?.steps||0;
 $('status').textContent=message;
 $('audio').textContent=running?`声音：${context?.state==='running'?'正常播放':'播放不可用，请检查浏览器'}，未达到步数不会主动降音量`:`声音：${done?'达标后已停止':'未播放或已停止'}`;
 for(const id of ['step','duplicate','dismiss','snooze','hold'])$(id).disabled=!running;
 for(const id of ['target','permission','sensor','label','start'])$(id).disabled=running;
 $('resume').hidden=!running||context?.state==='running';
 $('new').disabled=running||!state;$('confirm').hidden=!state?.exitConfirmation;
 $('json').textContent=JSON.stringify(state,null,2);
 if(!running){held=false;clearTimeout(holdTimer);stopSound();}
}
function dispatch(type,extra={}){const now=Date.now();const r=transitionImportantAlarm(state,{type,at:now,...extra},now);state=r.state;render(r.message);return r;}
$('settings').addEventListener('submit',async e=>{
 e.preventDefault();if(busy()||starting)return;
 const ready=createImportantAlarm({alarmId:'demo-important',targetSteps:$('target').value===''?null:Number($('target').value),permissionGranted:$('permission').checked,sensorAvailable:$('sensor').checked});
 if(!ready.ok){render(ready.message);return;}
 starting=true;$('start').disabled=true;
 try{await startSound();state=ready.state;sequence=0;$('taskName').textContent=$('label').value.trim()||'重要事项';dispatch('ring',{sessionId:crypto.randomUUID()});}
 catch(error){stopSound();state=null;render(`未开始保障任务：${error.message}`);}
 finally{starting=false;if(!busy())$('start').disabled=false;}
});
$('step').addEventListener('click',()=>dispatch('step',{sessionId:state.sessionId,sequence:++sequence}));
$('duplicate').addEventListener('click',()=>dispatch('step',{sessionId:state.sessionId,sequence}));
$('dismiss').addEventListener('click',()=>dispatch('dismiss'));$('snooze').addEventListener('click',()=>dispatch('snooze'));
function beginHold(){if(!busy()||held)return;held=true;dispatch('exit_hold_start');holdTimer=setTimeout(()=>{if(held)$('status').textContent='已按满8秒，请松开并确认；当前继续正常响铃。';},8000);}
function releaseHold(){if(!held)return;held=false;clearTimeout(holdTimer);dispatch('exit_hold_release');}
function cancelHold(){held=false;clearTimeout(holdTimer);if(busy())dispatch('exit_cancel');}
$('hold').addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();$('hold').setPointerCapture(e.pointerId);beginHold();});
$('hold').addEventListener('pointerup',releaseHold);$('hold').addEventListener('pointercancel',cancelHold);
$('hold').addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)beginHold();}});
$('hold').addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();releaseHold();}});
$('hold').addEventListener('blur',()=>{if(held)cancelHold();});
$('hold').addEventListener('lostpointercapture',()=>{if(held)cancelHold();});
window.addEventListener('blur',()=>{if(held)cancelHold();});
$('confirmExit').addEventListener('click',()=>dispatch('exit_confirm'));$('cancelExit').addEventListener('click',cancelHold);
$('new').addEventListener('click',()=>{stopSound();state=null;sequence=0;render('请设置目标，重新开始一场模拟。');});
$('resume').addEventListener('click',async()=>{if(!busy()||starting)return;starting=true;$('resume').disabled=true;
 try{await startSound();render('已恢复正常响铃。');}catch(error){stopSound();render(`恢复声音失败：${error.message}`);}finally{starting=false;$('resume').disabled=false;}});
window.addEventListener('pagehide',()=>{stopSound();if(held)cancelHold();if(busy())render('声音已中断；返回后请恢复声音。');});
window.addEventListener('pageshow',()=>{if(busy())render('请检查声音状态；若中断请点击恢复声音。');});
