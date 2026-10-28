// SSR 渲染冒烟：把真实组件渲染成 HTML 字符串，再断言关键功能确实出现在页面上。
// 为什么需要它：node:test 只测纯函数，vite build 只测能不能编译；
// 「组件已经写好但从来没被 import / 分支被覆盖掉」这两种问题只有渲染才能抓到。
import { createServer } from 'vite';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', '__render_smoke.entry.jsx');

// 必须走 vite 的 ssrLoadModule 才能解析 jsx + css import；
// 直接 import('react') 在 SSR 容器里是 CJS，会报 module is not defined。
writeFileSync(entry, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupGuide, RecheckSettings, AmbientSettings, WeatherFallbackSettings } from './SetupGuide.jsx';
import { DEFAULT_COMMUTE } from './commuteSettings.js';

const noop = () => {};
const commute = {
  ...DEFAULT_COMMUTE,
  fixedEnabled: true, smartEnabled: true, transport: '自驾',
  preferences: { rain: { mode: '地铁', extra: 18 }, snow: { mode: null, extra: 25 } },
};
const props = {
  commute, setCommute: noop, alarms: [], home: null, office: null,
  arrival: '2026-10-29T09:00', setArrival: noop,
  setGuideStep: noop, error: '', onClose: noop, onFinish: noop,
  onCreateAlarm: noop, onEnableAlarm: noop, onOpenCommute: noop, onTestRing: noop,
};

export function renderAll() {
  const out = {};
  for (const step of [0, 1, 2, 3]) {
    out['guide' + step] = renderToStaticMarkup(React.createElement(SetupGuide, { ...props, guideStep: step }));
  }
  out.recheck = renderToStaticMarkup(React.createElement(RecheckSettings, { commute, onChange: noop, baseAlarmAt: Date.now() + 86400000 }));
  out.ambient = renderToStaticMarkup(React.createElement(AmbientSettings, { commute, onChange: noop, profileLabel: '雨声', onPreview: noop, previewing: false, onStopPreview: noop }));
  out.fallback = renderToStaticMarkup(React.createElement(WeatherFallbackSettings, { commute, onChange: noop }));
  out.fallbackCompact = renderToStaticMarkup(React.createElement(WeatherFallbackSettings, { commute, onChange: noop, compact: true }));
  return out;
}
`);

const checks = [
  // A02 四步引导：这是上一轮被合并覆盖掉的功能，必须常驻断言
  ['guide0', '1. 基础闹钟', '四步引导第 1 步'],
  ['guide0', '新增基础闹钟', '引导第 1 步可新增基础闹钟'],
  ['guide1', '固定提前', '引导第 2 步固定模式'],
  ['guide1', '智能通勤', '引导第 2 步智能模式'],
  ['guide1', '填写详细通勤资料', '引导第 2 步跳转通勤页'],
  ['guide2', '早晨复查时间', '引导第 3 步复查时间'],
  ['guide2', '天气环境音', '引导第 3 步环境音'],
  ['guide2', '雨雪天是否换一种出行方式', 'B08 引导第 3 步含备用方式配置'],
  ['guide2', '保持「自驾」', 'B08 备用方式默认不改交通方式'],
  ['guide2', '地铁', 'B08 备用方式可选其它交通方式'],
  ['guide3', '4. 预览确认', '引导第 4 步预览'],
  ['guide3', '雨雪备用', 'B08 引导预览汇总备用方式'],
  ['guide3', '雨：地铁+18分', 'B08 预览显示雨天备用'],
  ['guide3', '雪：仍自驾+25分', 'B08 预览显示雪天备用'],
  // A03 / A07 / B08
  ['recheck', '复查与备用', 'A03 复查面板'],
  ['ambient', '试听环境音', 'A07 环境音试听'],
  ['fallback', '雨雪备用方式', 'B08 设置页面板'],
  ['fallback', '明早若有雨，改为「地铁」并额外预留 18 分钟', 'B08 雨天说明文案'],
  ['fallback', '明早若有雪，仍按「自驾」出行，只额外预留 25 分钟', 'B08 雪天说明文案'],
  ['fallbackCompact', '雨雪天是否换一种出行方式', 'B08 引导内紧凑版'],
];

const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let failed = 0;
try {
  const mod = await server.ssrLoadModule('/src/__render_smoke.entry.jsx');
  const html = mod.renderAll();
  for (const [key, needle, label] of checks) {
    const ok = String(html[key] || '').includes(needle);
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'MISS'}  ${label}  ← "${needle}"`);
  }
  // 概率未知语义（B01）必须在 Dashboard 源码里出现，防止 UI 又退回「null%」
  const { readFileSync } = await import('node:fs');
  const dash = readFileSync(join(root, 'src', 'Dashboard.jsx'), 'utf8');
  const semantic = [
    ["概率未知", 'B01 核心卡概率缺失文案'],
    ["数据不全 · 不提前", 'B01 核心卡未知态提前量'],
    ["commuteWet===null", 'B01 首页文案区分未知'],
  ];
  for (const [needle, label] of semantic) {
    const ok = dash.includes(needle);
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'MISS'}  ${label}  ← "${needle}"`);
  }
} finally {
  await server.close();
  try { unlinkSync(entry); } catch {}
}
console.log(failed ? `\n${failed} 项未通过` : '\n渲染冒烟全部通过');
process.exit(failed ? 1 : 0);
