// 白屏静态检查：找出「把对象当 React 子节点渲染」的写法。
//
// React error #31 的直接后果就是整个组件树卸载 → 白屏。
// 这里逐个检查 buildPlan 的返回值，确认界面上所有 `${plan.xxx}` 用到的字段都是可渲染的原始值，
// 而不是对象。历史上 reason 从字符串改成结构化对象时，就靠这个检查兜住的。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/plan.js';

const DAY = new Date('2026-10-29T00:00:00+08:00').getTime();

// 只有这几种值能安全地放进 JSX 里当子节点
function renderable(v) {
  return v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    // 已经 createElement 过的元素也是合法子节点，但 plan 里不应该出现
    || (typeof v === 'object' && v.$$typeof);
}

test('白屏防线：plan.reason 必须是字符串，不能是结构化对象', () => {
  const plan = buildPlan({
    baseAlarmAt: DAY + 7 * 3600000,
    arrivalAt: DAY + 9 * 3600000,
    durationMinutes: 40,
    buffer: 10,
    preparation: 20,
    extra: 0,
    maxAdvance: 60,
    fixedMinutes: 20,
    fixedEnabled: true,
    smartEnabled: true,
    weatherKnown: true,
    routeKnown: true,
    wet: true,
    probability: 80,
    threshold: 30,
    now: DAY,
  });
  assert.equal(typeof plan.reason, 'string', 'plan.reason 被 ${plan.reason} 直接插值，必须是字符串');
  assert.ok(plan.reason.length > 0, 'plan.reason 不能为空串');
  assert.equal(typeof plan.reasonDetail, 'object', '结构化解释改放在 reasonDetail');
  assert.equal(plan.reasonDetail.text, plan.reason, '两者文本必须一致，避免界面说法分裂');
});

test('白屏防线：plan 的所有标量字段都不能是「无 $$typeof 的普通对象」', () => {
  const plan = buildPlan({
    baseAlarmAt: DAY + 7 * 3600000,
    arrivalAt: DAY + 9 * 3600000,
    durationMinutes: 40,
    buffer: 10,
    preparation: 20,
    extra: 15,
    maxAdvance: 60,
    fixedMinutes: 20,
    fixedEnabled: true,
    smartEnabled: true,
    weatherKnown: true,
    routeKnown: true,
    wet: true,
    probability: 80,
    threshold: 30,
    snow: false,
    now: DAY,
  });
  // 这些字段在 JSX 里被直接插值或拼进模板字符串
  const interpolated = ['statusText', 'reasonText', 'reason', 'routeNote', 'mode', 'transport', 'dataVersion', 'source'];
  for (const key of interpolated) {
    const v = plan[key];
    assert.ok(renderable(v), `plan.${key} 会被直接渲染，实际是 ${Object.prototype.toString.call(v)}`);
  }
});

test('白屏防线：plan 里所有会被插值的字段在未知天气下也保持原始类型', () => {
  const plan = buildPlan({
    baseAlarmAt: DAY + 7 * 3600000,
    arrivalAt: DAY + 9 * 3600000,
    durationMinutes: null,
    buffer: 10,
    preparation: 20,
    extra: 0,
    maxAdvance: 60,
    fixedMinutes: 20,
    fixedEnabled: true,
    smartEnabled: true,
    weatherKnown: false,
    routeKnown: false,
    wet: null,
    probability: null,
    threshold: 30,
    now: DAY,
  });
  for (const key of ['reasonText', 'reason', 'routeNote', 'statusText']) {
    assert.equal(typeof plan[key], 'string', `未知天气下 plan.${key} 仍须是字符串`);
  }
});
