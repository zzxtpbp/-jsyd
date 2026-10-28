// B01 回归：降水门槛唯一化，概率缺失保留「未知」。
// 对应 docs/weather-rules.md 第四节验收用例。
import test from 'node:test';
import assert from 'node:assert/strict';
import { wetVerdict, daySummary, commuteWeatherWindow, windowVerdict, isSnow, isSevere } from '../src/schedule.js';
import { assess } from '../src/live.js';

const hours = (rows) => ({
  hourly: {
    time: rows.map(r => r.time),
    weather_code: rows.map(r => r.code),
    precipitation_probability: rows.map(r => r.probability),
    precipitation: rows.map(r => r.amount),
    temperature_2m: rows.map(() => 12),
  },
});

test('用例1：门槛 80、概率 30、有 0.5mm 降水 —— 不触发', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 61, probability: 30, amount: 0.5 }]);
  const win = commuteWeatherWindow(w, new Date(2026, 9, 29, 7, 0), new Date(2026, 9, 29, 7, 40), 80);
  assert.equal(win.affected, false);
  assert.deepEqual(win.wetHours, []);
});

test('用例2：门槛 80、概率 30、代码 61、降水量 0 —— 不触发', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 61, probability: 30, amount: 0 }]);
  const win = commuteWeatherWindow(w, new Date(2026, 9, 29, 7, 0), new Date(2026, 9, 29, 7, 40), 80);
  assert.equal(win.affected, false);
});

test('用例3：门槛 80、概率 85 —— 触发', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 1, probability: 85, amount: 0 }]);
  const win = commuteWeatherWindow(w, new Date(2026, 9, 29, 7, 0), new Date(2026, 9, 29, 7, 40), 80);
  assert.equal(win.affected, true);
  assert.deepEqual(win.wetHours, ['07:00']);
});

test('用例4：概率缺失保留未知，不当作 0，也不触发', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 61, probability: null, amount: null }]);
  const win = commuteWeatherWindow(w, new Date(2026, 9, 29, 7, 0), new Date(2026, 9, 29, 7, 40), 80);
  assert.equal(win.affected, null);
  assert.equal(win.probability, null);
  assert.equal(win.unknown, true);
  const day = daySummary(w, '2026-10-29', 80);
  assert.equal(day.probability, null);
  assert.equal(day.affected, null);
});

test('用例5：等于门槛即触发', () => {
  assert.equal(wetVerdict({ probability: 30 }, 30), true);
  assert.equal(wetVerdict({ probability: 29 }, 30), false);
});

test('用例6：强天气不绕过门槛（雷暴 79% 低于 80% 不触发）', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 95, probability: 79, amount: 5 }]);
  const win = commuteWeatherWindow(w, new Date(2026, 9, 29, 7, 0), new Date(2026, 9, 29, 7, 40), 80);
  assert.equal(win.affected, false);
  // 但强天气必须能被识别出来，供界面做「是否临时降低门槛」的提示。
  assert.equal(win.severe, true);
  assert.equal(isSevere(95), true);
  assert.equal(isSnow(73), true);
});

test('一段里既有未知又有未触发：未知优先，结论为 null', () => {
  const w = hours([
    { time: '2026-10-29T07:00', code: 1, probability: 10, amount: 0 },
    { time: '2026-10-29T08:00', code: 1, probability: null, amount: null },
  ]);
  const win = commuteWeatherWindow(w, new Date(2026, 9, 29, 7, 0), new Date(2026, 9, 29, 8, 30), 60);
  assert.equal(win.affected, null);
});

test('windowVerdict 在无预报时返回 known=false，不谎称不下雨', () => {
  const v = windowVerdict(null, Date.now(), Date.now() + 3600000, 30);
  assert.equal(v.known, false);
  assert.equal(v.affected, null);
});

test('assess：阈值由调用方传入，不再写死 50', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 61, probability: 40, amount: 1 }]);
  const dep = new Date(2026, 9, 29, 7, 10);
  const low = assess(w, { duration: 300 }, dep, 15, 60, 30);
  assert.equal(low.wet, true);
  assert.equal(low.advance, 15);
  const high = assess(w, { duration: 300 }, dep, 15, 60, 80);
  assert.equal(high.wet, false);
  assert.equal(high.advance, 0);
});

test('assess：概率缺失标记 unknown，不推进也不声称不下雨', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 61, probability: null, amount: null }]);
  const r = assess(w, { duration: 300 }, new Date(2026, 9, 29, 7, 10), 15, 60, 30);
  assert.equal(r.unknown, true);
  assert.equal(r.advance, 0);
});

test('assess：超出预报范围仍然抛错，与「查到了但没数据」区分开', () => {
  const w = hours([{ time: '2026-10-29T07:00', code: 1, probability: 10, amount: 0 }]);
  assert.throws(() => assess(w, { duration: 300 }, new Date(2026, 10, 5, 7, 0), 15, 60, 30), /超出当前预报范围/);
});

test('全仓不再用降水量或天气代码做触发判定', async () => {
  const fs = await import('node:fs');
  const src = ['src/schedule.js', 'src/live.js', 'src/Dashboard.jsx'].map(p => fs.readFileSync(p, 'utf8')).join('\n');
  // 允许 amount 作为字段名出现，不允许它出现在比较里。
  assert.equal(/amount\s*>/.test(src), false, '仍有 amount> 形式的触发判定');
  assert.equal(/code\s*>=\s*51\s*\|\|/.test(src), false, '仍有用天气代码绕过门槛的写法');
});
