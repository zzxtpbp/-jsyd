// 只选择建议，不创建、更新或删除闹钟。所有时间均为 Unix 毫秒。
export function mergeAdvanceCandidates(options = {}) {
  const { baseAlarmAt, fixedEnabled, smartEnabled, fixedCandidate, smartCandidate, now } = options ?? {};
  const isTime = value => Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
  const unavailable = {
    status: 'unavailable', candidate: null, selectedMode: null,
    action: 'keep_existing', reason: '没有有效新候选，保留基础闹钟及仍有效的已有计划。',
  };
  if (!isTime(now) || !isTime(baseAlarmAt) || baseAlarmAt <= now) {
    return { ...unavailable, reason: '当前时间或基础时间无效，或基础闹钟已经到期；暂不更新。' };
  }
  let selected = null;
  let selectedMode = null;
  for (const [mode, enabled, candidate] of [
    ['fixed', fixedEnabled, fixedCandidate], ['smart', smartEnabled, smartCandidate],
  ]) {
    if (enabled !== true || !candidate || candidate.baseAlarmAt !== baseAlarmAt) continue;
    const capped = mode === 'smart' && candidate.status === 'capped'
      && Number.isFinite(candidate.gapMinutes) && candidate.gapMinutes > 0;
    if (candidate.status !== 'ready' && !capped) continue;
    if (!isTime(candidate.wakeAt) || candidate.wakeAt <= now || candidate.wakeAt >= baseAlarmAt) continue;
    if (!isTime(candidate.validUntil) || candidate.validUntil <= now) continue;
    // 固定先遍历；并列时保持固定，重复计算不会来回切换。
    if (!selected || candidate.wakeAt < selected.wakeAt) {
      selected = candidate;
      selectedMode = mode;
    }
  }
  if (!selected) return unavailable;
  return {
    status: selected.status, selectedMode, action: 'suggest',
    candidate: { ...selected, executionState: 'suggested' },
    reason: selected.status === 'capped'
      ? '已选择较早的有效候选，但智能提前受上限限制，仍存在时间缺口。'
      : '已选择开启模式中较早的有效候选；基础闹钟保持独立。',
  };
}
