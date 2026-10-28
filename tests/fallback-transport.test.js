// B08 / B09：雨雪备用方式必须「换名字也换耗时」。
// 验收报告里的问题是：配置了「下雨改乘公交」之后 ——
//   1. 时间仍然按驾车耗时算（公交 40 分钟其实是驾车那 40 分钟）；
//   2. 通勤方案页仍显示原交通方式，和首页说的「已改乘公交」对不上。
// 这组测试锁住三件事：
//   a) 切换后采用备用方式自己的耗时，叫醒时间随之变化；
//   b) 备用耗时缺失时绝不退回驾车耗时，而是标成「路线未知」并如实说明；
//   c) 天气未知（affected=null）时不切换交通方式。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, buildRouteNote, PLAN_STATUS } from '../src/plan.js';

// 用固定时刻构造本地时间，避免测试受运行机器时区影响。
const at = (h, m = 0) => {
  const d = new Date(2026, 9, 29, h, m, 0, 0);
  return +d;
};

const base = {
  baseAlarmAt: at(8, 0),
  arrivalAt: at(9, 0),
  buffer: 15,
  preparation: 25,
  extra: 15,
  maxAdvance: 240,
  fixedEnabled: false,
  smartEnabled: true,
  weatherKnown: true,
  routeKnown: true,
  threshold: 30,
  // 雨/雪都改成公交，额外准备沿用设置里的 15 分钟。
  preferences: { rain: { mode: '公交', extra: 15 }, snow: { mode: '公交', extra: 20 } },
};

test('B08①：下雨改乘公交时采用公交耗时，不沿用驾车耗时', () => {
  const drive = buildPlan({
    ...base,
    durationMinutes: 40,
    wet: true,
    // 没有备用耗时（等同于没配备用方式时的对照）
    preferences: null,
  });
  const bus = buildPlan({
    ...base,
    durationMinutes: 40,
    wet: true,
    alternateDurationMinutes: 65,
    alternateDurationSource: 'amap',
  });
  // 注意口径：advance = 行程 + 到达余量 + 起床准备 + 雨雪额外准备 − (基础闹钟 − 到达时间)。
  // 基础 08:00、到达 09:00 → 可提前量 60 分钟；驾车 40 分钟时 40+15+25+15=95，
  // 减 60 后需提前 35 分钟 → 07:25。换成公交 65 分钟后需提前 60 分钟 → 07:00。
  // 公交比驾车多 25 分钟，叫醒也必须相应提前 25 分钟，不能和驾车一样。
  assert.equal(drive.wakeAt, at(7, 25));
  assert.equal(bus.wakeAt, at(7, 0));
  assert.equal(bus.transport, '公交');
});

test('B08②：备用耗时缺失时不退回驾车耗时，而是标成路线未知', () => {
  const plan = buildPlan({
    ...base,
    durationMinutes: 40,
    wet: true,
    // 故意不传 alternateDurationMinutes：浏览器还没查到公交路线
    alternateDurationMinutes: null,
  });
  assert.equal(plan.transport, '公交');
  // 没有可信耗时 → 不能给出叫醒时间，也不能报一个「看起来正常」的数。
  assert.equal(plan.wakeAt, null);
  assert.notEqual(plan.status, PLAN_STATUS.READY);
  // 说明里必须点明「没按备用方式查过」，不能只说「手填值」。
  assert.match(plan.routeNote, /备用方式/);
  // 绝不能出现「40 分钟」这种拿驾车数据冒充的表述
  assert.doesNotMatch(plan.reason, /行程约 40 分钟/);
});

test('B08③：备用耗时来源为手填时，routeNote 不能声称是高德估算', () => {
  const plan = buildPlan({
    ...base,
    durationMinutes: 40,
    wet: true,
    alternateDurationMinutes: 70,
    alternateDurationSource: 'user',
  });
  assert.equal(plan.sources.duration, 'user');
  assert.match(plan.routeNote, /你填写/);
  assert.doesNotMatch(plan.routeNote, /高德接口估算/);
});

test('B08④：雨雪未确认（affected=null）时不切换交通方式', () => {
  const plan = buildPlan({
    ...base,
    durationMinutes: 40,
    wet: null,
    alternateDurationMinutes: 65,
  });
  assert.equal(plan.transport, null);
  assert.equal(plan.fallback, null);
});

test('B08⑤：不是雨天时不采用备用方式耗时，仍按原方式计算', () => {
  const plan = buildPlan({
    ...base,
    durationMinutes: 40,
    wet: false,
    alternateDurationMinutes: 65,
  });
  assert.equal(plan.transport, null);
  // 不下雨 → 不切换方式、不加额外准备：40+15+25=80，减可提前量 60 → 需提前 20 分钟。
  assert.equal(plan.wakeAt, at(7, 40));
});

test('B09：下雪时用雪档备用方式与雪档额外准备', () => {
  const plan = buildPlan({
    ...base,
    durationMinutes: 40,
    wet: true,
    snow: true,
    preferences: { rain: { mode: '公交', extra: 15 }, snow: { mode: '地铁', extra: 20 } },
    alternateDurationMinutes: 50,
  });
  assert.equal(plan.transport, '地铁');
  // 雪档 50 分钟必须进解释里（不能出现驾车那 40 分钟）。
  assert.match(plan.reason, /50 分钟/);
  assert.doesNotMatch(plan.reason, /40 分钟/);
  // 雪档额外准备 20 分钟同样进了计算：50+15+25+20=110，减 60 → 需提前 50 分钟 → 07:10。
  assert.equal(plan.wakeAt, at(7, 10));
});

test('B08：buildRouteNote 对「已切换但没查路线」给出明确提示', () => {
  const note = buildRouteNote({ durationSource: 'user', durationMinutes: null, transport: '公交', routeKnown: false, alternatePending: true });
  assert.match(note, /公交/);
  assert.match(note, /备用方式/);
});
