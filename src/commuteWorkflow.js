import {calculateFixedCandidate} from './fixedAdvance.js';
import {calculateSmartCandidate} from './smartAdvance.js';
import {mergeAdvanceCandidates} from './mergeAdvance.js';
import {checkAlarmTiming} from './alarmTiming.js';
import {suggestAlarmWrite} from './alarmWrite.js';
import {summarizeCommute} from './commuteSummary.js';
const isTime = v => Number.isSafeInteger(v) && Number.isFinite(new Date(v).getTime());
const fresh = (data,now) => isTime(now) && isTime(data?.updatedAt) && isTime(data?.validUntil)
  && data.updatedAt <= now && data.validUntil > now;

// weather.triggered 由上游统一天气政策提供；本层不发请求、不生成有效期、不保存。
export function calculateCommuteWorkflow(input) {
  const o=input ?? {};
  const timing=checkAlarmTiming(o);
  const weatherValid=fresh(o.weather,o.now) && typeof o.weather.triggered === 'boolean';
  const weatherTriggered=weatherValid ? o.weather.triggered : null;
  const routeValid=fresh(o.route,o.now);
  const rawFixed=calculateFixedCandidate({...o,weatherTriggered});
  const fixedCandidate=rawFixed.status === 'ready'
    ? {...rawFixed,validUntil:o.weather.validUntil,updatedAt:o.weather.updatedAt} : rawFixed;
  let smartCandidate=calculateSmartCandidate({...o,weatherTriggered,
    durationMinutes:routeValid ? o.route.durationMinutes : null,
    validUntil:weatherValid && routeValid ? Math.min(o.weather.validUntil,o.route.validUntil) : null,
    updatedAt:weatherValid && routeValid ? Math.max(o.weather.updatedAt,o.route.updatedAt) : null,
  });
  const calculated=mergeAdvanceCandidates({...o,fixedCandidate,smartCandidate});
  const merged=timing.ok ? calculated : {status:'unavailable',action:'keep_existing',candidate:null,selectedMode:null,reason:'设置时间关系无效，请先处理冲突。'};
  const write=timing.ok ? suggestAlarmWrite({...o,mergeResult:merged})
    : {action:'blocked',reason:timing.issues.map(i=>i.message).join(' '),targetId:null,patch:null,idempotencyKey:null};
  // 天气或路线无效时，不能借缺省值制造“零缺口”。
  if (!weatherValid || !routeValid) smartCandidate={...smartCandidate,desiredWakeAt:null};
  const summary=summarizeCommute({baseAlarmAt:o.baseAlarmAt,now:o.now,baseAlarmId:o.baseAlarmId,commutePlanId:o.commutePlanId,merged,smartCandidate,write,alarms:Array.isArray(o.alarms)?o.alarms:[]});
  return {timing,weatherTriggered,fixedCandidate,smartCandidate,merged,write,summary};
}
