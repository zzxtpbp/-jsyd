import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestAlarmWrite } from '../src/alarmWrite.js';

const now = Date.parse('2026-10-30T05:00:00+08:00');
const base = Object.freeze({ id: 'base-1', at: Date.parse('2026-10-30T07:00:00+08:00'), enabled: true, repeat: 'daily', label: '基础闹钟' });
const candidate = Object.freeze({
  baseAlarmAt: base.at, wakeAt: Date.parse('2026-10-30T06:30:00+08:00'),
  validUntil: Date.parse('2026-10-30T05:15:00+08:00'), updatedAt: now,
  status: 'ready', source: 'fixed', departAt: null, gapMinutes: null,
  reason: '固定提前30分钟', executionState: 'suggested',
});
const mergeResult = Object.freeze({ action: 'suggest', status: 'ready', selectedMode: 'fixed', candidate });
const input = Object.freeze({ alarms: Object.freeze([base]), baseAlarmId: base.id, commutePlanId: 'commute-1', mergeResult, now });
const existing = Object.freeze({ id: 'primary-1', planKind: 'primary', commutePlanId: 'commute-1', baseAlarmId: base.id, baseAlarmAt: base.at, at: Date.parse('2026-10-30T06:40:00+08:00'), label: '我的提前闹钟', enabled: true, state: 'armed' });

test('首次只返回创建补丁，不生成ID、不写入或修改基础闹钟', () => {
  const result = suggestAlarmWrite(input);
  assert.equal(result.action, 'create');
  assert.equal(result.targetId, null);
  assert.equal(result.patch.id, undefined);
  assert.equal(result.patch.at, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(result.patch.planKind, 'primary');
  assert.equal(result.patch.baseAlarmId, base.id);
  assert.equal(result.patch.commutePlanId, 'commute-1');
  assert.equal(result.patch.repeat, 'once');
  assert.equal(input.alarms.length, 1);
  assert.equal(base.at, Date.parse('2026-10-30T07:00:00+08:00'));
});

test('已有同一计划时复用原ID并保留用户名称', () => {
  const result = suggestAlarmWrite({ ...input, alarms: [base, existing] });
  assert.equal(result.action, 'update');
  assert.equal(result.targetId, 'primary-1');
  assert.equal(result.patch.at, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(result.patch.label, '我的提前闹钟');
});

test('同一补丁模拟保存后再次请求是noop，不追加第二个主要闹钟', () => {
  const first = suggestAlarmWrite(input);
  const saved = { ...first.patch, id: 'saved-1' };
  const second = suggestAlarmWrite({ ...input, alarms: [base, saved] });
  assert.equal(second.action, 'noop');
  assert.equal(second.targetId, 'saved-1');
  assert.equal(second.patch, null);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
});

test('无新候选时只保留，不删除旧计划', () => {
  const result = suggestAlarmWrite({ ...input, alarms: [base, existing], mergeResult: { action: 'keep_existing', candidate: null } });
  assert.equal(result.action, 'keep_existing');
  assert.equal(result.patch, null);
});

test('已有同次且启用的更早主要闹钟不被延后', () => {
  const result = suggestAlarmWrite({ ...input, alarms: [base, { ...existing, at: Date.parse('2026-10-30T06:00:00+08:00') }] });
  assert.equal(result.action, 'keep_existing');
  assert.equal(result.targetId, existing.id);
  assert.equal(result.patch, null);
});

test('用户更换了基础闹钟ID时更新绑定，不把相同钟点误认作同一基础', () => {
  const result = suggestAlarmWrite({ ...input, alarms: [base, {
    ...existing, baseAlarmId: 'old-base', at: Date.parse('2026-10-30T06:00:00+08:00'),
  }] });
  assert.equal(result.action, 'update');
  assert.equal(result.patch.baseAlarmId, 'base-1');
});

test('保存前再次检查新鲜度、未来时间、状态及基础时间匹配', () => {
  for (const changes of [
    { validUntil: now }, { wakeAt: now }, { wakeAt: base.at },
    { baseAlarmAt: base.at + 86400000 }, { status: 'needs_confirmation' },
  ]) {
    const result = suggestAlarmWrite({ ...input, mergeResult: { ...mergeResult, candidate: { ...candidate, ...changes } } });
    assert.equal(result.action, 'blocked');
    assert.equal(result.patch, null);
  }
});

test('基础不存在、关闭、归属非法或时间已改变时不写入', () => {
  for (const changes of [
    { alarms: [] }, { alarms: [{ ...base, enabled: false }] },
    { alarms: [{ ...base, at: base.at + 60000 }] }, { alarms: [{ ...base, planKind: 'primary' }] },
    { baseAlarmId: '' }, { commutePlanId: '' }, { now: null }, { alarms: null },
  ]) {
    assert.equal(suggestAlarmWrite({ ...input, ...changes }).action, 'blocked');
  }
});

test('同计划多条主要闹钟、重复ID或未迁移归属的旧主要闹钟阻断', () => {
  for (const alarms of [
    [base, existing, { ...existing, id: 'primary-2' }],
    [base, { ...base }],
    [base, existing, { id: existing.id, at: base.at }],
    [base, { id: 'legacy-1', planKind: 'primary', at: candidate.wakeAt }],
  ]) {
    const result = suggestAlarmWrite({ ...input, alarms });
    assert.equal(result.action, 'blocked');
    assert.equal(result.patch, null);
  }
});

test('其他计划主要闹钟不被更新', () => {
  const other = { ...existing, commutePlanId: 'other-plan' };
  const result = suggestAlarmWrite({ ...input, alarms: [base, other] });
  assert.equal(result.action, 'create');
  assert.equal(result.targetId, null);
  assert.equal(other.at, Date.parse('2026-10-30T06:40:00+08:00'));
});

test('正在响铃的主要闹钟不被重新设为armed', () => {
  const result = suggestAlarmWrite({ ...input, alarms: [base, { ...existing, state: 'ringing' }] });
  assert.equal(result.action, 'blocked');
  assert.equal(result.patch, null);
});

test('刚到期或已过期但仍启用的主要闹钟等待调度处理，不重置成未来闹钟', () => {
  for (const at of [now, now - 60000]) {
    const result = suggestAlarmWrite({ ...input, alarms: [base, { ...existing, at }] });
    assert.equal(result.action, 'blocked');
    assert.equal(result.patch, null);
  }
});

test('智能capped结果保留缺口，不能借保存伪称完整满足通勤', () => {
  const result = suggestAlarmWrite({ ...input, mergeResult: {
    ...mergeResult, status: 'capped', selectedMode: 'smart',
    candidate: { ...candidate, status: 'capped', gapMinutes: 20, source: 'smart' },
  } });
  assert.equal(result.action, 'create');
  assert.equal(result.patch.planStatus, 'capped');
  assert.equal(result.patch.gapMinutes, 20);
});

test('重复计算一致且不改变任何输入记录', () => {
  const args = Object.freeze({ ...input, alarms: Object.freeze([base, existing]) });
  const before = structuredClone(args);
  assert.deepEqual(suggestAlarmWrite(args), suggestAlarmWrite(args));
  assert.deepEqual(args, before);
});
