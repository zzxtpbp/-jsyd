import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCommuteWorkflow } from '../src/commuteWorkflow.js';
const t = s => Date.parse(`2026-11-04T${s}:00+08:00`);
export function fixture(changes={}) {
  return { now:t('04:00'),baseAlarmAt:t('07:00'),arrivalAt:t('08:00'),recheckAt:t('04:00'),
    fixedEnabled:true,smartEnabled:true,fixedMinutes:30,maxAdvance:20,preparation:30,buffer:10,extra:10,
    ambientEnabled:true,ambientOffset:5,fallback:'保留基础闹钟',
    weather:{triggered:true,updatedAt:t('04:00'),validUntil:t('04:15')},
    route:{durationMinutes:60,updatedAt:t('03:59'),validUntil:t('04:10')},
    baseAlarmId:'base',commutePlanId:'commute',alarms:[{id:'base',at:t('07:00'),enabled:true,repeat:'daily'}],...changes };
}
test('真实串联：固定取早仍明确还有20分钟缺口，不假装已保存',()=>{
 const r=calculateCommuteWorkflow(fixture());assert.equal(r.merged.selectedMode,'fixed');assert.equal(r.write.action,'create');
 assert.equal(r.summary.wakeAt,t('06:30'));assert.equal(r.summary.gapMinutes,20);assert.equal(r.summary.executionState,'suggested');
 assert.equal(r.fixedCandidate.validUntil,t('04:15'));assert.equal(r.smartCandidate.validUntil,t('04:10'));
});
test('路线失败或过期不会拖住固定模式',()=>{
 for(const route of [null,{durationMinutes:60,updatedAt:t('03:00'),validUntil:t('04:00')}]){
 const r=calculateCommuteWorkflow(fixture({route}));assert.equal(r.write.action,'create');assert.equal(r.summary.gapMinutes,null);
 assert.equal(r.merged.selectedMode,'fixed');assert.equal(r.smartCandidate.status,'route_failed');}
});
test('天气未知、缺有效期、过期、未来更新时间、非布尔触发均不写入',()=>{
 for(const weather of [null,{triggered:true},{triggered:true,updatedAt:t('04:00'),validUntil:t('04:00')},
 {triggered:true,updatedAt:t('04:01'),validUntil:t('04:15')},{triggered:'false',updatedAt:t('04:00'),validUntil:t('04:15')}]){
 const r=calculateCommuteWorkflow(fixture({weather}));assert.equal(r.write.action,'keep_existing');assert.equal(r.summary.gapMinutes,null);}
});
test('天气明确不触发，不创建且没有0分钟安全保证',()=>{
 const f=fixture();f.weather.triggered=false;const r=calculateCommuteWorkflow(f);assert.equal(r.write.action,'keep_existing');assert.equal(r.summary.wakeAt,null);
});
test('复查与环境音冲突阻断保存',()=>{
 const r=calculateCommuteWorkflow(fixture({recheckAt:t('06:25')}));assert.equal(r.timing.ok,false);assert.equal(r.write.action,'blocked');assert.equal(r.write.patch,null);
});
test('固定60分钟不受智能上限20影响，最终缺口为0',()=>{
 const r=calculateCommuteWorkflow(fixture({fixedMinutes:60}));assert.equal(r.summary.wakeAt,t('06:00'));assert.equal(r.summary.gapMinutes,0);
});
test('只开智能会提示建议固定；上限0不创建重复基础铃且保留缺口',()=>{
 const r=calculateCommuteWorkflow(fixture({fixedEnabled:false,maxAdvance:0}));assert.equal(r.write.action,'keep_existing');
 assert.equal(r.smartCandidate.gapMinutes,50);assert.equal(r.summary.gapMinutes,null);assert.ok(r.timing.warnings.some(w=>w.code==='smart_without_fixed'));
});
test('保留更早已有闹钟时按已有时间重算缺口',()=>{
 const f=fixture();f.alarms.push({id:'primary',at:t('06:00'),enabled:true,state:'armed',planKind:'primary',commutePlanId:'commute',baseAlarmId:'base',baseAlarmAt:t('07:00')});
 const r=calculateCommuteWorkflow(f);assert.equal(r.write.action,'keep_existing');assert.equal(r.summary.wakeAt,t('06:00'));assert.equal(r.summary.gapMinutes,0);assert.equal(r.summary.executionState,'existing_record');
});
test('保存建议幂等，不改变输入且不冒充设备已同步',()=>{
 const f=fixture();const before=structuredClone(f);const r=calculateCommuteWorkflow(f);assert.deepEqual(f,before);
 f.alarms.push({...r.write.patch,id:'new'});const second=calculateCommuteWorkflow(f);assert.equal(second.write.action,'noop');assert.equal(f.alarms.length,2);
 assert.equal(second.summary.executionState,'existing_record');
});
test('基础关闭或归属冲突阻断时不显示可应用的新时间',()=>{
 const f=fixture();f.alarms[0].enabled=false;const r=calculateCommuteWorkflow(f);assert.equal(r.write.action,'blocked');assert.equal(r.summary.wakeAt,null);
});
test('非法开关及缺失输入不抛异常',()=>{
 for(const f of [undefined,null,{},fixture({smartEnabled:'true'})])assert.doesNotThrow(()=>calculateCommuteWorkflow(f));
 assert.equal(calculateCommuteWorkflow(fixture({smartEnabled:'true'})).write.action,'blocked');
});
test('跨午夜保持日期顺序',()=>{
 const f=fixture({baseAlarmAt:t('00:30'),arrivalAt:t('01:00'),now:Date.parse('2026-11-03T22:00:00+08:00'),recheckAt:Date.parse('2026-11-03T22:00:00+08:00'),maxAdvance:60});
 f.weather={triggered:true,updatedAt:f.now,validUntil:f.now+900000};f.route={durationMinutes:60,updatedAt:f.now,validUntil:f.now+600000};f.alarms[0].at=f.baseAlarmAt;
 const r=calculateCommuteWorkflow(f);assert.equal(r.summary.wakeAt,Date.parse('2026-11-03T23:30:00+08:00'));assert.equal(r.summary.gapMinutes,20);
});
test('无新候选仍展示同次有效旧铃，并重算缺口',()=>{
 const f=fixture({fixedEnabled:false,maxAdvance:0});f.alarms.push({id:'old',at:t('06:00'),enabled:true,state:'armed',source:'fixed',planKind:'primary',commutePlanId:'commute',baseAlarmId:'base',baseAlarmAt:t('07:00')});
 const r=calculateCommuteWorkflow(f);assert.equal(r.write.action,'keep_existing');assert.equal(r.summary.wakeAt,t('06:00'));assert.equal(r.summary.gapMinutes,0);assert.equal(r.summary.executionState,'existing_record');
 f.alarms[1].commutePlanId='other';assert.equal(calculateCommuteWorkflow(f).summary.wakeAt,null);
});
test('闹钟列表中的空记录不会导致摘要崩溃',()=>{
 const f=fixture();f.alarms.push(null);assert.doesNotThrow(()=>calculateCommuteWorkflow(f));
 assert.equal(calculateCommuteWorkflow(f).write.action,'create');assert.doesNotThrow(()=>calculateCommuteWorkflow(fixture({alarms:[null]})));
});
test('空ID不能冒充keep_existing的目标或其他计划旧铃',()=>{
 const f=fixture({fixedEnabled:false,maxAdvance:0});f.alarms.push({id:null,at:t('06:00'),source:'other-plan'});
 const r=calculateCommuteWorkflow(f);assert.equal(r.summary.wakeAt,null);assert.equal(r.summary.gapMinutes,null);assert.equal(r.summary.executionState,'suggested');
});
