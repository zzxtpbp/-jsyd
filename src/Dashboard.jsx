import React, { useEffect, useRef, useState } from 'react';
import { coordinate, weatherName, assess } from './live.js';
import { gcjToWgs } from './coordinates.js';
import { nextDaily, tickAlarms, tomorrowRisk, daySummary, dayKey, dueAt, commuteWeatherWindow, wetVerdict, isSnow, isSevere } from './schedule.js';
import { RINGTONES, getRingtone, createRinger, previewRingtone } from './ringtones.js';
import { DEFAULT_COMMUTE, restoreCommute, validateCommute, validateCommuteShape, effectiveTaxiWait, withExtra, withPreference, TRANSPORTS, TRANSPORT_MODE } from './commuteSettings.js';
// 注意：plan.js 的纯函数改名为 computePlan，避免与下方同名的事件处理函数 buildPlan 冲突。
import { buildPlan as computePlan, buildPlan, PLAN_STATUS, EXECUTION_STATE, commuteVerdict } from './plan.js';
import { NextPlanCard, GapNotice, WeatherSettings, RingtoneSettings } from './PlanSettings.jsx';
import { SetupGuide, RecheckSettings, AmbientSettings, WeatherFallbackSettings } from './SetupGuide.jsx';
import { createAmbient, ambientProfile, ambientWindow, shouldSound } from './ambient.js';
import './theme.css';
import './dashboard.css';
import './guide.css';
import './unknown.css';

const STORE='jishi-studio-v3';
const THEMES=[
 {id:'forest',name:'清晨森林',desc:'自然柔和 · 当前经典风格'},
 {id:'neumorphic',name:'柔光新拟物',desc:'圆润表面 · 双向柔影与玻璃高光'},
 {id:'clay',name:'粘土拟态',desc:'充气大圆角 · 弹簧浮起手感'},
 {id:'immersive',name:'晨雾沉浸玻璃',desc:'雨后晨雾 · 毛玻璃层级景深'},
];
const fmt=(time)=>new Date(time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
const localDate=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
function read(){try{return JSON.parse(localStorage.getItem(STORE))||{};}catch{return {};}}
// 唯一的写入出口。以前是两个 useEffect 各自 setItem(JSON.stringify({...}))：
// 一个带 alarms/location/prefs，一个带 commute/guideComplete，后跑的会把先跑的整体覆盖掉，
// 于是「保存后刷新即丢、第二次刷新回默认并重开引导」。现在一律读-合并-写。
function writeStore(patch){
 try{
  const next={...read(),...patch};
  localStorage.setItem(STORE,JSON.stringify(next));
  return true;
 }catch{return false;}
}
function initialAlarms(){const saved=read().alarms;if(Array.isArray(saved))return saved.filter(a=>a&&typeof a.id==='string'&&Number.isFinite(a.at));return [7,7.5,8].map((hour,i)=>{const d=new Date();d.setHours(Math.floor(hour),hour%1*60,0,0);return{id:crypto.randomUUID(),at:nextDaily(+d),label:['早起闹钟','出发提醒','备用闹钟'][i],enabled:false,repeat:'daily',state:'idle'};});}
// 分享部署时，网关要求每个请求都带 sharecode；入口 HTML 上的参数要一直带到接口请求，
// 否则 /api/* 会 403。本地开发没有这个参数，这里原样返回、不影响任何行为。
function shareParam(){try{const c=new URLSearchParams(location.search).get('sharecode');return c?`sharecode=${encodeURIComponent(c)}`:'';}catch{return '';}}
async function api(path,body){
 const q=shareParam();
 const url=`/api/${path}${q?(path.includes('?')?'&':'?')+q:''}`;
 const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)}:{});
 const j=await r.json();
 if(!r.ok)throw new Error(j.error||'接口暂不可用');
 return j;
}

export default function Dashboard(){
 const [view,setView]=useState('alarm');
 const [alarms,setAlarms]=useState(initialAlarms);
 const [location,setLocation]=useState(()=>read().location||{lon:121.4737,lat:31.2304,name:'上海示例位置',example:true});
 const [weather,setWeather]=useState(null),[weatherError,setWeatherError]=useState(''),[weatherBusy,setWeatherBusy]=useState(false);
 // B04：家的独立天气，专供通勤时段判定，与天气页主位置解耦。
 const [homeWeather,setHomeWeather]=useState(null),[homeWeatherError,setHomeWeatherError]=useState('');
 const [locating,setLocating]=useState(false);
 const [providers,setProviders]=useState({});
 const [status,setStatus]=useState('');
 const [now,setNow]=useState(Date.now());
 const [editor,setEditor]=useState(null);
 const [prefs,setPrefs]=useState(()=>({enabled:false,at:'20:00',threshold:30,ringtone:'classic',volume:1,theme:'forest',night:false,...read().prefs}));
 const [notice,setNotice]=useState(null);
 const [home,setHome]=useState(()=>read().home||null),[office,setOffice]=useState(()=>read().office||null);
 const [search,setSearch]=useState(''),[searchTarget,setSearchTarget]=useState('home'),[candidates,setCandidates]=useState([]),[searchBusy,setSearchBusy]=useState(false);
 const [locEditor,setLocEditor]=useState(false),[locQuery,setLocQuery]=useState(''),[locResults,setLocResults]=useState([]),[locBusy,setLocBusy]=useState(false),[coordInput,setCoordInput]=useState(''),[locError,setLocError]=useState('');
 const [locMode,setLocMode]=useState('main');
 const [customPlaces,setCustomPlaces]=useState(()=>{const saved=read().customPlaces;return Array.isArray(saved)?saved.filter(p=>p&&typeof p.id==='string'&&typeof p.name==='string'&&Number.isFinite(p.lon)&&Number.isFinite(p.lat)).slice(0,5):[];});
 const [placeWeather,setPlaceWeather]=useState({}),[placeBusy,setPlaceBusy]=useState(false),[placeError,setPlaceError]=useState('');
 const [plans,setPlans]=useState(()=>{const saved=read().plans;return Array.isArray(saved)?saved.filter(p=>p&&typeof p.id==='string'&&typeof p.label==='string'&&Number.isFinite(p.at)).map(p=>({...p,remind:Number.isFinite(p.remind)?p.remind:30,place:p.place&&p.place.name&&p.place.location?p.place:null})):[];});
 const [planEditor,setPlanEditor]=useState(null);
 const [tripBusy,setTripBusy]=useState(false),[tripError,setTripError]=useState('');
 const [route,setRoute]=useState(null),[routeBusy,setRouteBusy]=useState(false),[routeError,setRouteError]=useState('');
 // B08：备用交通方式自己的耗时。键为交通方式名（公交 / 地铁 / 骑行 / 步行）。
 // 以前切换交通方式只改文案，耗时仍取驾车路线，于是「改乘公交」还是驾车那 40 分钟。
 // 这里按需单独查一次，查不到就如实标为未知，绝不复用驾车耗时冒充。
 const [altRoutes,setAltRoutes]=useState({});
 const [mapImage,setMapImage]=useState(''),[mapError,setMapError]=useState('');
 const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(9,0,0,0);
 const [arrival,setArrival]=useState(localDate(tomorrow));
 const [mode,setMode]=useState('drive');
 const [preparation,setPreparation]=useState(40),[buffer,setBuffer]=useState(15),[extra,setExtra]=useState(15),[maxAdvance,setMaxAdvance]=useState(30);
 // 固定 / 智能双模式设置：独立于通勤页的即时参数，持久化到本地。
 const [commute,setCommute]=useState(()=>restoreCommute(read()));
 // A02：首次引导。已完成过就不再自动弹出。
 const [showGuide,setShowGuide]=useState(()=>!read().guideComplete);
 const [guideStep,setGuideStep]=useState(0);
 const [guideError,setGuideError]=useState('');
// A02：引导被打断的上下文。引导里点「新增基础闹钟」时把引导收起来，
// 记下「回来后应该停在哪一步、回来要给哪一步做补全动作」，避免整个引导被顶掉。
// 以前是 showGuide=false 之后就再也不管了，用户必须刷新才能回到引导。
const [guideResume,setGuideResume]=useState(null);
// A07：环境音。ambientRef 持有当前发声节点，ambientPreview 区分试听与正式播放。
const ambientRef=useRef(null);
const [ambientPreview,setAmbientPreview]=useState(false);
// 浏览器要求用户手势后才能发声；soundReady 记录本次页面是否已经拿到可用音频上下文。
const [soundReady,setSoundReady]=useState(false);
const [guideDone,setGuideDone]=useState(()=>!!read().guideComplete);
 const [proposal,setProposal]=useState(null),[analysis,setAnalysis]=useState(''),[aiBusy,setAiBusy]=useState(false),[planBusy,setPlanBusy]=useState(false);
 const planRequest=useRef(0);
 const audio=useRef(null),ringerRef=useRef(null),weatherRequest=useRef(0),routeRequest=useRef(0),analysisRequest=useRef(0),searchRequest=useRef(0),placeRequest=useRef(0);
 const active=alarms.filter(a=>a.enabled).sort((a,b)=>a.at-b.at);
 const ringing=active.filter(a=>a.state==='ringing');
 const next=ringing[0]||active[0]||alarms[0];
 const risk=tomorrowRisk(weather?.weather,new Date(now),Number(prefs.threshold));
 const tomorrowKey=(()=>{const d=new Date(now);d.setDate(d.getDate()+1);return dayKey(d);})();
 const tomorrowForecast=daySummary(weather?.weather,tomorrowKey,Number(prefs.threshold));
 // 当前选中的出行方式：优先所选，其次驾车，再次任意可得方式；路线未查询时为 null。
 const activeMode=route?.modes?.[mode]||route?.modes?.drive||Object.values(route?.modes||{})[0]||null;
 // 统一口径：预计出发→抵达窗口内的天气。只有家、公司、路线、到达时间齐全时才算数；
 // 与通勤方案 computeProposal 用同一个函数，杜绝「首页说提前、通勤说 0 分钟」的两套结论。
 const homeReady=!!(home&&office&&route);
 const arrivalMs=(()=>{const t=+new Date(arrival);return Number.isFinite(t)?t:null;})();
 // B04：两个点位必须分开。
 //   weatherSpot  = 天气页主位置（location），用户可能切到外地城市，只用于「当地天气」展示；
 //   commuteSpot  = 通勤时段的天气，必须取家所在地，否则「家附近没雨，但人已经飞到外地」会算错。
 const weatherSpot={name:location.name,lon:location.lon,lat:location.lat,source:'天气页主位置'};
 // B04：两个点位必须分开。
 //   weatherSpot  = 天气页主位置（location），用户可能切到外地城市，只用于「当地天气」展示；
 //   commuteSpot  = 通勤时段的天气，必须取家所在地，否则人已经切到外地时会算错。
 const commuteSpot=(()=>{
  if(!home||!Number.isFinite(home.lon))return null;
  return {name:home.name||'家',lon:home.lon,lat:home.lat,source:'通勤起点（家）'};
 })();
 // 通勤天气只认「家」的逐小时预报；拿不到时退回主位置，但界面上必须写明是退回值，
 // 不能让用户以为这就是家附近的天气。
 const commuteWeather=homeWeather?.weather||null;
 const commuteWeatherFallback=!commuteWeather;
 const commuteWeatherSource=commuteWeather?'家':(homeWeatherError?`主位置（家天气获取失败：${homeWeatherError}）`:'主位置（家的天气获取中）');
 // 两处都用同一套来源，避免首页和通勤页各回退一次导致结论不一致。
 const commuteWeatherRaw=commuteWeather||weather?.weather||null;
 const commuteWindow=(()=>{
  if(!homeReady||arrivalMs==null||!commuteWeatherRaw)return null;
  const picked=activeMode;
  const durationMin=picked&&Number.isFinite(picked.duration)?Math.ceil(picked.duration/60):null;
  if(durationMin==null)return null;
  const depart=arrivalMs-(durationMin+Number(buffer)||0)*60000;
  const wake=depart-(Number(preparation)||0)*60000;
  if(!Number.isFinite(depart)||!Number.isFinite(wake))return null;
  return commuteWeatherWindow(commuteWeatherRaw,new Date(depart),arrivalMs,Number(commute.threshold??prefs.threshold));
 })();
 // affected 三态：null 表示出发时段存在概率缺失，不能当成「确定不下雨」。
 const commuteWet=commuteWindow?commuteWindow.affected:null;
 // 雨雪额外准备只有一个来源：commute.extra（= preferences.rain.extra）。
 const extraNow=Number.isFinite(commute.extra)?commute.extra:extra;
 const dayKeys=weather?[...new Set((weather.weather.hourly?.time||[]).map(t=>String(t).slice(0,10)))]:[];
 const smartAlarm=alarms.filter(a=>a.enabled&&a.label==='智能通勤唤醒'&&a.at>now).sort((a,b)=>a.at-b.at)[0]||null;
 const smartAdvance=commuteWet===true?extraNow:0;
 // A04 / A06 / A08：统一走 plan.js 的纯函数，固定候选与智能候选合并后只产出一个唤醒时间。
 const baseAlarm=alarms.find(a=>a.id===commute.baseAlarmId&&a.enabled)||alarms.filter(a=>a.enabled).sort((a,b)=>a.at-b.at)[0]||null;
// B02：唯一的时间计算出口。首页和通勤方案页都调它，参数来源差别只在于
// 「天气与路线是不是已经查到了」。任何一处改了参数，两处结果必然同步。
function buildCanonicalPlan(overrides={}){
 const durationMin=(()=> {
  const d=overrides.durationMinutes;
  if(Number.isFinite(d))return d;
  return activeMode&&Number.isFinite(activeMode.duration)?Math.ceil(activeMode.duration/60):null;
 })();
 // B08：如果确实要改乘备用方式，就必须用那条方式自己查到的耗时。
 // 查到 → 用它；查过但失败 / 还没查 → 传 null，让 plan.js 标成「路线未知」，
 // 而不是悄悄退回驾车耗时（那正是验收里「只换名字不换耗时」的根因）。
 const altMode=commute.preferences?.rain?.mode&&commute.preferences.rain.mode!==commute.transport
  ?commute.preferences.rain.mode:null;
 const altKey=altMode?TRANSPORT_MODE[altMode]:null;
 const altRoute=altKey?altRoutes[altKey]:null;
 const altDurationMin=altRoute&&Number.isFinite(altRoute.duration)?Math.ceil(altRoute.duration/60):null;
 return computePlan({
  baseAlarmAt:baseAlarm?baseAlarm.at:null,
  arrivalAt:arrivalMs,
  durationMinutes:durationMin,
  buffer:Number(commute.buffer??buffer), preparation:Number(commute.preparation??preparation),
  extra:Number(commute.extra??extra), maxAdvance:Number(commute.maxAdvance??maxAdvance),
  // B03：打车等车时间必须进这里，否则首页的提前唤醒会比通勤方案页晚（验收 B02 第①条）。
  taxiWait:effectiveTaxiWait(commute),
  fixedMinutes:Number(commute.fixedMinutes), fixedEnabled:!!commute.fixedEnabled,
  // 只开了固定模式时不需要路线，避免因为没查路线就整体不可用。
  smartEnabled:!!commute.smartEnabled,
  weatherKnown:overrides.weatherKnown??!!weather,
  routeKnown:overrides.routeKnown??!!route,
  // 传三态而不是 !!commuteWet：概率缺失时不能谎称「无雨」。
  wet:'wet' in overrides?overrides.wet:commuteWet,
  probability:Number.isFinite(overrides.probability)?overrides.probability:null,
  snow:overrides.snow??!!commuteWindow?.snow,
  severe:overrides.severe??false,
  preferences:commute.preferences,
  threshold:Number(commute.threshold??prefs.threshold),
  // 耗时来自高德路线查询；没查路线时 routeKnown=false，routeNote 会如实说明。
  durationSource:overrides.durationSource||'amap',
  // B08：备用方式耗时单独传，只有真的切换时才被采用（由 plan.js 判定）。
  alternateDurationMinutes:Number.isFinite(overrides.alternateDurationMinutes)?overrides.alternateDurationMinutes:altDurationMin,
  alternateDurationSource:altRoute?'amap':'user',
  source:commute.smartEnabled?'高德地图 + 和风天气':'本地闹钟设置',
  now,
 });
}
const plan=buildCanonicalPlan();
// A06：保存状态不能恒为「尚未保存」。
// 依据是「本地是否已经存在一条与当前方案同时间的 primary 闹钟」，
// 而不是 plan 对象自己的某个默认值 —— 默认值永远不会自己变成 saved。
const primaryAlarm=alarms.find(a=>a.planKind==='primary')||null;
const planExecutionState=(()=>{
 if(!Number.isFinite(plan.wakeAt))return EXECUTION_STATE.SUGGESTED;
 if(!primaryAlarm)return EXECUTION_STATE.SUGGESTED;
 // 时间对得上才算「这条方案已保存」；差一分钟都算没保存，避免显示假的完成态。
 if(Math.abs(primaryAlarm.at-plan.wakeAt)>60000)return EXECUTION_STATE.SUGGESTED;
 return primaryAlarm.enabled?EXECUTION_STATE.SAVED:EXECUTION_STATE.FAILED;
})();
// 给界面用的那份 plan 带上真实保存状态
const planWithState={...plan,executionState:planExecutionState};
 const upcomingPlans=plans.slice().sort((a,b)=>a.at-b.at).filter(p=>p.at>Date.now()-3600000);
 // B02：通勤方案页以前用自己的 proposal.at / proposal.depart 显示，和首页的 plan 是两套算法，
 // 于是出现「方案页 06:28、首页 06:40」「方案页 06:40、首页 06:35」。
 // 现在方案页一律显示 plan 的结果，proposal 只保留天气/路线这类「原料」。
 const planView=(()=>{
  if(!proposal)return null;
  const wake=Number.isFinite(plan?.wakeAt)?plan.wakeAt:(Number.isFinite(proposal.at)?proposal.at:null);
  const depart=Number.isFinite(plan?.departAt)?plan.departAt:(proposal.depart?+new Date(proposal.depart):null);
  const adv=plan?.candidates?.[plan.mode]?.advance;
  return {
   wake, depart,
   wakeText:wake==null?'—:—':fmt(wake),
   departText:depart==null?'—:—':fmt(depart),
   advance:Number.isFinite(adv)?adv:(plan?.candidates?.fixed?.advance??0),
   needsConfirm:plan?.status===PLAN_STATUS.CAPPED||plan?.gapMinutes>0,
   // 打车等车只在「打车」且用户填了非零值时才提示，文案与首页一致。
   taxiNote:(()=>{const w=effectiveTaxiWait(commute);return w>0?`打车预留：按你设置的打车等车 ${w} 分钟预留。`:'';})(),
   // B08/B09：方案页也要采用备用方式，并把「这条耗时是哪来的」说清楚。
   // 以前方案页只显示原交通方式与驾车耗时，和首页「已改乘公交」对不上。
   transport:plan?.transport || (plan?.fallback?.switched?plan.fallback.mode:null),
   routeNote:plan?.routeNote||'',
   alternateNote:(()=>{
    if(!plan?.fallback?.switched)return '';
    const mode=plan.fallback.mode;
    const minutes=Number.isFinite(plan?.reasonDetail?.route?.durationMinutes)?plan.reasonDetail.route.durationMinutes:null;
    if(minutes==null)return `${mode}路线耗时暂未查到，出发时间需查一次才能确定。`;
    return `雨雪方案：已改乘${mode}，行程约 ${minutes} 分钟。`;
   })(),
   sameAsHome:true,
  };
 })();
 // 出行计划的天气提示：出发小时有雨雪/超阈值概率时在提醒里点名，否则只提醒出发。
 function planWeatherHint(plan){
  if(!weather)return '';
  const day=dayKey(new Date(plan.at));
  const hour=`T${String(new Date(plan.at).getHours()).padStart(2,'0')}:00`;
  const slot=(weather.weather.hourly?.time||[]).findIndex(t=>t.startsWith(day+hour));
  if(slot<0)return '';
  const code=weather.weather.hourly.weather_code[slot];
  const prob=weather.weather.hourly.precipitation_probability?.[slot];
  // 统一走 schedule.js 的判定：只看概率门槛，缺失保留未知，不由天气代码绕过。
  const wet=wetVerdict({probability:Number.isFinite(prob)?prob:null},Number(prefs.threshold))===true;
  if(!wet)return '';
  const snow=isSnow(code);
  return snow?`出发时段预报有雪，注意保暖防滑、预留时间。`:Number.isFinite(prob)?`出发时段降水概率 ${Math.round(prob)}%，记得带伞。`:'出发时段预报有降水，记得带伞。';
 }
 // 到点触发：提醒 + 可选闹钟。触发过的计划当天不再重复提醒。
 const firedPlans=useRef({});
 useEffect(()=>{
  upcomingPlans.forEach(p=>{
   if(!dueAt(p.at-((p.remind||0)*60000)))return;
   if(firedPlans.current[p.id])return;
   firedPlans.current[p.id]=true;
   const hint=planWeatherHint(p);
   const when=new Date(p.at);
   const text=`${p.label} · ${when.getHours()}:${String(when.getMinutes()).padStart(2,'0')} 出发${p.place?` · ${p.place.name}`:''}${hint?`。${hint}`:'。'}`;
   setNotice({text,tag:`plan-${p.id}`});
   if('Notification'in window&&Notification.permission==='granted'){try{new Notification('吉时已到 · 出行提醒',{body:text,tag:`plan-${p.id}`});}catch{}}
   setStatus(text);
  });
 },[now,upcomingPlans.length,weather?.fetched,prefs.threshold]);
 function openPlanEditor(plan){
  const base=plan?{...plan}:{id:null,label:'',at:localDate(new Date(Date.now()+90*60000)),remind:30,place:null};
  setPlanEditor({...base,pendingPlace:base.place,placeQuery:'',placeResults:[]});
 }
 async function searchPlanPlace(){const e=planEditor;if(!e||!e.placeQuery)return;try{const r=await api('geocode',{address:e.placeQuery});setPlanEditor(v=>({...v,placeResults:r.candidates.slice(0,5)}));if(!r.candidates.length)setStatus('没有找到这个地方，请补上城市名');}catch(err){setStatus(`高德地址查询：${err.message}`);}}
 function savePlan(e){e.preventDefault();const d=planEditor;if(!d.label.trim()){setStatus('请填写计划名称');return;}try{const at=+new Date(d.at);if(!Number.isFinite(at)||at<=Date.now())throw new Error('出发时间需在未来');const item={id:d.id||`plan-${crypto.randomUUID()}`,label:d.label.trim(),at,remind:Math.min(120,Math.max(0,Number(d.remind)||0)),place:d.pendingPlace||null};setPlans(v=>d.id?v.map(p=>p.id===d.id?item:p):[...v,item]);firedPlans.current[item.id]=false;setPlanEditor(null);setStatus(`已保存「${item.label}」，出发前 ${item.remind} 分钟提醒`);}catch(err){setStatus(err.message);}}
 function removePlan(id){setPlans(v=>v.filter(p=>p.id!==id));delete firedPlans.current[id];}
 function snoozePlan(id){setPlans(v=>v.map(p=>p.id===id?{...p,at:p.at+30*60000}:p));firedPlans.current[id]=false;setStatus('已延后 30 分钟提醒');}
 // 出发前实时路况：优先计划地点，其次家→公司。
 function planAmapLink(plan){
  const dest=plan?.place?.location||office?.location;
  if(!dest)return null;
  const from=location.lon&&location.lat?`${location.lon},${location.lat},当前位置`:home?.location?`${home.location},家`:null;
  const params={to:`${dest},${plan?.place?.name||'目的地'}`,mode:'car',coordinate:'gaode',src:'jishi-demo',callnative:'0'};
  if(from)params.from=from;
  return `https://uri.amap.com/navigation?${new URLSearchParams(params)}`;
 }
 const placeSlots=(()=>{
  const wgs=(place)=>{try{const c=coordinate(place.location);return gcjToWgs(c.lon,c.lat);}catch{return {lon:NaN,lat:NaN};}};
  return [
   {id:'current',role:'当前',name:location.name,lon:location.lon,lat:location.lat},
   {id:'home',role:'家',name:home?.name||'未设置家',...(home?wgs(home):{}),missing:!home},
   {id:'office',role:'公司',name:office?.name||'未设置公司',...(office?wgs(office):{}),missing:!office},
   ...customPlaces.map(p=>({id:p.id,role:'自定义',name:p.name,lon:p.lon,lat:p.lat,custom:true})),
  ];
 })();
 const placeKey=placeSlots.filter(s=>Number.isFinite(s.lon)&&Number.isFinite(s.lat)).map(s=>`${s.id}:${s.lon.toFixed(4)},${s.lat.toFixed(4)}`).join('|');

 useEffect(()=>{planRequest.current++;setProposal(null);analysisRequest.current++;setAnalysis('');setAiBusy(false);},[route,home,arrival,preparation,buffer,extra,maxAdvance]);
 useEffect(()=>{api('status').then(setProviders).catch(()=>{});},[]);
 useEffect(()=>{const timer=setInterval(()=>{const at=Date.now();setNow(at);setAlarms(previous=>{const next=tickAlarms(previous,at);return next.some((a,i)=>a!==previous[i])?next:previous;});},500);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(!writeStore({alarms,location,prefs,home,office,customPlaces,plans}))setStatus('浏览器存储不可用，本次修改未保存');},[alarms,location,prefs,home,office,customPlaces,plans]);
 // 外观主题：写到 <html> 上，由 theme.css 的变量层驱动
 useEffect(()=>{
  const root=document.documentElement;
  const theme=THEMES.some(t=>t.id===prefs.theme)?prefs.theme:'forest';
  root.dataset.theme=theme;
  if(prefs.night)root.dataset.night='true';else delete root.dataset.night;
  const color=getComputedStyle(root).getPropertyValue('--app-bg').trim();
  let meta=document.querySelector('meta[name="theme-color"]');
  if(!meta){meta=document.createElement('meta');meta.setAttribute('name','theme-color');document.head.appendChild(meta);}
  if(color)meta.setAttribute('content',color);
 },[prefs.theme,prefs.night]);
 useEffect(()=>{const listener=e=>{if(e.key===STORE){try{const data=JSON.parse(e.newValue);if(Array.isArray(data?.alarms))setAlarms(data.alarms.filter(a=>Number.isFinite(a.at)));}catch{}}};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},[]);
 async function enableSound(){if(!audio.current)audio.current=new (window.AudioContext||window.webkitAudioContext)();await audio.current.resume();if(audio.current.state!=='running')throw new Error('浏览器未允许声音，请点击启用声音');setSoundReady(true);}
// A07：环境音发声节点。试听与正式播放共用一条通道，切换前先停旧的。
 function stopAmbient(){if(ambientRef.current){try{ambientRef.current.stop();}catch{}ambientRef.current=null;}setAmbientPreview(false);}
 function startAmbient(preview=false){
  if(!audio.current||audio.current.state!=='running')return false;
  stopAmbient();
  const code=weather?.weather?.current?.weather_code;
  const node=createAmbient(audio.current,Number(commute.sound.ambientVolume));
  if(!node)return false;
  node.setProfile(Number.isFinite(code)?code:undefined);
  node.start();
  ambientRef.current=node;
  setAmbientPreview(preview);
  return true;
 }
 async function previewAmbient(){try{await enableSound();startAmbient(true);setStatus(`正在试听${ambientProfile(weather?.weather?.current?.weather_code).label}`);}catch(e){setStatus(e.message);}}
 function beep(){const ctx=audio.current;if(!ctx||ctx.state!=='running')return;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=660;gain.gain.setValueAtTime(.001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.16,ctx.currentTime+.03);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.65);}
 async function testRing(){try{await enableSound();beep();setStatus('主铃试听已播放');}catch(e){setStatus(e.message);}}
 function stopRinger(){if(ringerRef.current){ringerRef.current.stop();ringerRef.current=null;}}
 useEffect(()=>{
  if(!ringing.length){stopRinger();return;}
  const ctx=audio.current;
  if(!ctx||ctx.state!=='running')return;
  stopRinger();
  const ringer=createRinger(ctx,getRingtone(prefs.ringtone),Number(prefs.volume)||1);
  ringerRef.current=ringer;
  ringer.start();
  return stopRinger;
 },[ringing.length,prefs.ringtone,prefs.volume]);
// A07 环境音计时：按「主铃前 offset 分钟 → 主铃后 duration 分钟」这段窗口自动起停。
// 主铃已经开始响就交给主铃，不叠加环境音；试听时不参与自动控制。
 useEffect(()=>{
  const sound=commute.sound;
  if(ambientPreview)return;
  if(!sound.ambientEnabled||!next?.enabled||!soundReady){if(ambientRef.current)stopAmbient();return;}
  const win=ambientWindow(next.at,{enabled:!!sound.ambientEnabled,offsetMinutes:Number(sound.ambientOffset),durationMinutes:Number(sound.ambientDuration)});
  const on=shouldSound(now,win,next.state==='ringing');
  if(on&&!ambientRef.current)startAmbient(false);
  if(!on&&ambientRef.current)stopAmbient();
 },[now,next?.at,next?.enabled,next?.state,commute.sound.ambientEnabled,commute.sound.ambientOffset,commute.sound.ambientDuration,commute.sound.ambientVolume,ambientPreview,soundReady,weather?.fetched]);
 // 切换页面或卸载时收掉试听音，避免离开设置页还在响。
 useEffect(()=>{if(ambientPreview)stopAmbient();},[view]);
 useEffect(()=>()=>{if(ambientRef.current)try{ambientRef.current.stop();}catch{}},[]);
 async function audition(id){try{await enableSound();previewRingtone(audio.current,id,Number(prefs.volume)||1);setStatus(`正在试听「${getRingtone(id).name}」`);}catch(e){setStatus(e.message);}}
 async function refreshWeather(){const id=++weatherRequest.current;setWeatherBusy(true);setWeatherError('');try{const r=await api('weather',{location:`${location.lon},${location.lat}`});if(id!==weatherRequest.current)return;if(!Number.isFinite(r.weather?.current?.temperature_2m))throw new Error('天气数据缺失');setWeather(r);}catch(e){if(id===weatherRequest.current)setWeatherError(e.message);}finally{if(id===weatherRequest.current)setWeatherBusy(false);}}
 useEffect(()=>{setWeather(null);setWeatherError('');setProposal(null);refreshWeather();const id=setInterval(refreshWeather,15*60000);return()=>{clearInterval(id);weatherRequest.current++;};},[location.lon,location.lat]);
 // B04：家的逐小时预报单独取。多地点卡片的 brief 只有当日摘要，算不了「出发→抵达」窗口，
 // 而通勤结论必须站在家的天气上，不能拿天气页主位置（可能已被切到外地）顶替。
 useEffect(()=>{
  if(!home||!Number.isFinite(home.lon)||!Number.isFinite(home.lat)){setHomeWeather(null);setHomeWeatherError('');return;}
  let alive=true;
  const load=async()=>{
   try{const r=await api('weather',{location:`${home.lon},${home.lat}`});if(!alive)return;
    // 记下这份预报属于哪个坐标，通勤计算要靠它判断缓存能不能复用。
    setHomeWeather({...r,spotLon:home.lon,spotLat:home.lat});setHomeWeatherError('');}
   catch(e){if(alive)setHomeWeatherError(e.message);}
  };
  setHomeWeather(null);load();
  const id=setInterval(load,15*60000);
  return()=>{alive=false;clearInterval(id);};
 },[home?.lon,home?.lat]);
 useEffect(()=>{function onVisible(){if(document.visibilityState==='visible'){refreshWeather();refreshPlaces();}}document.addEventListener('visibilitychange',onVisible);return()=>document.removeEventListener('visibilitychange',onVisible);},[location.lon,location.lat,placeKey]);
 async function refreshPlaces(){
  const list=placeSlots.filter(s=>Number.isFinite(s.lon)&&Number.isFinite(s.lat));
  if(!list.length)return;
  const id=++placeRequest.current;setPlaceBusy(true);setPlaceError('');
  try{
   const r=await api('places',{locations:list.map(s=>`${s.lon.toFixed(5)},${s.lat.toFixed(5)}`)});
   if(id!==placeRequest.current)return;
   const map={};list.forEach((s,i)=>{const point=r.points?.[i];if(point?.brief)map[s.id]=point.brief;});
   setPlaceWeather(map);
  }catch(e){if(id===placeRequest.current)setPlaceError(e.message);}
  finally{if(id===placeRequest.current)setPlaceBusy(false);}
 }
 useEffect(()=>{refreshPlaces();const id=setInterval(refreshPlaces,15*60000);return()=>{clearInterval(id);placeRequest.current++;};},[placeKey]);
 function addCustomPlace(place){
  const exists=customPlaces.some(p=>p.name===place.name||(Math.abs(p.lon-place.lon)<0.002&&Math.abs(p.lat-place.lat)<0.002));
  if(exists){setStatus(`「${place.name}」已在多地天气里了`);return;}
  if(customPlaces.length>=5){setStatus('最多添加 5 个自定义地点，可先移除一个');return;}
  setCustomPlaces(v=>[...v,{id:`custom-${crypto.randomUUID()}`,name:place.name,lon:place.lon,lat:place.lat}].slice(0,5));
  setStatus(`已添加「${place.name}」，天气马上刷新`);
 }
 function removeCustomPlace(id){setCustomPlaces(v=>v.filter(p=>p.id!==id));setPlaceWeather(v=>{const next={...v};delete next[id];return next;});}
 function openLocEditor(mode='main'){setLocMode(mode);setLocEditor(true);setLocError('');setLocQuery('');setLocResults([]);setCoordInput('');}
 function openPlace(slot){if(slot.missing){setView('commute');setStatus('先在这里设置家或公司的地址，天气会自动出现在这一行');return;}setLocation({lon:slot.lon,lat:slot.lat,name:slot.name,example:false,manual:true});setView('weather');setStatus(`天气主位置已切到「${slot.name}」`);}
 async function locate(){if(!navigator.geolocation){setStatus('浏览器不支持定位，可在高德搜索城市设置天气位置');return;}setLocating(true);navigator.geolocation.getCurrentPosition(async position=>{const {longitude:lon,latitude:lat,accuracy}=position.coords;setLocation({lon,lat,name:'当前位置',example:false,accuracy});setLocating(false);try{const r=await api('location',{location:`${lon},${lat}`});setLocation(old=>old.lon===lon&&old.lat===lat?{...old,name:r.name||'当前位置',gcj:r.location}:old);}catch{setStatus('天气已使用 GPS 坐标；高德地名解析暂不可用。');}},()=>{setLocating(false);setStatus('没有获得当前位置。请允许定位，或到通勤页搜索地点并设为天气位置。');},{timeout:25000,maximumAge:0,enableHighAccuracy:true});}
 function locateCustom(){if(!navigator.geolocation){setLocError('浏览器不支持定位，请直接搜索地址');return;}setLocating(true);navigator.geolocation.getCurrentPosition(async position=>{const {longitude:lon,latitude:lat}=position.coords;let name='我的当前位置';try{const r=await api('location',{location:`${lon},${lat}`});if(r.name)name=r.name;}catch{}setLocating(false);setLocEditor(false);addCustomPlace({name,lon,lat});},()=>{setLocating(false);setLocError('没有获得当前位置，请允许定位或直接搜索地址');},{timeout:25000,maximumAge:0,enableHighAccuracy:true});}
 useEffect(()=>{let current=true;if(navigator.permissions)navigator.permissions.query({name:'geolocation'}).then(p=>{if(current&&p.state==='granted')locate();}).catch(()=>{});return()=>{current=false;};},[]);
// B08：备用交通方式要有自己的耗时。
// 只在「确实配了备用方式 + 已经查过主路线 + 出发时段确认有雨雪」时才查，
// 避免每次打开页面都白花一次高德额度。查过就缓存 15 分钟，与主路线同一口径。
useEffect(()=>{
 const altMode=commute.preferences?.rain?.mode;
 if(!altMode||altMode===commute.transport||!route||!home||!office||commuteWet!==true){return;}
 const key=TRANSPORT_MODE[altMode];
 if(!key||key==='drive'||key==='taxi'){return;} // 自驾/打车沿用驾车耗时，无需单查
 const old=altRoutes[key];
 if(old&&Date.now()-old.fetched<15*60000)return;
 let cancelled=false;
 api('route',{home:home.location,office:office.location,mode:key})
  .then(r=>{if(cancelled)return;const one=r.modes?.[key];if(!one||!Number.isFinite(one.duration))throw new Error(`${altMode}路线未返回有效耗时`);setAltRoutes(v=>({...v,[key]:{...one,fetched:Date.now(),mode:altMode}}));})
  // 查不到不编造：把失败记成一条，界面上会如实显示「备用方式路线未查到」，
  // 由 plan.js 把 routeKnown 标成未知，而不是继续用驾车耗时。
  .catch(e=>{if(cancelled)return;setAltRoutes(v=>({...v,[key]:{error:String(e.message||e),fetched:Date.now(),mode:altMode}}));});
 return()=>{cancelled=true;};
},[commute.preferences?.rain?.mode,commute.transport,route,home?.location,office?.location,commuteWet]);
 useEffect(()=>{if(!prefs.enabled||!risk?.affected||!weather||now-weather.fetched>30*60000)return;const date=new Date(now),[h,m]=prefs.at.split(':').map(Number);if(date.getHours()*60+date.getMinutes()<h*60+m)return;const key=`jishi-notice-${risk.day}`;try{if(localStorage.getItem(key))return;localStorage.setItem(key,'sent');}catch{}const text=`明天${risk.snow?'有降雪风险':'有降雨风险'}，最高降水概率 ${risk.probability}%，出门记得预留时间。`;setNotice({text,day:risk.day});if('Notification'in window&&Notification.permission==='granted'){try{new Notification('吉时已到 · 明日出行提醒',{body:text,tag:key});}catch{}}},[now,prefs,risk?.day,risk?.affected,risk?.probability,weather]);
 async function enableNotice(){setPrefs(p=>({...p,enabled:true}));if('Notification'in window&&Notification.permission==='default')await Notification.requestPermission();setStatus('已开启晚间雨雪提醒。网页需保持打开；未授权系统通知时使用页面内提醒。');}
 async function toggle(a){if(a.enabled){setAlarms(v=>v.map(x=>x.id===a.id?{...x,enabled:false,state:'idle'}:x));return;}try{await enableSound();setAlarms(v=>v.map(x=>x.id===a.id?{...x,enabled:true,state:'armed',at:nextDaily(x.at)}:x));}catch(e){setStatus(e.message);}}
 function dismiss(id,snooze=false){setAlarms(v=>v.map(a=>a.id!==id?a:snooze?{...a,baseAt:a.baseAt||a.at,at:Date.now()+5*60000,state:'armed'}:{...a,enabled:a.repeat==='daily',at:a.repeat==='daily'?nextDaily(a.baseAt||a.at):a.at,state:'idle'}));}
 async function saveAlarm(e){e.preventDefault();try{const at=+new Date(editor.time);if(!Number.isFinite(at)||at<=Date.now())throw new Error('请选择未来的响铃时间');await enableSound();const item={id:editor.id||crypto.randomUUID(),at,label:editor.label.trim()||'我的闹钟',enabled:true,repeat:editor.repeat,state:'armed'};setAlarms(v=>editor.id?v.map(a=>a.id===editor.id?item:a):[...v,item]);setEditor(null);setStatus('闹钟已保存并开启。');
  // A02：如果这次新建是引导第 1 步触发的，保存后把引导接回来，
  // 并直接把新闹钟设成基础闹钟 —— 用户点「新增基础闹钟」的意图就是用它。
  if(guideResume){setCommute(c=>({...c,baseAlarmId:item.id}));setShowGuide(true);setGuideResume(null);setGuideError('');}
 }catch(e){setStatus(e.message);}}
// A02：引导里的「新增基础闹钟」被取消（点 × 关掉）时，引导也要回来，不能停在关闭状态。
function closeEditor(){setEditor(null);if(guideResume){setShowGuide(true);setGuideResume(null);}}
 async function demo(){try{await enableSound();setAlarms(v=>[...v,{id:crypto.randomUUID(),at:Date.now()+10000,label:'10 秒响铃体验',enabled:true,repeat:'once',state:'armed'}]);setStatus('10 秒后响铃，请保持页面打开。');}catch(e){setStatus(e.message);}}
 function newEditor(a){const d=new Date(Date.now()+120000);setEditor(a?{id:a.id,time:localDate(new Date(nextDaily(a.at))),label:a.label,repeat:a.repeat}:{time:localDate(d),label:'我的闹钟',repeat:'once'});}

 async function searchLocation(){const id=++searchRequest.current;setLocBusy(true);setLocResults([]);setLocError('');try{const r=await api('geocode',{address:locQuery});if(id!==searchRequest.current)return;setLocResults(r.candidates);if(!r.candidates.length)setLocError('没有找到这个地方，请补上城市名或换个说法');}catch(e){if(id===searchRequest.current)setLocError(e.message);}finally{if(id===searchRequest.current)setLocBusy(false);}}
 async function pickLocation(place){const c=coordinate(place.location),wgs=gcjToWgs(c.lon,c.lat);if(locMode==='custom'){addCustomPlace({name:place.name,...wgs});}else{setLocation({...wgs,name:place.name,example:false,manual:true});setStatus(`天气位置已切换到 ${place.name}`);}setLocEditor(false);setLocQuery('');setLocResults([]);}
 function applyCoordinate(){try{const p=coordinate(coordInput);if(locMode==='custom'){addCustomPlace({name:`自定义坐标 ${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}`,lon:p.lon,lat:p.lat});}else{setLocation({lon:p.lon,lat:p.lat,name:`自定义坐标 ${p.lon.toFixed(3)}, ${p.lat.toFixed(3)}`,example:false,manual:true});setStatus('已用自定义坐标作为天气位置');}setLocEditor(false);setCoordInput('');}catch(e){setLocError(e.message);}}
 async function quickCity(city){setLocQuery(city);setLocResults([]);setLocError('');const id=++searchRequest.current;setLocBusy(true);try{const r=await api('geocode',{address:city});if(id!==searchRequest.current)return;setLocResults(r.candidates.slice(0,6));if(!r.candidates.length)setLocError('没有找到这个城市');}catch(e){if(id===searchRequest.current)setLocError(e.message);}finally{if(id===searchRequest.current)setLocBusy(false);}}
 async function find(){const id=++searchRequest.current;setSearchBusy(true);setCandidates([]);try{const r=await api('geocode',{address:search});if(id!==searchRequest.current)return;setCandidates(r.candidates);if(!r.candidates.length)setStatus('未找到地址，请补充城市和街道');}catch(e){if(id===searchRequest.current)setStatus(`高德地址查询：${e.message}`);}finally{if(id===searchRequest.current)setSearchBusy(false);}}
 function clearRoute(){routeRequest.current++;setRoute(null);setMapImage('');setMapError('');setRouteError('');setRouteBusy(false);setProposal(null);analysisRequest.current++;setAnalysis('');}
 async function choosePlace(place){if(searchTarget==='weather'){const c=coordinate(place.location),wgs=gcjToWgs(c.lon,c.lat);setLocation({...wgs,name:place.name,example:false});}else{clearRoute();if(searchTarget==='home')setHome(place);else setOffice(place);}setCandidates([]);setStatus('地点已保存');}
 // 把 GPS 定到的当前位置设为家或公司（逆地理解析出地名，失败时用坐标兜底）
 function locateTarget(target){
  if(!navigator.geolocation){setStatus('浏览器不支持定位，请直接搜索地址');return;}
  const label=target==='home'?'家':'公司';
  setLocating(true);setStatus(`正在用 GPS 精确定位，将设为${label}…`);
  const apply=(position,accurate)=>{
   const {longitude:lon,latitude:lat,accuracy}=position.coords;
   const finish=(place)=>{
    clearRoute();
    if(target==='home')setHome(place);else setOffice(place);
    setLocating(false);
    const acc=Number.isFinite(accuracy)?`（精度约 ${Math.round(accuracy)} 米）`:'';
    setStatus(`${label}已设为当前位置：${place.name}${acc}`);
   };
   const fallback={name:`GPS 坐标 ${lon.toFixed(5)}, ${lat.toFixed(5)}`,location:`${lon},${lat}`,level:accurate?'GPS 精确定位':'网络定位'};
   api('location',{location:`${lon},${lat}`}).then(r=>{
    const [glon,glat]=String(r.location||'').split(',').map(Number);
    if(Number.isFinite(glon)&&Number.isFinite(glat))finish({name:r.name||fallback.name,location:`${glon},${glat}`,level:'定位解析',address:r.address||''});
    else finish(fallback);
   }).catch(()=>finish(fallback));
  };
  // 先用 GPS 高精度；若超时/无 GPS 信号，降级为网络定位再试一次。
  navigator.geolocation.getCurrentPosition(
   position=>apply(position,true),
   ()=>{setStatus('GPS 定位未成功，改用网络定位…');
    navigator.geolocation.getCurrentPosition(
     position=>apply(position,false),
     ()=>{setLocating(false);setStatus('没有获得当前位置。请允许定位权限，或直接搜索地址');},
     {timeout:12000,maximumAge:60000,enableHighAccuracy:false});
   },
   {timeout:25000,maximumAge:0,enableHighAccuracy:true});
 }
 async function getRoute(){if(!home||!office){setStatus('请先搜索并确认家与公司的地址');return;}const id=++routeRequest.current;setRouteBusy(true);setRouteError('');setRoute(null);setMapImage('');setMapError('');setProposal(null);setMode('');try{const r=await api('route',{home:home.location,office:office.location});if(id!==routeRequest.current)return;setRoute(r);setMode(TRANSPORT_MODE[commute.transport]||r.mode||'drive');setStatus(`两地约 ${(r.distance/1000).toFixed(1)} 公里 · ${r.reason}`);const path=r.modes?.drive?.steps?.flatMap(s=>(s.polyline||'').split(';')).filter(Boolean);if(path&&path.length)api('map',{home:home.location,office:office.location,path:path.filter((_,i)=>i%Math.max(1,Math.ceil(path.length/100))===0)}).then(m=>{if(id===routeRequest.current)setMapImage(m.image);}).catch(e=>{if(id===routeRequest.current)setMapError(e.message);});}catch(e){if(id===routeRequest.current)setRouteError(e.message);}finally{if(id===routeRequest.current)setRouteBusy(false);}}
 async function computeProposal(){const request=++planRequest.current;setPlanBusy(true);try{if(!route||!home)throw new Error('请先查询高德路线');if(Date.now()-route.fetched>15*60000)throw new Error('路线已过期，请重新查询');if(![preparation,buffer,extra,maxAdvance].every(n=>Number.isInteger(n)&&n>=0&&n<=240))throw new Error('分钟数需为 0 到 240 的整数');const picked=route.modes?.[mode]||route.modes?.drive||Object.values(route.modes||{})[0];if(!picked)throw new Error('该出行方式暂无路线，请换一种');setStatus('正在查询家附近的通勤时段天气…');const c=coordinate(home.location),p=gcjToWgs(c.lon,c.lat);
  // B04：优先复用首页已经取到的「家天气」，坐标相同就不再打第二次接口；
  // 只有首页还没取到时才自己请求一次（例如刚改完家地址就立刻点计算）。
  // 判断这份缓存是不是「家」的天气：按当时记录下来的坐标比对，避免拿别处的预报凑数。
  const sameSpot=homeWeather&&Math.abs((homeWeather.spotLat??NaN)-p.lat)<0.01&&Math.abs((homeWeather.spotLon??NaN)-p.lon)<0.01;
  const w=sameSpot?homeWeather:await api('weather',{location:`${p.lon},${p.lat}`});
  if(request!==planRequest.current)return null;if(new Date().getTimezoneOffset()!==-480)throw new Error('当前 Demo 的通勤计算需使用 UTC+8 时区');  const duration=Math.ceil(picked.duration/60),arrive=+new Date(arrival);// 出发时段天气强度（0~3），决定打车难叫的额外等待
  const dep=new Date(arrive-(duration+buffer)*60000);
  // 与首页核心卡同一个口径：只看出发→抵达窗口内的天气（commuteWeatherWindow）。
  const win=commuteWeatherWindow(w.weather,dep,arrive,Number(prefs.threshold));
  if(!win)throw new Error('出发→抵达时段的预报暂缺，请稍后重试或调整到达时间');
  const depHours=win.hours.map(h=>h.time);
  const depCode=w.weather.hourly.weather_code[w.weather.hourly.time.indexOf(depHours[0])];
  const snowHour=isSnow(depCode);
  const severeHour=isSevere(depCode);
  // B03：等车时间只对「打车」生效，自驾一律为 0。
  // 数值来自用户自己填的 taxiWait，不再按天气自动加 10~30 分钟——那是估算，用户没同意。
  const taxiWait=effectiveTaxiWait(commute);
  const taxiNote=taxiWait>0?`按你设置的打车等车 ${taxiWait} 分钟预留。`:'';
  const decision=assess(w.weather,picked,dep,extra,maxAdvance,Number(commute.threshold??prefs.threshold));
  // B02：这里不再自己算「叫醒时间」。assess 只负责把天气原料（概率、现象、雪/强降水）取出来，
  // 时间一律交给 plan.js 的 buildPlan —— 否则首页和方案页又是两套算法。
  decision.advance=win.affected===true?extra:0;
  // 这个字段仅用于「超限提示」的粗判断；真正的判定在 applyPlanWithGuard 里按 plan.status 做。
  decision.approval=false;
  return {...decision,at:null,depart:null,duration,taxiWait,taxiNote,mode,snowHour,severeHour,unknown:win.affected===null,window:{affected:win.affected,wetHours:win.wetHours,probability:win.probability},fetched:Date.now(),source:'高德地图 + 和风天气'};
 }catch(e){setStatus(e.message);return null;}finally{if(request===planRequest.current)setPlanBusy(false);}}
 async function buildPlan(){const result=await computeProposal();if(result){analysisRequest.current++;setAnalysis('');setProposal(result);setStatus('方案已生成，点击千问分析可查看出行建议；应用后才会创建闹钟。');}}
 // B02：快捷创建不再自己算时间，也不再先删后加。
 // 以前这里完全不检查提前上限，用户点一下就能绕过 maxAdvance；现在走同一个守卫。
 async function smartWake(){
  if(!route||!home){setView('commute');setStatus('请先搜索家与公司地址并查询高德路线，才能按真实通勤计算明早叫醒时间');return;}
  const result=await computeProposal();
  if(!result)return;
  setProposal(result);
  // 等 React 用新 proposal 重算出 plan 再写入，保证写进去的就是界面显示的那一份。
  const next=proposalToPlan(result);
  const ok=await applyPlanWithGuard(next,'主要提前唤醒');
  if(ok)setView('alarm');
 }
 async function analyze(){const id=++analysisRequest.current;setAiBusy(true);setAnalysis('');try{
  let tomorrowData=null;
  if(tomorrowForecast){
    const picks=tomorrowForecast.hours.filter(h=>{const hour=+h.time.slice(11,13);return hour%3===0||(hour>=6&&hour<=9)||hour===18||hour===19;});
    tomorrowData={日期:tomorrowForecast.day,总体天气:tomorrowForecast.hours.find(h=>h.text)?.text||'',
      最低气温:tomorrowForecast.min,最高气温:tomorrowForecast.max,最高降水概率:tomorrowForecast.probability,
      有无降水:tomorrowForecast.affected?'有':'无',是否降雪:tomorrowForecast.snow?'是':'否',
      降水时段:tomorrowForecast.wetHours.length?tomorrowForecast.wetHours.join('、'):'无',
      逐小时:picks.map(h=>`${h.time.slice(11,16)} ${h.text||weatherName(h.code)} ${Number.isFinite(h.temperature)?Math.round(h.temperature)+'℃':'?'} 降水${Math.round(h.probability)}%`)};
  }
  // B10：把已经算好的确定性结论交给千问，让它解释，而不是自己再推一遍时间。
  // 模板文案是兜底的（千问失败也有话说），advice 是可选修饰，两者不能互相污染。
  const planFacts=plan&&plan.status!==PLAN_STATUS.UNAVAILABLE?{
    结论:plan.statusText,
    基础闹钟:Number.isFinite(plan.baseAlarmAt)?new Date(plan.baseAlarmAt).toLocaleString('zh-CN'):null,
    主要提前唤醒:Number.isFinite(plan.wakeAt)?new Date(plan.wakeAt).toLocaleString('zh-CN'):null,
    出发时间:Number.isFinite(plan.departAt)?new Date(plan.departAt).toLocaleString('zh-CN'):null,
    提前分钟:plan.candidates?.[plan.mode]?.advance??null,
    还差分钟:plan.gapMinutes>0?plan.gapMinutes:null,
    判断理由:plan.reasonText||plan.reason,
    耗时来源:plan.routeNote||null,
    雨雪备用:plan.fallback||null,
  }:null;
  const summary=proposal?{...proposal,wakeTime:new Date(proposal.at).toLocaleString('zh-CN'),forecast:weatherName(proposal.code),distanceKm:activeMode?.distance!=null?activeMode.distance/1000:null,mode,execution:'尚未创建闹钟',已算出的结论:planFacts}:{
    来源:'和风天气',地点:location.name,
    当前:weather?.weather.current?{时间:weather.weather.current.time,温度:weather.weather.current.temperature_2m,天气:weather.weather.current.text}:null,
    明日:tomorrowData,
    今晚雨雪提醒:risk?{达到阈值会提醒:risk.affected,最高降水概率:risk.probability,降水时段:risk.hours.join('、')||'无'}:null,
    通勤路线:plan?.routeNote||'未提供路线，不可编造通勤耗时',
    已算出的结论:planFacts,
    执行:'仅做分析与建议，未创建或修改任何闹钟'};
  if(!weather&&!proposal)throw new Error('请先获取天气或通勤方案');
  if(!proposal&&!tomorrowData)throw new Error('明日预报暂缺，请稍候重试');
  const r=await api('explain',{summary});if(id===analysisRequest.current)setAnalysis(r.text);
 }catch(e){if(id===analysisRequest.current)setAnalysis(`分析暂不可用：${e.message}`);}finally{if(id===analysisRequest.current)setAiBusy(false);}}
 // B07：以前这里直接 push，点两次就有两个主要提前唤醒。现在统一走 commitPlan。
 // B02：写入的必须是首页/方案页显示的那份 plan，不能再拿 proposal 重算一遍。
 async function applyPlan(){
  if(!plan){setStatus('还没有可用的唤醒方案');return;}
  if(Date.now()-plan.updatedAt>15*60000){setStatus('方案过期，请重新计算');return;}
  const ok=await applyPlanWithGuard(plan,'主要提前唤醒');
  if(ok){setView('alarm');setProposal(null);}
 }
 // A04：把合并后的候选写成「主要提前唤醒」。复用同一个 planKind='primary' 的闹钟，不重复新增；
 // 基础闹钟原样保留，提前唤醒只负责更早那一次。
 // B07：唯一的写入入口。以前 smartWake 是「先删后加」、applyPlan 是直接 push，
 // 点两次就会出现两个主要提前唤醒。现在统一按 planKind==='primary' 找已有闹钟：有就更新，没有才新增。
 function commitPlan(source){
  if(!source||source.wakeAt==null){setStatus('还没有可用的唤醒方案');return false;}
  const primary=alarms.find(a=>a.planKind==='primary');
  const item={id:primary?.id||crypto.randomUUID(),at:source.wakeAt,label:'主要提前唤醒',enabled:true,repeat:'once',state:'armed',
   planKind:'primary',mode:source.mode,gapMinutes:source.gapMinutes,reason:source.reason,reasonText:source.reasonText,
   departAt:source.departAt,updatedAt:Date.now(),validUntil:source.validUntil,dataVersion:source.dataVersion};
  setAlarms(v=>primary?v.map(a=>a.id===primary.id?item:a):[...v,item]);
  return true;
 }
 // B02：上限收敛。任何一个入口都不允许绕过 maxAdvance：
 // capped 必须先确认，unavailable / 数据缺失一律不创建。
 async function applyPlanWithGuard(source,label='主要提前唤醒'){
  if(!source||source.wakeAt==null){setStatus(`没有可用的${label}时间`);return false;}
  if(source.status===PLAN_STATUS.WEATHER_UNKNOWN||source.status===PLAN_STATUS.ROUTE_FAILED||source.status===PLAN_STATUS.UNAVAILABLE){
   setStatus(`${source.statusText||'数据不足'}，本次不创建${label}，基础闹钟保持不变。`);
   return false;
  }
  if(source.status===PLAN_STATUS.CAPPED||source.gapMinutes>0){
   const ok=typeof window!=='undefined'&&window.confirm
    ?window.confirm(`需要的提前量超过你设置的上限，仍缺 ${source.gapMinutes} 分钟，不能保证准时。仍要保存这个${label}吗？`)
    :false;
   if(!ok){setStatus('已取消。没有创建任何闹钟，基础闹钟保持不变。');return false;}
  }
  try{await enableSound();}catch(e){setStatus(e.message);return false;}
  if(!commitPlan(source))return false;
  setStatus(source.gapMinutes>0
   ?`已保存${label}；仍缺少 ${source.gapMinutes} 分钟，可能赶不上目标时间。`
   :`已保存${label}；基础闹钟原样保留，设备与服务器尚未同步。`);
  return true;
 }
 // 兼容旧入口：把 computeProposal 的结果喂给同一个 buildCanonicalPlan。
// B02：以前这里自己拼 buildPlan 参数，和首页那份容易走岔；现在只覆盖「方案页已经查到的原料」。
 function proposalToPlan(result){
  if(!result)return null;
  return buildCanonicalPlan({
   durationMinutes:Number.isFinite(result.duration)?result.duration:null,
   weatherKnown:true,
   routeKnown:true,
   wet:'wet' in result?result.wet:(result.unknown?null:!!result.advance),
   probability:Number.isFinite(result.probability)?result.probability:null,
   snow:!!result.snowHour,
   severe:!!result.severeHour,
   durationSource:'amap',
  });
 }
 function applyComputedPlan(){applyPlanWithGuard(plan,'主要提前唤醒').then(ok=>{if(ok){ /* 保持停留，便于核对 */ }}); }
// A03：设置改动即时持久化；未通过校验的草稿不覆盖上一份有效设置。
// 只要用户动过一次（commuteTouched），就按「最后一次有效值」落盘，
// 不再因为「基础闹钟暂时没选好」把整份设置判为无效而丢弃。
useEffect(()=>{
 const base=alarms.find(a=>a.id===commute.baseAlarmId&&a.enabled);
 const baseAt=base?.at;
 // 参数本身写错 → 绝不落盘（避免把坏值存成「上次的有效值」）；
 // 参数没问题、只是暂时没有有效基础闹钟 → 照存，只把 guideComplete 记为 false。
 if(validateCommuteShape(commute))return;
 const timedValid=Number.isFinite(baseAt)&&baseAt>Date.now()&&!validateCommute(commute,baseAt);
 writeStore({commute,guideComplete:timedValid&&guideDone});
},[commute,alarms,guideDone]);
// A02：引导里的「下一步」按步校验，与分支实现一致。
function guideNext(){
 const error=(guideStep===0&&!alarms.some(a=>a.id===commute.baseAlarmId&&a.enabled))
  ?(()=>{const first=alarms.find(a=>a.enabled&&a.planKind!=='primary');if(first){setCommute(c=>({...c,baseAlarmId:first.id}));return '';}return '请先新增基础闹钟，或选择并启用一个预设闹钟。';})()
  :(guideStep===1&&!commute.fixedEnabled&&!commute.smartEnabled?'请至少开启固定或智能模式。':'');
 if(error){setGuideError(error);return;}
 setGuideError('');setGuideStep(s=>s+1);
}
function finishGuide(){
 const base=alarms.find(a=>a.id===commute.baseAlarmId&&a.enabled);
 const error=validateCommute(commute,base?.at);
 if(error){setGuideError(error);return;}
 setGuideError('');setGuideDone(true);setShowGuide(false);setView('alarm');
 setStatus('设置已保存在此浏览器。请在通勤页计算并应用方案；关闭网页后尚不能保证响铃。');
}
function closeGuide(kind){
 if(kind==='step'){setGuideError('');setGuideStep(0);setShowGuide(false);return;}
 setShowGuide(false);setGuideStep(0);setGuideError('');
 setStatus('随时可以从设置页的「固定与智能模式」重新打开引导。');
}

 const current=weather?.weather.current;
 const mapLink=home&&office?`https://uri.amap.com/navigation?${new URLSearchParams({from:`${home.location},家`,to:`${office.location},公司`,mode:'car',coordinate:'gaode',src:'jishi-demo',callnative:'0'})}`:null;
 return <div className="studio">
  <header className="studio-top"><a href="#" className="logo" onClick={e=>{e.preventDefault();setView('alarm');}}><Glyph name="clock"/><span>吉时已到<small>RIGHT ON TIME</small></span></a><span className="top-date">{new Date(now).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</span><button className="icon-btn" aria-label="打开设置" onClick={()=>setView('settings')}><Glyph name="settings"/></button></header>
  <main className="studio-main">
   <section className="local-weather"><div><button className="location-name" onClick={()=>openLocEditor('main')}><Glyph name="pin"/>{locating?'正在定位…':location.name}<span>⌄</span></button><small>{location.example?'示例地点 · 点击授权定位':'所在地区天气'} · 每 15 分钟自动更新</small></div><div className="weather-reading"><WeatherSymbol code={current?.weather_code}/><strong>{current?Math.round(current.temperature_2m):'—'}<sup>°</sup></strong><span>{current?.text|| (current?weatherName(current.weather_code):weatherBusy?'获取天气中':'天气未获取')}<small>和风天气 · {weather?new Date(weather.fetched).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'等待更新'}</small></span><button className="icon-btn" aria-label="刷新当地天气" onClick={refreshWeather} disabled={weatherBusy}><Glyph name="refresh"/></button></div></section>
   {weatherError&&<p className="inline-error">天气更新失败：{weatherError} {weather?'（保留上次数据）':''}</p>}
   {notice&&<div className="notice-banner" role="alert"><Glyph name="bell"/><span>{notice.text}</span>{notice.tag&&notice.tag.startsWith('plan-')&&(()=>{const plan=plans.find(p=>`plan-${p.id}`===notice.tag);if(!plan)return null;const link=planAmapLink(plan);return <><button className="notice-action" onClick={()=>snoozePlan(plan.id)}>延后 30 分钟</button>{link?<a className="notice-action amap" href={link} target="_blank" rel="noreferrer">高德实时路况 <Glyph name="arrow"/></a>:null}</>;})()}<button onClick={()=>setNotice(null)} aria-label="关闭提醒">×</button></div>}
   {view==='alarm'&&<>
    <div className="welcome"><span className="overline">MAKE ROOM FOR A GOOD MORNING</span><h1>把早晨，<br/><em>留给从容。</em></h1><p>{commuteWindow?(commuteWet===true?'预计出发时段有雨雪，闹钟会自动提前，你只管睡。':commuteWet===null?'出发时段有小时的天气拿不到，这次不做提前判断，出发前记得再看一眼。':'预计出发时段无明显雨雪，按计划出发就好。'):'设好家、公司和到达时间，明早的安排交给吉时。'}</p></div>
    <CoreCard forecast={tomorrowForecast} window={commuteWindow} advance={smartAdvance} smartAlarm={smartAlarm} busy={planBusy} extra={extraNow} maxAdvance={Number(commute.maxAdvance??maxAdvance)} threshold={Number(commute.threshold??prefs.threshold)} fallback={plan.fallback} transport={commute.transport} spot={commuteSpot?{...commuteSpot,actual:commuteWeatherSource,fallback:commuteWeatherFallback}:null} onWake={smartWake} onCancel={()=>setAlarms(v=>v.filter(a=>a.id!==smartAlarm?.id))}/>
    <GapNotice plan={plan}/>
    <NextPlanCard plan={planWithState} baseAlarm={baseAlarm} onApply={applyComputedPlan} applyDisabled={plan.status===PLAN_STATUS.WEATHER_UNKNOWN||plan.status===PLAN_STATUS.ROUTE_FAILED}/>
    <ForecastCard forecast={tomorrowForecast} threshold={Number(prefs.threshold)} onOpen={()=>setView('weather')}/>
    <div className="focus-grid">
     <section className={`clock-stage glass ${ringing.length?'ringing':''}`}><div className="stage-heading"><span className="capsule"><i/>{ringing.length?'正在响铃':active.length?'下一次唤醒':'我的唤醒时间'}</span><button className="icon-btn" aria-label="添加闹钟" onClick={()=>newEditor()}><Glyph name="plus"/></button></div><div className="clock-face"><svg viewBox="0 0 400 350" aria-hidden="true"><defs><linearGradient id="ring"><stop stopColor="#daf6a0"/><stop offset="1" stopColor="#a6cc73"/></linearGradient></defs><path d="M 82 285 A 154 154 0 1 1 318 285" fill="none" stroke="#ffffff10" strokeWidth="23" strokeLinecap="round"/><path d="M 82 285 A 154 154 0 1 1 345 230" fill="none" stroke="url(#ring)" strokeWidth="23" strokeLinecap="round"/><g>{Array.from({length:49},(_,i)=>{const a=(140+i*6.15)*Math.PI/180;return <line key={i} x1={200+Math.cos(a)*127} y1={183+Math.sin(a)*127} x2={200+Math.cos(a)*(i%6===0?115:122)} y2={183+Math.sin(a)*(i%6===0?115:122)} stroke="#ffffff" opacity={i%6===0?.55:.2}/>;})}</g></svg><div className="clock-content"><span className="overline">{next?.enabled?'WAKE UP AT':'YOUR NEXT MORNING'}</span><div className="giant-time">{next?fmt(next.at):'—:—'}</div><span>{next?.enabled?new Date(next.at).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'}):'尚未开启 · 选择下方闹钟'}</span><button className="face-button" aria-label="编辑主闹钟" onClick={()=>newEditor(next)}><Glyph name="clock"/></button></div></div><div className="stage-footer"><span>{active.length?`${active.length} 个闹钟已开启`:'以自己的节奏，准时到达。'}</span><button onClick={demo} className="demo-button"><Glyph name="play"/>10 秒体验</button></div></section>
     <div className="insight-stack"><section className="tomorrow-card glass"><div className="card-heading"><span className="capsule"><Glyph name="bell"/>前一晚提醒</span><span className="subtle">NIGHT BEFORE</span></div><h2>{risk?.affected?'今晚先告诉你一声。':'今晚无需担心。'}</h2><p>{risk?`每天 ${prefs.at} 检查次日预报，达到 ${prefs.threshold}% 或有雨雪时提醒一次。`:'天气获取后，每晚自动检查次日雨雪风险。'}</p><button className={prefs.enabled?'soft-button':'lime-button'} onClick={()=>prefs.enabled?setView('settings'):enableNotice()}><Glyph name="bell"/>{prefs.enabled?`今晚 ${prefs.at} 提醒已开启`:'开启前一晚雨雪提醒'}<Glyph name="arrow"/></button><small className="fine-print">需保持网页打开；可授权浏览器通知</small></section><section className="qwen-card"><div className="card-heading"><span className="overline">QWEN INTELLIGENCE</span><Glyph name="spark"/></div><h3>让信息，变成安排。</h3><p>千问分析天气风险、准备事项与通勤方案，叫醒时间由程序计算。</p><button className="text-link" onClick={()=>{setView('agent');if(weather)analyze();}}>看看千问怎么说 <Glyph name="arrow"/></button></section></div>
    </div>
    <section className="alarm-section"><div className="section-title"><h2>你的闹钟 <span>{String(alarms.length).padStart(2,'0')}</span></h2><button className="text-link" onClick={()=>newEditor()}><Glyph name="plus"/>添加闹钟</button></div><div className="alarm-strip">{alarms.map(a=><article key={a.id} className={`mini-alarm ${a.enabled?'enabled':''}`}><div className="card-heading"><button className="alarm-label" onClick={()=>newEditor(a)}>{a.label}</button><button className={`switch ${a.enabled?'on':''}`} role="switch" aria-label={`${a.label}开关`} aria-checked={a.enabled} onClick={()=>toggle(a)}><span/></button></div><button className="mini-time" onClick={()=>newEditor(a)}>{fmt(a.at)}</button><div className="card-heading"><small>{a.state==='ringing'?'正在响铃':a.state==='missed'?'已错过':a.repeat==='daily'?'每天':'仅一次'} · {a.enabled?'已开启':'已关闭'}</small><button className="delete-alarm" aria-label={`删除${a.label}`} onClick={()=>setAlarms(v=>v.filter(x=>x.id!==a.id))}>×</button></div></article>)}</div></section>
    <PlacesStrip slots={placeSlots} data={placeWeather} busy={placeBusy} error={placeError} onAdd={()=>openLocEditor('custom')} onRemove={removeCustomPlace} onOpen={openPlace} onRefresh={refreshPlaces}/>
    <section className="commute-teaser glass"><span className="round-symbol"><Glyph name="route"/></span><div><span className="overline">AMAP · 高德地图</span><h3>{home?.name||'设置家'} <span>→</span> {office?.name||'设置公司'}</h3><p>{route?`${(route.distance/1000).toFixed(1)} 公里 · ${activeMode?.label||'驾车'}约 ${activeMode?Math.ceil(activeMode.duration/60):'—'} 分钟`:'地址搜索、地图预览、真实驾车路线，一次安排。'}</p></div><button className="icon-btn lime" aria-label="打开高德通勤地图" onClick={()=>setView('commute')}><Glyph name="arrow"/></button></section>
   </>}
   {view==='weather'&&<>
    <div className="page-intro"><span className="overline">QWEATHER · NEXT 48 HOURS</span><h1>今明两天，<br/>每个小时。</h1><p>和风天气逐小时预报，雨雪时段一眼看全。</p></div>
    <PlacesStrip slots={placeSlots} data={placeWeather} busy={placeBusy} error={placeError} onAdd={()=>openLocEditor('custom')} onRemove={removeCustomPlace} onOpen={openPlace} onRefresh={refreshPlaces}/>
    {dayKeys.length?dayKeys.map((key,i)=>{const summary=daySummary(weather.weather,key,Number(prefs.threshold));return summary?<DayBlock key={key} summary={summary} label={['今天','明天','后天'][i]||key.slice(5).replace('-',' / ')} threshold={Number(prefs.threshold)}/>:null;}):<section className="panel glass"><h2>正在获取逐小时预报…</h2>{weatherError&&<p className="inline-error">天气更新失败：{weatherError}</p>}</section>}
    <section className="panel glass"><h2>天气怎么影响你的闹钟</h2><p>出发时段出现雨雪，或降水概率达到阈值时，叫醒时间会按「雨雪额外准备」自动提前；超过提前上限会先请你确认，不会擅自改动已有闹钟。</p><button className="soft-button" onClick={()=>setView('commute')}>去设置通勤与提前规则 <Glyph name="arrow"/></button></section>
   </>}
   {view==='commute'&&<>
    <div className="page-intro"><span className="overline">AMAP / YOUR DAILY JOURNEY</span><h1>从家，到公司。</h1><p>高德地图提供地点搜索、路线、地图预览和导航入口。</p></div>
    <section className="panel glass plans-panel"><div className="section-title"><h2>出行计划 <span>{String(plans.length).padStart(2,'0')}</span></h2><button className="text-link" onClick={()=>openPlanEditor()}><Glyph name="plus"/>添加计划</button></div>
     <p>不止早晨：任何时段的出行都能提前提醒。到点会弹提醒并附出发时段天气，一键查看高德实时路况。</p>
     <div className="plan-list">
      {upcomingPlans.length?upcomingPlans.map(p=>{const link=planAmapLink(p);return <article key={p.id} className="plan-row">
       <div className="plan-info"><small>{new Date(p.at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',weekday:'short'})} · 提前 {p.remind||0} 分钟提醒</small><strong>{p.label}</strong><span className="plan-when">{fmt(p.at)} 出发{p.place?` · ${p.place.name}`:''}</span></div>
       <div className="plan-actions">{link&&<a href={link} target="_blank" rel="noreferrer" className="text-link">高德路况</a>}<button className="text-link" onClick={()=>openPlanEditor(p)}>编辑</button><button className="delete-alarm" aria-label={`删除${p.label}`} onClick={()=>removePlan(p.id)}>×</button></div>
      </article>;}):<p className="fine-print">还没有计划。比如「14:00 去机场」「19:30 接孩子」，加进来就会到点提醒。</p>}
     </div>
    </section>
    <div className="journey-grid"><section className="panel glass"><div className="section-title"><h2>确认通勤地点</h2><span className="provider-pill">高德地图</span></div><div className="place-row"><span className="point-a">A</span><div><small>家</small><strong>{home?.name||'还未设置'}</strong>{home?.address&&<span className="place-addr">{home.address}</span>}</div><button className="text-link" onClick={()=>setSearchTarget('home')}>设置</button><button className="text-link locate-link" onClick={()=>locateTarget('home')}><Glyph name="pin"/>{locating?'定位中…':'定位'}</button></div><div className="place-row"><span className="point-b">B</span><div><small>公司</small><strong>{office?.name||'还未设置'}</strong>{office?.address&&<span className="place-addr">{office.address}</span>}</div><button className="text-link" onClick={()=>setSearchTarget('office')}>设置</button><button className="text-link locate-link" onClick={()=>locateTarget('office')}><Glyph name="pin"/>{locating?'定位中…':'定位'}</button></div><label>搜索并设为<select value={searchTarget} onChange={e=>setSearchTarget(e.target.value)}><option value="home">家</option><option value="office">公司</option><option value="weather">天气所在地区</option></select></label><form onSubmit={e=>{e.preventDefault();find();}} className="search-box"><input required minLength={4} aria-label="高德地址搜索" placeholder="城市、街道、园区或地标" value={search} onChange={e=>{setSearch(e.target.value);searchRequest.current++;setCandidates([]);}}/><button disabled={searchBusy} aria-label="搜索高德地址"><Glyph name="search"/></button></form>{candidates.map((p,i)=><button className="search-result" key={i} onClick={()=>choosePlace(p)}><Glyph name="pin"/><span>{p.name}<small>{p.level}</small></span><Glyph name="plus"/></button>)}<button className="lime-button" onClick={getRoute} disabled={routeBusy||!home||!office}>{routeBusy?'高德正在规划路线…':'查询高德驾车路线'}<Glyph name="arrow"/></button>{routeError&&<p className="inline-error">{routeError}</p>}</section>
     <section className="map-panel glass"><div className="map-display">{mapImage?<img src={mapImage} alt="高德地图上的家到公司路线"/>:activeMode?<RouteSketch route={activeMode}/>:<div className="map-empty"><Glyph name="route"/><h3>你的每天，值得一条好路线。</h3><p>确认起终点后，这里显示高德地图与路线。</p></div>}<span className="map-credit">高德地图 AMAP</span></div>{mapError&&<p className="fine-print">{mapError}。当前展示路线示意，非地图底图。</p>}<div className="map-details"><div><strong>{route?(route.distance/1000).toFixed(1):'—'}<small>km</small></strong><span>两地距离</span></div><div><strong>{activeMode?Math.ceil(activeMode.duration/60):'—'}<small>min</small></strong><span>{activeMode?.label||'驾车'}参考耗时</span></div>{mapLink&&<a href={mapLink} target="_blank" rel="noreferrer" className="soft-button">打开高德导航 <Glyph name="arrow"/></a>}</div><p className="fine-print">实时查询不等于未来路况预测。地图图片需高德静态地图权限。</p>{route&&<details className="route-steps"><summary>查看高德分段路线</summary>{(route.modes?.drive?.steps||[]).map((s,i)=><p key={i}>{i+1}. {s.instruction||s.road||'沿当前道路行驶'} {s.traffic.filter(Boolean).join(' / ')}</p>)}</details>}</section></div>
    {route&&route.modes&&<section className="panel glass mode-panel"><div className="section-title"><h2>出行方式</h2><span className="provider-pill">高德地图</span></div>
     <p>两地约 <strong>{(route.distance/1000).toFixed(1)} 公里</strong> · 默认建议：<strong>{route.modes?.[route.mode]?.label||activeMode?.label}</strong>（{route.reason}）。你可以改成任意方式。</p>
     <div className="mode-grid">{Object.entries(route.modes).map(([key,m])=><button key={key} className={`mode-card${mode===key?' on':''}`} onClick={()=>{setMode(key);setProposal(null);setStatus(`已选择${m.label}，约 ${Math.ceil(m.duration/60)} 分钟`);}}><span className="mode-name">{m.label}</span><span className="mode-time">{Math.ceil(m.duration/60)}<small>min</small></span><small>{(m.distance/1000).toFixed(1)} km{mode===key?' · 当前':''}</small></button>)}</div>
     <p className="fine-print">{mode==='taxi'
      ? `打车：仅按你设置的等车时间预留（当前 ${effectiveTaxiWait(commute)} 分钟），不再按天气自动加时。可在设置页「固定与智能模式」里调整。`
      : mode==='drive'
        ? '自驾：不预留等车时间，只按路线耗时与到达余量计算。'
        : '步行、骑行、公交与地铁在雨雪天同样会按降水概率提前，但不等同于打车等车时间。'}</p>
    </section>}
    <section className="panel glass"><div className="section-title"><h2>让明早的闹钟，更有依据。</h2><span className="overline">PLAN YOUR MORNING</span></div><div className="settings-grid"><label>到公司日期与时间<input type="datetime-local" value={arrival} onChange={e=>{setArrival(e.target.value);setProposal(null);}}/></label>{[['起床准备',preparation,setPreparation],['到达余量',buffer,setBuffer],['雨雪额外准备',Number.isFinite(commute.extra)?commute.extra:extra,(v)=>setCommute(c=>withExtra(c,v))],['提前上限',maxAdvance,setMaxAdvance]].map(([name,v,set])=><label key={name}>{name} / 分钟<input type="number" min="0" max="240" value={v} onChange={e=>{set(e.target.value===''?'':Number(e.target.value));setExtra(e.target.value===''?'':Number(e.target.value));setProposal(null);}}/></label>)}</div><p className="fine-print">「雨雪额外准备」与设置页的雨雪备用方式是同一项设置，改动会同步。</p><button className="lime-button" disabled={!route} onClick={buildPlan}>结合家附近天气，计算叫醒方案<Glyph name="spark"/></button></section>
    {proposal&&planView&&<section className="plan-result panel"><span className="overline">YOUR MORNING, REARRANGED.</span><h2>{planView.wakeText} <small>叫醒</small> <span>→</span> {planView.departText} <small>出发</small></h2><p>{proposal.time} · {weatherName(proposal.code)} · 降水概率 {Number.isFinite(proposal.probability)?`${proposal.probability}%`:'未知'}。{planView.transport?`已改乘${planView.transport}`:(activeMode?.label||'所选方式')}约 {(()=>{const m=plan?.reasonDetail?.route?.durationMinutes;return Number.isFinite(m)?m:proposal.duration;})()} 分钟，额外准备 {planView.advance} 分钟{proposal.window?.wetHours?.length?`（时段降水：${proposal.window.wetHours.slice(0,4).join('、')}）`:''}。</p>{planView.alternateNote&&<p className="taxi-note">{planView.alternateNote}</p>}{planView.routeNote&&<p className="taxi-note">{planView.routeNote}</p>}{proposal.unknown&&<p className="taxi-note">该时段概率数据缺失，本次未按天气提前，也未判定为不下雨。</p>}{planView.taxiNote&&<p className="taxi-note">{planView.taxiNote}</p>}{planView.sameAsHome&&<p className="taxi-note">与首页「下一次安排」使用同一份计算结果。</p>}<div className="button-line"><button className="dark-button" onClick={analyze} disabled={aiBusy}>{aiBusy?'千问分析中…':'千问分析方案'}</button><button className="dark-button" onClick={applyPlan}>{planView.needsConfirm?'确认超限提前并创建闹钟':'新增通勤闹钟'}</button></div>{planView.needsConfirm&&<small>超过你设置的提前上限，需要本次确认。</small>}{analysis&&<p className="analysis-output">{analysis}</p>}</section>}
   </>}
   {view==='agent'&&<><div className="page-intro"><span className="overline">QWEN / PERSONAL MORNING ASSISTANT</span><h1>信息有了，<br/>下一步呢？</h1><p>千问根据真实天气与路线结果，给你一份可执行的早晨建议。</p></div><section className="agent-workspace glass panel"><div className="agent-emblem"><Glyph name="spark"/></div><h2>你的出行分析助手</h2><div className="context-pills"><span>当前天气 {current?weatherName(current.weather_code):'未获取'}</span><span>明日降水 {risk?risk.probability+'%':'待获取'}</span><span>通勤方案 {proposal?'已生成':'未提供'}</span></div><button className="lime-button" onClick={analyze} disabled={aiBusy||(!weather&&!proposal)}>{aiBusy?'千问正在分析…':'分析天气与明日出行'}<Glyph name="arrow"/></button>{plan?.reasonText&&<p className="fine-print">已确定的结论：{plan.reasonText}</p>}{analysis?<div className="analysis-output">{analysis}</div>:<p className="fine-print">分析不会擅自创建或修改闹钟，也不会把当前路况当作明早的预测。</p>}</section></>}
   {view==='settings'&&<><div className="page-intro"><span className="overline">SET YOUR OWN RHYTHM</span><h1>按你的节奏来。</h1></div><div className="journey-grid"><section className="panel glass"><h2>前一晚雨雪提醒</h2><p>每天到设定时间，检查所在地区次日预报。有雨雪或达到概率阈值时，发送一次提醒。</p><label>提醒时间<input type="time" value={prefs.at} onChange={e=>setPrefs(p=>({...p,at:e.target.value||'20:00'}))}/></label><label>降水概率阈值 / %<input type="number" min="1" max="100" value={prefs.threshold} onChange={e=>setPrefs(p=>({...p,threshold:Math.min(100,Math.max(1,Number(e.target.value)||1))}))}/></label><button className={prefs.enabled?'soft-button':'lime-button'} onClick={()=>prefs.enabled?setPrefs(p=>({...p,enabled:false})):enableNotice()}>{prefs.enabled?'关闭雨雪提醒':'开启雨雪提醒'}</button><p className="fine-print">页面关闭后无法通知；浏览器系统通知需要单独授权。再次打开页面可补发当天已到时的提醒。</p><button className="text-link" onClick={()=>setNotice({text:'演示提醒：假设明天降雨概率 80%，建议准备雨具并预留出行时间。（模拟数据，不影响真实天气与闹钟）'})}>预览雨雪提醒样式 <Glyph name="arrow"/></button></section><section className="panel glass"><h2>位置</h2><p>{location.name}{location.example?'（示例，并非当前位置）':''}</p><button className="soft-button" onClick={()=>openLocEditor('main')}><Glyph name="pin"/>修改天气位置（搜索 / 手填坐标）</button><button className="soft-button" onClick={locate}><Glyph name="pin"/>{locating?'定位中…':'使用我现在的位置'}</button><p className="fine-print">定位需要浏览器授权；也可以手动搜索地址或填坐标。</p></section>
<section className="panel glass"><h2>固定与智能模式</h2><p>固定模式只按基础闹钟减固定提前量，不需要路线和天气；智能模式按通勤与天气计算。两者同时开启时取更早的那个，但只会生成一个提前唤醒。</p>
<button className="text-link" onClick={()=>{setGuideStep(0);setGuideError('');setShowGuide(true);}}>重新打开四步引导 <Glyph name="arrow"/></button>
<label className="check-line"><input type="checkbox" checked={!!commute.fixedEnabled} onChange={e=>setCommute(c=>({...c,fixedEnabled:e.target.checked}))}/>开启固定提前</label>
<label className="check-line"><input type="checkbox" checked={!!commute.smartEnabled} onChange={e=>setCommute(c=>({...c,smartEnabled:e.target.checked}))}/>开启智能通勤</label>
{commute.fixedEnabled&&<label>固定提前量 / 分钟<input type="number" min="0" max="240" value={commute.fixedMinutes} onChange={e=>setCommute(c=>({...c,fixedMinutes:e.target.value===''?'':Number(e.target.value)}))}/></label>}
{commute.smartEnabled&&<label>智能提前上限 / 分钟<input type="number" min="0" max="240" value={commute.maxAdvance} onChange={e=>setCommute(c=>({...c,maxAdvance:e.target.value===''?'':Number(e.target.value)}))}/></label>}
{!commute.fixedEnabled&&!commute.smartEnabled&&<p className="inline-error">至少开启一种模式，否则不会生成提前唤醒。</p>}
{commute.smartEnabled&&!commute.fixedEnabled&&<p className="fine-print">只开智能模式时，如果天气或路线拿不到，会明确显示不可用，不会假装已经提前。</p>}
<div className="settings-grid">
<label>交通方式<select value={commute.transport} onChange={e=>setCommute(c=>({...c,transport:e.target.value}))}>{TRANSPORTS.map(t=><option key={t}>{t}</option>)}</select></label>
<label>打车等车 / 分钟<input type="number" min="0" max="240" disabled={commute.transport!=='打车'} value={commute.taxiWait} onChange={e=>setCommute(c=>({...c,taxiWait:e.target.value===''?'':Number(e.target.value)}))}/></label>
</div>
<p className="fine-print">{commute.transport==='打车'?'等车时间只对打车生效，由你填写，程序不会按天气猜。':'当前不是打车，等车时间不生效，自驾一律不加等车时间。'}</p>
</section>
<WeatherFallbackSettings commute={commute} onChange={setCommute}/>
<section className="panel glass"><h2>天气</h2><p>通勤结论只看「出发 → 抵达」时段内的天气，不看全天预报。天气缺失时不会按晴天处理。</p>
<label>降水概率阈值 / %<input type="number" min="1" max="100" value={commute.threshold} onChange={e=>setCommute(c=>({...c,threshold:Math.min(100,Math.max(1,Number(e.target.value)||1))}))}/></label>
<p className="fine-print">阈值只有这一个来源，首页核心卡、通勤方案和雨雪提醒三处都用它。</p>
<label>天气地点<strong>{location.name}{location.example?'（示例位置）':''}</strong></label>
<button className="soft-button" onClick={()=>openLocEditor('main')}><Glyph name="pin"/>修改天气位置</button>
</section>
<RecheckSettings commute={commute} onChange={setCommute} baseAlarmAt={baseAlarm?.at}/>
<AmbientSettings commute={commute} onChange={setCommute} onPreview={previewAmbient} previewing={ambientPreview} onStopPreview={stopAmbient} profileLabel={ambientProfile(weather?.weather?.current?.weather_code).label}/>
<section className="panel glass"><h2>账号提醒</h2><p>账号绑定、云端保存、设备同步与服务器提醒尚未接入。当前状态仅表示设置保存在此浏览器，关闭网页后不能保证准时响铃。</p><div className="service-row"><strong>本地设置<small>已保存在此浏览器</small></strong><span className="capsule">已保存</span></div><div className="service-row"><strong>服务端提醒<small>需要账号与设备同步</small></strong><span className="capsule">尚未接入</span></div></section>
<section className="panel glass"><h2>铃声与音量</h2><p>选一个叫醒你的声音，普通闹钟和雨雪智能闹钟共用。</p>
<div className="ringtone-list">{RINGTONES.map(r=><button key={r.id} className={`ringtone-item${prefs.ringtone===r.id?' selected':''}`} onClick={()=>{setPrefs(p=>({...p,ringtone:r.id}));audition(r.id);}}><span className="ringtone-name">{r.name}<small>{r.desc}</small></span>{prefs.ringtone===r.id?<span className="ringtone-check">当前铃声</span>:<span className="ringtone-play"><Glyph name="play"/>试听</span>}</button>)}</div>
<label>音量 · {Math.round((prefs.volume??1)*100)}%<input type="range" min="0.3" max="1" step="0.05" value={prefs.volume??1} onChange={e=>setPrefs(p=>({...p,volume:Number(e.target.value)}))} onMouseUp={()=>audition(prefs.ringtone)} onTouchEnd={()=>audition(prefs.ringtone)}/></label>
<p className="fine-print">铃声用双振荡器加谐波合成，比旧版单音明显更响；但手机媒体音量和静音模式仍由系统控制，iPhone 网页响铃需页面在前台并先启用声音。</p></section><section className="panel glass theme-panel"><h2>界面外观</h2><p>选择一套你喜欢的界面风格，夜间模式可叠加在任意外观之上，偏好保存在这台设备。</p><div className="theme-options">{THEMES.map(t=><button key={t.id} type="button" className={`theme-option theme-${t.id}${prefs.theme===t.id?' selected':''}`} aria-pressed={prefs.theme===t.id} onClick={()=>setPrefs(p=>({...p,theme:t.id}))}><span className="theme-preview" aria-hidden="true"><i/><i/><i/></span><span><strong>{t.name}</strong><small>{t.desc}</small></span><span className="theme-radio" aria-hidden="true"/></button>)}</div><div className="night-row"><span><strong>夜间模式</strong><small>开启后所有外观切换到深色配色，夜里更护眼也更省电。</small></span><button type="button" className={`switch${prefs.night?' on':''}`} aria-pressed={!!prefs.night} aria-label="切换夜间模式" onClick={()=>setPrefs(p=>({...p,night:!p.night}))}><span/></button></div></section></div><section className="panel glass"><h2>已配置的数据服务</h2>{[['高德地图','地址 / 路线 / 地图预览',providers.amap],['和风天气','当前位置天气 / 逐小时预报',providers.qweather],['通义千问','天气与出行分析',providers.qwen]].map(([name,desc,yes])=><div className="service-row" key={name}><strong>{name}<small>{desc}</small></strong><span className="capsule">{yes?'配置已填写':'待配置'}</span></div>)}<small className="fine-print">配置存在不等于实时认证成功，查询失败会显示原因。</small></section></>}
   <footer className="studio-footer"><span>网页演示 · 保持页面打开与声音可用</span><span>高德地图 · 和风天气 · 通义千问</span></footer>
   {weather&&<div className="data-credit">天气数据 <a href="https://www.qweather.com/" target="_blank" rel="noreferrer">和风天气</a> · {(weather.weather.attributions||[]).map((u,i)=><a key={i} href={/^https:\/\//.test(u)?u:undefined} target="_blank" rel="noreferrer">数据声明 </a>)}</div>}
  </main>
  <nav className="bottom-nav" aria-label="主导航">{[['alarm','clock','闹钟'],['weather','weather','天气'],['commute','route','通勤'],['agent','spark','千问'],['settings','settings','设置']].map(([id,icon,text])=><button key={id} aria-label={text} className={view===id?'selected':''} onClick={()=>setView(id)} aria-current={view===id?'page':undefined}><Glyph name={icon}/><span>{text}</span></button>)}</nav>
  {status&&<div className="toast" role="status"><Glyph name="info"/><span>{status}</span><button onClick={()=>setStatus('')} aria-label="关闭提示">×</button></div>}
  {showGuide&&<SetupGuide commute={commute} setCommute={setCommute} alarms={alarms} home={home} office={office} arrival={arrival} setArrival={setArrival} guideStep={guideStep} setGuideStep={guideStep<3?guideNext:()=>setGuideStep(guideStep+1)} error={guideError} onClose={closeGuide} onFinish={finishGuide} onCreateAlarm={()=>{setShowGuide(false);setGuideResume({step:guideStep});newEditor();}} onEnableAlarm={a=>{toggle(a);setGuideError('');}} onOpenCommute={()=>{setShowGuide(false);setView('commute');}} onTestRing={testRing}/>}
  {ringing.length>0&&<div className="ring-overlay" role="dialog" aria-modal="true" aria-label="闹钟正在响铃"><div className="ring-window"><Glyph name="clock"/><span className="overline">GOOD MORNING</span><h2>{fmt(now)}</h2>{ringing.map(a=><section key={a.id}><h3>{a.label}</h3><div className="button-line"><button className="lime-button" onClick={()=>dismiss(a.id)}>停止响铃</button><button className="soft-button" onClick={()=>dismiss(a.id,true)}>5 分钟后再响</button></div></section>)}</div></div>}
  {locEditor&&<div className="editor-overlay" role="dialog" aria-modal="true" aria-label={locMode==='custom'?'添加对比地点':'修改天气位置'}><form className="editor-window glass" onSubmit={e=>{e.preventDefault();searchLocation();}}>
   <div className="section-title"><h2>{locMode==='custom'?'添加一个地点':'改天气位置'}</h2><button type="button" className="icon-btn" aria-label="关闭位置修改" onClick={()=>setLocEditor(false)}>×</button></div>
   {locMode==='custom'?<p className="loc-current"><Glyph name="pin"/>搜索或填坐标，选中的地点会加到「多地天气」里，不影响主天气位置。<small>最多 5 个自定义地点 · 已添加 {customPlaces.length} 个</small></p>:<p className="loc-current"><Glyph name="pin"/>当前：{location.name}<small>{location.example?'示例位置，建议改成你所在城市':'已保存'} · {location.lon.toFixed(3)}, {location.lat.toFixed(3)}（WGS84）</small></p>}
   <label>搜索城市、区或地址<input required minLength={2} value={locQuery} onChange={e=>{setLocQuery(e.target.value);searchRequest.current++;setLocResults([]);}} placeholder="如：长春宽城区、上海人民广场" aria-label="搜索天气位置"/></label>
   <div className="city-chips">{['北京','上海','广州','深圳','杭州','成都','长春','西安'].map(c=><button type="button" key={c} className="chip" onClick={()=>quickCity(c)}>{c}</button>)}</div>
   <button className="soft-button loc-search">{locBusy?'正在搜索…':locMode==='custom'?'搜索并添加这个地点':'搜索这个位置'}<Glyph name="search"/></button>
   {locResults.map((p,i)=><button type="button" className="search-result" key={i} onClick={()=>pickLocation(p)}><Glyph name="pin"/><span>{p.name}<small>{p.level}</small></span><Glyph name="arrow"/></button>)}
   <label>或者直接填坐标（WGS84：经度,纬度）<input value={coordInput} onChange={e=>setCoordInput(e.target.value)} placeholder="124.82,45.00" inputMode="decimal" aria-label="手动填写坐标"/></label>
   <div className="button-line"><button type="button" className="soft-button" onClick={applyCoordinate}>{locMode==='custom'?'添加这个坐标':'用这个坐标'}</button><button type="button" className="soft-button" onClick={()=>{if(locMode==='custom'){locateCustom();}else{locate();setLocEditor(false);}}}><Glyph name="pin"/>{locating?'定位中…':'用我现在的位置'}</button></div>
   {locError&&<p className="inline-error">{locError}</p>}
   <small className="fine-print">高德返回的是 GCJ-02 坐标，已自动转成 WGS84 再查天气；手动填坐标请填 WGS84，不要直接填高德坐标。</small>
  </form></div>}
  {editor&&<div className="editor-overlay" role="dialog" aria-modal="true" aria-label="设置闹钟"><form className="editor-window glass" onSubmit={saveAlarm}><div className="section-title"><h2>{editor.id?'编辑闹钟':'新的唤醒时间'}</h2><button type="button" className="icon-btn" aria-label="关闭闹钟编辑" onClick={closeEditor}>×</button></div><label>响铃日期与时间<input required type="datetime-local" value={editor.time} onChange={e=>setEditor(v=>({...v,time:e.target.value}))}/></label><label>闹钟名称<input required maxLength={30} value={editor.label} onChange={e=>setEditor(v=>({...v,label:e.target.value}))}/></label><label>重复<select value={editor.repeat} onChange={e=>setEditor(v=>({...v,repeat:e.target.value}))}><option value="once">仅一次</option><option value="daily">每天</option></select></label><button className="lime-button">保存并开启 <Glyph name="arrow"/></button></form></div>}
  {planEditor&&<div className="editor-overlay" role="dialog" aria-modal="true" aria-label={planEditor.id?'编辑出行计划':'添加出行计划'}><form className="editor-window glass" onSubmit={savePlan}>
   <div className="section-title"><h2>{planEditor.id?'编辑出行计划':'添加出行计划'}</h2><button type="button" className="icon-btn" aria-label="关闭计划编辑" onClick={()=>setPlanEditor(null)}>×</button></div>
   <label>计划名称<input required maxLength={30} value={planEditor.label} onChange={e=>setPlanEditor(v=>({...v,label:e.target.value}))} placeholder="如：去机场、接孩子、看牙医"/></label>
   <label>出发时间<input required type="datetime-local" value={planEditor.at} onChange={e=>setPlanEditor(v=>({...v,at:e.target.value}))}/></label>
   <label>提前提醒 / 分钟（0~120）<input type="number" min="0" max="120" value={planEditor.remind} onChange={e=>setPlanEditor(v=>({...v,remind:e.target.value===''?'':Number(e.target.value)}))}/></label>
   <label>目的地（可选，用于一键看路况）<input value={planEditor.placeQuery||''} onChange={e=>setPlanEditor(v=>({...v,placeQuery:e.target.value}))} placeholder="搜地址，如：首都机场 T3" aria-label="搜索计划目的地"/></label>
   <button type="button" className="soft-button" onClick={searchPlanPlace}>搜索目的地 <Glyph name="search"/></button>
   {planEditor.placeResults?.map((p,i)=><button type="button" className="search-result" key={i} onClick={()=>setPlanEditor(v=>({...v,pendingPlace:{name:p.name,location:p.location},placeResults:[],placeQuery:''}))}><Glyph name="pin"/><span>{p.name}<small>{p.level}</small></span><Glyph name="plus"/></button>)}
   {planEditor.pendingPlace&&<p className="loc-current"><Glyph name="pin"/>已选目的地：{planEditor.pendingPlace.name}</p>}
   <small className="fine-print">到点在页面内弹提醒（需保持网页打开），出发时段有雨雪会一并提示；提醒里可一键打开高德实时路况。</small>
   <button className="lime-button">保存计划 <Glyph name="arrow"/></button>
  </form></div>}
 </div>;
}

function PlacesStrip({slots,data,busy,error,onAdd,onRemove,onOpen,onRefresh}){
 return <section className="places-panel glass">
  <div className="card-heading"><span className="capsule"><Glyph name="pin"/>多地天气</span><div className="places-head-tools"><span className="subtle">CURRENT · HOME · OFFICE</span><button className="icon-btn" aria-label="刷新多地天气" onClick={onRefresh} disabled={busy}><Glyph name="refresh"/></button></div></div>
  <div className="places-strip">
   {slots.map(slot=>{const brief=data[slot.id];const wet=brief&&(brief.rain||brief.snow);
    return <article key={slot.id} className={`place-card${slot.custom?' custom':''}${slot.missing?' missing':''}`}>
     <div className="place-card-head"><span className="place-role">{slot.role}</span>{slot.custom&&<button className="place-remove" aria-label={`移除${slot.name}`} onClick={()=>onRemove(slot.id)}>×</button>}</div>
     <button className="place-body" onClick={()=>onOpen(slot)} aria-label={`查看${slot.name}的完整天气`}>
      <span className="place-name">{slot.name}</span>
      <span className="place-temp">{brief&&brief.temperature!=null?Math.round(brief.temperature):'—'}<sup>°</sup><small>{brief?.text||(slot.missing?'待设置':busy?'获取中':'—')}</small></span>
      <span className="place-meta">{brief&&brief.min!=null?`${brief.min}° ~ ${brief.max}°`:'—'}{brief&&brief.probability!=null?` · 降水 ${Math.round(brief.probability)}%`:''}</span>
      {wet&&<span className={`place-flag ${brief.snow?'snow':'rain'}`}>{brief.snow?'有雪':'有雨'}</span>}
     </button>
    </article>;})}
   <button className="place-card add" onClick={onAdd} aria-label="添加自定义天气地点"><Glyph name="plus"/><span>添加地点</span><small>城市 / 地址 / 坐标</small></button>
  </div>
  {error&&<p className="inline-error">多地天气更新失败：{error} {Object.keys(data).length?'（保留上次数据）':''}</p>}
  <small className="fine-print">默认展示当前所在地、通勤里设置的家与公司；点卡片把该地点设为天气页主位置，「添加地点」可搜索任意城市或手填坐标。</small>
 </section>;
}
function CoreCard({forecast,window:win,advance,smartAlarm,busy,extra,maxAdvance,threshold,fallback,transport,spot,onWake,onCancel}){
 // 核心卡只看「出发→抵达窗口」的统一口径：没有完整设置时，不承诺自动提前，只引导继续设置。
 const ready=!!win;
 // affected 三态：true=触发、false=确定不触发、null=概率数据缺失（未知）
 const affected=ready?win.affected:null, unknown=ready&&affected===null, snow=win?.snow;
 const winText=ready?`${win.hours[0].time.slice(11,16)}–${win.hours.at(-1).time.slice(11,16)}`:'';
 const peakText=win?.probability==null?'概率未知':`最高 ${Math.round(win.probability)}%`;
 const headline=!forecast?'正在获取明天的天气…':!ready?'先设好通勤，才告诉你提前多久':unknown?'出发时段天气数据不全，这次不做提前判断':affected?(snow?`出发时段有雪，闹钟自动提前 ${advance} 分钟`:`出发时段有雨，闹钟自动提前 ${advance} 分钟`):'出发时段无明显雨雪，按原计划唤醒';
 const detail=!forecast?'拿到预报后，这里会直接告诉你明早要提前多久。':!ready?'到通勤页确认家、公司、路线与到达时间后，这里只按出发→抵达时段的天气判断，不再被全天降水误导。':unknown?`预计 ${winText} 出行，但该时段有小时的降水概率拿不到，无法确认是否达到 ${threshold}% 阈值。按保守策略这次不提前，出行前请再看一眼天气。`:affected?`预计 ${winText} 出行，${win.wetHours.slice(0,4).join('、')} 时段有降水（${peakText}）${win.max!=null?`，气温 ${win.min}° ~ ${win.max}°`:''}。`:`预计 ${winText} 出行，时段内降水${peakText}，未达到提醒阈值，不会提前叫醒${win.max!=null?`，气温 ${win.min}° ~ ${win.max}°`:''}。`;
 return <section className={`core-card glass ${affected?'alert':unknown?'unknown':'calm'}`}>
  <div className="card-heading"><span className="capsule"><Glyph name="weather"/>核心 · 雨雪自动提前唤醒</span><span className="subtle">{ready?'DEPARTURE WINDOW':forecast?forecast.day.slice(5).replace('-',' / '):'FORECAST'}</span></div>
  <div className="core-body">
   <div className="core-advance"><strong>{affected?`+${advance}`:'0'}<small>分钟</small></strong><span>{affected?'明早自动提前':unknown?'数据不全 · 不提前':ready?'无需额外提前':'待通勤设置'}</span></div>
   <div className="core-weather"><WeatherSymbol code={snow?73:affected?61:0}/><div><h2>{headline}</h2><p>{detail}</p></div></div>
  </div>
  {spot&&<p className={`spot-line${spot.fallback?' fallback':''}`}><Glyph name="pin"/>通勤天气按「{spot.name}」算 · 实际数据来自{spot.actual}{spot.fallback?'（家的天气还没取到，先用这个，结论可能会变）':''}</p>}
  {smartAlarm&&<p className="core-scheduled"><Glyph name="bell"/>已安排 <b>{fmt(smartAlarm.at)}</b> 叫醒 · {new Date(smartAlarm.at).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'})}{smartAlarm.advance?` · 因雨雪提前 ${smartAlarm.advance} 分钟`:''}</p>}
  <div className="core-actions">
   <button className="lime-button" onClick={onWake} disabled={busy}>{busy?'正在计算…':!ready?'去设置通勤，按出发时段计算':smartAlarm?'重新计算并替换明早闹钟':'按明早天气安排闹钟'}<Glyph name="arrow"/></button>
   {smartAlarm&&<button className="soft-button" onClick={onCancel}>取消这个闹钟</button>}
  </div>
  <small className="fine-print">判断口径：只看预计出发→抵达时段的天气（当前阈值 {threshold}%）；提前量 = 雨雪额外准备（当前 {extra} 分钟，上限 {maxAdvance} 分钟），可在通勤页调整。{fallback&&(fallback.switched?`本次按你配置的${fallback.kind==='snow'?'雪天':'雨天'}备用方式「${fallback.mode}」计算。`:`未配置${fallback.kind==='snow'?'雪天':'雨天'}备用交通方式，仍按「${transport||'当前方式'}」，只增加准备时间。`)}</small>
 </section>;
}
function ForecastCard({forecast,threshold,onOpen}){
 if(!forecast)return <section className="forecast-card glass"><div className="card-heading"><span className="capsule"><Glyph name="weather"/>明天逐时天气</span><span className="subtle">FORECAST</span></div><p className="forecast-empty">逐小时预报获取中…</p></section>;
 const peak=forecast.hours.filter(h=>{const hour=Number(h.time.slice(11,13));return hour>=6&&hour<=9;});
 const peakWet=peak.some(h=>wetVerdict(h,threshold)===true);
 const dominant=forecast.hours.find(h=>Number.isFinite(h.code))?.text||weatherName(forecast.hours.find(h=>Number.isFinite(h.code))?.code);
 return <section className="forecast-card glass">
  <div className="card-heading"><span className="capsule"><Glyph name="weather"/>明天逐时天气 · {forecast.day.slice(5).replace('-',' / ')}</span><button className="text-link" onClick={onOpen}>今明两天完整预报 <Glyph name="arrow"/></button></div>
  <div className="forecast-summary">
   <div className="forecast-temp">{forecast.min!=null&&forecast.max!=null?<><strong>{forecast.max}<sup>°</sup></strong><span>/ {forecast.min}°</span></>:<strong>—</strong>}<small>{dominant||'—'}</small></div>
   <div className="forecast-risk"><strong>{forecast.probability==null?'—':forecast.probability}<small>{forecast.probability==null?'':'%'}</small></strong><span>明日最高降水概率{forecast.probability==null?'（部分数据缺失）':''}</span></div>
   <p className="forecast-note">{peakWet?`早高峰 ${peak[0]?.time.slice(11,16)}–${peak.at(-1)?.time.slice(11,16)} 有降水，若在此时段出行会提前。`:peak.length?`早高峰 ${peak[0]?.time.slice(11,16)}–${peak.at(-1)?.time.slice(11,16)} 无明显降水。`:'暂无早高峰时段预报。'}</p>
  </div>
  <HourStrip hours={forecast.hours} threshold={threshold}/>
  <p className="fine-print">这里展示明天全天的逐小时预报；闹钟是否提前，只按你的出发→抵达时段判断（见上方核心卡）。</p>
 </section>;
}
function HourStrip({hours,threshold}){
 return <div className="hour-strip" role="list">{hours.map(h=>{const hour=Number(h.time.slice(11,13));const wet=wetVerdict(h,threshold)===true;const unknown=wetVerdict(h,threshold)===null;const snow=isSnow(h.code);const shown=Number.isFinite(h.probability)?`${Math.round(h.probability)}%`:'未知';return <div role="listitem" key={h.time} className={`hour-chip${wet?' wet':''}${snow?' snow':''}${unknown?' unknown':''}${hour>=6&&hour<=9?' peak':''}`}><span className="hour-time">{h.time.slice(11,16)}</span><WeatherSymbol code={h.code}/><span className="hour-temp">{Number.isFinite(h.temperature)?`${Math.round(h.temperature)}°`:'—'}</span><span className="hour-bar"><i style={{height:`${Number.isFinite(h.probability)?Math.max(6,Math.min(100,h.probability)):6}%`}}/></span><b>{shown}</b></div>;})}</div>;
}
function DayBlock({summary,label,threshold}){
 return <section className="panel glass day-block">
  <div className="day-head"><span className="day-label">{label}<small>{summary.day.slice(5).replace('-',' / ')}</small></span>{summary.affected?<span className="day-flag">{summary.snow?'有雪':'有雨'}</span>:summary.affected===null?<span className="day-flag unknown">数据不全</span>:<span className="day-flag calm">无降水</span>}</div>
  <div className="day-overview">
   <WeatherSymbol code={summary.snow?73:summary.affected?61:(summary.hours.find(h=>Number.isFinite(h.code))?.code ?? 0)}/>
   <div><strong>{summary.max!=null?`${summary.min}° ~ ${summary.max}°`:'—'}</strong><span>{summary.hours.find(h=>h.text)?.text||''} · 覆盖 {summary.coverage} 小时</span></div>
   <div className="day-risk"><strong>{summary.probability==null?'—':summary.probability}<small>{summary.probability==null?'':'%'}</small></strong><span>最高降水概率{summary.wetHours.length?` · ${summary.wetHours.slice(0,6).join('、')}`:''}</span></div>
  </div>
  <div className="day-hours">{summary.hours.map(h=>{const verdict=wetVerdict(h,threshold);const wet=verdict===true;const snow=isSnow(h.code);return <div key={h.time} className={`day-hour${wet?' wet':''}${snow?' snow':''}${verdict===null?' unknown':''}`}><span>{h.time.slice(11,16)}</span><small>{Number.isFinite(h.temperature)?`${Math.round(h.temperature)}°`:'—'}</small><b>{Number.isFinite(h.probability)?`${Math.round(h.probability)}%`:'未知'}</b><i>{h.text||weatherName(h.code)}</i></div>;})}</div>
  <p className="fine-print">全天预报仅供参考；闹钟是否提前，只按你的出发→抵达时段判断。</p>
 </section>;
}
function RouteSketch({route}){const list=route.steps.flatMap(s=>(s.polyline||'').split(';')).filter(Boolean).map(x=>x.split(',').map(Number)).filter(p=>p.length===2&&p.every(Number.isFinite));if(list.length<2)return <div className="map-empty">高德路线已获取，未返回路线几何。请查看分段路线。</div>;const xs=list.map(x=>x[0]),ys=list.map(x=>x[1]),minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys),project=p=>[50+(p[0]-minx)/(maxx-minx||1)*650,350-(p[1]-miny)/(maxy-miny||1)*300];const p=list.map(project),d=p.map(x=>x.join(',')).join(' ');return <svg viewBox="0 0 750 400" className="route-svg" aria-label="高德真实路线几何示意，非地图底图"><defs><pattern id="grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="#ffffff0c"/></pattern></defs><rect width="750" height="400" fill="url(#grid)"/><polyline points={d} fill="none" stroke="#b8ec81" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>{[p[0],p.at(-1)].map((x,i)=><g key={i}><circle cx={x[0]} cy={x[1]} r="15" fill={i?'#f9a886':'#b8ec81'}/><text x={x[0]} y={x[1]+5} textAnchor="middle" fill="#172020" fontSize="14">{i?'B':'A'}</text></g>)}<text x="25" y="380" fill="#9aa5a7" fontSize="12">路线示意 · 非地图底图</text></svg>;}
function WeatherSymbol({code}){const wet=code>=51,snow=[71,73,75,77,85,86].includes(code);return <svg viewBox="0 0 100 90" className="weather-symbol" aria-hidden="true"><defs><radialGradient id="sun"><stop stopColor="#f6fbc6"/><stop offset="1" stopColor="#c8f49a"/></radialGradient><linearGradient id="cloud"><stop stopColor="#f7f9f6"/><stop offset="1" stopColor="#809099"/></linearGradient></defs><circle cx="66" cy="29" r="21" fill="url(#sun)"/><path d="M23 64c-24 0-24-29-5-31 3-24 33-27 44-8 23-7 39 11 30 28 11 9 3 11-10 11Z" fill="url(#cloud)"/>{wet&&[30,48,66].map((x,i)=>snow?<text key={i} x={x} y="83" fill="#d6ebff" fontSize="18">*</text>:<path key={i} d={`M${x} 72l-4 9`} stroke="#a5cfff" strokeWidth="3" strokeLinecap="round"/>)}</svg>;}
function Glyph({name}){const p={clock:<><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2M5 3 2 6m17-3 3 3"/></>,route:<><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h6a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7"/></>,settings:<><circle cx="12" cy="12" r="4"/><path d="m9 3 6 0 1 3 3 1 1 5-2 2 0 4-4 2-3-1-3 1-4-3 1-4-2-3 2-4 3 0Z"/></>,arrow:<path d="M5 12h14m-6-6 6 6-6 6"/>,plus:<path d="M12 5v14M5 12h14"/>,spark:<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>,refresh:<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>,pin:<><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,play:<path d="m9 5 10 7-10 7Z"/>,volume:<><path d="M4 9h4l5-5v16l-5-5H4ZM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,bell:<><path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4ZM10 21h4"/></>,weather:<><circle cx="15" cy="8" r="4"/><path d="M6 18h11a4 4 0 0 0-1-8 5 5 0 0 0-9-1 5 5 0 0 0-1 9"/></>,search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>};return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]||p.clock}</svg>;}
