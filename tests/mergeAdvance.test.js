import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAdvanceCandidates } from '../src/mergeAdvance.js';

const now = Date.parse('2026-10-30T05:00:00+08:00');
const baseAlarmAt = Date.parse('2026-10-30T07:00:00+08:00');
const fixedCandidate = Object.freeze({
  baseAlarmAt, wakeAt: Date.parse('2026-10-30T06:30:00+08:00'),
  status: 'ready', reason: '固定提前 30 分钟', source: 'fixed',
  validUntil: Date.parse('2026-10-30T05:15:00+08:00'),
  updatedAt: now, departAt: null, gapMinutes: null, executionState: 'suggested',
});
const smartCandidate = Object.freeze({
  ...fixedCandidate, wakeAt: Date.parse('2026-10-30T06:10:00+08:00'),
  departAt: Date.parse('2026-10-30T07:40:00+08:00'),
  reason: '通勤耗时与准备时间倒推', source: 'smart',
});
const input = Object.freeze({ baseAlarmAt, now, fixedEnabled: true, smartEnabled: true, fixedCandidate, smartCandidate });

test('两种模式取较早时间，只返回一个建议并保留基础时间', () => {
  const result = mergeAdvanceCandidates(input);
  assert.equal(result.action, 'suggest');
  assert.equal(result.status, 'ready');
  assert.equal(result.selectedMode, 'smart');
  assert.equal(result.candidate.wakeAt, Date.parse('2026-10-30T06:10:00+08:00'));
  assert.equal(result.candidate.baseAlarmAt, baseAlarmAt);
  assert.equal(result.candidate.departAt, Date.parse('2026-10-30T07:40:00+08:00'));
});

test('固定候选更早时选固定，相同时间也稳定选固定', () => {
  for (const wakeAt of [Date.parse('2026-10-30T06:00:00+08:00'), smartCandidate.wakeAt]) {
    const result = mergeAdvanceCandidates({ ...input, fixedCandidate: { ...fixedCandidate, wakeAt } });
    assert.equal(result.selectedMode, 'fixed');
    assert.equal(result.candidate.wakeAt, wakeAt);
  }
});

test('只开启一种模式时不使用另一模式更早的时间', () => {
  const fixedOnly = mergeAdvanceCandidates({ ...input, smartEnabled: false });
  assert.equal(fixedOnly.selectedMode, 'fixed');
  assert.equal(fixedOnly.candidate.wakeAt, Date.parse('2026-10-30T06:30:00+08:00'));
  const smartOnly = mergeAdvanceCandidates({ ...input, fixedEnabled: false });
  assert.equal(smartOnly.selectedMode, 'smart');
});

test('过期、缺少有效期或无效有效期的较早智能候选不能覆盖固定候选', () => {
  for (const validUntil of [now - 1, now, null, undefined, NaN, Infinity, '2026-10-30T05:15:00+08:00', 8640000000000001]) {
    const result = mergeAdvanceCandidates({ ...input, smartCandidate: { ...smartCandidate, validUntil } });
    assert.equal(result.selectedMode, 'fixed');
  }
});

test('未知天气、路线失败、不可用和待确认状态均不参与合并', () => {
  for (const status of ['weather_unknown', 'route_failed', 'unavailable', 'needs_confirmation', 'approval', undefined]) {
    const result = mergeAdvanceCandidates({ ...input, smartCandidate: { ...smartCandidate, status } });
    assert.equal(result.selectedMode, 'fixed');
  }
});

test('唤醒时间必须仍在未来且早于基础，不能生成延后或重复基础的闹钟', () => {
  for (const wakeAt of [now - 1, now, baseAlarmAt, baseAlarmAt + 60000, null, NaN, Infinity, '06:10', 8640000000000001]) {
    const result = mergeAdvanceCandidates({ ...input, smartCandidate: { ...smartCandidate, wakeAt } });
    assert.equal(result.selectedMode, 'fixed');
  }
});

test('其他日期或其他基础时间的候选不能混入本次计划', () => {
  const result = mergeAdvanceCandidates({ ...input, smartCandidate: { ...smartCandidate, baseAlarmAt: baseAlarmAt + 86400000 } });
  assert.equal(result.selectedMode, 'fixed');
});

test('没有有效候选时明确不更新，不用基础闹钟伪造新候选', () => {
  for (const changes of [
    { fixedEnabled: false, smartEnabled: false },
    { fixedCandidate: null, smartCandidate: null },
    { fixedCandidate: undefined, smartCandidate: undefined },
    { fixedCandidate: { ...fixedCandidate, status: 'weather_unknown' }, smartCandidate: { ...smartCandidate, status: 'route_failed' } },
  ]) {
    const result = mergeAdvanceCandidates({ ...input, ...changes });
    assert.equal(result.action, 'keep_existing');
    assert.equal(result.candidate, null);
    assert.equal(result.selectedMode, null);
    assert.equal(result.status, 'unavailable');
  }
});

test('非法公共时间或已经到期的基础闹钟不能生成候选', () => {
  for (const changes of [
    { now: undefined }, { now: null }, { now: NaN }, { now: Infinity }, { now: '05:00' },
    { baseAlarmAt: null }, { baseAlarmAt: NaN }, { baseAlarmAt: 8640000000000001 },
    { baseAlarmAt: now }, { baseAlarmAt: now - 1 },
  ]) {
    const result = mergeAdvanceCandidates({ ...input, ...changes });
    assert.equal(result.action, 'keep_existing');
    assert.equal(result.candidate, null);
  }
});

test('字符串开关不能按真值开启模式', () => {
  const result = mergeAdvanceCandidates({ ...input, fixedEnabled: 'true', smartEnabled: 'false' });
  assert.equal(result.action, 'keep_existing');
  assert.equal(result.candidate, null);
});

test('智能上限处理后的候选保留 capped 与缺口，不能伪装为完全足够', () => {
  const result = mergeAdvanceCandidates({ ...input, smartCandidate: { ...smartCandidate, status: 'capped', gapMinutes: 15 } });
  assert.equal(result.selectedMode, 'smart');
  assert.equal(result.status, 'capped');
  assert.equal(result.candidate.status, 'capped');
  assert.equal(result.candidate.gapMinutes, 15);
});

test('没有有效缺口的 capped 智能结果和 capped 固定结果不能作为可用候选', () => {
  for (const gapMinutes of [null, undefined, 0, -1, NaN, Infinity, '15']) {
    const result = mergeAdvanceCandidates({ ...input, smartCandidate: { ...smartCandidate, status: 'capped', gapMinutes } });
    assert.equal(result.selectedMode, 'fixed');
  }
  const result = mergeAdvanceCandidates({ ...input, smartEnabled: false, fixedCandidate: { ...fixedCandidate, status: 'capped', gapMinutes: 15 } });
  assert.equal(result.candidate, null);
});

test('跨日候选按完整时间戳比较，不按钟面排序', () => {
  const result = mergeAdvanceCandidates({
    ...input,
    now: Date.parse('2026-10-29T23:00:00+08:00'),
    baseAlarmAt: Date.parse('2026-10-30T00:10:00+08:00'),
    fixedCandidate: { ...fixedCandidate, baseAlarmAt: Date.parse('2026-10-30T00:10:00+08:00'), wakeAt: Date.parse('2026-10-29T23:40:00+08:00') },
    smartCandidate: { ...smartCandidate, baseAlarmAt: Date.parse('2026-10-30T00:10:00+08:00'), wakeAt: Date.parse('2026-10-30T00:00:00+08:00') },
  });
  assert.equal(result.selectedMode, 'fixed');
  assert.equal(result.candidate.wakeAt, Date.parse('2026-10-29T23:40:00+08:00'));
});

test('输出只是新建议，不能沿用输入的已保存或已同步状态', () => {
  const result = mergeAdvanceCandidates({ ...input, smartCandidate: { ...smartCandidate, executionState: 'synced' } });
  assert.equal(result.candidate.executionState, 'suggested');
});

test('不修改输入，重复计算一致；返回对象不与输入候选共用引用', () => {
  const before = structuredClone(input);
  const result = mergeAdvanceCandidates(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result, mergeAdvanceCandidates(input));
  assert.notEqual(result.candidate, smartCandidate);
  result.candidate.wakeAt = 0;
  assert.equal(smartCandidate.wakeAt, Date.parse('2026-10-30T06:10:00+08:00'));
});
