import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const M = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (p === '/api/status') return res.end(JSON.stringify({ amap: false, qweather: false, qwen: false }));
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: '本地验收未配置数据服务' }));
  }
  const f = path.join(dist, p);
  const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(dist, 'index.html');
  res.setHeader('Content-Type', M[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

const b = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
p.on('pageerror', (e) => console.log('[ERR]', e.message));

// 预置一份「固定模式 + 已保存闹钟」的状态，直接看卡片的保存状态
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.evaluate(() => {
  const id = 'base-alarm-1';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);
  localStorage.setItem('jishi-studio-v3', JSON.stringify({
    guideComplete: true,
    alarms: [{ id, at: +tomorrow, label: '早起闹钟', enabled: true, repeat: 'daily', state: 'armed' }],
    commute: {
      version: 2, fixedEnabled: true, smartEnabled: false, fixedMinutes: 20,
      baseAlarmId: id, transport: '自驾', preparation: 40, buffer: 15, extra: 15,
      maxAdvance: 30, threshold: 30, taxiWait: 0, recheckTime: '05:30', fallback: '保留基础闹钟',
      sound: { ambientEnabled: false, ambientOffset: 5, ambientDuration: 2, ambientVolume: 35 },
      preferences: { rain: { mode: null, extra: 15 }, snow: { mode: null, extra: 20 } },
    },
  }));
});
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);

const card = p.locator('.plan-overview');
console.log('卡片存在:', await card.count());
const before = (await card.innerText()).replace(/\s+/g, ' ');
console.log('保存前:', (before.match(/保存状态：[^。]*/) || ['（无）'])[0]);
console.log('出发时间行:', (before.match(/出发时间 \d{2}:\d{2}/) || ['（无）'])[0]);

// 点「设为提前唤醒」
const applyBtn = card.locator('button', { hasText: '设为提前唤醒' });
console.log('按钮可用:', !(await applyBtn.isDisabled()));
await applyBtn.click();
await p.waitForTimeout(1200);
const after = (await p.locator('.plan-overview').innerText()).replace(/\s+/g, ' ');
console.log('保存后:', (after.match(/保存状态：[^。]*/) || ['（无）'])[0]);
await p.screenshot({ path: 'shot-save-state.png' });
await b.close();
srv.close();
