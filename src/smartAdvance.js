// 只消费已验证的天气/路线数据，不查询接口、不写入闹钟。
export function calculateSmartCandidate(options = {}) {
  const { baseAlarmAt, arrivalAt, durationMinutes, preparation, buffer, extra,
    maxAdvance, smartEnabled, weatherTriggered, validUntil, updatedAt, now } = options ?? {};
  const isTime = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
  const result = {
    baseAlarmAt: isTime(baseAlarmAt) ? baseAlarmAt : null,
    wakeAt: null, desiredWakeAt: null, departAt: null, gapMinutes: null,
    status: 'unavailable', source: 'smart', reason: '',
    validUntil: null, updatedAt: null, executionState: 'suggested',
  };
  if (smartEnabled !== true) return { ...result, reason: '智能模式未开启或开关无效。' };
  if (!isTime(now) || !isTime(baseAlarmAt) || !isTime(arrivalAt) || baseAlarmAt <= now || arrivalAt <= now) {
    return { ...result, reason: '需要有效且尚未到期的基础及到达时间。' };
  }
  if (typeof weatherTriggered !== 'boolean') return { ...result, status: 'weather_unknown', reason: '天气触发结果未知。' };
  if (!weatherTriggered) return { ...result, reason: '天气未达到触发条件。' };
  if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) {
    return { ...result, status: 'route_failed', reason: '缺少有效路线耗时；不能假定零分钟。' };
  }
  if ([preparation, buffer, extra, maxAdvance].some(value => !Number.isInteger(value) || value < 0 || value > 240)) {
    return { ...result, reason: '准备、余量、额外准备和智能上限需为 0 到 240 的整数分钟。' };
  }
  if (!isTime(validUntil) || validUntil <= now || !isTime(updatedAt) || updatedAt > now) {
    return { ...result, reason: '数据有效期或更新时间缺失、过期或无效。' };
  }
  const departAt = arrivalAt - (durationMinutes + buffer) * 60000;
  const desiredWakeAt = departAt - (preparation + extra) * 60000;
  if (!isTime(departAt) || !isTime(desiredWakeAt)) return { ...result, reason: '倒推后的时间超出有效范围。' };
  const calculated = { ...result, desiredWakeAt, departAt, validUntil, updatedAt };
  if (desiredWakeAt >= baseAlarmAt) return { ...calculated, reason: '无需提前，保留基础闹钟。' };
  const wakeAt = Math.max(desiredWakeAt, baseAlarmAt - maxAdvance * 60000);
  if (!isTime(wakeAt) || wakeAt <= now) return { ...calculated, reason: '建议叫醒时间已经错过，暂不创建过去闹钟。' };
  const gapMinutes = Math.ceil((wakeAt - desiredWakeAt) / 60000);
  return {
    ...calculated, wakeAt: wakeAt < baseAlarmAt ? wakeAt : null, gapMinutes,
    status: gapMinutes > 0 ? 'capped' : 'ready',
    reason: gapMinutes > 0
      ? `受用户智能提前上限限制，距满足到达目标仍差约 ${gapMinutes} 分钟。`
      : '按提供的交通耗时、准备时间与到达余量倒推智能提前候选。',
  };
}
