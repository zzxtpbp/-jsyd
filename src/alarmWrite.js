// 返回保存操作建议；实际持久化、唯一约束和设备执行由调用方实现。
export function suggestAlarmWrite(options = {}) {
  const { mergeResult, alarms, baseAlarmId, commutePlanId, now } = options ?? {};
  const response = (action, reason, extra = {}) => ({ action, reason, targetId: null, patch: null, idempotencyKey: null, ...extra });
  if (mergeResult?.action !== 'suggest') return response('keep_existing', '没有新候选，本次不写入或删除。');
  const isTime = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
  const isId = value => typeof value === 'string' && value.trim().length > 0;
  if (!isTime(now) || !Array.isArray(alarms) || !isId(baseAlarmId) || !isId(commutePlanId)) return response('blocked', '时间、闹钟列表或计划归属无效。');
  const ids = alarms.map(alarm => alarm?.id).filter(isId);
  if (new Set(ids).size !== ids.length) return response('blocked', '现有闹钟包含重复 ID，需先处理记录冲突。');
  const base = alarms.find(alarm => alarm?.id === baseAlarmId);
  const candidate = mergeResult.candidate;
  if (!base || base.enabled !== true || base.planKind === 'primary' || !isTime(base.at) || base.at <= now) return response('blocked', '基础闹钟不存在、关闭、到期或不是独立基础闹钟。');
  const capped = mergeResult.selectedMode === 'smart' && candidate?.status === 'capped'
    && Number.isFinite(candidate.gapMinutes) && candidate.gapMinutes > 0;
  if (!['fixed', 'smart'].includes(mergeResult.selectedMode) || !candidate
    || mergeResult.status !== candidate.status || (candidate.status !== 'ready' && !capped)
    || candidate.baseAlarmAt !== base.at
    || !isTime(candidate.wakeAt) || candidate.wakeAt <= now || candidate.wakeAt >= base.at
    || !isTime(candidate.validUntil) || candidate.validUntil <= now) {
    return response('blocked', '候选已失效、待确认，或基础闹钟时间发生变化；请重新计算。');
  }
  const primary = alarms.filter(alarm => alarm?.planKind === 'primary');
  if (primary.some(alarm => !isId(alarm.commutePlanId))) return response('blocked', '存在未标明通勤计划归属的旧主要闹钟，需先完成迁移。');
  const matches = primary.filter(alarm => alarm.commutePlanId === commutePlanId);
  if (matches.length > 1 || (matches[0] && !isId(matches[0].id))) return response('blocked', '同一计划的主要闹钟记录冲突，不能自动选择或删除。');
  const existing = matches[0];
  const idempotencyKey = JSON.stringify([commutePlanId, baseAlarmId, base.at]);
  const target = { targetId: existing?.id ?? null, idempotencyKey };
  if (existing?.state === 'ringing') return response('blocked', '主要闹钟正在响铃，暂不覆盖。', target);
  if (existing?.enabled === true && isTime(existing.at) && existing.at <= now) return response('blocked', '已有启用的主要闹钟已到期，需先由调度处理，不能重置为更晚时间。', target);
  if (existing?.enabled === true && existing.baseAlarmId === baseAlarmId && existing.baseAlarmAt === base.at && isTime(existing.at)
    && existing.at > now && existing.at < candidate.wakeAt) {
    return response('keep_existing', '已有同次主要闹钟更早，本次不延后。', target);
  }
  const patch = {
    at: candidate.wakeAt, label: existing?.label ?? '主要提前唤醒',
    enabled: true, repeat: 'once', state: 'armed', planKind: 'primary',
    commutePlanId, baseAlarmId, baseAlarmAt: base.at,
    departAt: candidate.departAt ?? null, desiredWakeAt: candidate.desiredWakeAt ?? null,
    reason: candidate.reason ?? '', source: candidate.source ?? null,
    validUntil: candidate.validUntil, updatedAt: candidate.updatedAt ?? null,
    gapMinutes: candidate.gapMinutes ?? null, planStatus: candidate.status,
  };
  if (existing && Object.entries(patch).every(([key, value]) => existing[key] === value)) return response('noop', '记录已经一致，无需重复保存。', target);
  return response(existing ? 'update' : 'create', existing ? '建议更新同一主要闹钟，保留其 ID。' : '建议创建一条主要提前闹钟。', { ...target, patch });
}
