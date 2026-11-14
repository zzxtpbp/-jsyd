// 纯状态机：不读取传感器、不调度/播放/保存。事件只能由可信原生计步适配层产生。
const isTime=v=>Number.isSafeInteger(v)&&Number.isFinite(new Date(v).getTime());
export function createImportantAlarm(options) {
 const o=options??{};
 const targetSteps=o.targetSteps===undefined?20:o.targetSteps;
 if(typeof o.alarmId!=='string'||!o.alarmId.trim())return {ok:false,state:null,message:'缺少闹钟ID。'};
 if(o.sensorAvailable!==true||o.permissionGranted!==true)return {ok:false,state:null,message:'计步硬件或权限尚不可用，不能启用保障模式。'};
 if(!Number.isInteger(targetSteps)||targetSteps<1||targetSteps>200)return {ok:false,state:null,message:'请设置1到200整数步。'};
 return {ok:true,message:'已准备，尚未开始响铃。',state:{version:1,alarmId:o.alarmId,targetSteps,status:'armed',audio:'off',steps:0,
  sessionId:null,startedAt:null,lastEventAt:null,lastSequence:0,exitHoldAt:null,exitConfirmation:false,completionReason:null}};
}
export function transitionImportantAlarm(state,event,now) {
 const reject=message=>({ok:false,state:state??null,message});
 if(state?.version!==1||!['armed','ringing','completed','manual_exit'].includes(state.status))return reject('闹钟状态无效。');
 if(!event||!isTime(now)||!isTime(event.at)||event.at>now||
   (state.lastEventAt!=null&&event.at<state.lastEventAt))return reject('事件时间无效、来自未来或已经乱序。');
 const accept=(patch,message,ok=true)=>({ok,state:{...state,...patch,lastEventAt:event.at},message});
 if(event.type==='ring'){
  if(state.status!=='armed'||typeof event.sessionId!=='string'||!event.sessionId.trim())return reject('任务已开始或会话ID无效。');
  return accept({status:'ringing',audio:'normal',sessionId:event.sessionId,startedAt:event.at},'请带手机走够目标步数；完成前正常响铃。');
 }
 if(state.status!=='ringing')return reject('当前没有进行中的步数任务。');
 if(event.type==='step'){
  if(event.sessionId!==state.sessionId||!Number.isSafeInteger(event.sequence)||event.sequence<=state.lastSequence
    ||event.at<state.startedAt)return reject('忽略旧会话、重复或无效步事件。');
  const steps=state.steps+1,done=steps>=state.targetSteps;
  return accept({steps,lastSequence:event.sequence,status:done?'completed':'ringing',audio:done?'off':'normal',
   exitHoldAt:done?null:state.exitHoldAt,exitConfirmation:done?false:state.exitConfirmation,completionReason:done?'steps':null},done?'步数达标，本次响铃结束。':`已完成${steps}/${state.targetSteps}步，继续正常响铃。`);
 }
 if(event.type==='exit_hold_start')return accept({exitHoldAt:event.at,exitConfirmation:false},'请持续按住8秒，然后二次确认。');
 if(event.type==='exit_hold_release'){
  const ready=isTime(state.exitHoldAt)&&event.at-state.exitHoldAt>=8000;
  return accept({exitHoldAt:null,exitConfirmation:ready},ready?'长按已完成，等待二次确认；期间继续正常响铃。':'长按不足8秒，继续正常响铃。',ready);
 }
 if(event.type==='exit_cancel')return accept({exitHoldAt:null,exitConfirmation:false},'已取消应急退出，继续正常响铃。');
 if(event.type==='exit_confirm'){
  if(state.exitConfirmation!==true)return reject('请先连续长按8秒并完成二次确认。');
  return accept({status:'manual_exit',audio:'off',exitHoldAt:null,exitConfirmation:false,completionReason:'manual_exit'},'已应急停止；记录为手动退出，步数未达标。');
 }
 return reject('保障任务未完成，普通关闭、贪睡或降音量不能结束响铃。');
}
