import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAlarmTiming } from '../src/alarmTiming.js';

const settings = Object.freeze({
  baseAlarmAt: Date.parse('2026-10-30T07:00:00+08:00'),
  recheckAt: Date.parse('2026-10-30T05:30:00+08:00'),
  fixedEnabled: true, smartEnabled: true, fixedMinutes: 30, maxAdvance: 60,
  ambientEnabled: true, ambientOffset: 5, fallback: '保留基础闹钟',
});

test('两个模式和环境音一起计算最早发声时间', () => {
  const result = checkAlarmTiming(settings);
  assert.equal(result.ok, true);
  assert.equal(result.earliestAlarmAt, Date.parse('2026-10-30T06:00:00+08:00'));
  assert.equal(result.earliestSoundAt, Date.parse('2026-10-30T05:55:00+08:00'));
  assert.deepEqual(result.issues, []);
});

test('固定量可以大于智能上限，并按固定量检查复查时间', () => {
  const result = checkAlarmTiming({ ...settings, fixedMinutes: 90, recheckAt: Date.parse('2026-10-30T05:00:00+08:00') });
  assert.equal(result.ok, true);
  assert.equal(result.earliestSoundAt, Date.parse('2026-10-30T05:25:00+08:00'));
});

test('复查等于或晚于环境音开始时间均报告冲突，备用策略不能掩盖', () => {
  for (const fallback of ['保留基础闹钟', '仅按固定模式']) {
    const result = checkAlarmTiming({ ...settings, recheckAt: Date.parse('2026-10-30T05:55:00+08:00'), fallback });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.code === 'recheck_too_late'));
  }
});

test('仅固定模式也需要在发声前复查，关闭环境音不减偏移', () => {
  const result = checkAlarmTiming({ ...settings, smartEnabled: false, ambientEnabled: false, recheckAt: Date.parse('2026-10-30T06:30:00+08:00') });
  assert.equal(result.earliestSoundAt, Date.parse('2026-10-30T06:30:00+08:00'));
  assert.equal(result.ok, false);
});

test('仅智能给绑定固定的非阻断提醒，未开启固定不能选固定备用', () => {
  const result = checkAlarmTiming({ ...settings, fixedEnabled: false });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(issue => issue.code === 'smart_without_fixed'));
  const invalid = checkAlarmTiming({ ...settings, fixedEnabled: false, fallback: '仅按固定模式' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some(issue => issue.code === 'fixed_fallback_disabled'));
});

test('无模式、非布尔开关、非法时间/分钟/备用设置均拒绝', () => {
  for (const changes of [
    { fixedEnabled: false, smartEnabled: false }, { fixedEnabled: 'true' },
    { baseAlarmAt: null }, { recheckAt: '05:30' }, { fixedMinutes: -1 },
    { maxAdvance: 241 }, { ambientOffset: 0 }, { ambientOffset: 61 },
    { ambientEnabled: 'true' }, { fallback: '随便' },
  ]) {
    const result = checkAlarmTiming({ ...settings, ...changes });
    assert.equal(result.ok, false);
    assert.ok(result.issues.length > 0);
  }
});

test('未开启模式的旧分钟配置不参与，关闭环境音时也不验证旧偏移', () => {
  const result = checkAlarmTiming({ ...settings, smartEnabled: false, maxAdvance: null, ambientEnabled: false, ambientOffset: null });
  assert.equal(result.ok, true);
  assert.equal(result.earliestSoundAt, Date.parse('2026-10-30T06:30:00+08:00'));
});

test('跨日最早发声必须与前一晚的复查时间比较', () => {
  const result = checkAlarmTiming({ ...settings,
    baseAlarmAt: Date.parse('2026-10-30T00:10:00+08:00'),
    recheckAt: Date.parse('2026-10-29T22:00:00+08:00'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.earliestSoundAt, Date.parse('2026-10-29T23:05:00+08:00'));
});

test('检查不改变设置，重复结果一致', () => {
  const before = structuredClone(settings);
  assert.deepEqual(checkAlarmTiming(settings), checkAlarmTiming(settings));
  assert.deepEqual(settings, before);
});
