import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFixedCandidate } from '../src/fixedAdvance.js';
import { calculateSmartCandidate } from '../src/smartAdvance.js';
import { mergeAdvanceCandidates } from '../src/mergeAdvance.js';
import { checkAlarmTiming } from '../src/alarmTiming.js';
import { suggestAlarmWrite } from '../src/alarmWrite.js';

const sample = Object.freeze({
  baseAlarmAt: Date.parse('2026-10-30T07:00:00+08:00'),
  arrivalAt: Date.parse('2026-10-30T08:00:00+08:00'),
  now: Date.parse('2026-10-30T05:00:00+08:00'),
  updatedAt: Date.parse('2026-10-30T05:00:00+08:00'),
  validUntil: Date.parse('2026-10-30T05:15:00+08:00'),
  fixedEnabled: true, smartEnabled: true, fixedMinutes: 30, maxAdvance: 60,
  durationMinutes: 60, preparation: 30, buffer: 10, extra: 10, weatherTriggered: true,
});

// 离线场景的接入层示例，不请求天气，也不执行实际保存。
function calculate(changes = {}, previous) {
  const args = { ...sample, ...changes };
  const base = { id: 'base-1', at: args.baseAlarmAt, enabled: true, repeat: 'daily' };
  const rawFixed = calculateFixedCandidate(args);
  const fixedCandidate = rawFixed.status === 'ready'
    ? { ...rawFixed, validUntil: args.validUntil, updatedAt: args.updatedAt } : rawFixed;
  const smartCandidate = calculateSmartCandidate(args);
  const merged = mergeAdvanceCandidates({ ...args, fixedCandidate, smartCandidate });
  const alarms = previous ?? [base];
  const operation = suggestAlarmWrite({ mergeResult: merged, alarms, baseAlarmId: base.id, commutePlanId: 'commute-1', now: args.now });
  return { args, fixedCandidate, smartCandidate, merged, operation, alarms };
}

test('设置检查 → 两种候选 → 合并 → 单条创建建议，基础07:00仍独立', () => {
  const timing = checkAlarmTiming({ ...sample, recheckAt: sample.now, ambientEnabled: true, ambientOffset: 5 });
  assert.equal(timing.ok, true);
  const flow = calculate();
  assert.equal(flow.fixedCandidate.wakeAt, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(flow.smartCandidate.wakeAt, Date.parse('2026-10-30T06:10:00+08:00'));
  assert.equal(flow.operation.action, 'create');
  assert.equal(flow.operation.patch.at, Date.parse('2026-10-30T06:10:00+08:00'));
  assert.equal(flow.alarms.length, 1);
  assert.equal(flow.alarms[0].at, Date.parse('2026-10-30T07:00:00+08:00'));
});

test('固定或智能单独开启均能完成离线计算链路', () => {
  const fixed = calculate({ smartEnabled: false });
  assert.equal(fixed.operation.patch.at, Date.parse('2026-10-30T06:30:00+08:00'));
  const smart = calculate({ fixedEnabled: false });
  assert.equal(smart.operation.patch.at, Date.parse('2026-10-30T06:10:00+08:00'));
});

test('路线失败时固定仍可用，不要求高德先成功', () => {
  const flow = calculate({ durationMinutes: null });
  assert.equal(flow.smartCandidate.status, 'route_failed');
  assert.equal(flow.merged.selectedMode, 'fixed');
  assert.equal(flow.operation.action, 'create');
  const onlySmart = calculate({ fixedEnabled: false, durationMinutes: null });
  assert.equal(onlySmart.operation.action, 'keep_existing');
});

test('天气未知、未触发或数据过期不创建额外闹钟', () => {
  for (const changes of [{ weatherTriggered: null }, { weatherTriggered: false }, { validUntil: sample.now }]) {
    const flow = calculate(changes);
    assert.equal(flow.operation.action, 'keep_existing');
    assert.equal(flow.operation.patch, null);
    assert.equal(flow.alarms.length, 1);
  }
});

test('智能达到上限时保留缺口；固定更早时仍选固定', () => {
  const smartOnly = calculate({ fixedEnabled: false, maxAdvance: 30 });
  assert.equal(smartOnly.operation.patch.at, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(smartOnly.operation.patch.planStatus, 'capped');
  assert.equal(smartOnly.operation.patch.gapMinutes, 20);
  const both = calculate({ maxAdvance: 20 });
  assert.equal(both.smartCandidate.gapMinutes, 30);
  assert.equal(both.merged.selectedMode, 'fixed');
  assert.equal(both.operation.patch.at, Date.parse('2026-10-30T06:30:00+08:00'));
});

test('智能上限0且没有固定时保留基础，不生成同时间重复铃', () => {
  const flow = calculate({ fixedEnabled: false, maxAdvance: 0 });
  assert.equal(flow.smartCandidate.gapMinutes, 50);
  assert.equal(flow.operation.action, 'keep_existing');
});

test('模拟保存一次后重复计算无需新增，最终仍是一条基础加一条主要闹钟', () => {
  const first = calculate();
  const saved = { ...first.operation.patch, id: 'primary-1' };
  const alarms = Object.freeze([Object.freeze(first.alarms[0]), Object.freeze(saved)]);
  const second = calculate({}, alarms);
  assert.equal(second.operation.action, 'noop');
  assert.equal(second.operation.targetId, 'primary-1');
  assert.equal(alarms.length, 2);
  const unknown = calculate({ weatherTriggered: null }, alarms);
  assert.equal(unknown.operation.action, 'keep_existing');
  assert.equal(alarms[1].at, Date.parse('2026-10-30T06:10:00+08:00'));
});

test('页面恢复后先重算，也不能把尚未由调度处理的06:00旧铃延至06:30', () => {
  const alarms = Object.freeze([
    Object.freeze({ id: 'base-1', at: sample.baseAlarmAt, enabled: true }),
    Object.freeze({ id: 'primary-1', planKind: 'primary', commutePlanId: 'commute-1',
      baseAlarmId: 'base-1', baseAlarmAt: sample.baseAlarmAt,
      at: Date.parse('2026-10-30T06:00:00+08:00'), enabled: true, state: 'armed' }),
  ]);
  const flow = calculate({ smartEnabled: false,
    now: Date.parse('2026-10-30T06:10:00+08:00'), updatedAt: Date.parse('2026-10-30T06:10:00+08:00'),
    validUntil: Date.parse('2026-10-30T06:25:00+08:00'),
  }, alarms);
  assert.equal(flow.merged.candidate.wakeAt, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(flow.operation.action, 'blocked');
  assert.equal(flow.operation.patch, null);
  assert.equal(alarms[1].at, Date.parse('2026-10-30T06:00:00+08:00'));
});

test('跨午夜计算、上限、合并和保存建议使用完整日期', () => {
  const flow = calculate({
    now: Date.parse('2026-10-29T22:00:00+08:00'), updatedAt: Date.parse('2026-10-29T22:00:00+08:00'),
    validUntil: Date.parse('2026-10-29T22:15:00+08:00'),
    baseAlarmAt: Date.parse('2026-10-30T00:30:00+08:00'), arrivalAt: Date.parse('2026-10-30T01:00:00+08:00'),
  });
  assert.equal(flow.operation.patch.at, Date.parse('2026-10-29T23:30:00+08:00'));
  assert.equal(flow.operation.patch.baseAlarmAt, Date.parse('2026-10-30T00:30:00+08:00'));
  assert.equal(flow.operation.patch.gapMinutes, 20);
});
