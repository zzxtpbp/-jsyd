// 构建产物静态校验：确认新模块真的进了 bundle，且旧的自由文本状态已被替换。
import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist/assets');
const jsFile = fs.readdirSync(dist).find(f => f.endsWith('.js'));
const cssFile = fs.readdirSync(dist).find(f => f.endsWith('.css'));
const js = fs.readFileSync(path.join(dist, jsFile), 'utf8');
const css = fs.readFileSync(path.join(dist, cssFile), 'utf8');

const checks = [
  ['状态枚举 ready', /"ready"/.test(js) || /'ready'/.test(js) || /ready:/.test(js)],
  ['状态枚举 weather_unknown', /weather_unknown/.test(js)],
  ['状态枚举 route_failed', /route_failed/.test(js)],
  ['状态枚举 capped', /capped/.test(js)],
  ['状态枚举 needs_confirmation', /needs_confirmation/.test(js)],
  ['状态枚举 unavailable', /unavailable/.test(js)],
  ['executionState suggested', /suggested/.test(js)],
  ['executionState synced', /synced/.test(js)],
  ['缺口文案「还差」', /还差/.test(js)],
  ['下一次安排卡片', /下一次安排/.test(js)],
  ['固定与智能模式组', /固定与智能模式/.test(js)],
  ['固定提前量已进入计算', /fixedMinutes/.test(js)],
  ['主题样式仍在(theme)', /--stage-1|theme-forest|morning-forest/.test(css)],
  ['5 种铃声 id 仍在', ['classic', 'chime', 'warm', 'ocean', 'siren'].every(id => js.includes(id))],
  ['多地点天气类仍在', /place-card|places-strip/.test(css)],
  ['缺口样式', /gap-notice/.test(css)],
  ['状态胶囊样式', /status-pill/.test(css)],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n${checks.length - failed}/${checks.length} 通过`);
process.exit(failed ? 1 : 0);
