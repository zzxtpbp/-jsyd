// B07 合并规则 + 去重：同一份输入只产出一个主要提前唤醒。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, mergeCandidates, PLAN_STATUS } from '../src/plan.js';

const at = (h, m = 0) => +new Date(2026, 9, 29, h, m, 0, 0);
const base = at(8, 30);
const arrival = at(9, 0);
const common = {
  baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 45, buffer: 5, preparation: 15,
  extra: 10, maxAdvance: 120, weatherKnown: true, routeKnown: true, now: at(0, 0),
};

test('两种模式都开时取更早的那个', () => {
  const p = buildPlan({ ...common, fixedEnabled: true, smartEnabled: true, fixedMinutes: 20, probability: 0, threshold: 50 });
  // 固定 08:10；智能需 35 分钟 → 07:55。取较早：07:55
  assert.equal(p.wakeAt, at(7, 55));
  assert.equal(p.mode, 'smart');
});

test('固定更早时用固定', () => {
  const p = buildPlan({ ...common, fixedEnabled: true, smartEnabled: true, fixedMinutes: 60, probability: 0, threshold: 50 });
  // 固定 07:30；智能 07:55。取较早：07:30
  assert.equal(p.wakeAt, at(7, 30));
  assert.equal(p.mode, 'fixed');
});

test('只开一种模式时只用那一种', () => {
  const fixedOnly = buildPlan({ ...common, fixedEnabled: true, smartEnabled: false, fixedMinutes: 20 });
  assert.equal(fixedOnly.mode, 'fixed');
  const smartOnly = buildPlan({ ...common, fixedEnabled: false, smartEnabled: true, probability: 0, threshold: 50 });
  assert.equal(smartOnly.mode, 'smart');
});

test('两种都不可用时返回 unavailable，基础闹钟不动', () => {
  const p = buildPlan({ ...common, fixedEnabled: false, smartEnabled: false });
  assert.equal(p.status, PLAN_STATUS.UNAVAILABLE);
  assert.equal(p.wakeAt, null);
});

test('只开固定模式时天气缺失不影响结论', () => {
  const p = buildPlan({ ...common, fixedEnabled: true, smartEnabled: false, fixedMinutes: 20, weatherKnown: false, routeKnown: false });
  assert.equal(p.status, PLAN_STATUS.READY);
  assert.equal(p.wakeAt, at(8, 10));
});

test('智能候选赢了但天气未知时降级为 weather_unknown', () => {
  const p = buildPlan({ ...common, fixedEnabled: false, smartEnabled: true, probability: null });
  assert.equal(p.status, PLAN_STATUS.WEATHER_UNKNOWN);
});

// 验收 B02 第③条：固定提前 20 已给出 06:40，智能被上限压到 06:50 时，
// 旧实现仍弹「还差 10 分钟，不能保证准时」——但实际方案 06:40 完全没问题。
// 缺口只应该表示「按最理想口径算仍达不到」，所以只有当赢家就是智能候选时才算真缺口。
test('固定候选胜出时不报缺口（它已经把问题解决了）', () => {
  const p = buildPlan({
    ...common, fixedEnabled: true, smartEnabled: true, fixedMinutes: 60, maxAdvance: 10,
    probability: 90, threshold: 30,
  });
  // 固定 07:30 更早，赢家是固定 —— 固定候选没有上限概念，自己不会产生 gap
  assert.equal(p.mode, 'fixed');
  assert.equal(p.candidates.fixed.gapMinutes, 0);
  // 智能候选自己确实还差，但那不再是「本次方案的缺口」：方案给的时间已经能覆盖
  assert.ok(p.candidates.smart.gapMinutes > 0, '智能候选仍应记录自己的差额，供解释使用');
  assert.equal(p.gapMinutes, 0, '赢家是固定候选时不该报缺口');
  assert.notEqual(p.status, PLAN_STATUS.CAPPED, '固定候选覆盖后不应判为超限');
});

test('智能候选胜出且被上限截断时，缺口如实上报', () => {
  const p = buildPlan({
    ...common, fixedEnabled: false, smartEnabled: true, maxAdvance: 10,
    probability: 90, threshold: 30,
  });
  assert.equal(p.mode, 'smart');
  assert.ok(p.gapMinutes > 0, '赢家是智能候选时缺口必须暴露');
  assert.equal(p.status, PLAN_STATUS.CAPPED);
});

test('智能候选胜出时缺口取它自己的', () => {
  const merged = mergeCandidates({
    fixed: { kind: 'fixed', at: 900, advance: 5, gapMinutes: 0 },
    smart: { kind: 'smart', at: 800, advance: 30, gapMinutes: 12 },
    baseAlarmAt: 1000,
  });
  assert.equal(merged.plan.kind, 'smart');
  assert.equal(merged.gapMinutes, 12);
});

test('候选晚于基础闹钟时不视为有效候选', () => {
  const merged = mergeCandidates({
    fixed: null,
    smart: { kind: 'smart', at: base + 60000, advance: -1, gapMinutes: 0 },
    baseAlarmAt: base,
  });
  assert.equal(merged.plan, null);
  assert.equal(merged.status, PLAN_STATUS.UNAVAILABLE);
});

test('同一份输入反复计算结果完全一致（去重的前提）', () => {
  const input = { ...common, fixedEnabled: true, smartEnabled: true, fixedMinutes: 20, probability: 80, threshold: 30 };
  const a = buildPlan(input);
  const b = buildPlan(input);
  assert.deepEqual({ wakeAt: a.wakeAt, gap: a.gapMinutes, mode: a.mode, text: a.reason.text },
    { wakeAt: b.wakeAt, gap: b.gapMinutes, mode: b.mode, text: b.reason.text });
});
