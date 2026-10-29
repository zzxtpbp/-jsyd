import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSmartCandidate } from '../src/smartAdvance.js';

const now = Date.parse('2026-10-30T05:00:00+08:00');
const input = Object.freeze({
  baseAlarmAt: Date.parse('2026-10-30T07:00:00+08:00'),
  arrivalAt: Date.parse('2026-10-30T08:00:00+08:00'),
  durationMinutes: 60, preparation: 30, buffer: 10, extra: 10,
  maxAdvance: 60, smartEnabled: true, weatherTriggered: true,
  validUntil: Date.parse('2026-10-30T05:15:00+08:00'), updatedAt: now, now,
});

test('按交通、准备、余量和雨雪准备倒推，不使用大模型计算时间', () => {
  const result = calculateSmartCandidate(input);
  assert.equal(result.status, 'ready');
  assert.equal(result.wakeAt, Date.parse('2026-10-30T06:10:00+08:00'));
  assert.equal(result.desiredWakeAt, Date.parse('2026-10-30T06:10:00+08:00'));
  assert.equal(result.departAt, Date.parse('2026-10-30T06:50:00+08:00'));
  assert.equal(result.gapMinutes, 0);
  assert.equal(result.baseAlarmAt, input.baseAlarmAt);
  assert.equal(result.source, 'smart');
  assert.equal(result.executionState, 'suggested');
});

test('用户上限30分钟时只提前到06:30，明确还有20分钟缺口', () => {
  const result = calculateSmartCandidate({ ...input, maxAdvance: 30 });
  assert.equal(result.status, 'capped');
  assert.equal(result.wakeAt, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(result.gapMinutes, 20);
});

test('上限0时不生成重复基础的额外闹钟，但仍显示缺口', () => {
  const result = calculateSmartCandidate({ ...input, maxAdvance: 0 });
  assert.equal(result.status, 'capped');
  assert.equal(result.wakeAt, null);
  assert.equal(result.gapMinutes, 50);
});

test('无需提前的方案不生成延后闹钟', () => {
  const result = calculateSmartCandidate({ ...input, durationMinutes: 0, preparation: 10, buffer: 0, extra: 0 });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.wakeAt, null);
});

test('模式关闭和天气未触发不生成智能候选', () => {
  for (const changes of [{ smartEnabled: false }, { smartEnabled: 'true' }, { weatherTriggered: false }]) {
    const result = calculateSmartCandidate({ ...input, ...changes });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.wakeAt, null);
  }
});

test('未知天气或字符串触发值不按下雨处理', () => {
  for (const weatherTriggered of [null, undefined, 'false', 60]) {
    const result = calculateSmartCandidate({ ...input, weatherTriggered });
    assert.equal(result.status, 'weather_unknown');
    assert.equal(result.wakeAt, null);
  }
});

test('缺失或非法路线耗时不能假装零分钟路线', () => {
  for (const durationMinutes of [undefined, null, -1, 1441, 1.5, NaN, Infinity, '60']) {
    const result = calculateSmartCandidate({ ...input, durationMinutes });
    assert.equal(result.status, 'route_failed');
    assert.equal(result.wakeAt, null);
  }
});

test('非法设置分钟数不参与计算', () => {
  for (const key of ['preparation', 'buffer', 'extra', 'maxAdvance']) {
    for (const value of [-1, 241, 1.5, null, undefined, '30']) {
      const result = calculateSmartCandidate({ ...input, [key]: value });
      assert.equal(result.status, 'unavailable');
      assert.equal(result.wakeAt, null);
    }
  }
});

test('过期、缺失有效期或未来更新时间不生成候选', () => {
  for (const changes of [{ validUntil: now }, { validUntil: null }, { validUntil: Infinity }, { updatedAt: null }, { updatedAt: now + 1 }]) {
    const result = calculateSmartCandidate({ ...input, ...changes });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.wakeAt, null);
  }
});

test('非法公共日期及已经错过的叫醒时间不生成过去闹钟', () => {
  for (const changes of [{ baseAlarmAt: '07:00' }, { arrivalAt: null }, { arrivalAt: now }, { now: null }, { now: Date.parse('2026-10-30T06:10:00+08:00'), validUntil: input.baseAlarmAt }]) {
    const result = calculateSmartCandidate({ ...input, ...changes });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.wakeAt, null);
  }
});

test('跨午夜正确倒推到前一天，输入不变且结果可重复', () => {
  const args = Object.freeze({ ...input,
    now: Date.parse('2026-10-29T22:00:00+08:00'), updatedAt: Date.parse('2026-10-29T22:00:00+08:00'),
    validUntil: Date.parse('2026-10-29T22:15:00+08:00'),
    baseAlarmAt: Date.parse('2026-10-30T00:30:00+08:00'), arrivalAt: Date.parse('2026-10-30T01:00:00+08:00'),
  });
  const before = structuredClone(args);
  const result = calculateSmartCandidate(args);
  assert.equal(result.wakeAt, Date.parse('2026-10-29T23:30:00+08:00'));
  assert.equal(result.gapMinutes, 20);
  assert.deepEqual(result, calculateSmartCandidate(args));
  assert.deepEqual(args, before);
});
