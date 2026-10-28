// ⚠️ DEMO ONLY —— 本文件是早期场景演示用的独立决策层，产品界面（Dashboard / server）不使用它。
// 真正在跑的计划逻辑在 src/plan.js（候选 → 合并 → 状态）。两者并存只是为了让
// tests/planner.test.js 里的场景推演仍可复现，避免把演示口径误当成线上口径。
// 如果要在 UI 里用这里的任何函数，请先把它并入 plan.js，并删掉这条注释。
//
// 纯函数决策层。天气与路线来自可替换的数据适配器，不依赖大模型计算时间。
export const DEMO_ONLY = true;

export const defaults = {
  arrival: '09:00', preparation: 40, buffer: 10, extra: 5,
  normalDuration: 30, alternateDuration: 45, maxAdvance: 30,
  mode: '骑行', alternateMode: '地铁', alarmAuthorized: true,
};

export const scenarios = {
  sunny: { label: '晴天', weather: '晴', affected: false, routeDelay: 0 },
  rain: { label: '早高峰降雨', weather: '雨', affected: true, routeDelay: 0 },
  snow: { label: '降雪与通勤延误', weather: '雪', affected: true, routeDelay: 20 },
  offline: { label: '天气数据不可用', unavailable: true },
};

export function minutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请输入有效的到达时间');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}
export function clock(value) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const result = `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
  return value < 0 ? `前一天 ${result}` : result;
}
export function validate(profile) {
  minutes(profile.arrival);
  for (const key of ['preparation', 'buffer', 'extra', 'normalDuration', 'alternateDuration', 'maxAdvance']) {
    if (!Number.isInteger(profile[key]) || profile[key] < 0 || profile[key] > 240) {
      throw new Error('分钟数须为 0 到 240 的整数');
    }
  }
  if (!['骑行', '步行', '自驾', '地铁'].includes(profile.mode)) throw new Error('请选择有效的通勤方式');
  if (!['地铁', '公交', '步行'].includes(profile.alternateMode)) throw new Error('请选择有效的备选方式');
  if (typeof profile.alarmAuthorized !== 'boolean') throw new Error('闹钟授权设置无效');
}
export function plan(profile, scenarioId) {
  validate(profile);
  const source = scenarios[scenarioId];
  if (!source) throw new Error('未知天气场景');
  const arrival = minutes(profile.arrival);
  const baselineWake = arrival - profile.buffer - profile.normalDuration - profile.preparation;
  const sensitive = ['骑行', '步行'].includes(profile.mode);
  const switchRoute = source.affected && sensitive;
  const duration = (switchRoute ? profile.alternateDuration : profile.normalDuration) + (source.routeDelay || 0);
  const extra = source.affected && profile.mode !== '地铁' ? profile.extra : 0;
  const depart = arrival - profile.buffer - duration;
  const calculatedWake = depart - profile.preparation - extra;
  // 默认不延后，保留原有作息的安全边界。
  const wake = Math.min(baselineWake, calculatedWake);
  const advance = baselineWake - wake;
  const status = source.unavailable ? 'unavailable' : !profile.alarmAuthorized ? 'unauthorized' : advance > profile.maxAdvance ? 'approval' : 'ready';
  return {
    scenarioId, status, baselineWake, wake, depart, arrival: arrival - profile.buffer,
    advance, duration, extra, mode: switchRoute ? profile.alternateMode : profile.mode,
    reason: source.unavailable ? '天气数据不可用，保留已有闹钟。' :
      `模拟天气：${source.weather}；${switchRoute ? `由${profile.mode}改为${profile.alternateMode}` : `继续${profile.mode}`}，路线预计 ${duration} 分钟，额外准备 ${extra} 分钟，到达余量 ${profile.buffer} 分钟。`,
    steps: ['读取通勤目标与授权范围', `获取模拟天气：${source.weather || '不可用'}`, '比较常用与备选路线', '倒推叫醒和出发时间', '检查提前上限与闹钟授权'],
  };
}

// Demo 适配器：只写入本地模拟执行记录，不代表系统闹钟设置成功。
export function simulateAlarm(result, profile, confirm = false) {
  if (result.status === 'unavailable') throw new Error('数据不可用，保留已有闹钟');
  if (!profile.alarmAuthorized) throw new Error('未授权闹钟，不能执行');
  if (result.status === 'approval' && !confirm) throw new Error('超过授权上限，需要确认本次执行');
  return { id: crypto.randomUUID(), at: new Date().toISOString(), state: 'simulated',
    wake: result.wake, baselineWake: result.baselineWake, advance: result.advance,
    mode: result.mode, scenario: scenarios[result.scenarioId].label, reason: result.reason,
    confirmed: confirm, feedback: null };
}
