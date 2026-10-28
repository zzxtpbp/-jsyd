// B03：自驾与打车是两种出行方式，等车时间只对打车生效，且由用户填写，不由天气猜测。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMUTE, restoreCommute, validateCommute, effectiveTaxiWait, TRANSPORT_MODE } from '../src/commuteSettings.js';

const future = Date.now() + 12 * 3600000;

test('自驾一律不加等车时间，即使设置里填了值', () => {
  const settings = { ...DEFAULT_COMMUTE, transport: '自驾', taxiWait: 25 };
  assert.equal(effectiveTaxiWait(settings), 0);
});

test('打车使用用户填写的等车时间', () => {
  const settings = { ...DEFAULT_COMMUTE, transport: '打车', taxiWait: 12 };
  assert.equal(effectiveTaxiWait(settings), 12);
});

test('打车但没填等车时间时为 0，不按天气自动加', () => {
  assert.equal(effectiveTaxiWait({ ...DEFAULT_COMMUTE, transport: '打车', taxiWait: 0 }), 0);
  assert.equal(effectiveTaxiWait({ ...DEFAULT_COMMUTE, transport: '打车', taxiWait: null }), 0);
});

test('等车时间非法时回落 0，不把 NaN 带进计算', () => {
  assert.equal(effectiveTaxiWait({ transport: '打车', taxiWait: -5 }), 0);
  assert.equal(effectiveTaxiWait({ transport: '打车', taxiWait: 999 }), 0);
  assert.equal(effectiveTaxiWait({ transport: '打车', taxiWait: 'abc' }), 0);
});

test('自驾与打车映射到不同的路线 modes key', () => {
  assert.equal(TRANSPORT_MODE['自驾'], 'drive');
  assert.equal(TRANSPORT_MODE['打车'], 'taxi');
  assert.notEqual(TRANSPORT_MODE['自驾'], TRANSPORT_MODE['打车']);
});

test('v1 旧记录能读出来，并迁移成 v2 结构', () => {
  const v1 = { commute: { version: 1, extra: 18, transport: '打车', buffer: 12, fixedEnabled: true } };
  const restored = restoreCommute(v1);
  assert.equal(restored.version, 2);
  assert.equal(restored.extra, 18);
  assert.equal(restored.buffer, 12);
  assert.equal(restored.transport, '打车');
  // 旧的单一 extra 沿用为雨雪两档的初始值，不让用户设置凭空变化。
  assert.equal(restored.preferences.rain.extra, 18);
  assert.equal(restored.preferences.snow.extra, 18);
  assert.equal(restored.preferences.snow.mode, null);
  assert.equal(restored.taxiWait, 0);
});

test('v2 记录原样恢复，preferences 不被默认值覆盖', () => {
  const v2 = {
    commute: {
      version: 2, transport: '骑行', taxiWait: 8,
      preferences: { rain: { mode: '地铁', extra: 10 }, snow: { mode: '公交', extra: 25 } },
    },
  };
  const restored = restoreCommute(v2);
  assert.equal(restored.preferences.rain.mode, '地铁');
  assert.equal(restored.preferences.snow.extra, 25);
  assert.equal(restored.taxiWait, 8);
});

test('备用方式不能与当前方式相同，额外准备必须在 0—240', () => {
  const base = { ...DEFAULT_COMMUTE, fixedEnabled: true, transport: '骑行' };
  assert.equal(validateCommute(base, future), null);
  const same = { ...base, preferences: { ...base.preferences, snow: { mode: '骑行', extra: 10 } } };
  assert.match(validateCommute(same, future), /不应与当前交通方式相同/);
  const bad = { ...base, preferences: { ...base.preferences, rain: { mode: null, extra: 999 } } };
  assert.match(validateCommute(bad, future), /0 到 240/);
});
