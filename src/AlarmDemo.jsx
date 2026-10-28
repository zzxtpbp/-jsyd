import React, { useEffect, useRef, useState } from 'react';
import { getJSON, coordinate, weatherName, assess } from './live.js';

const ALARM_KEY = 'jishi-web-alarm-v1';
// 分享部署时网关要求每个请求都带 sharecode，见 Dashboard.jsx 里的同名函数说明。
function shareParam(){try{const c=new URLSearchParams(location.search).get('sharecode');return c?`sharecode=${encodeURIComponent(c)}`:'';}catch{return '';}}
async function api(path, body) {
  const q = shareParam();
  const url = `/api/${path}${q ? (path.includes('?') ? '&' : '?') + q : ''}`;
  const response = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(60000) });
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || '接口请求失败');
  return data;
}
function localInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
function restore() {
  try { const a = JSON.parse(localStorage.getItem(ALARM_KEY)); return a && Number.isFinite(a.at) && ['armed','ringing'].includes(a.state) ? a : null; } catch { return null; }
}
export default function AlarmDemo() {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); tomorrow.setHours(9,0,0,0);
  const [alarm, setAlarm] = useState(restore);
  const [alarmTime, setAlarmTime] = useState(localInput(new Date(Date.now()+120000)));
  const [arrival, setArrival] = useState(localInput(tomorrow));
  const [home, setHome] = useState('121.4782,31.2285');
  const [office, setOffice] = useState('121.5043,31.2378');
  const [prep, setPrep] = useState(40);
  const [buffer, setBuffer] = useState(10);
  const [extra, setExtra] = useState(15);
  const [limit, setLimit] = useState(30);
  const [data, setData] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [view, setView] = useState('alarm');
  const [editing, setEditing] = useState(false);
  const [weatherPreview, setWeatherPreview] = useState(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [providers, setProviders] = useState(null);
  const [paidMode, setPaidMode] = useState(true);
  const [address, setAddress] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [explanation, setExplanation] = useState('');
  const [explaining, setExplaining] = useState(false);
  const explanationId = useRef(0);
  const [now, setNow] = useState(Date.now());
  const audio = useRef(null);
  const soundTimer = useRef(null);
  const requestId = useRef(0);
  useEffect(()=>{getJSON('/api/status').then(setProviders).catch(()=>setProviders({}));},[]);
  useEffect(()=>{explanationId.current++;setExplanation('');setExplaining(false);},[proposal]);
  async function searchAddress() {
    setCandidates([]);
    try { const r=await api('geocode',{address});setCandidates(r.candidates);setStatus(r.candidates.length ? '请核对结果后选择设为家或公司。' : '没有找到地址，请补充城市与街道。'); }
    catch(e){setStatus(e.message);}
  }
  async function explain() {
    const id=++explanationId.current;setExplaining(true);setExplanation('');
    try {
      const r=await api('explain',{summary:{source:data.source||'Open-Meteo / OSRM',routeNote:data.routeNote||'不含实时路况',forecastTime:proposal.time,weather:weatherName(proposal.code),rainProbability:proposal.probability,precipitationMm:proposal.precipitation,distanceKm:data.route.distance/1000,durationMinutes:proposal.duration,weatherAdvanceMinutes:proposal.advance,wakeTime:new Date(proposal.at).toLocaleString('zh-CN'),departure:proposal.depart.toLocaleString('zh-CN'),requiresApproval:proposal.approval,execution:'尚未设置闹铃'}});
      if(id===explanationId.current)setExplanation(r.text);
    }catch(e){if(id===explanationId.current)setExplanation(`千问解释不可用：${e.message}。仍可按程序计算的方案设置闹铃。`);}
    finally{if(id===explanationId.current)setExplaining(false);}
  }
  function stopSound() { if (soundTimer.current) clearInterval(soundTimer.current); soundTimer.current = null; }
  async function enableSound() {
    if (!audio.current) audio.current = new (window.AudioContext || window.webkitAudioContext)();
    await audio.current.resume();
    if (audio.current.state !== 'running') throw new Error('请允许浏览器播放声音');
  }
  function beep() {
    const ctx = audio.current;
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.value = 0.12;
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+0.3);
  }
  function saveAlarm(next) {
    try { if (next) localStorage.setItem(ALARM_KEY, JSON.stringify(next)); else localStorage.removeItem(ALARM_KEY); }
    catch { setStatus('浏览器保存失败，闹铃仅在当前页面有效。'); }
    setAlarm(next);
  }
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (alarm?.state === 'armed' && now >= alarm.at) {
      if (now - alarm.at > 60000) { saveAlarm(null); setStatus('检测到已错过的闹铃，未作为准时响铃处理，请重新设置。'); }
      else saveAlarm({ ...alarm, state: 'ringing' });
    }
  }, [now, alarm]);
  useEffect(() => {
    if (alarm?.state === 'ringing') { beep(); soundTimer.current = setInterval(beep, 900); }
    else stopSound();
    return stopSound;
  }, [alarm?.state]);
  async function arm(at, label) {
    try {
      if (!Number.isFinite(at) || at <= Date.now()) throw new Error('响铃时间必须晚于现在');
      await enableSound(); stopSound(); saveAlarm({ at, label, state: 'armed' }); setStatus('网页闹铃已开启。请保持页面打开、设备唤醒和声音可用。');
    } catch (e) { setStatus(e.message); }
  }
  function invalidate() { requestId.current++; setData(null); setWeatherPreview(null); setProposal(null); setBusy(false); }
  async function refresh() {
    const id = ++requestId.current; setBusy(true); setStatus('正在查询真实天气和驾车路线…'); setData(null); setProposal(null);
    try {
      const a = coordinate(home); const b = coordinate(office);
      if(paidMode) {
        const r=await api('commute',{home,office});
        if(new Date().getTimezoneOffset()!==-480) throw new Error('高德与和风模式请使用中国时区（UTC+8）的浏览器');
        if(id!==requestId.current)return;
        setData(r);setStatus('高德与和风数据已获取，闹铃尚未修改。');return;
      }
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${a.lat}&longitude=${a.lon}&current=temperature_2m,weather_code&hourly=precipitation_probability,precipitation,weather_code&forecast_days=3&timezone=auto`;
      const [weather, routing] = await Promise.all([getJSON(url), getJSON(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`)]);
      const route = routing.routes?.[0];
      if (!route || !Number.isFinite(route.duration) || !Number.isFinite(route.distance) || !weather.current || !weather.hourly) throw new Error('数据不完整，未修改闹铃');
      if (Intl.DateTimeFormat().resolvedOptions().timeZone !== weather.timezone && Math.abs(new Date().getTimezoneOffset()*60 + weather.utc_offset_seconds) > 0) throw new Error('此 Demo 仅支持浏览器与地点处于同一时区，请使用本地坐标');
      if (id !== requestId.current) return;
      setData({ weather, route, fetched: Date.now() }); setStatus('真实数据已更新。闹铃尚未修改。');
    } catch (e) { if (id === requestId.current) setStatus(`查询失败：${e.message}。已有闹铃保持不变，可继续下方模拟演示。`); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  function calculate() {
    try {
      if (!data || Date.now()-data.fetched > 15*60000) throw new Error('请先获取或刷新天气路线数据（有效期 15 分钟）');
      if (![prep,buffer,extra,limit].every(x => Number.isInteger(x) && x >= 0 && x <= 240)) throw new Error('各分钟数须为 0 到 240 的整数');
      const arriveAt = new Date(arrival).getTime();
      if (!Number.isFinite(arriveAt) || arriveAt <= Date.now()) throw new Error('请选择未来的到达时间');
      const duration = Math.ceil(data.route.duration/60);
      const depart = new Date(arriveAt-(duration+buffer)*60000);
      const decision = assess(data.weather, data.route, depart, extra, limit);
      const baseline = arriveAt-(duration+buffer+prep)*60000;
      const at = baseline-decision.advance*60000;
      if (at <= Date.now()) throw new Error('建议叫醒时间已经过去，请调整到达时间');
      if (alarm?.state === 'ringing') throw new Error('请先停止当前正在响的闹铃');
      // 已有更早闹铃时保留更早时间，不因本次计算自动延后。
      const effectiveAt = alarm?.state === 'armed' ? Math.min(at, alarm.at) : at;
      setProposal({ ...decision, at: effectiveAt, baseline, depart, duration, fetched: data.fetched });
      setStatus('方案已计算，确认后写入网页闹铃。');
    } catch(e) { setProposal(null); setStatus(e.message); }
  }
  async function refreshWeather() {
    setWeatherBusy(true);setWeatherError('');
    try {
      const c=coordinate(home);
      // 明示备用数据来源；不把未接通的和风服务标记为成功。
      const r=await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code&timezone=auto`);
      if(!Number.isFinite(r.current?.temperature_2m))throw new Error('天气数据缺失');
      setWeatherPreview({ ...r.current, source:'Open-Meteo 备用天气', fetched:Date.now() });
    } catch(e){setWeatherError('天气暂未获取，请稍后重试');}
    finally{setWeatherBusy(false);}
  }
  const currentWeather=data?.weather.current||weatherPreview;
  const displayAt=alarm?.at||new Date(alarmTime).getTime();
  const timeParts=Number.isFinite(displayAt)?new Date(displayAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}).split(':'):['--','--'];
  const remaining=alarm?Math.max(0,Math.ceil((alarm.at-now)/60000)):null;
  const stopAlarm=()=>{stopSound();saveAlarm(null);setStatus('闹铃已关闭。');};
  const chooseView=(next)=>{setView(next);setEditing(false);};
  return <div className="app-layout">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();chooseView('alarm');}}><span className="brand-mark"><Icon name="clock" /></span><span>吉时已到<small>RIGHT ON TIME</small></span></a>
      <div className="nav-caption">你的每一天，从容开始</div>
      <nav aria-label="主导航">{[['alarm','clock','我的闹钟'],['commute','route','通勤计划'],['settings','settings','偏好设置']].map(([id,icon,label])=><button key={id} className={view===id?'nav-item active':'nav-item'} onClick={()=>chooseView(id)} aria-current={view===id?'page':undefined}><Icon name={icon}/>{label}{view===id&&<span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="mini-orbit">✳</span><p>少一点匆忙<br/>多一点刚刚好</p><small>WEATHER-AWARE ALARM</small><div className="local-badge"><i/> 本地网页演示</div></div>
    </aside>
    <main className="workspace">
      <header className="page-header"><div><span className="eyebrow">A LITTLE AHEAD, RIGHT ON TIME.</span><h1>{view==='alarm'?'把早晨，留给从容。':view==='commute'?'出发之前，安排妥当。':'按照你的节奏。'}</h1><p>{new Date(now).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})} <span> / </span> {view==='alarm'?'今天也要好好出发':view==='commute'?'让天气与路线，一起参与计划':'你的习惯，由你决定'}</p></div><button className="round-button" aria-label="打开偏好设置" onClick={()=>chooseView('settings')}><Icon name="settings"/></button></header>
      <section className="weather-banner" aria-label="当前天气">
        <div className="weather-place"><span className="eyebrow"><Icon name="pin"/> 通勤起点附近</span><div className="temperature">{currentWeather?Math.round(currentWeather.temperature_2m):'—'}<span>°</span><div><strong>{currentWeather?weatherName(currentWeather.weather_code):'等待天气更新'}</strong><small>{currentWeather?'出门前，再看一眼天空':'先安排闹铃，天气稍后就位'}</small></div></div></div>
        <WeatherArt />
        <div className="weather-action"><span className="weather-source">{data?data.source||'Open-Meteo / OSRM':weatherPreview?weatherPreview.source:'和风天气 · 待补 API Host'}</span><button onClick={refreshWeather} disabled={weatherBusy}><Icon name="refresh"/>{weatherBusy?'更新中':'更新备用天气'}</button><small>{weatherError|| (currentWeather?`获取于 ${new Date(data?.fetched||weatherPreview?.fetched).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`:'无数据时不显示模拟温度')}</small></div>
      </section>
      {view==='alarm' && <>
        <div className="section-heading"><h2>我的闹钟 <span>MY ALARM</span></h2><button className="text-button" onClick={()=>setEditing(!editing)}><Icon name="plus"/>设置闹铃</button></div>
        <div className="home-grid">
          <section className={'alarm-card '+(alarm?.state==='ringing'?'is-ringing':'')}>
            <div className="card-top"><span className="chip"><Icon name="clock"/> {alarm?.state==='ringing'?'该起床啦':alarm?'下一次唤醒':'准备好你的下一次唤醒'}</span><button className={'toggle '+(alarm?'on':'')} role="switch" aria-checked={!!alarm} aria-label="闹铃开关" onClick={()=>alarm?stopAlarm():arm(new Date(alarmTime).getTime(),'我的闹铃')}><span/></button></div>
            <div className="dial"><svg className="dial-lines" viewBox="0 0 400 320" aria-hidden="true"><path d="M 62 270 A 160 160 0 1 1 338 270" fill="none" stroke="currentColor" strokeWidth="1"/>{Array.from({length:41},(_,i)=>{const a=(140+i*6.5)*Math.PI/180;const r=151;return <line key={i} x1={200+Math.cos(a)*r} y1={170+Math.sin(a)*r} x2={200+Math.cos(a)*(r-(i%5===0?13:6))} y2={170+Math.sin(a)*(r-(i%5===0?13:6))} stroke="currentColor" strokeWidth={i%5===0?2:1}/>})}</svg><span className="dial-label">{alarm?.state==='ringing'?'GOOD MORNING':'WAKE UP AT'}</span><div className="alarm-digits">{timeParts[0]}<span>:</span>{timeParts[1]}</div><p>{alarm?new Date(alarm.at).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'}):'尚未开启 · 点击下方设置'}</p><span className="dial-leaf"><Icon name="spark"/></span></div>
            <div className="alarm-card-bottom"><div><span className="status-dot"/>{alarm?.state==='ringing'?'正在响铃':alarm?`距离唤醒 ${Math.floor(remaining/60)} 小时 ${remaining%60} 分钟`:'选择时间，安心休息'}</div><button className="circle-dark" aria-label="编辑闹铃时间" onClick={()=>setEditing(!editing)}><Icon name="arrow"/></button></div>
          </section>
          <div className="right-stack">
            <section className="agent-card"><div className="card-top"><span className="eyebrow"><Icon name="spark"/> 智能唤醒</span><span className="tiny-label">QWEN</span></div><h3>天气有变化，<br/>早晨有准备。</h3><p>{proposal?`本次建议预留 ${proposal.advance} 分钟天气准备时间。`:'结合天气与通勤时间，为你计算更合适的叫醒时间。'}</p><button className="light-button" onClick={()=>chooseView('commute')}>安排通勤唤醒 <Icon name="arrow"/></button><div className="agent-orbit" aria-hidden="true"><span/><span/><span/></div></section>
            <section className="quick-card"><div><span className="eyebrow">TRY IT OUT</span><h3>听见新的早晨</h3><p>10 秒体验一次网页唤醒</p></div><button className="play-button" aria-label="10 秒后响铃演示" onClick={()=>arm(Date.now()+10000,'10 秒演示')}><Icon name="play"/></button></section>
          </div>
        </div>
        {editing&&<section className="surface alarm-editor"><div className="section-heading"><h3>设置下一次闹铃</h3><button className="text-button" onClick={()=>setEditing(false)}>收起</button></div><label>响铃日期与时间<input type="datetime-local" value={alarmTime} onChange={e=>setAlarmTime(e.target.value)} /></label><button className="primary-button" onClick={()=>arm(new Date(alarmTime).getTime(),'我的闹铃')}>保存并开启闹铃 <Icon name="arrow"/></button></section>}
        {alarm&&<div className="alarm-controls"><button onClick={stopAlarm}>停止 / 关闭闹铃</button>{alarm.state==='ringing'&&<button className="primary-button" onClick={()=>arm(Date.now()+5*60000,'稍后提醒')}>5 分钟后再响</button>}</div>}
        <section className="commute-summary"><span className="route-icon"><Icon name="route"/></span><div><h3>家 <span className="route-divider">→</span> 公司</h3><p>{data?`${(data.route.distance/1000).toFixed(1)} 公里 · 驾车约 ${Math.ceil(data.route.duration/60)} 分钟`:'设置你的通勤起终点，让叫醒更有依据'}</p></div><button className="round-button" aria-label="打开通勤计划" onClick={()=>chooseView('commute')}><Icon name="arrow"/></button></section>
      </>}
      {view==='commute'&&<>
        <div className="section-heading"><h2>通勤计划 <span>YOUR JOURNEY</span></h2><span className="chip neutral">驾车通勤</span></div>
        <section className="surface">
          <label>数据来源<select value={paidMode?'keyed':'free'} onChange={e=>{setPaidMode(e.target.value==='keyed');setHome(e.target.value==='keyed'?'121.4782,31.2285':'121.4737,31.2304');setOffice(e.target.value==='keyed'?'121.5043,31.2378':'121.4998,31.2397');invalidate();}}><option value="keyed">高德地图 + 和风天气</option><option value="free">免密钥备用 Open-Meteo + OSRM</option></select></label>
          {paidMode&&<div className="address-search"><label>搜索通勤地址<input value={address} onChange={e=>{setAddress(e.target.value);setCandidates([]);}} placeholder="输入城市、街道或地标"/></label><button onClick={searchAddress}>查询地址</button>{candidates.map((x,i)=><div className="candidate" key={i}><span>{x.name}<small>{x.level}</small></span><button onClick={()=>{setHome(x.location);invalidate();}}>设为家</button><button onClick={()=>{setOffice(x.location);invalidate();}}>设为公司</button></div>)}</div>}
          <div className="fields"><label>家 · 经度,纬度<input value={home} onChange={e=>{setHome(e.target.value);invalidate();}}/></label><label>公司 · 经度,纬度<input value={office} onChange={e=>{setOffice(e.target.value);invalidate();}}/></label></div>
          <p className="helper">上海示例起终点 · {paidMode?'GCJ-02 坐标':'WGS84 坐标'}。查询会把位置发送给对应数据服务。</p>
          <button className="primary-button" disabled={busy} onClick={refresh}><Icon name="refresh"/>{busy?'正在查询…':'获取天气与驾车路线'}</button>
          {data&&<div className="route-result"><strong>{(data.route.distance/1000).toFixed(1)} <small>公里</small> / {Math.ceil(data.route.duration/60)} <small>分钟</small></strong><p>{data.routeNote||'不含实时路况'} · 来源 {data.source||'Open-Meteo / OSRM'}</p></div>}
        </section>
        <section className="surface"><h3>倒推一个从容的早晨</h3><div className="fields"><label>到公司日期与时间<input type="datetime-local" value={arrival} onChange={e=>{setArrival(e.target.value);setProposal(null);}}/></label>{[['起床准备（分钟）',prep,setPrep],['到达余量（分钟）',buffer,setBuffer],['雨雪提前准备（分钟）',extra,setExtra],['自动提前上限（分钟）',limit,setLimit]].map(([label,value,setter])=><label key={label}>{label}<input type="number" min="0" max="240" value={value} onChange={e=>{setter(e.target.value===''?'':Number(e.target.value));setProposal(null);}}/></label>)}</div><button className="primary-button" disabled={!data||busy} onClick={calculate}>计算叫醒方案 <Icon name="arrow"/></button></section>
        {proposal&&<section className="surface proposal"><span className="eyebrow">YOUR MORNING PLAN</span><h3>建议 {new Date(proposal.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} 叫醒你</h3><p>{proposal.time} · {weatherName(proposal.code)} · 降水概率 {proposal.probability}% · 降水量 {proposal.precipitation} mm</p><p>天气准备提前 {proposal.advance} 分钟；{proposal.depart.toLocaleString('zh-CN')} 出发。保留已有更早闹铃。</p>{proposal.approval&&<p>本次超出自动提前上限，请确认后应用。</p>}<div className="button-row"><button disabled={explaining} onClick={explain}>{explaining?'千问正在解释…':'请千问解释本次方案'}</button><button className="primary-button" onClick={()=>{if(Date.now()-proposal.fetched>15*60000){setProposal(null);setStatus('数据已过期，请重新查询。');return;}arm(proposal.at,'天气通勤闹铃');setProposal(null);}}>{proposal.approval?'确认超限并应用闹铃':'应用方案并开启闹铃'}</button></div>{explanation&&<p className="ai-response">{explanation}</p>}</section>}
      </>}
      {view==='settings'&&<>
        <div className="section-heading"><h2>偏好与连接 <span>PREFERENCES</span></h2></div>
        <section className="surface"><h3>你的数据服务</h3>{[['高德地图','地址搜索与驾车路线',providers?.amap],['和风天气','当前天气与小时预报',providers?.qweather],['通义千问','通勤方案解释',providers?.qwen]].map(([name,desc,ready])=><div className="provider-row" key={name}><span><strong>{name}</strong><small>{desc}</small></span><span className={'provider-badge '+(ready?'ready':'')}>{ready?'配置已填写':'待补充配置'}</span></div>)}<p className="helper">填写不代表认证成功。和风仍需补充专属 API Host，接口异常会保留原有闹铃。</p></section>
        <section className="surface"><h3>声音与网页运行</h3><p>刷新后需要重新启用声音。请保持页面打开、设备唤醒；网页不能代替系统闹钟。</p><button className="primary-button" onClick={async()=>{try{await enableSound();beep();setStatus('声音已启用，可试听。');}catch(e){setStatus(e.message);}}}><Icon name="volume"/>启用声音 / 试听</button></section>
      </>}
      {status&&<div className="status-message" role="status" aria-live="polite"><Icon name="info"/>{status}<button aria-label="关闭提示" onClick={()=>setStatus('')}>×</button></div>}
      <footer className="app-footer"><span><Icon name="info"/> 网页演示需保持页面打开，休眠或后台节流可能影响响铃。</span><span>以自己的节奏，准时到达。</span></footer>
      {data?.weather.attributions?.length>0&&<div className="attributions">天气来源：{data.weather.attributions.map((url,i)=><a key={i} href={/^https:\/\//.test(url)?url:undefined} target="_blank" rel="noreferrer">{url} </a>)}</div>}
      {(weatherPreview||!paidMode)&&<div className="attributions"><a href="https://open-meteo.com/">Open-Meteo</a> · <a href="https://project-osrm.org/">OSRM</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></div>}
    </main>
  </div>;
}
function Icon({name}) {
 const paths={clock:<><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2M5 3 2 6m17-3 3 3"/></>,route:<><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h6a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7"/></>,settings:<><path d="m9 3 6 0 1 3 3 1 1 5-2 2 0 4-4 2-3-1-3 1-4-3 1-4-2-3 2-4 3 0Z"/><circle cx="12" cy="12" r="3"/></>,arrow:<path d="M5 12h14m-6-6 6 6-6 6"/>,plus:<path d="M12 5v14M5 12h14"/>,spark:<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>,refresh:<><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>,pin:<><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,play:<path d="m9 5 10 7-10 7Z"/>,volume:<><path d="M4 9h4l5-5v16l-5-5H4ZM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>};
 return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.clock}</svg>;
}
function WeatherArt(){return <svg className="weather-art" viewBox="0 0 220 150" aria-hidden="true"><circle cx="137" cy="62" r="35" fill="#dcefad"/><g stroke="#dcefad" strokeWidth="2" strokeLinecap="round"><path d="M137 9v-6m0 118v-6m53-53h6M80 62h-6m101-38 5-5m-81 81-5 5m81-5 5 5M99 24l-5-5"/></g><path d="M54 120c-29 0-29-39-4-42 1-30 48-38 61-13 27-11 50 8 45 30 21 6 18 25-3 25Z" fill="#d8dfdc" fillOpacity=".92"/><path d="M54 120h98" stroke="#f0f3e8" strokeOpacity=".5"/></svg>}
