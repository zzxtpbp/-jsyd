import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinate, assess } from '../src/live.js';
test('坐标校验拒绝空值及越界',()=>{
  assert.deepEqual(coordinate('121.47,31.23'),{lon:121.47,lat:31.23});
  for(const v of [',','190,20','20,91','abc,20']) assert.throws(()=>coordinate(v));
});
test('真实逐时预报按出发时段匹配，缺失或超范围不调整',()=>{
  const w={hourly:{time:['2026-10-17T08:00'],weather_code:[61],precipitation_probability:[80],precipitation:[1]}};
  const d=new Date(2026,9,17,8,30);
  const r=assess(w,{duration:300},d,15,10);
  assert.equal(r.advance,15);assert.equal(r.approval,true);
  assert.throws(()=>assess(w,{duration:300},new Date(2026,9,20),15,30));
  // 概率缺失曾经直接抛错；按 docs/weather-rules.md 决定 2，改为标记 unknown，
  // 由界面显示「天气未知」，不再让整个通勤方案失败，也不再假装「不下雨」。
  w.hourly.weather_code[0]=null;
  w.hourly.precipitation_probability[0]=null;
  const unknown=assess(w,{duration:300},d,15,30);
  assert.equal(unknown.unknown,true);
  assert.equal(unknown.advance,0);
});
