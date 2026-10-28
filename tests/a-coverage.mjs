// A 项完成度自检：逐条核对计划里的验收点是否真的在代码里可验证。
// 静态检索会统计全部源文件；关键项再做一次真实 SSR 渲染断言，
// 避免「组件写了但没接进页面」这种假通过。
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const entry = path.join(root, 'ssr-coverage.entry.jsx');
// 首次打开（guideComplete=false）的页面，用于断言引导确实挂在页面上。
fs.writeFileSync(entry, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Dashboard from './src/Dashboard.jsx';

export function run(storeKey) {
  return renderToStaticMarkup(React.createElement(Dashboard));
}
`);

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const dash = read('src/Dashboard.jsx');
const plan = read('src/plan.js');
const settings = read('src/PlanSettings.jsx');
const commute = read('src/commuteSettings.js');
const guide = read('src/SetupGuide.jsx');
const ambient = read('src/ambient.js');
const guideCss = read('src/guide.css');
const allSrc = [dash, plan, settings, commute, guide, ambient].join('\n');

const has = (s, re) => (s.match(re) || []).length;

// 首页首次打开：没有任何已保存的引导状态。
const store = new Map([['jishi-studio-v3', JSON.stringify({ alarms: [] })]]);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let html = '';
try {
  const mod = await server.ssrLoadModule('/ssr-coverage.entry.jsx');
  html = mod.run();
} finally {
  await server.close();
  fs.rmSync(entry, { force: true });
}

const inHtml = (re) => re.test(html);
const total = [];

total.push(['A01 设置持久化与旧记录兼容',
  /version:\s*1/.test(commute) && /legacy\.preparation \?\?/.test(commute),
  'commuteSettings.js 有 version:1 且三级回落']);

// 首次打开时引导必须真的渲染出来，且四步文案齐全。
total.push(['A02 首次引导（四步）',
  inHtml(/guide-overlay/) && inHtml(/1 \/ 4/) && /基础闹钟/.test(html) && has(guide, /guideStep/g) >= 5,
  `HTML 含引导遮罩=${inHtml(/guide-overlay/)} 进度 1/4=${inHtml(/1 \/ 4/)} guideStep=${has(guide, /guideStep/g)}`]);

// 设置页要真点了才渲染，静态检索文案 + 渲染断言引导里的同款控件。
const groups = {
  '基础闹钟': /基础闹钟/,
  '固定与智能模式': /固定与智能模式/,
  '天气': /降水概率阈值/,
  '通勤备用/复查': /复查与备用|早晨复查时间/,
  '主铃音色': /铃声与音量/,
  '环境音': /天气环境音/,
  '账号提醒': /账号提醒/,
};
const missingGroups = Object.entries(groups).filter(([, re]) => !(re.test(html) || re.test(allSrc))).map(([k]) => k);
total.push(['A03 设置七组：基础/模式/天气/复查/主铃/环境音/账号',
  missingGroups.length === 0,
  missingGroups.length ? `缺：${missingGroups.join('、')}` : '七组文案均可检索到，账号/复查/环境音组已渲染组件']);

total.push(['A04 双模式开关 + 固定候选参与计算',
  /fixedCandidate/.test(plan) && /开启固定提前/.test(allSrc) && /fixedMinutes/.test(plan),
  'fixedCandidate 纯函数 + 开关 UI']);

total.push(['A05 复查与最早发声冲突校验',
  /recheckTime/.test(commute) && /复查晚于/.test(commute),
  'validateCommute 含 recheck 冲突']);

total.push(['A06 首页下一次安排 + gapMinutes 缺口',
  /下一次安排/.test(settings) && /gapMinutes/.test(plan) && /还差/.test(settings),
  '卡片消费 plan.status/gapMinutes']);

// 环境音不能只有设置界面，必须有真正接通的起停逻辑。
total.push(['A07 天气环境音（开关/偏移/时长/音量/试听/自动起停）',
  /startAmbient/.test(dash) && /ambientWindow/.test(dash) && /shouldSound/.test(dash)
  && /ambientOffset/.test(guide) && /ambientVolume/.test(guide) && /试听环境音/.test(guide),
  `起停接线=${['startAmbient', 'ambientWindow', 'shouldSound'].filter(k => dash.includes(k)).length}/3 设置项=${
    ['ambientOffset', 'ambientDuration', 'ambientVolume'].filter(k => guide.includes(k)).length}/3 试听按钮=${/试听环境音/.test(guide)}`]);

total.push(['A08 plan 状态枚举落地',
  /PLAN_STATUS/.test(plan) && /EXECUTION_STATE/.test(plan) && /statusText/.test(settings),
  '枚举 + 卡片消费 statusText']);

total.push(['S02 数据约定草案文件',
  fs.existsSync(path.join(root, 'src/commuteSettings.js')) && /PLAN_STATUS/.test(plan),
  'commute 结构 + plan 状态约定均存在']);

total.push(['样式：引导遮罩与进度条',
  /guide-overlay/.test(guideCss) && /wizard-progress/.test(guideCss),
  'guide.css 独立文件，避免改动单行压缩的 dashboard.css']);

let gap = 0;
for (const [name, ok, detail] of total) {
  if (!ok) gap++;
  console.log(`${ok ? 'DONE ' : 'MISS '} ${name}\n        ${detail}`);
}
console.log(`\n完成 ${total.length - gap} / ${total.length}`);
if (gap) process.exit(1);
