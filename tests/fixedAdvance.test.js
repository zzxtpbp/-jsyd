import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFixedCandidate } from '../src/fixedAdvance.js';

const baseAlarmAt = Date.parse('2026-10-30T07:00:00+08:00');
const input = { baseAlarmAt, fixedEnabled: true, fixedMinutes: 30, weatherTriggered: true };

test('不需要路线：基础 07:00，触发后固定提前到 06:30', () => {
  const result = calculateFixedCandidate(input);
  assert.equal(result.status, 'ready');
  assert.equal(result.wakeAt, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(result.baseAlarmAt, baseAlarmAt);
  assert.equal(result.source, 'fixed');
  assert.equal(result.executionState, 'suggested');
  assert.equal(result.departAt, null);
  assert.equal(result.validUntil, null);
  assert.equal(result.updatedAt, null);
  assert.equal(result.gapMinutes, null);
});

test('关闭固定模式或者未触发天气时不生成候选', () => {
  for (const changes of [{ fixedEnabled: false }, { weatherTriggered: false }]) {
    const result = calculateFixedCandidate({ ...input, ...changes });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.wakeAt, null);
    assert.equal(result.baseAlarmAt, baseAlarmAt);
  }
});

test('天气未知或缺失时明确标记未知，不能当作未下雨', () => {
  for (const weatherTriggered of [null, undefined]) {
    const result = calculateFixedCandidate({ ...input, weatherTriggered });
    assert.equal(result.status, 'weather_unknown');
    assert.equal(result.wakeAt, null);
  }
});

test('提前零分钟时不生成与基础闹钟重复的候选', () => {
  const result = calculateFixedCandidate({ ...input, fixedMinutes: 0 });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.wakeAt, null);
});

test('00:10 提前 30 分钟正确落在前一天 23:40', () => {
  const result = calculateFixedCandidate({ ...input, baseAlarmAt: Date.parse('2026-10-30T00:10:00+08:00') });
  assert.equal(result.wakeAt, Date.parse('2026-10-29T23:40:00+08:00'));
});

test('固定提前不受智能上限限制，240 分钟也能独立计算', () => {
  const result = calculateFixedCandidate({ ...input, fixedMinutes: 240, maxAdvance: 10 });
  assert.equal(result.status, 'ready');
  assert.equal(result.wakeAt, Date.parse('2026-10-30T03:00:00+08:00'));
});

test('非法分钟数不生成候选，不把空值或字符串隐式转换为分钟', () => {
  for (const fixedMinutes of [-1, 241, 1.5, NaN, Infinity, null, undefined, '30', '']) {
    const result = calculateFixedCandidate({ ...input, fixedMinutes });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.wakeAt, null);
  }
});

test('非法基础时间不生成候选，毫秒时间戳不能误传为时钟文字', () => {
  for (const baseAlarmAt of [null, undefined, NaN, Infinity, '07:00', '2026-10-30', 8640000000000001]) {
    const result = calculateFixedCandidate({ ...input, baseAlarmAt });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.wakeAt, null);
    assert.equal(result.baseAlarmAt, null);
  }
});

test('非布尔触发值和开关不能通过真值判断意外叫醒用户', () => {
  for (const changes of [{ weatherTriggered: 'false' }, { weatherTriggered: 60 }, { fixedEnabled: 'false' }, { fixedEnabled: 1 }]) {
    const result = calculateFixedCandidate({ ...input, ...changes });
    assert.notEqual(result.status, 'ready');
    assert.equal(result.wakeAt, null);
  }
});

test('重复计算结果一致，不修改输入或基础闹钟', () => {
  const frozen = Object.freeze({ ...input });
  const first = calculateFixedCandidate(frozen);
  const second = calculateFixedCandidate(frozen);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.deepEqual(frozen, input);
  assert.equal(frozen.baseAlarmAt, Date.parse('2026-10-30T07:00:00+08:00'));
});
