// 展示诊断，不表示已调用持久化或设备接口。时间均为毫秒。
export function summarizeCommute({baseAlarmAt, merged, smartCandidate, write, alarms=[], now, baseAlarmId, commutePlanId}={}) {
  let retained = typeof write?.targetId === 'string' && write.targetId.trim()
    ? alarms.find(a => a?.id === write.targetId) : null;
  if (!retained && write?.action === 'keep_existing' && typeof baseAlarmId === 'string'
    && baseAlarmId.trim() && typeof commutePlanId === 'string' && commutePlanId.trim()) {
    const matches = alarms.filter(a => a?.planKind === 'primary' && a.enabled === true
      && a.state !== 'ringing' && a.baseAlarmId === baseAlarmId && a.baseAlarmAt === baseAlarmAt
      && a.commutePlanId === commutePlanId && typeof a.id === 'string' && a.id.trim()
      && Number.isSafeInteger(a.at) && a.at > now && a.at < baseAlarmAt);
    if (matches.length === 1) retained = matches[0];
  }
  const existing = (write?.action === 'keep_existing' || write?.action === 'noop') && retained;
  const wakeAt = write?.patch?.at ?? (existing ? retained.at : null);
  const desiredWakeAt = smartCandidate?.desiredWakeAt ?? null;
  const canAssess = wakeAt != null && desiredWakeAt != null;
  const gapMinutes = canAssess ? Math.max(0, Math.ceil((wakeAt-desiredWakeAt)/60000)) : null;
  return {
    baseAlarmAt, proposedWakeAt:merged?.candidate?.wakeAt ?? null, wakeAt,
    advanceMinutes:wakeAt == null ? null : Math.ceil((baseAlarmAt-wakeAt)/60000),
    selectedMode:existing ? retained.source ?? null : merged?.selectedMode ?? null,
    desiredWakeAt, gapMinutes,
    executionState: existing ? 'existing_record' : 'suggested',
    message: write?.action === 'blocked' ? `暂不可应用：${write.reason}`
      : wakeAt == null ? '没有新的有效提前建议；保留基础闹钟和已有记录，通勤时间是否足够尚未确认。'
      : gapMinutes == null ? '已得到提前时间，但缺少有效通勤数据，不能确认是否足够。'
      : gapMinutes > 0 ? `按提供的通勤数据，最终时间仍有约 ${gapMinutes} 分钟缺口。`
      : '按提供的通勤数据暂无时间缺口；这不是准时到达保证。',
  };
}
