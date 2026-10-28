// B04：天气点位与通勤点位必须分离。
// 这是一个数据流约束，不是纯函数的某个返回值，所以用源码级断言 + 渲染断言一起守。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dash = readFileSync(join(root, 'src', 'Dashboard.jsx'), 'utf8');

test('首页区分 weatherSpot 与 commuteSpot 两个点位', () => {
  assert.match(dash, /const weatherSpot=/, '应声明 weatherSpot');
  assert.match(dash, /const commuteSpot=/, '应声明 commuteSpot');
});

test('通勤时段天气来自「家」，不直接拿天气页主位置', () => {
  // commuteWindow 必须用 commuteWeatherRaw（家的天气，可回退），
  // 不能写成 commuteWeatherWindow(weather?.weather, ...)
  assert.match(dash, /commuteWeatherWindow\(commuteWeatherRaw/);
  assert.doesNotMatch(
    dash,
    /commuteWeatherWindow\(weather\?\.weather/,
    'commuteWindow 不能直接用主位置天气，否则用户切换城市后通勤结论会跟着变',
  );
});

test('家的天气有独立的请求与失效重取', () => {
  assert.match(dash, /const \[homeWeather,setHomeWeather\]=useState\(null\)/);
  // 依赖 home 坐标变化重新请求
  assert.match(dash, /\},\[home\?\.lon,home\?\.lat\]\)/);
});

test('回退到主位置时界面上有明确提示', () => {
  assert.match(dash, /commuteWeatherFallback/);
  assert.match(dash, /家的天气还没取到/);
  assert.match(dash, /通勤天气按「/);
});

test('通勤计算复用家的天气缓存，不重复打接口', () => {
  assert.match(dash, /sameSpot=homeWeather/);
  assert.match(dash, /setHomeWeather\(\{\.\.\.r,spotLon:home\.lon,spotLat:home\.lat\}\)/);
});
