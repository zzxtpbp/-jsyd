// T01—T04：端到端场景校验。
// 用固定的假数据把「天气 → 窗口判定 → 备用方式 → 候选 → 合并 → 状态/文案」整条链跑一遍，
// 断言的是用户最终看到的那句话，而不是某个中间函数的返回值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowVerdict, wetVerdict } from '../src/schedule.js';
import { buildPlan, PLAN_STATUS } from '../src/plan.js';

// 固定的时间基线：2026-10-29 08:00 出发，09:00 到达（UTC 表示，内部按毫秒算）
// 造一份只含目标时段的逐小时天气。
// 注意：schedule.js 用「本地时间」的 YYYY-MM-DDTHH:00 去匹配小时，不是 ISO/UTC 串，
// 所以这里必须按本地时间格式化，否则窗口内一格都匹配不上，verdict 会是 known:false。
function localHour(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}
function weather(hours) {
  return {
    hourly: {
      time: hours.map((h) => localHour(h.time)),
      precipitation_probability: hours.map((h) => h.probability),
      weather_code: hours.map((h) => h.code ?? 3),
      temperature_2m: hours.map(() => 16),
    },
  };
}

// 用本地时间构造场景时刻：明早 08:00 出发、09:00 抵达。
const LOCAL_BASE = new Date();
LOCAL_BASE.setHours(0, 0, 0, 0);
const DAY = LOCAL_BASE.getTime();
const D8 = DAY + 8 * 3600000;
const D9 = DAY + 9 * 3600000;

const DRY = weather([{ time: D8, probability: 5 }, { time: D9, probability: 10 }]);
const RAINY = weather([{ time: D8, probability: 85, code: 61 }, { time: D9, probability: 80, code: 61 }]);
const SNOWY = weather([{ time: D8, probability: 90, code: 73 }, { time: D9, probability: 88, code: 73 }]);
const MISSING = weather([{ time: D8, probability: null }, { time: D9, probability: 10 }]);
const SEVERE_RAIN = weather([{ time: D8, probability: 95, code: 65 }, { time: D9, probability: 95, code: 65 }]);

// 通勤参数：行程 35 分钟 + 余量 10 + 准备 30 = 75 分钟
// 09:00 抵达 → 最晚 07:45 出门 → 理想唤醒 07:15。
// 基础闹钟设在 07:05，比理想晚 10 分钟 → 需要提前 10 分钟。
const COMMON = {
  baseAlarmAt: DAY + 7 * 3600000 + 5 * 60000,
  arrivalAt: D9,
  durationMinutes: 35,
  buffer: 10,
  preparation: 30,
  maxAdvance: 30,
  fixedMinutes: 20,
  fixedEnabled: true,
  smartEnabled: true,
  threshold: 30,
  now: DAY - 12 * 3600000,
};

function run(w, overrides = {}) {
  const v = windowVerdict(w, new Date(D8), new Date(D9), overrides.threshold ?? COMMON.threshold);
  return buildPlan({
    ...COMMON, ...overrides,
    wet: v.affected,
    snow: v.snow,
    severe: v.severe,
    probability: v.probability,
    weatherKnown: !!w,
    routeKnown: true,
  });
}

test('T01 晴天：不提前，理由里不出现「有雨」', () => {
  const plan = run(DRY);
  assert.notEqual(plan.status, PLAN_STATUS.CAPPED);
  assert.equal(plan.fallback, null, '没有雨雪就不该有备用方式');
  assert.doesNotMatch(plan.reasonText, /有雨|有雪/);
});

test('T01 雨天：触发备用方式并计入额外准备', () => {
  const plan = run(RAINY, {
    extra: 15,
    preferences: { rain: { mode: '地铁', extra: 25 }, snow: { mode: null, extra: 20 } },
  });
  assert.equal(plan.fallback.kind, 'rain');
  assert.equal(plan.fallback.switched, true);
  assert.equal(plan.fallback.mode, '地铁');
  assert.equal(plan.fallback.extra, 25, '雨天的额外准备应取 preferences.rain.extra');
});

test('T01 雨雪附带说明：文案里出现用户配置的方式', () => {
  const plan = run(RAINY, {
    extra: 15,
    preferences: { rain: { mode: '地铁', extra: 25 }, snow: { mode: null, extra: 20 } },
  });
  assert.match(plan.reasonText + plan.reason, /地铁|备用/);
});

test('T02 雪天：走 snow 档，不误用雨的配置', () => {
  const plan = run(SNOWY, {
    extra: 15,
    preferences: { rain: { mode: '地铁', extra: 25 }, snow: { mode: '公交', extra: 40 } },
  });
  assert.equal(plan.fallback.kind, 'snow');
  assert.equal(plan.fallback.mode, '公交');
  assert.equal(plan.fallback.extra, 40);
});

test('T02 雪天未配置备用方式：保持原交通方式，只加准备时间', () => {
  const plan = run(SNOWY, {
    extra: 15,
    preferences: { rain: { mode: '地铁', extra: 25 }, snow: { mode: null, extra: 18 } },
  });
  assert.equal(plan.fallback.switched, false);
  assert.equal(plan.fallback.mode, null);
  assert.equal(plan.fallback.extra, 18);
});

test('T03 概率缺失：判定为未知，不切换交通方式，也不声称无雨', () => {
  const plan = run(MISSING);
  assert.equal(plan.fallback, null, '未知天气不能触发备用方案');
  // plan.reason 是可直接插值的字符串，结构化解释在 reasonDetail 里
  assert.equal(typeof plan.reason, 'string');
  assert.equal(plan.reason, plan.reasonDetail.text);
  const text = String(plan.reasonText || plan.reason || '');
  assert.ok(
    [PLAN_STATUS.WEATHER_UNKNOWN, PLAN_STATUS.UNAVAILABLE].includes(plan.status) ||
      /未知|不全|拿不到/.test(text),
    `概率缺失时应明确标为未知，实际 status=${plan.status} text=${text}`,
  );
  assert.doesNotMatch(text, /无明显雨雪/);
});

test('T03 阈值必须真的生效：85% 在 90% 阈值下不触发', () => {
  assert.equal(wetVerdict({ probability: 85 }, 90), false);
  assert.equal(wetVerdict({ probability: 85 }, 30), true);
  const plan = run(RAINY, { threshold: 90 });
  assert.equal(plan.fallback, null, '门槛 90% 时 85% 不该触发');
});

test('T04 上限不足：智能候选被截断时如实给出缺口（固定候选已覆盖则不报）', () => {
  // 时序：09:00 抵达，行程 35 + 余量 10 + 准备 30 + 雨天额外 5 = 80 分钟
  // → 理想唤醒 = 09:00 - 80 = 07:40。基础闹钟在 08:20，比理想晚 40 分钟 → 需提前 40。
  // 上限压到 15 → 智能候选缺 25 分钟。
  const greedy = run(RAINY, {
    baseAlarmAt: DAY + 8 * 3600000 + 20 * 60000,
    maxAdvance: 15,
    extra: 15,
    preferences: { rain: { mode: null, extra: 5 }, snow: { mode: null, extra: 5 } },
  });
  // 但固定候选（基础 08:20 - 20 = 08:00）比智能的 08:05 更早，已经把问题解决了，
  // 按验收 B02 第③条，这时不能再弹「还差 25 分钟」。
  assert.equal(greedy.mode, 'fixed', `固定候选更早时应胜出，实际 mode=${greedy.mode}`);
  assert.equal(greedy.gapMinutes, 0, '固定候选已覆盖时不应报缺口');
  assert.notEqual(greedy.status, PLAN_STATUS.CAPPED);

  // 关掉固定模式，缺口就必须如实暴露
  const smartOnly = run(RAINY, {
    baseAlarmAt: DAY + 8 * 3600000 + 20 * 60000,
    maxAdvance: 15,
    fixedEnabled: false,
    extra: 15,
    preferences: { rain: { mode: null, extra: 5 }, snow: { mode: null, extra: 5 } },
  });
  assert.equal(smartOnly.status, PLAN_STATUS.CAPPED, `实际 status=${smartOnly.status} gap=${smartOnly.gapMinutes}`);
  assert.ok(smartOnly.gapMinutes > 0, '缺口必须大于 0');
  assert.ok(smartOnly.candidates.smart.advance <= 15, '实际提前量不得超过上限');
});

test('T04 强天气不自动触发：只提示，不擅自把用户叫醒得更早', () => {
  const plan = run(SEVERE_RAIN, {
    extra: 0,
    preferences: { rain: { mode: null, extra: 0 }, snow: { mode: null, extra: 0 } },
  });
  // extra 为 0 时没有额外准备，需要的提前量与晴天一致 —— 强天气不应额外加码
  const dryPlan = run(DRY, {
    extra: 0,
    preferences: { rain: { mode: null, extra: 0 }, snow: { mode: null, extra: 0 } },
  });
  assert.equal(
    plan.candidates.smart?.advance ?? 0,
    dryPlan.candidates.smart?.advance ?? 0,
    '强天气目前只做提示，不应比晴天提前更多',
  );
});

test('T04 固定模式不依赖天气：天气未知时固定候选仍然有效', () => {
  const plan = run(MISSING, { smartEnabled: false });
  assert.ok(plan.wakeAt != null, '只开固定模式时，天气缺失也应给出唤醒时间');
  assert.equal(plan.mode, 'fixed');
});

test('T04 两种模式同时开启时只产出一个提前唤醒', () => {
  const plan = run(RAINY, { extra: 15, fixedMinutes: 60, maxAdvance: 30 });
  const usable = Object.entries(plan.candidates || {}).filter(([, c]) => c && !c.expired && !c.skipped);
  assert.equal(usable.length >= 1, true);
  assert.ok(plan.wakeAt != null);
  // 取更早的那个
  const times = usable.map(([, c]) => c.at).filter(Number.isFinite);
  assert.equal(plan.wakeAt, Math.min(...times));
});
