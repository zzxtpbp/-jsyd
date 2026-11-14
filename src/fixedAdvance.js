// 仅生成候选；天气触发判断、数据有效期及闹钟保存由调用方负责。
// baseAlarmAt / wakeAt 为带日期的 Unix 毫秒时间戳，不能传 HH:mm。
export function calculateFixedCandidate({ baseAlarmAt, fixedEnabled, fixedMinutes, weatherTriggered } = {}) {
  const validBase = Number.isSafeInteger(baseAlarmAt) && Number.isFinite(new Date(baseAlarmAt).getTime());
  const result = {
    baseAlarmAt: validBase ? baseAlarmAt : null,
    wakeAt: null, departAt: null, reason: '', validUntil: null,
    gapMinutes: null, status: 'unavailable', source: 'fixed',
    updatedAt: null, executionState: 'suggested',
  };
  if (typeof fixedEnabled !== 'boolean') return { ...result, reason: '固定模式开关无效。' };
  if (!fixedEnabled) return { ...result, reason: '固定提前模式未开启。' };
  if (!validBase) return { ...result, reason: '基础闹钟需提供有效的毫秒时间戳。' };
  if (!Number.isInteger(fixedMinutes) || fixedMinutes < 0 || fixedMinutes > 240) {
    return { ...result, reason: '固定提前量需为 0 到 240 的整数分钟。' };
  }
  if (fixedMinutes === 0) return { ...result, reason: '提前量为零，沿用基础闹钟，不生成重复候选。' };
  if (typeof weatherTriggered !== 'boolean') {
    return { ...result, status: 'weather_unknown', reason: '天气触发结果未知，暂不生成固定提前候选。' };
  }
  if (!weatherTriggered) return { ...result, reason: '天气未达到触发条件。' };
  const wakeAt = baseAlarmAt - fixedMinutes * 60000;
  if (!Number.isFinite(new Date(wakeAt).getTime())) return { ...result, reason: '提前后的时间超出有效日期范围。' };
  return { ...result, wakeAt, status: 'ready', reason: `天气达到触发条件，按用户设置提前 ${fixedMinutes} 分钟。` };
}
