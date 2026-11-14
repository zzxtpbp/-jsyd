// 所有数据均为模拟，虚拟时钟固定在北京时间 2026-11-04 04:00。
export const time = hm => Date.parse(`2026-11-04T${hm}:00+08:00`);
export const scenarios = [
 {id:'both',name:'双模式：固定更早，但仍差20分钟',changes:{},expected:{action:'create',mode:'fixed',gap:20}},
 {id:'enough',name:'固定提前60分钟：暂无缺口',changes:{fixedMinutes:60},expected:{action:'create',mode:'fixed',gap:0}},
 {id:'route-failed',name:'路线失败：固定模式仍可用',changes:{route:null},expected:{action:'create',mode:'fixed',gap:null}},
 {id:'unknown',name:'天气未知：保留已有闹钟',changes:{weather:null},expected:{action:'keep_existing',mode:null,gap:null}},
 {id:'dry',name:'天气未触发：不新增',changes:{weather:{triggered:false,updatedAt:time('04:00'),validUntil:time('04:15')}},expected:{action:'keep_existing',mode:null,gap:null}},
 {id:'expired',name:'天气过期：不使用旧结果',changes:{weather:{triggered:true,updatedAt:time('03:00'),validUntil:time('04:00')}},expected:{action:'keep_existing',mode:null,gap:null}},
 {id:'smart',name:'只开智能：受上限限制',changes:{fixedEnabled:false},expected:{action:'create',mode:'smart',gap:30}},
 {id:'conflict',name:'复查晚于环境音：阻断',changes:{recheckAt:time('06:25')},expected:{action:'blocked',mode:null,gap:null}},
];
export function makeScenario(id='both') {
 const scenario=scenarios.find(s=>s.id===id);
 if(!scenario)throw new Error('未知模拟场景');
 return structuredClone({now:time('04:00'),baseAlarmAt:time('07:00'),arrivalAt:time('08:00'),recheckAt:time('04:00'),
  fixedEnabled:true,smartEnabled:true,fixedMinutes:30,maxAdvance:20,preparation:30,buffer:10,extra:10,
  ambientEnabled:true,ambientOffset:5,fallback:'保留基础闹钟',
  weather:{triggered:true,updatedAt:time('04:00'),validUntil:time('04:15')},
  route:{durationMinutes:60,updatedAt:time('03:59'),validUntil:time('04:10')},
  baseAlarmId:'base',commutePlanId:'commute',alarms:[{id:'base',at:time('07:00'),enabled:true,repeat:'daily'}],...scenario.changes});
}
