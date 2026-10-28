// B05 / B06 / B08 / B09 / B10 的边界与端到端用例。
// 对应计划第三、四、六、七、九步的验收点。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan, fixedCandidate, smartCandidate, weatherFallback, PLAN_STATUS,
} from '../src/plan.js';
import { DEFAULT_COMMUTE } from '../src/commuteSettings.js';

const at = (h, m = 0) => +new Date(2026, 9, 29, h, m, 0, 0);
const base = at(7, 0);
const arrival = at(9, 0);
// 基础闹钟 08:30 + 到达 09:00：行程 65 分钟要在 30 分钟内走完，需提前 35 分钟。
// 上限设 20 时缺口 15 分钟；上限设 60 时正常提前 35 分钟。
// 注意方向：基础闹钟必须晚于「理想唤醒时刻」，否则属于「不需要提前」，不会生成候选。
const lateBase = at(8, 30);

test('B05 固定候选不需要路线与天气', () => {
  const p = buildPlan({
    baseAlarmAt: base, fixedMinutes: 20, fixedEnabled: true, smartEnabled: false,
    routeKnown: false, weatherKnown: false, now: at(0, 0),
  });
  assert.equal(p.wakeAt, at(6, 40));
  assert.equal(p.mode, 'fixed');
  assert.equal(p.status, PLAN_STATUS.READY, '只开固定模式时天气缺失不应降级');
});

test('B05 固定提前量为 0 时不生成候选', () => {
  assert.equal(fixedCandidate({ baseAlarmAt: base, fixedMinutes: 0, enabled: true }), null);
});

test('B05 固定候选早于当前时间时标记过期，不参与合并', () => {
  const p = buildPlan({
    baseAlarmAt: at(7, 0), fixedMinutes: 20, fixedEnabled: true,
    now: at(7, 0), // 现在已经是基础闹钟时间，06:40 已过去
  });
  assert.equal(p.wakeAt, null);
  assert.equal(p.status, PLAN_STATUS.UNAVAILABLE);
});

test('B06 超出上限只提前到上限，并如实给出缺口', () => {
  const p = buildPlan({
    baseAlarmAt: lateBase, arrivalAt: arrival, durationMinutes: 45, buffer: 5, preparation: 15,
    extra: 0, maxAdvance: 20, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 10, threshold: 50, now: at(0, 0),
  });
  // 需提前 35 分钟，上限 20 → 提前到上限，缺 15 分钟
  assert.equal(p.gapMinutes, 15);
  assert.equal(p.status, PLAN_STATUS.CAPPED);
  assert.equal(p.wakeAt, lateBase - 20 * 60000);
  assert.match(p.reasonDetail.text, /仍缺 15 分钟/);
});

test('B06 智能算出来晚于基础闹钟时不生成更晚的「提前」闹钟', () => {
  const p = buildPlan({
    baseAlarmAt: at(8, 30), arrivalAt: arrival, durationMinutes: 10, buffer: 5, preparation: 5,
    extra: 0, maxAdvance: 60, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 0, threshold: 50, now: at(0, 0),
  });
  assert.equal(p.wakeAt, null);
  assert.equal(p.status, PLAN_STATUS.UNAVAILABLE);
});

test('B06 wet 由 probability 与 threshold 内部对比得出', () => {
  const common = {
    baseAlarmAt: lateBase, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    extra: 15, maxAdvance: 120, smartEnabled: true, weatherKnown: true, routeKnown: true, now: at(0, 0),
  };
  const low = buildPlan({ ...common, probability: 30, threshold: 30 });
  const high = buildPlan({ ...common, probability: 30, threshold: 80 });
  assert.ok(low.wakeAt < high.wakeAt, '门槛 30 触发提前，门槛 80 不触发');
  assert.match(low.reasonDetail.text, /达到你设的 30% 门槛/);
  assert.match(high.reasonDetail.text, /未达到你设的 80% 门槛/);
});

test('B06 概率未知时不提前，状态为 weather_unknown', () => {
  const p = buildPlan({
    baseAlarmAt: lateBase, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    extra: 15, maxAdvance: 120, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: null, threshold: 30, now: at(0, 0),
  });
  assert.equal(p.status, PLAN_STATUS.WEATHER_UNKNOWN);
  assert.match(p.reasonDetail.text, /没有数据/);
});

test('B08 未配置备用方式时只加准备时间，不擅自改交通方式', () => {
  const p = buildPlan({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    maxAdvance: 200, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 90, threshold: 30, snow: true, preferences: DEFAULT_COMMUTE.preferences, now: at(0, 0),
  });
  assert.equal(p.fallback.switched, false);
  assert.equal(p.transport, null);
  assert.match(p.reasonDetail.text, /未配置雪天备用交通方式/);
});

test('B08 配置了雪天改乘公交时切换交通方式', () => {
  const p = buildPlan({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    maxAdvance: 200, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 90, threshold: 30, snow: true, now: at(0, 0),
    preferences: { rain: { mode: null, extra: 10 }, snow: { mode: '公交', extra: 25 } },
  });
  assert.equal(p.fallback.switched, true);
  assert.equal(p.transport, '公交');
  assert.match(p.reasonDetail.text, /改乘公交/);
});

test('B08 没有雨雪时不进入备用方案', () => {
  assert.equal(weatherFallback({ snow: true, preferences: null }).switched, false);
  const p = buildPlan({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    maxAdvance: 200, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 5, threshold: 30, snow: true, preferences: DEFAULT_COMMUTE.preferences, now: at(0, 0),
  });
  assert.equal(p.fallback, null);
});

test('B09 结果标注各项耗时来源', () => {
  const p = buildPlan({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    extra: 15, maxAdvance: 200, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 50, threshold: 30, durationSource: 'amap', now: at(0, 0),
  });
  assert.equal(p.sources.duration, 'amap');
  assert.equal(p.sources.preparation, 'user');
  assert.match(p.reasonDetail.text, /高德估算/);
  const manual = buildPlan({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    extra: 15, maxAdvance: 200, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 50, threshold: 30, durationSource: 'user', now: at(0, 0),
  });
  assert.match(manual.reasonDetail.text, /你填写/);
});

test('B10 结构化解释：reasonDetail 是对象，text 与数字字段一致；reason 保留字符串形态供界面插值', () => {
  const p = buildPlan({
    baseAlarmAt: lateBase, arrivalAt: arrival, durationMinutes: 45, buffer: 5, preparation: 15,
    extra: 0, maxAdvance: 20, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 85, threshold: 80, now: at(0, 0),
  });
  // 界面里有 `${plan.reason}` 这种直接插值，对象会触发 React error #31 → 白屏，
  // 所以 reason 必须是字符串，结构化数据放 reasonDetail。
  assert.equal(typeof p.reason, 'string');
  assert.equal(p.reason, p.reasonDetail.text);
  assert.equal(typeof p.reasonDetail, 'object');
  assert.equal(p.reasonDetail.advance.gap, 15);
  assert.equal(p.reasonDetail.weather.probability, 85);
  assert.equal(p.reasonDetail.weather.threshold, 80);
  assert.ok(p.reasonDetail.text.includes('85%'));
  assert.ok(p.reasonDetail.text.includes('80%'));
  assert.ok(p.reasonDetail.text.includes('15 分钟'));
});

test('B10 千问建议失败时为 null，不影响计算与可执行性', () => {
  const p = buildPlan({
    baseAlarmAt: lateBase, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    extra: 15, maxAdvance: 200, smartEnabled: true, weatherKnown: true, routeKnown: true,
    probability: 50, threshold: 30, advice: null, now: at(0, 0),
  });
  assert.equal(p.advice, null);
  assert.ok(Number.isFinite(p.wakeAt));
  assert.ok(p.reasonDetail.text.length > 0);
});

test('B10 四种异常状态各有独立文案，且都不含「已准时」「预计准点」', () => {
  const common = { baseAlarmAt: lateBase, now: at(0, 0) };
  const cases = [
    buildPlan({ ...common, smartEnabled: true, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20, extra: 0, maxAdvance: 60, weatherKnown: true, routeKnown: false, probability: 10 }),
    buildPlan({ ...common, smartEnabled: true, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20, extra: 0, maxAdvance: 60, weatherKnown: true, routeKnown: true, probability: null }),
    buildPlan({ ...common, fixedEnabled: false, smartEnabled: false }),
  ];
  for (const p of cases) {
    assert.equal(/预计准时|已准时|已提前完成/.test(p.reasonDetail.text), false, `文案里出现了不该有的承诺：${p.reasonDetail.text}`);
  }
  assert.ok(cases[0].reasonDetail.text.includes('路线'));
  assert.ok(cases[1].reasonDetail.text.includes('没有数据'));
});

test('B04 dataVersion 随阈值与数据可用性变化', () => {
  const mk = (threshold, weatherKnown) => buildPlan({
    baseAlarmAt: base, arrivalAt: arrival, durationMinutes: 40, buffer: 10, preparation: 20,
    extra: 15, maxAdvance: 200, smartEnabled: true, weatherKnown, routeKnown: true,
    probability: 50, threshold, now: at(0, 0),
  }).dataVersion;
  assert.notEqual(mk(30, true), mk(80, true));
  assert.notEqual(mk(30, true), mk(30, false));
});
