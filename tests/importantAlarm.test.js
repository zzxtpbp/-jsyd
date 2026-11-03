import test from 'node:test';
import assert from 'node:assert/strict';
import {createImportantAlarm,transitionImportantAlarm} from '../src/importantAlarm.js';
const now=Date.parse('2026-11-04T07:00:00+08:00');
const make=(changes={})=>createImportantAlarm({alarmId:'train',targetSteps:3,sensorAvailable:true,permissionGranted:true,...changes});
const start=(s=make().state)=>transitionImportantAlarm(s,{type:'ring',sessionId:'session-1',at:now},now);
const step=(s,sequence,changes={})=>transitionImportantAlarm(s,{type:'step',sessionId:'session-1',sequence,at:now+sequence,...changes},now+10000);
test('默认20步，仅支持传感器和权限都明确具备的保障模式',()=>{
 assert.equal(make({targetSteps:undefined}).state.targetSteps,20);
 for(const changes of [{sensorAvailable:false},{permissionGranted:false},{permissionGranted:'true'},{targetSteps:0},{targetSteps:null},{targetSteps:2.5},{targetSteps:201}])assert.equal(make(changes).ok,false);
});
test('只在响铃后计步，达标前一直请求正常音量播放',()=>{
 let s=start().state;assert.equal(s.status,'ringing');assert.equal(s.audio,'normal');
 s=step(s,1).state;assert.equal(s.steps,1);assert.equal(s.audio,'normal');
 s=step(s,2).state;assert.equal(s.audio,'normal');
 s=step(s,3).state;assert.equal(s.status,'completed');assert.equal(s.audio,'off');assert.equal(s.completionReason,'steps');
});
test('普通关闭、贪睡、降低音量和重开都不能绕过任务',()=>{
 const s=start().state;for(const type of ['dismiss','snooze','lower_volume','ring']){
 const r=transitionImportantAlarm(s,{type,sessionId:'new',at:now+1},now+1);assert.equal(r.state.status,'ringing');assert.equal(r.state.audio,'normal');assert.equal(r.ok,false);}
});
test('旧会话、重复、乱序、未来、早于响铃及非法序号不计步',()=>{
 let s=step(start().state,2).state;assert.equal(s.steps,1);
 for(const e of [{sequence:2},{sequence:1},{sequence:3,sessionId:'old'},{sequence:3,at:now-1},{sequence:3,at:now+20000},{sequence:'3'}]){
 const r=step(s,3,e);assert.equal(r.state.steps,1);assert.equal(r.state.audio,'normal');}
});
test('触发前、完成后步数不改变结果，不修改输入',()=>{
 const armed=make().state;assert.equal(step(armed,1).ok,false);
 const s=step(step(step(start().state,1).state,2).state,3).state;
 const copy=structuredClone(s);assert.equal(step(s,4).state.status,'completed');assert.deepEqual(s,copy);
});
test('应急退出必须连续长按8秒并二次确认，不能当作达标',()=>{
 let s=start().state;s=transitionImportantAlarm(s,{type:'exit_hold_start',at:now+1},now+1).state;
 assert.equal(transitionImportantAlarm(s,{type:'exit_hold_release',at:now+8000},now+8000).state.exitConfirmation,false);
 s=transitionImportantAlarm(s,{type:'exit_hold_release',at:now+8001},now+8001).state;assert.equal(s.exitConfirmation,true);assert.equal(s.audio,'normal');
 s=transitionImportantAlarm(s,{type:'exit_confirm',at:now+8002},now+8002).state;assert.equal(s.status,'manual_exit');assert.equal(s.completionReason,'manual_exit');assert.equal(s.audio,'off');
});
test('取消应急确认或提前松开，旧长按授权不能复用',()=>{
 let s=start().state;s=transitionImportantAlarm(s,{type:'exit_hold_start',at:now+1},now+1).state;
 s=transitionImportantAlarm(s,{type:'exit_hold_release',at:now+2},now+2).state;
 assert.equal(transitionImportantAlarm(s,{type:'exit_confirm',at:now+9000},now+9000).ok,false);
 s=transitionImportantAlarm(s,{type:'exit_hold_start',at:now+10000},now+10000).state;
 s=transitionImportantAlarm(s,{type:'exit_hold_release',at:now+18000},now+18000).state;
 s=transitionImportantAlarm(s,{type:'exit_cancel',at:now+18001},now+18001).state;
 assert.equal(transitionImportantAlarm(s,{type:'exit_confirm',at:now+18002},now+18002).ok,false);
});
test('恶意未来时间不能直接获得长按授权，事件时间不能倒退',()=>{
 const s=start().state;assert.equal(transitionImportantAlarm(s,{type:'exit_hold_start',at:now+9000},now).ok,false);
 const next=transitionImportantAlarm(s,{type:'exit_hold_start',at:now+100},now+100).state;
 assert.equal(transitionImportantAlarm(next,{type:'exit_hold_release',at:now+99},now+100).ok,false);
});
test('无效输入有明确错误，不生成可响铃的新状态',()=>{
 for(const input of [undefined,null,{},'wrong'])assert.doesNotThrow(()=>transitionImportantAlarm(input,null,now));
 assert.equal(createImportantAlarm(null).ok,false);assert.equal(transitionImportantAlarm(null,null,now).ok,false);
});
test('应急长按期间的步数不打断退出授权，只有达标才清理',()=>{
 let s=start().state;s=transitionImportantAlarm(s,{type:'exit_hold_start',at:now+1},now+1).state;
 s=transitionImportantAlarm(s,{type:'step',sessionId:'session-1',sequence:1,at:now+1000},now+1000).state;
 s=transitionImportantAlarm(s,{type:'exit_hold_release',at:now+8001},now+8001).state;assert.equal(s.exitConfirmation,true);
 s=transitionImportantAlarm(s,{type:'step',sessionId:'session-1',sequence:2,at:now+8002},now+8002).state;assert.equal(s.exitConfirmation,true);
 s=transitionImportantAlarm(s,{type:'step',sessionId:'session-1',sequence:3,at:now+8003},now+8003).state;assert.equal(s.exitConfirmation,false);assert.equal(s.status,'completed');
});
