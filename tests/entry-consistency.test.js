// 验收 B02 / A06 / B04 的回归测试。
//
// 这三条验收失败都不是「算错了」那么单纯，而是「两处各自算一套，谁也没对齐」：
//   - 打车等车只加进了通勤方案页，进不了首页的提前唤醒；
//   - 首页出发时间漏了雨雪额外准备与到达余量，和方案页差 15 分钟；
//   - 固定候选已经覆盖时仍报「还差 N 分钟」。
// 所以这里的断言一律成对写：同一个输入，两个口径必须给出同一个数。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, PLAN_STATUS, smartCandidate } from '../src/plan.js';

const at = (h, m = 0) => +new Date(2026, 9, 29, h, m, 0, 0);
const base = at(8, 0);        // 基础闹钟 08:00
const arrival = at(9, 0);     // 到达 09:00
const night = at(0, 0);

const common = {
  baseAlarmAt: base,
  arrivalAt: arrival,
  durationMinutes: 40,
  buffer: 15,
  preparation: 25,
  extra: 0,
  maxAdvance: 240,
  weatherKnown: true,
  routeKnown: true,
  now: night,
};

test('B02① 打车等车时间必须进入提前唤醒（以前只进方案页）', () => {
  const noWait = buildPlan({ ...common, smartEnabled: true, wet: false, taxiWait: 0 });
  const withWait = buildPlan({ ...common, smartEnabled: true, wet: false, taxiWait: 12 });
  // 行程 40 + 余量 15 + 准备 25 = 80 分钟 → 叫醒 07:40 → 提前 20
  // 加等车 12 分钟 → 需要 92 分钟 → 叫醒 07:28 → 提前 32
  assert.equal(noWait.wakeAt, at(7, 40), `不带等车应 07:40，实际 ${new Date(noWait.wakeAt).toTimeString().slice(0, 5)}`);
  assert.equal(withWait.wakeAt, at(7, 28), `带 12 分钟等车应 07:28，实际 ${new Date(withWait.wakeAt).toTimeString().slice(0, 5)}`);
  assert.equal(noWait.candidates.smart.advance + 12, withWait.candidates.smart.advance, '等车时间必须加到提前量上');
});

test('B02① 等车时间为 0 或负数时不影响结果', () => {
  const a = buildPlan({ ...common, smartEnabled: true, wet: false, taxiWait: 0 });
  const b = buildPlan({ ...common, smartEnabled: true, wet: false, taxiWait: -5 });
  const c = buildPlan({ ...common, smartEnabled: true, wet: false });
  assert.equal(a.wakeAt, c.wakeAt);
  assert.equal(b.wakeAt, c.wakeAt, '负的等车时间不能变成「提前叫醒」的反向修正');
});

test('A06/B04 出发时间必须含雨雪额外准备与等车时间', () => {
  const plan = buildPlan({
    ...common,
    smartEnabled: true,
    wet: true,
    snow: false,
    preferences: { rain: { mode: null, extra: 20 }, snow: { mode: null, extra: 20 } },
    taxiWait: 10,
  });
  // 行程总耗时 = 40+15+25+雨20+等车10 = 110 分钟 → 理想叫醒 07:10 → 提前 50
  // 出发 = 叫醒 07:10 + 准备 25 + 雨 20 + 等车 10 = 08:05
  assert.equal(plan.wakeAt, at(7, 10), `叫醒应为 07:10，实际 ${new Date(plan.wakeAt).toTimeString().slice(0, 5)}`);
  assert.equal(plan.departAt, at(8, 5), `出发应为 08:05，实际 ${new Date(plan.departAt).toTimeString().slice(0, 5)}`);
  // 出发离到达的差 = 路程 + 余量，不该把准备时间也算成「在路上」
  assert.equal(arrival - plan.departAt, (40 + 15) * 60000, '出发→到达应恰好等于路程+余量');
});

test('A06/B04 没有雨雪时出发时间只含准备时间', () => {
  const plan = buildPlan({ ...common, smartEnabled: true, wet: false });
  // 叫醒 07:40，准备 25 → 出发 08:05
  assert.equal(plan.departAt, at(8, 5), `出发应为 08:05，实际 ${new Date(plan.departAt).toTimeString().slice(0, 5)}`);});

test('A06/B04 没有可用提前唤醒时，出发时间仍按同一口径倒推', () => {
  const plan = buildPlan({
    ...common,
    fixedEnabled: false,
    smartEnabled: false,
    wet: false,
  });
  // 全关时没有候选，但到达时间与耗时已知 → 出发 = 09:00 − (40+15+25) = 07:40
  assert.equal(plan.wakeAt, null);
  assert.equal(plan.departAt, at(7, 40), `出发应为 07:40，实际 ${new Date(plan.departAt).toTimeString().slice(0, 5)}`);
});

test('B02③ 固定候选已覆盖时不报缺口', () => {
  // 基础 08:00，固定提前 20 → 07:40；智能需要 125 分钟但上限只有 10 → 只能到 07:50
  const plan = buildPlan({
    ...common,
    fixedEnabled: true,
    fixedMinutes: 20,
    smartEnabled: true,
    maxAdvance: 10,
    wet: false,
    durationMinutes: 40,
    buffer: 15,
    preparation: 70, // 需要 125 分钟，远超上限
  });
  assert.equal(plan.mode, 'fixed', '固定 07:40 更早，应胜出');
  assert.equal(plan.wakeAt, at(7, 40));
  assert.equal(plan.gapMinutes, 0, '固定候选已覆盖，缺口必须为 0');
  assert.notEqual(plan.status, PLAN_STATUS.CAPPED);
  assert.ok(plan.candidates.smart.gapMinutes > 0, '智能候选自己的差额仍要保留，供解释使用');
});

test('B02③ 只有智能候选时缺口如实上报', () => {
  const plan = buildPlan({
    ...common,
    fixedEnabled: false,
    smartEnabled: true,
    maxAdvance: 10,
    wet: false,
    durationMinutes: 40,
    buffer: 15,
    preparation: 70,
  });
  assert.equal(plan.mode, 'smart');
  assert.ok(plan.gapMinutes > 0, '赢家是智能候选时缺口必须暴露');
  assert.equal(plan.status, PLAN_STATUS.CAPPED);
});

test('B02 同一个输入多次调用结果完全一致（无隐藏状态）', () => {
  const args = { ...common, fixedEnabled: true, fixedMinutes: 20, smartEnabled: true, wet: true, taxiWait: 8 };
  const a = buildPlan({ ...args, now: night });
  const b = buildPlan({ ...args, now: night });
  assert.equal(a.wakeAt, b.wakeAt);
  assert.equal(a.departAt, b.departAt);
  assert.equal(a.status, b.status);
  assert.equal(a.gapMinutes, b.gapMinutes);
});

test('B03 等车时间只对打车有意义 —— smartCandidate 自身不猜交通方式', () => {
  // 调用方用 effectiveTaxiWait() 决定传不传；这里只验证「传了就生效、不传就是 0」
  const passed = smartCandidate({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 15, preparation: 25,
    extra: 0, maxAdvance: 240, taxiWait: 12, wet: false, enabled: true, now: night,
  });
  const omitted = smartCandidate({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 15, preparation: 25,
    extra: 0, maxAdvance: 240, wet: false, enabled: true, now: night,
  });
  assert.equal(passed.advance - omitted.advance, 12);
});
