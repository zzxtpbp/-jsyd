import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMUTE, restoreCommute, validateCommute } from '../src/commuteSettings.js';

test('旧记录的天气门槛和时间参数可读取，声音默认值补齐', () => {
  const restored = restoreCommute({prefs:{threshold:80},preparation:25,buffer:10,commute:{fixedEnabled:true,sound:{ambientVolume:60}}});
  assert.equal(restored.threshold,80);
  assert.equal(restored.preparation,25);
  assert.equal(restored.buffer,10);
  assert.equal(restored.sound.ambientVolume,60);
  assert.equal(restored.sound.ambientOffset,DEFAULT_COMMUTE.sound.ambientOffset);
});

test('复查晚于首次可能发声时拒绝保存，仅固定备用需要固定模式', () => {
  const base = new Date(); base.setDate(base.getDate()+1); base.setHours(7,0,0,0);
  const settings = {...DEFAULT_COMMUTE,smartEnabled:true,recheckTime:'06:45'};
  assert.match(validateCommute(settings,+base),/复查晚于/);
  assert.match(validateCommute({...settings,fallback:'仅按固定模式'},+base),/固定模式未开启/);
  assert.equal(validateCommute({...settings,fixedEnabled:true,fallback:'仅按固定模式'},+base),null);
});

test('固定模式无需智能通勤资料；环境音偏移计入智能模式的复查冲突', () => {
  const base = new Date(); base.setDate(base.getDate()+1); base.setHours(7,0,0,0);
  assert.equal(validateCommute({...DEFAULT_COMMUTE,fixedEnabled:true,recheckTime:'06:55'},+base),null);
  const smart = {...DEFAULT_COMMUTE,smartEnabled:true,recheckTime:'06:25'};
  assert.equal(validateCommute(smart,+base),null);
  assert.match(validateCommute({...smart,sound:{...smart.sound,ambientEnabled:true,ambientOffset:10}},+base),/复查晚于/);
  assert.match(validateCommute(smart,NaN),/基础闹钟/);
});
