import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_STATUS, EXECUTION_STATE, statusText,
  fixedCandidate, smartCandidate, mergeCandidates, deriveStatus, buildPlan,
  commuteVerdict,
} from '../src/plan.js';

const MIN = 60000;
// 固定基准：明早 07:00 的基础闹钟
const baseAlarmAt = new Date(2026, 9, 29, 7, 0, 0, 0).getTime();
const hm = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

test('固定候选只需基础闹钟与固定提前量，不需要路线', () => {
  const c = fixedCandidate({ baseAlarmAt, fixedMinutes: 20, enabled: true });
  assert.ok(c);
  assert.equal(hm(c.at), '06:40');
  assert.equal(c.advance, 20);
  assert.equal(c.kind, 'fixed');
});

test('固定模式未开启或无基础闹钟时不产出候选', () => {
  assert.equal(fixedCandidate({ baseAlarmAt, fixedMinutes: 20, enabled: false }), null);
  assert.equal(fixedCandidate({ baseAlarmAt: NaN, fixedMinutes: 20, enabled: true }), null);
  assert.equal(fixedCandidate({ baseAlarmAt, fixedMinutes: -1, enabled: true }), null);
  assert.equal(fixedCandidate({ baseAlarmAt, fixedMinutes: 241, enabled: true }), null);
});

test('T02 场景：智能需早 65 分钟、上限 40 分钟，缺口为 25 分钟', () => {
  // 07:00 基础闹钟，要在 06:00 前出发（到达 07:00，路上加准备共 60 分钟）。
  // 相对 07:00 需要提前 60 分钟，但上限只有 40 分钟，应只提前 40 分钟并显示缺口 20 分钟。
  const arrivalAt = new Date(2026, 9, 29, 7, 0, 0, 0).getTime();
  const c = smartCandidate({
    baseAlarmAt, arrivalAt, durationMinutes: 40, buffer: 5, preparation: 15,
    extra: 0, maxAdvance: 40, wet: false, enabled: true,
  });
  assert.equal(c.gapMinutes, 20);
  assert.equal(c.advance, 40);
  assert.equal(hm(c.at), '06:20');
});

test('智能所需提前量完全在限内时，按实际需求提前', () => {
  const arrivalAt = new Date(2026, 9, 29, 7, 20, 0, 0).getTime();
  const c = smartCandidate({
    baseAlarmAt, arrivalAt, durationMinutes: 30, buffer: 5, preparation: 10,
    extra: 0, maxAdvance: 40, wet: false, enabled: true,
  });
  assert.equal(c.gapMinutes, 0);
  assert.equal(c.advance, 25);
  assert.equal(hm(c.at), '06:35');
});

test('所需提前量超过 65 分钟且上限 40 时，缺口为 25 分钟', () => {
  const arrivalAt = new Date(2026, 9, 29, 7, 0, 0, 0).getTime();
  const c = smartCandidate({
    baseAlarmAt, arrivalAt, durationMinutes: 45, buffer: 5, preparation: 15,
    extra: 0, maxAdvance: 40, wet: false, enabled: true,
  });
  assert.equal(c.gapMinutes, 25);
  assert.equal(c.advance, 40);
});

test('雨雪额外准备计入所需提前量，干燥时被上限截断并留下缺口', () => {
  const arrivalAt = new Date(2026, 9, 29, 7, 0, 0, 0).getTime();
  // 行驶 40 + 余量 5 + 准备 15 = 60 分钟。干燥时需提前 60 分钟 > 上限 40，缺口 20；
  // 雨雪再加 15 分钟额外准备，需提前 75 分钟，上限放宽到 75 后不再有缺口。
  const dry = smartCandidate({
    baseAlarmAt, arrivalAt, durationMinutes: 40, buffer: 5, preparation: 15,
    extra: 15, maxAdvance: 40, wet: false, enabled: true,
  });
  assert.equal(dry.advance, 40);
  assert.equal(dry.gapMinutes, 20);

  const wet = smartCandidate({
    baseAlarmAt, arrivalAt, durationMinutes: 40, buffer: 5, preparation: 15,
    extra: 15, maxAdvance: 75, wet: true, enabled: true,
  });
  assert.equal(wet.advance, 75);
  assert.equal(wet.gapMinutes, 0);
  assert.ok(wet.at < dry.at, '雨雪时应比晴天更早');
});

test('两模式合并取较早候选，且只产出一个', () => {
  const fixed = fixedCandidate({ baseAlarmAt, fixedMinutes: 20, enabled: true });
  const smart = smartCandidate({
    baseAlarmAt, arrivalAt: new Date(2026, 9, 29, 7, 0, 0, 0).getTime(),
    durationMinutes: 40, buffer: 5, preparation: 15, extra: 0, maxAdvance: 40,
    wet: false, enabled: true,
  });
  const merged = mergeCandidates({ fixed, smart, baseAlarmAt });
  assert.equal(hm(merged.plan.at), '06:20');
  assert.equal(merged.plan.kind, 'smart');
});

test('候选晚于基础闹钟时不生成更晚的提前唤醒', () => {
  const late = { kind: 'fixed', at: baseAlarmAt + 10 * MIN, advance: 5 };
  const merged = mergeCandidates({ fixed: late, smart: null, baseAlarmAt });
  assert.equal(merged.plan, null);
  assert.equal(merged.status, PLAN_STATUS.UNAVAILABLE);
});

test('无任何候选时为 unavailable，不伪装成 ready', () => {
  const merged = mergeCandidates({ fixed: null, smart: null, baseAlarmAt });
  assert.equal(merged.plan, null);
  assert.equal(merged.status, PLAN_STATUS.UNAVAILABLE);
});

test('只开固定模式时，天气与路线缺失不降级', () => {
  const plan = buildPlan({
    baseAlarmAt, fixedMinutes: 20, fixedEnabled: true, smartEnabled: false,
    weatherKnown: false, routeKnown: false,
  });
  assert.equal(plan.status, PLAN_STATUS.READY);
  assert.equal(hm(plan.wakeAt), '06:40');
  assert.equal(plan.mode, 'fixed');
});

test('开智能模式时，天气缺失会降级为 weather_unknown', () => {
  const plan = buildPlan({
    baseAlarmAt,
    arrivalAt: new Date(2026, 9, 29, 7, 0, 0, 0).getTime(),
    durationMinutes: 40, buffer: 5, preparation: 15, extra: 0, maxAdvance: 40,
    smartEnabled: true, weatherKnown: false, routeKnown: true, wet: false,
  });
  assert.equal(plan.status, PLAN_STATUS.WEATHER_UNKNOWN);
  assert.equal(plan.statusText, '天气数据缺失，未做提前判断');
});

test('开智能模式时，路线缺失会降级为 route_failed', () => {
  const plan = buildPlan({
    baseAlarmAt,
    arrivalAt: new Date(2026, 9, 29, 7, 0, 0, 0).getTime(),
    durationMinutes: 40, buffer: 5, preparation: 15, extra: 0, maxAdvance: 40,
    smartEnabled: true, weatherKnown: true, routeKnown: false, wet: false,
  });
  assert.equal(plan.status, PLAN_STATUS.ROUTE_FAILED);
});

test('缺口存在时状态为 capped，并带出 gapMinutes', () => {
  const plan = buildPlan({
    baseAlarmAt,
    arrivalAt: new Date(2026, 9, 29, 7, 0, 0, 0).getTime(),
    durationMinutes: 45, buffer: 5, preparation: 15, extra: 0, maxAdvance: 40,
    smartEnabled: true, weatherKnown: true, routeKnown: true, wet: false,
  });
  assert.equal(plan.status, PLAN_STATUS.CAPPED);
  assert.equal(plan.gapMinutes, 25);
  assert.equal(plan.statusText, '需要的提前量超过智能上限');
});

test('plan 结果包含 S02 约定的全部字段，缺失值为 null 而非 0', () => {
  const plan = buildPlan({ baseAlarmAt, fixedEnabled: false, smartEnabled: false });
  for (const key of ['status', 'statusText', 'executionState', 'mode', 'baseAlarmAt', 'wakeAt', 'departAt', 'gapMinutes', 'reason', 'validUntil', 'updatedAt', 'source']) {
    assert.ok(key in plan, `缺少字段 ${key}`);
  }
  assert.equal(plan.wakeAt, null);
  assert.equal(plan.departAt, null);
  assert.equal(plan.status, PLAN_STATUS.UNAVAILABLE);
  assert.equal(plan.executionState, EXECUTION_STATE.SUGGESTED);
});

test('executionState 默认为 suggested，保存后才允许变成 saved', () => {
  const suggested = buildPlan({ baseAlarmAt, fixedMinutes: 20, fixedEnabled: true });
  assert.equal(suggested.executionState, EXECUTION_STATE.SUGGESTED);
  const saved = buildPlan({ baseAlarmAt, fixedMinutes: 20, fixedEnabled: true, executionState: EXECUTION_STATE.SAVED });
  assert.equal(saved.executionState, EXECUTION_STATE.SAVED);
});

test('状态枚举取值固定，不允许自由文本', () => {
  assert.deepEqual(Object.values(PLAN_STATUS).sort(), [
    'capped', 'needs_confirmation', 'ready', 'route_failed', 'unavailable', 'weather_unknown',
  ]);
  assert.deepEqual(Object.values(EXECUTION_STATE).sort(), ['failed', 'saved', 'suggested', 'synced']);
  assert.equal(statusText('不存在的状态'), '数据不足，暂无法计算');
});

test('天气缺失时通勤裁决返回 known=false，不冒充晴天', () => {
  const v = commuteVerdict({ weather: null, departureAt: baseAlarmAt, arrivalAt: baseAlarmAt + 3600000 });
  assert.equal(v.known, false);
  // wet 从 false 改为 null：没有数据时不能断言「没下雨」，否则界面会显示成晴天。
  assert.equal(v.wet, null);
  assert.equal(v.unknown, false);
});

test('概率缺失时裁决为 unknown，wet=null 而不是 false', () => {
  const weather = { hourly: {
    time: ['2026-10-29T07:00'],
    weather_code: [61],
    precipitation_probability: [null],
    precipitation: [null],
  } };
  const v = commuteVerdict({
    weather,
    departureAt: +new Date(2026, 9, 29, 7, 0),
    arrivalAt: +new Date(2026, 9, 29, 7, 40),
    threshold: 30,
  });
  assert.equal(v.known, true);
  assert.equal(v.wet, null);
  assert.equal(v.unknown, true);
});
