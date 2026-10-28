// B09：耗时来源必须可追溯，演示层不得混进线上路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from '../src/plan.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.js', '.jsx', '.mjs'].includes(extname(full))) out.push(full);
  }
  return out;
}

test('planner.js 标注为 DEMO ONLY', () => {
  const src = readFileSync(join(root, 'src', 'planner.js'), 'utf8');
  assert.match(src, /DEMO ONLY/);
  assert.match(src, /export const DEMO_ONLY = true/);
});

test('除测试外没有任何模块 import planner.js', () => {
  const files = walk(join(root, 'src')).concat(walk(join(root, 'server')));
  const offenders = files.filter(f => /from\s+['"].*planner\.js['"]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, [], `planner.js 被线上代码引用：${offenders.join(', ')}`);
});

test('routeNote / durationSource 随计划一起返回', () => {
  const plan = buildPlan({
    baseAlarmAt: Date.UTC(2026, 9, 29, 0, 0),
    arrivalAt: Date.UTC(2026, 9, 29, 1, 0),
    durationMinutes: 30, buffer: 10, preparation: 40, extra: 15, maxAdvance: 60,
    fixedMinutes: 20, fixedEnabled: true, smartEnabled: true,
    weatherKnown: true, routeKnown: true, wet: false, probability: 10,
    durationSource: 'user',
    now: Date.UTC(2026, 9, 28, 12, 0),
  });
  // 耗时来源必须写进 plan，UI 才有东西可展示「这是接口估的还是你填的」
  assert.equal(plan.sources.duration, 'user');
  assert.ok('routeNote' in plan, 'plan 应带 routeNote 字段');
});

test('电量/耗时来源缺失时默认标记为 amap，不会静默为空', () => {
  const plan = buildPlan({
    baseAlarmAt: null, arrivalAt: null, durationMinutes: null,
    buffer: 10, preparation: 40, extra: 15, maxAdvance: 60,
    fixedMinutes: 20, fixedEnabled: true, smartEnabled: false,
    now: Date.UTC(2026, 9, 28, 12, 0),
  });
  assert.ok(plan.sources && typeof plan.sources === 'object');
  assert.equal(plan.sources.duration, 'amap');
});
