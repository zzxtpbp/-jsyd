const SNOW=[71,73,75,77,85,86];
// 强天气代码只用于提示与音色，不参与触发判定（见 docs/weather-rules.md 决定 1、决定 3）。
const SEVERE=[65,67,75,82,85,86,95,96,99];
const finite=(n)=>Number.isFinite(n)?n:null;
export const dayKey=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

// 天气是否触发提前：只看降水概率是否达到用户门槛。
// 返回 true / false，概率缺失时返回 null —— null 表示「未知」，绝不当 0 处理。
export function wetVerdict(slot, threshold){
  const p=finite(slot?.probability);
  if(p==null)return null;
  const t=finite(threshold);
  if(t==null)return null;
  return p>=t;
}
export function isSnow(code){return SNOW.includes(code);}
export function isSevere(code){return SEVERE.includes(code);}
// 一段槽位里是否出现未知概率。未知优先于已知：只要有一格不知道，结论就不能是「确定不下」。
const anyUnknown=(hours)=>hours.some(h=>finite(h?.probability)==null);

// 取出某一天的逐小时预报。概率缺失保留 null，不再填 0 —— 填 0 会让界面显示「降水概率 0%」，
// 那是把「不知道」说成「没有」。
export function dayHours(weather,day){
  const h=weather?.hourly;if(!h||!Array.isArray(h.time))return [];
  return h.time.map((time,i)=>({
    time,
    code:h.weather_code?.[i],
    probability:finite(h.precipitation_probability?.[i]),
    amount:finite(h.precipitation?.[i]),
    temperature:h.temperature_2m?.[i],
    text:h.text?.[i],
  })).filter(x=>typeof x.time==='string'&&x.time.slice(0,10)===day);
}
// 汇总一组槽位。affected：有任一格触发即 true；全部未触发但有未知则为 null；否则 false。
function summarize(hours,threshold){
  const hits=hours.filter(h=>wetVerdict(h,threshold)===true);
  const probs=hours.map(h=>h.probability).filter(Number.isFinite);
  const temps=hours.map(h=>h.temperature).filter(Number.isFinite);
  const affected=hits.length>0?true:(anyUnknown(hours)?null:false);
  return {affected,wetHours:hits.map(h=>h.time.slice(11,16)),
    snow:hours.some(h=>isSnow(h.code)),
    severe:hours.some(h=>isSevere(h.code)),
    probability:probs.length?Math.round(Math.max(...probs)):null,
    max:temps.length?Math.round(Math.max(...temps)):null,
    min:temps.length?Math.round(Math.min(...temps)):null,
    coverage:hours.length,
    unknown:anyUnknown(hours)};
}
export function daySummary(weather,day,threshold=30){
  const hours=dayHours(weather,day);if(!hours.length)return null;
  return {day,hours,...summarize(hours,threshold)};
}
// 出发→抵达窗口内的逐小时预报：起止时间取整到小时，跨天也能取全；预报缺失的槽位跳过。
export function windowHours(weather,departure,arrival){
  const h=weather?.hourly;
  const s=new Date(departure),a=new Date(arrival);
  if(!h||!Array.isArray(h.time)||!Number.isFinite(+s)||!Number.isFinite(+a))return [];
  const start=new Date(s);start.setMinutes(0,0,0);
  const slots=[];
  for(let t=+start;t<=+a;t+=3600000){
    const d=new Date(t);
    slots.push(`${dayKey(d)}T${String(d.getHours()).padStart(2,'0')}:00`);
  }
  return slots.map(time=>{
    const i=h.time.indexOf(time);
    if(i<0)return null;
    return {time,code:h.weather_code?.[i],
      probability:finite(h.precipitation_probability?.[i]),
      amount:finite(h.precipitation?.[i]),
      temperature:h.temperature_2m?.[i],text:h.text?.[i]};
  }).filter(Boolean);
}
// 统一口径：所有「是否因雨雪提前」的判断都只看出发→抵达窗口内的天气，与全天预报无关。
export function commuteWeatherWindow(weather,departure,arrival,threshold=30){
  const hours=windowHours(weather,departure,arrival);
  if(!hours.length)return null;
  return {departure:+new Date(departure),arrival:+new Date(arrival),hours,...summarize(hours,threshold)};
}
// 窗口裁决：给 plan.js 用的只有一个入口，避免各处再自己拼字段。
export function windowVerdict(weather,departure,arrival,threshold){
  const w=commuteWeatherWindow(weather,departure,arrival,threshold);
  if(!w)return {known:false,affected:null,probability:null,window:null};
  return {known:true,affected:w.affected,probability:w.probability,
    wetHours:w.wetHours,snow:w.snow,severe:w.severe,unknown:w.unknown,window:w};
}
export function tomorrowRisk(weather, now=new Date(), threshold=30) {
  const tomorrow=new Date(now);tomorrow.setDate(tomorrow.getDate()+1);
  const day=dayKey(tomorrow);
  const summary=daySummary(weather,day,threshold);
  if(!summary)return null;
  return {day,affected:summary.affected,probability:summary.probability,snow:summary.snow,severe:summary.severe,
    unknown:summary.unknown,hours:summary.wetHours,coverage:summary.coverage};
}
export function nextDaily(at,now=Date.now()) {
  const date=new Date(at);while(date.getTime()<=now)date.setDate(date.getDate()+1);return date.getTime();
}
// 计划触发时刻（分钟级）：未来 60s 内到点视为「该触发了」。返回 null 表示无需触发。
export function dueAt(at,now=Date.now()){
  if(!Number.isFinite(at))return null;
  const delta=at-now;
  return delta<=60000&&delta>-60000?at:null;
}
export function tickAlarms(alarms,now) {
  return alarms.map(a=>{
    if(!a.enabled||a.state==='ringing'||a.at>now)return a;
    if(now-a.at>60000)return {...a,at:a.repeat==='daily'?nextDaily(a.baseAt||a.at,now):a.at,enabled:a.repeat==='daily',state:'missed'};
    return {...a,state:'ringing'};
  });
}
