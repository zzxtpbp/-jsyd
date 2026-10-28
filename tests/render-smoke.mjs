// 真实渲染冒烟：用 Vite 把组件打包成 SSR bundle，再用 react-dom/server 渲染。
// 这样能跑通 .jsx，且能捕获 hooks 顺序、undefined 访问等运行期问题。
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const entry = path.join(root, 'ssr-smoke.entry.jsx');
fs.writeFileSync(entry, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Dashboard from './src/Dashboard.jsx';
import { NextPlanCard, GapNotice, WeatherSettings, RingtoneSettings } from './src/PlanSettings.jsx';
import { buildPlan } from './src/plan.js';
import { DEFAULT_COMMUTE } from './src/commuteSettings.js';
import { SetupGuide, RecheckSettings, AmbientSettings } from './src/SetupGuide.jsx';
import { ambientWindow, shouldSound, ambientProfile } from './src/ambient.js';

export function run() {
  const out = [];
  out.push(['Dashboard', renderToStaticMarkup(React.createElement(Dashboard))]);
  const base = new Date(2026, 9, 29, 7, 0, 0, 0).getTime();
  const capped = buildPlan({
    baseAlarmAt: base, arrivalAt: base, durationMinutes: 45, buffer: 5, preparation: 15,
    extra: 0, maxAdvance: 40, smartEnabled: true, weatherKnown: true, routeKnown: true, wet: false,
  });
  out.push(['NextPlanCard(capped)', renderToStaticMarkup(React.createElement(NextPlanCard, { plan: capped, baseAlarm: { at: base } }))]);
  out.push(['GapNotice', renderToStaticMarkup(React.createElement(GapNotice, { plan: capped }))]);
  const unknown = buildPlan({
    baseAlarmAt: base, arrivalAt: base, durationMinutes: 40, buffer: 5, preparation: 15,
    extra: 0, maxAdvance: 40, smartEnabled: true, weatherKnown: false, routeKnown: true,
  });
  out.push(['NextPlanCard(weather_unknown)', renderToStaticMarkup(React.createElement(NextPlanCard, { plan: unknown, baseAlarm: { at: base } }))]);
  out.push(['WeatherSettings', renderToStaticMarkup(React.createElement(WeatherSettings, {
    commute: DEFAULT_COMMUTE, onChange() {}, location: { name: '上海', example: true }, onLocate() {}, locating: false,
  }))]);
  out.push(['RingtoneSettings', renderToStaticMarkup(React.createElement(RingtoneSettings, {
    prefs: { ringtone: 'classic', volume: 1 }, onChange() {}, onPreview() {}, previewing: false,
  }))]);
  const guideProps = {
    commute: DEFAULT_COMMUTE, setCommute() {}, alarms: [], home: null, office: null,
    arrival: '', setArrival() {}, setGuideStep() {}, error: '', onClose() {},
    onFinish() {}, onCreateAlarm() {}, onEnableAlarm() {}, onOpenCommute() {}, onTestRing() {},
  };
  out.push(['Guide(step0)', renderToStaticMarkup(React.createElement(SetupGuide, { ...guideProps, guideStep: 0 }))]);
  out.push(['Guide(step1)', renderToStaticMarkup(React.createElement(SetupGuide, { ...guideProps, guideStep: 1 }))]);
  out.push(['Guide(step2)', renderToStaticMarkup(React.createElement(SetupGuide, { ...guideProps, guideStep: 2 }))]);
  out.push(['Guide(step3)', renderToStaticMarkup(React.createElement(SetupGuide, { ...guideProps, guideStep: 3 }))]);
  out.push(['Recheck', renderToStaticMarkup(React.createElement(RecheckSettings, { commute: DEFAULT_COMMUTE, onChange() {}, baseAlarmAt: base }))]);
  out.push(['Ambient', renderToStaticMarkup(React.createElement(AmbientSettings, { commute: { ...DEFAULT_COMMUTE, sound: { ...DEFAULT_COMMUTE.sound, ambientEnabled: true } }, onChange() {}, onPreview() {}, previewing: false, onStopPreview() {}, profileLabel: '雨声' }))]);
  const win = ambientWindow(base, { enabled: true, offsetMinutes: 5, durationMinutes: 2 });
  out.push(['ambient 起止窗口', String(win.start === base - 5 * 60000 && win.end === base + 2 * 60000)]);
  out.push(['ambient 窗口内发声', String(shouldSound(base - 60000, win, false) && !shouldSound(base - 60000, win, true) && !shouldSound(base + 3 * 60000, win, false))]);
  out.push(['ambient 音色分流', ambientProfile(61).kind + '/' + ambientProfile(73).kind + '/' + ambientProfile(0).kind]);
  return out;
}
`);

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});

const checks = [];
try {
  const mod = await server.ssrLoadModule('/ssr-smoke.entry.jsx');
  const results = mod.run();
  const byName = Object.fromEntries(results);

  checks.push(['Dashboard 渲染成功', byName.Dashboard.length > 2000]);
  checks.push(['包含「下一次安排」', /下一次安排/.test(byName.Dashboard)]);
  checks.push(['包含「主要提前唤醒」', /主要提前唤醒/.test(byName.Dashboard)]);
  checks.push(['capped 显示超上限文案', /需要的提前量超过智能上限/.test(byName['NextPlanCard(capped)'])]);
  checks.push(['capped 显示 06:20', /06:20/.test(byName['NextPlanCard(capped)'])]);
  checks.push(['缺口提示显示「还差 25 分钟」', /还差 25 分钟/.test(byName.GapNotice)]);
  checks.push(['缺天气显示 weather 未知', /天气数据缺失/.test(byName['NextPlanCard(weather_unknown)'])]);
  checks.push(['不谎称已同步', !/已同步到账号/.test(byName['NextPlanCard(weather_unknown)'])]);
  checks.push(['天气组渲染阈值', /降水概率阈值/.test(byName.WeatherSettings)]);
  checks.push(['天气组标注示例位置', /示例位置/.test(byName.WeatherSettings)]);
  // A02：四步引导的每步都必须有真实内容，进度条与按钮文案同步推进。
  for (const [i, title] of [[0, '基础闹钟'], [1, '选择模式'], [2, '复查与声音'], [3, '预览确认']]) {
    const h = byName['Guide(step' + i + ')'] || '';
    checks.push(['引导第 ' + (i + 1) + ' 步渲染「' + title + '」', h.includes(title) && h.includes('wizard-progress') && h.includes((i + 1) + ' / 4')]);
  }
  checks.push(['引导第 4 步出现「确认并保存」', /确认并保存/.test(byName['Guide(step3)'])]);
  checks.push(['引导第 1 步上一步禁用', /disabled=""[^>]*>上一步/.test(byName['Guide(step0)']) || /disabled.{0,20}上一步/.test(byName['Guide(step0)'])]);
  // A03：复查组与账号组
  checks.push(['复查组渲染复查时间', /早晨复查时间/.test(byName.Recheck)]);
  // A07：环境音组
  checks.push(['环境音组渲染偏移与音量', /主铃前开始/.test(byName.Ambient) && /音量/.test(byName.Ambient) && /试听环境音/.test(byName.Ambient)]);
  checks.push(['环境音窗口 = 主铃前 5 分 ~ 主铃后 2 分', byName['ambient 起止窗口'] === 'true']);
  checks.push(['环境音窗口内发声、主铃响铃时让位', byName['ambient 窗口内发声'] === 'true']);
  checks.push(['环境音音色按天气分流', byName['ambient 音色分流'] === 'rain/snow/wind']);
  checks.push(['铃声组渲染 5 种', ['经典闹铃', '清晨风铃', '温暖和弦', '海浪渐强', '大喇叭'].every(n => byName.RingtoneSettings.includes(n))]);
} catch (e) {
  console.log('RENDER_ERROR:', e.message);
  checks.push(['渲染未抛错', false]);
} finally {
  await server.close();
  fs.rmSync(entry, { force: true });
}

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n${checks.length - failed}/${checks.length} 通过`);
if (failed) process.exit(1);
