import React from 'react';
import { DEFAULT_COMMUTE, validateCommute, withPreference, TRANSPORTS } from './commuteSettings.js';

const fmt = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const number = (v) => v === '' ? '' : Number(v);

// A02：四步首次引导。与分支实现对齐 —— 固定模式路径不需要填智能通勤资料。
// 步骤：1 基础闹钟 → 2 选择模式 → 3 资料/复查/声音 → 4 预览确认
export function SetupGuide({
  commute, setCommute, alarms, home, office, arrival, setArrival,
  guideStep, setGuideStep, error, onClose, onFinish,
  onCreateAlarm, onEnableAlarm, onOpenCommute, onTestRing,
}) {
  const set = (key, val) => setCommute(old => ({ ...old, [key]: val }));
  const setSound = (key, val) => setCommute(old => ({ ...old, sound: { ...old.sound, [key]: val } }));
  const resetRecommended = () => setCommute(old => ({
    ...DEFAULT_COMMUTE, baseAlarmId: old.baseAlarmId,
    fixedEnabled: old.fixedEnabled, smartEnabled: old.smartEnabled,
    sound: { ...DEFAULT_COMMUTE.sound },
  }));
  const baseList = alarms.filter(a => a.planKind !== 'primary');
  const picked = alarms.find(a => a.id === commute.baseAlarmId);
  const noMode = !commute.fixedEnabled && !commute.smartEnabled;

  const modeText = commute.fixedEnabled && commute.smartEnabled ? '固定 + 智能'
    : commute.fixedEnabled ? '仅固定' : commute.smartEnabled ? '仅智能' : '未开启';

  return <div className="guide-overlay" role="dialog" aria-modal="true" aria-label="首次通勤设置">
    <div className="guide-window glass">
      <div className="section-title">
        <h2>开始安排通勤唤醒</h2>
        <span className="capsule">{guideStep + 1} / 4</span>
      </div>
      <div className="wizard-progress" aria-hidden="true"><i style={{ width: `${((guideStep + 1) / 4) * 100}%` }} /></div>

      {guideStep === 0 && <section>
        <h3 className="wizard-q">1. 基础闹钟</h3>
        <p className="wizard-sub">先保存一个未来的基础闹钟，提前唤醒会作为独立闹钟存在，不会替换或改动它。预设闹钟目前是关闭的，不能直接用于下一步。</p>
        <label>基础闹钟
          <select value={commute.baseAlarmId || ''} onChange={e => set('baseAlarmId', e.target.value)}>
            <option value="">选择闹钟</option>
            {baseList.map(a => <option key={a.id} value={a.id}>
              {a.label} · {fmt(a.at)}{a.enabled ? '' : '（已关闭）'}
            </option>)}
          </select>
        </label>
        <div className="button-line">
          <button className="soft-button" onClick={onCreateAlarm}>新增基础闹钟</button>
          {picked && !picked.enabled && <button className="soft-button" onClick={() => onEnableAlarm(picked)}>启用所选闹钟</button>}
        </div>
        {!picked && <p className="fine-print">也可以直接下一步，会自动挑一个已开启的闹钟作为基础。</p>}
      </section>}

      {guideStep === 1 && <section>
        <h3 className="wizard-q">2. 选择模式</h3>
        <p className="wizard-sub">固定模式只看时间和固定提前量，不需要天气与路线；智能模式按通勤路况和天气计算。两者同时开启时取更早的那个，但只会生成一个提前唤醒。</p>
        <label className="check-line"><input type="checkbox" checked={!!commute.fixedEnabled} onChange={e => set('fixedEnabled', e.target.checked)} />固定提前</label>
        {commute.fixedEnabled && <label>固定提前量 / 分钟
          <input type="number" min="0" max="240" value={commute.fixedMinutes} onChange={e => set('fixedMinutes', number(e.target.value))} />
        </label>}
        <label className="check-line"><input type="checkbox" checked={!!commute.smartEnabled} onChange={e => set('smartEnabled', e.target.checked)} />智能通勤</label>
        {commute.smartEnabled && <label>智能提前上限 / 分钟
          <input type="number" min="0" max="240" value={commute.maxAdvance} onChange={e => set('maxAdvance', number(e.target.value))} />
        </label>}
        {commute.smartEnabled && !commute.fixedEnabled && <p className="fine-print">建议开启固定模式作为备用；你也可以保持仅智能。</p>}
        {noMode && <p className="inline-error">至少开启一种模式，否则不会生成提前唤醒。</p>}
        {commute.smartEnabled && <button className="soft-button" onClick={onOpenCommute}>填写详细通勤资料</button>}
      </section>}

      {guideStep === 2 && <section>
        <h3 className="wizard-q">3. 资料、复查与声音</h3>
        <p className="wizard-sub">下方已填入推荐值，可以直接继续，也可以改成自己的时间。</p>
        <button className="soft-button" onClick={resetRecommended}>恢复推荐参数</button>
        {commute.smartEnabled && <>
          <p className="fine-print">智能模式需要到达时间、地点、交通和时间参数。固定模式无需填写这些资料。</p>
          <label>到达日期与时间<input type="datetime-local" value={arrival} onChange={e => setArrival(e.target.value)} /></label>
          <label>交通方式
            <select value={commute.transport} onChange={e => set('transport', e.target.value)}>
              {TRANSPORTS.map(x => <option key={x}>{x}</option>)}
            </select>
          </label>
          <div className="setup-grid">
            {[['preparation', '起床准备'], ['buffer', '到达余量'], ['extra', '雨雪额外准备'], ['maxAdvance', '智能上限']].map(([key, label]) =>
              <label key={key}>{label} / 分钟<input type="number" min="0" max="240" value={commute[key]} onChange={e => set(key, number(e.target.value))} /></label>)}
          </div>
          <p className="fine-print">家：{home?.name || '未设置'}；公司：{office?.name || '未设置'}。地点可在通勤页搜索。</p>
          <button className="soft-button" onClick={onOpenCommute}>设置通勤地点</button>
          <WeatherFallbackSettings commute={commute} onChange={setCommute} compact />
        </>}
        <label>早晨复查时间<input type="time" value={commute.recheckTime} onChange={e => set('recheckTime', e.target.value)} /></label>
        <label>资料不可用时
          <select value={commute.fallback} onChange={e => set('fallback', e.target.value)}>
            <option>保留基础闹钟</option>
            <option disabled={!commute.fixedEnabled}>仅按固定模式</option>
          </select>
        </label>
        <label className="check-line"><input type="checkbox" checked={!!commute.sound.ambientEnabled} onChange={e => setSound('ambientEnabled', e.target.checked)} />天气环境音</label>
        {commute.sound.ambientEnabled && <div className="setup-grid">
          {[['ambientOffset', '主铃前开始 / 分钟', 60], ['ambientDuration', '主铃后持续 / 分钟', 60], ['ambientVolume', '音量 / %', 100]].map(([key, label, max]) =>
            <label key={key}>{label}<input type="number" min="0" max={max} value={commute.sound[key]} onChange={e => setSound(key, number(e.target.value))} /></label>)}
        </div>}
        <button className="soft-button" onClick={onTestRing}>试听主铃</button>
        <p className="fine-print">主铃会照原定时间响起；停止提前的提示音不会删除基础闹钟。</p>
      </section>}

      {guideStep === 3 && <section>
        <h3 className="wizard-q">4. 预览确认</h3>
        <div className="service-row"><strong>基础闹钟<small>提前唤醒独立存在</small></strong><span className="capsule">{picked ? `${picked.label} · ${fmt(picked.at)}${picked.enabled ? '' : ' · 已关闭'}` : '未选择'}</span></div>
        <div className="service-row"><strong>提前方式<small>同时开启时取更早</small></strong><span className="capsule">{modeText}</span></div>
        {commute.fixedEnabled && <div className="service-row"><strong>固定提前量<small>不需要路线与天气</small></strong><span className="capsule">{commute.fixedMinutes} 分钟</span></div>}
        {commute.smartEnabled && <div className="service-row"><strong>智能上限<small>超出会显示缺口</small></strong><span className="capsule">{commute.maxAdvance} 分钟</span></div>}
        {commute.smartEnabled && <div className="service-row"><strong>雨雪备用<small>下雨 / 下雪分别处理</small></strong><span className="capsule">
          {['rain', 'snow'].map(k => {
            const row = commute.preferences?.[k] || {};
            return `${k === 'rain' ? '雨' : '雪'}：${row.mode ? row.mode : `仍${commute.transport}`}+${Number.isFinite(row.extra) ? row.extra : 0}分`;
          }).join(' · ')}
        </span></div>}
        <div className="service-row"><strong>早晨复查<small>资料不可用时的兜底</small></strong><span className="capsule">{commute.recheckTime} · {commute.fallback}</span></div>
        <div className="service-row"><strong>环境音<small>主铃之前铺垫</small></strong><span className="capsule">{commute.sound.ambientEnabled ? `主铃前 ${commute.sound.ambientOffset} 分钟 · ${commute.sound.ambientVolume}%` : '关闭'}</span></div>
        <p className="fine-print">两种模式均开启时，计算模块会选择较早的有效候选。当前网页仅保存设置和本地闹钟，后台复查与设备同步尚未接入；关闭网页后尚不能保证准时响铃。</p>
      </section>}

      {error && <p className="inline-error" role="alert">{error}</p>}

      <div className="button-line">
        <button className="soft-button" disabled={guideStep === 0} onClick={() => { onClose('step'); setGuideStep(guideStep - 1); }}>上一步</button>
        {guideStep < 3
          ? <button className="lime-button" onClick={() => setGuideStep(guideStep + 1)}>下一步</button>
          : <button className="lime-button" onClick={onFinish}>确认并保存</button>}
        <button className="soft-button wizard-skip" onClick={() => onClose('skip')}>稍后再设</button>
      </div>
    </div>
  </div>;
}

// A03 补齐：独立的「复查」分组，与 main 已有的主铃音色组并列。
export function RecheckSettings({ commute, onChange, baseAlarmAt }) {
  const set = (key, val) => onChange(old => ({ ...old, [key]: val }));
  const error = validateCommute(commute, baseAlarmAt);
  return <section className="panel glass">
    <h2>复查与备用</h2>
    <p>早晨复查时间必须早于最早可能发声的时间，否则这条设置无法保存。</p>
    <label>早晨复查时间<input type="time" value={commute.recheckTime} onChange={e => set('recheckTime', e.target.value)} /></label>
    <label>资料不可用时
      <select value={commute.fallback} onChange={e => set('fallback', e.target.value)}>
        <option>保留基础闹钟</option>
        <option disabled={!commute.fixedEnabled}>仅按固定模式</option>
      </select>
    </label>
    {error ? <p className="inline-error">{error}</p> : <p className="fine-print">当前设置通过检查。</p>}
    <p className="fine-print">后台复查任务尚未接入；此设置会保存在本机，网页关闭后不会执行。</p>
  </section>;
}

// B08：雨雪备用方式。雨/雪各自可以换成另一种交通方式，并各自有额外准备分钟数。
// 不用 Tabs 之类交互，两个并排区块，和设置页其余面板风格一致。
export function WeatherFallbackSettings({ commute, onChange, compact }) {
  const setRow = (key, field, val) => onChange(old => withPreference(old, key, field, val));
  const rows = [['rain', '雨天', '雨'], ['snow', '雪天', '雪']];
  const body = <>
    {rows.map(([key, label, short]) => {
      const row = commute.preferences?.[key] || {};
      const mode = row.mode ?? '';
      return <div key={key} className="fallback-row">
        <strong>{label}</strong>
        <label>改用
          <select value={mode} onChange={e => setRow(key, 'mode', e.target.value || null)}>
            <option value="">保持「{commute.transport}」</option>
            {TRANSPORTS.filter(t => t !== commute.transport).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>额外准备 / 分钟
          <input type="number" min="0" max="240" value={row.extra ?? ''} onChange={e => setRow(key, 'extra', number(e.target.value))} />
        </label>
        <small className="subtle">
          {mode ? `明早若有${short}，改为「${mode}」并额外预留 ${Number.isFinite(row.extra) ? row.extra : 0} 分钟。` : `明早若有${short}，仍按「${commute.transport}」出行，只额外预留 ${Number.isFinite(row.extra) ? row.extra : 0} 分钟。`}
        </small>
      </div>;
    })}
  </>;
  if (compact) return <div className="fallback-compact">
    <p className="fine-print">雨雪天是否换一种出行方式？不选就保持「{commute.transport}」，只加准备时间。</p>
    {body}
  </div>;
  return <section className="panel glass">
    <h2>雨雪备用方式</h2>
    <p>明早下雨或下雪时，是否换一种交通方式。这里填什么，闹钟就按什么算，不会替你猜。</p>
    {body}
    <p className="fine-print">「额外准备」与上方通勤参数里的雨雪额外准备是同一件事，改这里会同步生效；上限仍由智能提前上限约束。</p>
  </section>;
}

// A07：天气环境音设置。开关 / 偏移 / 时长 / 音量 / 试听。
export function AmbientSettings({ commute, onChange, onPreview, previewing, onStopPreview, profileLabel }) {
  const setSound = (key, val) => onChange(old => ({ ...old, sound: { ...old.sound, [key]: val } }));
  const s = commute.sound;
  return <section className="panel glass">
    <h2>天气环境音</h2>
    <p>按天气在主铃之前铺一层合成的雨声或风声，天气未知时使用轻风。当前音色：<strong>{profileLabel || '轻风声'}</strong>。</p>
    <label className="check-line"><input type="checkbox" checked={!!s.ambientEnabled} onChange={e => setSound('ambientEnabled', e.target.checked)} />开启环境音</label>
    {s.ambientEnabled && <div className="settings-grid">
      <label>主铃前开始 / 分钟<input type="number" min="1" max="60" value={s.ambientOffset} onChange={e => setSound('ambientOffset', number(e.target.value))} /></label>
      <label>主铃后持续 / 分钟<input type="number" min="0" max="60" value={s.ambientDuration} onChange={e => setSound('ambientDuration', number(e.target.value))} /></label>
      <label>音量 / %<input type="number" min="0" max="100" value={s.ambientVolume} onChange={e => setSound('ambientVolume', number(e.target.value))} /></label>
    </div>}
    <div className="button-line">
      <button className="soft-button" onClick={previewing ? onStopPreview : onPreview}>{previewing ? '停止环境音试听' : '试听环境音'}</button>
    </div>
    <p className="fine-print">环境音只是提前铺垫，主铃仍按原定时间响起；停止提前的声音不会删除基础闹钟。</p>
  </section>;
}
