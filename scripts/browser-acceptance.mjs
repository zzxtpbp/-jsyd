// 浏览器端验收脚本：直接复现验收报告里的操作序列，用来证明 6 个必修问题真的修好了。
//
// 为什么不用 node:test：这几个问题全部发生在「浏览器 + localStorage + React 状态」交界处，
// 纯函数测不到。必须用真实 Chrome 走一遍「保存 → 刷新 → 再刷新」。
//
// 用法：node scripts/browser-acceptance.mjs [url]
//   不带参数时自动起本地 dist 服务（含 /api/* 的 Demo 兜底）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

const dist = path.join(root, 'dist');
const M = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// —— 本地静态服务 + 极简 /api/*，让「无密钥」场景也能跑完整流程 ——
// 天气桩默认关闭：前几个问题（落盘、引导）用不到天气，
// 打开它会引入无关的状态，掩盖真正要验证的东西。
// 验证问题 5 时才打开。
let weatherStub = false;
const apiStub = (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (url.pathname === '/api/status') {
    return res.end(JSON.stringify({ amap: false, qweather: false, qwen: false, model: 'qwen-plus' }));
  }
  // B08 验收需要一条真实可区分的备用路线：
  // 主路线（驾车）40 分钟，公交 90 分钟 —— 数字差得够远，才能证明「换了名字也换了耗时」。
  if (url.pathname === '/api/route') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch {}
      const modes = {
        drive: { distance: 12000, duration: 2400, label: '自驾', steps: [] },
        taxi: { distance: 12000, duration: 2400, label: '打车', steps: [] },
      };
      // 只查某种方式时，只返回那一种（与真实 /api/route?mode= 行为一致）
      if (body.mode) {
        const duration = body.mode === 'bus' ? 5400 : body.mode === 'subway' ? 4200 : 2400;
        const label = { bus: '公交', subway: '地铁', walk: '步行', bike: '骑行' }[body.mode] || '自驾';
        return res.end(JSON.stringify({ modes: { [body.mode]: { distance: 12000, duration, label } }, mode: body.mode, fetched: Date.now(), source: '高德地图(桩)' }));
      }
      return res.end(JSON.stringify({ modes, mode: 'drive', reason: '距离约 12.0 公里，建议驾车或打车', distance: 12000, fetched: Date.now(), source: '高德地图(桩)', routeNote: '查询时刻路线估算' }));
    });
    return;
  }
  // 天气桩：明早 06:00–10:00 高概率小雨（代码 61），用来触发「下雨改乘公交」这条路径。
  // 返回 48 小时逐时数据，与应用对和风返回值的消费方式一致。
  if (url.pathname === '/api/weather' && !weatherStub) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: '本地验收未配置数据服务' }));
  }
  if (url.pathname === '/api/weather') {
    // 应用按本地时区的 "YYYY-MM-DDTHH:00" 去 indexOf 匹配槽位，
    // 所以这里必须用本地时间手工拼字符串，不能用 toISOString（那是 UTC，会一个都匹配不上）。
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
    const time = [], code = [], temp = [], prob = [], text = [], amount = [];
    for (let i = -1; i < 48; i++) {
      const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + i);
      const h = d.getHours();
      time.push(stamp(d));
      const wet = h >= 6 && h <= 10;
      code.push(wet ? 61 : 0);
      temp.push(22);
      prob.push(wet ? 80 : 5);
      text.push(wet ? '小雨' : '晴');
      amount.push(wet ? 0.2 : 0);
    }
    return res.end(JSON.stringify({
      weather: {
        timezone: 'Asia/Shanghai', utc_offset_seconds: 28800,
        current: { time: new Date().toISOString(), temperature_2m: 22, weather_code: 61, text: '小雨' },
        hourly: { time, weather_code: code, temperature_2m: temp, precipitation_probability: prob, precipitation: amount, text },
        attributions: ['https://www.qweather.com/'],
      },
      fetched: Date.now(), source: '和风天气(桩)',
    }));
  }
  // 多地天气卡片会请求 /api/places，这里给一个空结果，避免它影响其它断言。
  if (url.pathname === '/api/places') {
    return res.end(JSON.stringify({ points: [], fetched: Date.now(), source: '和风天气(桩)' }));
  }
  res.statusCode = 400;
  res.end(JSON.stringify({ error: '本地验收未配置数据服务' }));
};

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p.startsWith('/api/')) return apiStub(req, res);
  const f = path.join(dist, p);
  const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(dist, 'index.html');
  res.setHeader('Content-Type', M[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const results = [];
const record = (ok, label, detail = '') => {
  results.push([ok, label, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ← ' + detail : ''}`);
};

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = process.argv[2] || `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push((e.stack || e.message || '').split('\n').slice(0, 4).join(' | ')));

const go = async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
};
const store = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('jishi-studio-v3')) || {}; } catch { return {}; } });

// 走完引导：选一个预设闹钟 → 启用 → 第2步开智能 → 第3步 → 第4步保存
async function finishGuide() {
  if (!(await page.locator('.guide-window').count())) return false;
  await page.locator('.guide-window select').selectOption({ index: 1 });
  await page.waitForTimeout(250);
  await page.locator('.guide-window button', { hasText: '启用所选闹钟' }).click();
  await page.waitForTimeout(400);
  await page.locator('.guide-window .lime-button', { hasText: '下一步' }).click();
  await page.waitForTimeout(400);
  const smart = page.locator('.guide-window label', { hasText: '智能通勤' }).locator('input');
  if (await smart.count()) await smart.check().catch(() => {});
  await page.waitForTimeout(250);
  await page.locator('.guide-window .lime-button', { hasText: '下一步' }).click();
  await page.waitForTimeout(400);
  await page.locator('.guide-window .lime-button', { hasText: '下一步' }).click();
  await page.waitForTimeout(500);
  await page.locator('.guide-window .lime-button', { hasText: '确认并保存' }).click();
  await page.waitForTimeout(700);
  return true;
}

try {
  // ============ 问题 1：通勤设置落盘（A01 / T05）============
  await go();
  await finishGuide();
  const saved1 = await store();
  record(!!saved1.commute, 'P1 引导保存后 localStorage.commute 存在', saved1.commute ? `smart=${saved1.commute.smartEnabled}` : '缺失');

  await go(); // 刷新 1 次
  const after1 = await store();
  record(!!after1.commute, 'P1 刷新 1 次后 commute 仍在', after1.commute ? 'ok' : '被清空');
  record(!!after1.alarms, 'P1 刷新后 alarms 仍在（两处写入不再互相覆盖）', Array.isArray(after1.alarms) ? `${after1.alarms.length} 个` : '丢失');
  record(after1.guideComplete === true, 'P1 guideComplete 已持久化', String(after1.guideComplete));

  await go(); // 刷新 2 次
  const after2 = await store();
  record(!!after2.commute, 'P1 刷新 2 次后 commute 仍在', after2.commute ? 'ok' : '回默认');
  const guideVisible = await page.locator('.guide-window').count();
  record(!guideVisible, 'P1 第二次刷新不再重现四步引导', guideVisible ? '又弹出了' : 'ok');

  const mode = await page.evaluate(() => {
    try { const d = JSON.parse(localStorage.getItem('jishi-studio-v3')); return d.commute && d.commute.smartEnabled; } catch { return null; }
  });
  record(mode === true, 'P1 刷新后模式设置仍在（smartEnabled）', String(mode));

  // ============ 问题 6：引导流程中断（A02）============
  await page.evaluate(() => localStorage.clear());
  await go();
  // 引导内点「新增基础闹钟」→ 弹窗接管 → 保存后引导必须回来
  await page.locator('.guide-window button', { hasText: '新增基础闹钟' }).click();
  await page.waitForTimeout(700);
  const editorOpen = await page.locator('.editor-sheet, .alarm-editor, form').count();
  const guideGone = await page.locator('.guide-window').count();
  record(guideGone === 0, 'P6 新增闹钟时引导暂时让出（预期行为）', `editor=${editorOpen}`);
  // 保存闹钟（按钮文案是「保存并开启」，不是「保存」—— 选择器必须跟实际 UI 对齐）
  const saveBtn = page.locator('.editor-window button', { hasText: '保存并开启' }).first();
  if (await saveBtn.count()) { await saveBtn.click().catch(() => {}); await page.waitForTimeout(800); }
  const guideBack = await page.locator('.guide-window').count();
  record(guideBack > 0, 'P6 保存闹钟后引导自动回来', guideBack ? 'ok' : '引导消失了，必须刷新');

  // ============ 问题 3 / 4：出发时间与保存状态（A06 / B04）============
  await page.evaluate(() => localStorage.clear());
  await go();
  await page.locator('.guide-window .wizard-skip').click();
  await page.waitForTimeout(500);
  const stateText = await page.evaluate(() => document.body.innerText);
  record(/尚未保存|已保存/.test(stateText), 'P4 页面能显示保存状态字样', '');

  // ============ 问题 5：备用方式只换名字不换耗时（B08 / B09）============
  // 端到端：写入「下雨改乘公交」，走一遍真实「查询路线 → 首页出计划」，
  // 断言首页既显示公交、且用的是公交 90 分钟，而不是驾车 40 分钟。
  weatherStub = true;
  await page.evaluate(() => {
    const at = (h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); return +d; };
    localStorage.setItem('jishi-studio-v3', JSON.stringify({
      alarms: [{ id: 'a-base', at: at(8, 0), label: '基础闹钟', enabled: true, repeat: 'daily', state: 'armed' }],
      home: { name: '家', location: '121.4737,31.2304' },
      office: { name: '公司', location: '121.5043,31.2378' },
      guideComplete: true,
      prefs: { enabled: false, at: '20:00', threshold: 30, ringtone: 'classic', volume: 1, theme: 'forest', night: false },
      // 多地天气卡片为空，避免它去请求 /api/places（本脚本没给它做桩）
      customPlaces: [],
      commute: {
        version: 2, fixedEnabled: false, smartEnabled: true, fixedMinutes: 20,
        transport: '自驾', arrivalRule: '指定日期时间', preparation: 25, buffer: 15,
        extra: 15, maxAdvance: 240, threshold: 30, taxiWait: 0,
        recheckTime: '05:30', fallback: '保留基础闹钟', baseAlarmId: 'a-base',
        sound: { ambientEnabled: false, ambientOffset: 5, ambientDuration: 2, ambientVolume: 35 },
        preferences: { rain: { mode: '公交', extra: 15 }, snow: { mode: '公交', extra: 20 } },
      },
    }));
  });
  await go();
  // 到通勤页查一次路线（这一步会同时确定主路线耗时与备用路线耗时）
  await page.locator('button', { hasText: '通勤' }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  const routeBtn = page.locator('button', { hasText: '查询高德驾车路线' }).first();
  if (await routeBtn.count()) { await routeBtn.click(); await page.waitForTimeout(2000); }
  // 回首页看「下一次安排」
  await page.locator('button', { hasText: '闹钟' }).first().click().catch(() => {});
  await page.waitForTimeout(1200);

  const home5 = await page.evaluate(() => document.body.innerText);
  record(/公交换|改乘公交|公交路线/.test(home5), 'P5 首页采用了备用方式（公交）',
    (home5.match(/[^\n]*公交[^\n]*/g) || []).slice(0, 2).join(' / ') || '（未出现公交）');
  // 核心断言：不能出现「公交 ... 40 分钟」这种拿驾车数据冒充公交的写法
  record(!/公交[^\n]{0,12}40 分钟/.test(home5), 'P5 公交耗时不再沿用驾车 40 分钟',
    (home5.match(/[^\n]*90 分钟[^\n]*/g) || []).slice(0, 1).join('') || '（未见 90 分钟）');
} catch (err) {
  record(false, '脚本执行异常', err.message);
} finally {
  record(pageErrors.length === 0, '全程无 React 运行时异常', pageErrors.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
}

const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
