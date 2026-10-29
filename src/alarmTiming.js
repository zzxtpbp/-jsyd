// 仅检查时间关系；HH:mm、日期及用户时区需由调用方转换成完整时间戳。
export function checkAlarmTiming(options = {}) {
  const { baseAlarmAt, recheckAt, fixedEnabled, smartEnabled, fixedMinutes,
    maxAdvance, ambientEnabled = false, ambientOffset,
    fallback = '保留基础闹钟' } = options ?? {};
  const issues = [];
  const warnings = [];
  const isTime = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
  const issue = (code, message) => issues.push({ code, message });
  if ([fixedEnabled, smartEnabled, ambientEnabled].some(value => typeof value !== 'boolean')) issue('invalid_switch', '模式和环境音开关必须是布尔值。');
  if (!fixedEnabled && !smartEnabled) issue('no_mode', '请至少开启一种提前模式。');
  if (!isTime(baseAlarmAt) || !isTime(recheckAt)) issue('invalid_time', '基础与复查时间必须是包含日期的有效毫秒时间戳。');
  for (const [enabled, minutes] of [[fixedEnabled, fixedMinutes], [smartEnabled, maxAdvance]]) {
    if (enabled === true && (!Number.isInteger(minutes) || minutes < 0 || minutes > 240)) issue('invalid_minutes', '已开启模式的提前分钟需为 0 到 240 的整数。');
  }
  if (ambientEnabled === true && (!Number.isInteger(ambientOffset) || ambientOffset < 1 || ambientOffset > 60)) issue('invalid_ambient_offset', '铃前环境音应提前 1 到 60 整数分钟。');
  if (!['保留基础闹钟', '仅按固定模式'].includes(fallback)) issue('invalid_fallback', '备用策略无效。');
  if (fallback === '仅按固定模式' && fixedEnabled !== true) issue('fixed_fallback_disabled', '固定模式未开启，不能作为备用方式。');
  if (smartEnabled === true && fixedEnabled === false) warnings.push({ code: 'smart_without_fixed', message: '建议同时开启固定模式作为备用；仍可只使用智能模式。' });
  if (issues.length) return { ok: false, earliestAlarmAt: null, earliestSoundAt: null, issues, warnings };
  const earliestAlarmAt = baseAlarmAt - Math.max(fixedEnabled ? fixedMinutes : 0, smartEnabled ? maxAdvance : 0) * 60000;
  const earliestSoundAt = earliestAlarmAt - (ambientEnabled ? ambientOffset * 60000 : 0);
  if (!isTime(earliestSoundAt)) issue('invalid_result_time', '最早发声时间超出有效日期范围。');
  else if (recheckAt >= earliestSoundAt) issue('recheck_too_late', '复查必须早于最早可能发声时间；备用选项不能替代有效的提前计算。');
  return { ok: issues.length === 0, earliestAlarmAt, earliestSoundAt, issues, warnings };
}
