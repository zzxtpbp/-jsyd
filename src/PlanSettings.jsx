import React from 'react';
import { RINGTONES } from './ringtones.js';
import { PLAN_STATUS } from './plan.js';

const number = (v) => v === '' ? '' : Number(v);

// A03：独立的「天气」设置组。阈值属于天气判断，不应埋在雨雪提醒里。
export function WeatherSettings({ commute, onChange, location, onLocate, locating, thresholdHint }) {
  const set = (key, val) => onChange(old => ({ ...old, [key]: val }));
  return <section className="panel glass settings-group">
    <div className="section-title"><h2>天气</h2><span className="capsule">和风天气</span></div>
    <p className="fine-print">通勤结论只看「出发 → 抵达」时段内的天气，不看全天预报。</p>
    <label>降水概率阈值 / %
      <input type="number" min="1" max="100" value={commute.threshold}
        onChange={e => set('threshold', number(e.target.value))} />
    </label>
    <p className="fine-print">{thresholdHint || '达到该概率、出现降水或降水现象预报时，判定为需要提前。'}</p>
    <div className="service-row">
      <strong>天气地点<small>{location?.example ? '当前为示例位置，并非你所在城市' : '用于判断通勤时段天气'}</small></strong>
      <span className="capsule">{location?.name || '未设置'}</span>
    </div>
    <button className="soft-button" onClick={onLocate} disabled={locating}>
      {locating ? '定位中…' : '使用我现在的位置'}
    </button>
    <p className="fine-print">天气缺失时不会按晴天处理，界面会明确显示「天气未知」。</p>
  </section>;
}

// A03：独立的「主铃音色」组。复用 main 已有的 5 种 Web Audio 合成铃声。
export function RingtoneSettings({ prefs, onChange, onPreview, previewing }) {
  const set = (key, val) => onChange(old => ({ ...old, [key]: val }));
  return <section className="panel glass settings-group">
    <div className="section-title"><h2>主铃音色</h2><span className="capsule">{RINGTONES.length} 种</span></div>
    <p className="fine-print">主铃按基础闹钟的原定时间响起，环境音只是提前铺垫，不会延后主铃。</p>
    <div className="ringtone-list">
      {RINGTONES.map(r => <button key={r.id} type="button"
        className={`ringtone-item ${prefs.ringtone === r.id ? 'selected' : ''}`}
        aria-pressed={prefs.ringtone === r.id}
        onClick={() => set('ringtone', r.id)}>
        <strong>{r.name}</strong>
        <small>{r.desc}</small>
      </button>)}
    </div>
    <label>主铃音量 / %
      <input type="number" min="0" max="100" value={Math.round((prefs.volume ?? 1) * 100)}
        onChange={e => set('volume', Math.max(0, Math.min(100, number(e.target.value) || 0)) / 100)} />
    </label>
    <button className="soft-button" onClick={onPreview} disabled={previewing}>
      {previewing ? '试听中…' : '试听所选铃声'}
    </button>
  </section>;
}

// A06 + A08：下一次安排卡片。状态全部来自 plan.status，不再用自由文本拼装。
const STATUS_TONE = {
  ready: 'ok', weather_unknown: 'warn', route_failed: 'warn',
  capped: 'warn', needs_confirmation: 'warn', unavailable: 'idle',
};
const EXEC_TEXT = {
  suggested: '尚未保存', saved: '已保存到本机', synced: '已同步到账号', failed: '保存失败',
};

const fmt = (t) => t == null ? '—' : new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function NextPlanCard({ plan, baseAlarm, onApply, applyDisabled }) {
  const tone = STATUS_TONE[plan?.status] || 'idle';
  const hasPlan = plan && plan.wakeAt != null;
  return <section className="panel glass plan-overview">
    <div className="section-title">
      <h2>下一次安排</h2>
      <span className={`status-pill ${tone}`}>{plan?.statusText || '尚未计算'}</span>
    </div>
    <div className="overview-grid">
      <div><small>基础闹钟</small><strong>{fmt(baseAlarm?.at)}</strong></div>
      <div><small>主要提前唤醒</small><strong>{fmt(plan?.wakeAt)}</strong></div>
      <div><small>出发时间</small><strong>{fmt(plan?.departAt)}</strong></div>
    </div>
    {/* A06：固定模式不需要路线，但「出发时间」必须有行程耗时才算得出来。
        以前这里直接显示「—」，看着像算错了；现在说清是缺哪一项。 */}
    {hasPlan && plan.departAt == null && <p className="fine-print">
      出发时间需要在通勤页查询一次高德路线（用来确定路上要走多久）。固定模式不依赖路线，所以提前唤醒时间仍然有效。
    </p>}
    <p className="fine-print">{hasPlan
      ? `${plan.mode === 'fixed' ? '固定模式' : '智能通勤'} · 提前 ${plan.candidates?.[plan.mode]?.advance ?? '—'} 分钟 · ${plan.reason}`
      : (plan?.reason || '还没有可用的唤醒方案。')}</p>
    {plan?.routeNote && <p className="fine-print route-note">{plan.routeNote}</p>}
    <p className="fine-print">
      {plan?.executionState ? `保存状态：${EXEC_TEXT[plan.executionState] || plan.executionState}。` : ''}
      {plan?.source ? `数据来源：${plan.source}。` : ''}
      {hasPlan ? '' : '页面不会声称自动提前已经完成。'}
    </p>
    {onApply && <div className="button-line">
      <button className="lime-button" onClick={onApply} disabled={applyDisabled || !hasPlan}>
        设为提前唤醒
      </button>
    </div>}
  </section>;
}

// A06：缺口提示条。上限不足时如实告知「还差 N 分钟」，不承诺准时。
export function GapNotice({ plan }) {
  if (!plan || plan.status !== PLAN_STATUS.CAPPED || !plan.gapMinutes) return null;
  return <div className="gap-notice" role="alert">
    <strong>还差 {plan.gapMinutes} 分钟</strong>
    <span>按当前智能上限只能提前这么多，可能赶不上目标时间。可以调高上限、提前出发，或接受现状。</span>
  </div>;
}
