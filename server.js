import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './server/api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

// 项目内 .env / .env.local 优先于系统环境变量，避免机器上遗留的同名变量覆盖本项目密钥
const env = {
  ...process.env,
  ...loadDotEnv(path.join(root, '.env')),
  ...loadDotEnv(path.join(root, '.env.local')),
};

const api = createApi(env);
// 反向代理会把 host 改写成容器内地址（localhost:PORT），而浏览器发来的 Origin 是公网域名。
// 平台没有透传 x-forwarded-host，所以这里必须显式配置公网来源，否则分享域名下所有 POST 都会被判成跨站。
const PUBLIC_ORIGIN = env.PUBLIC_ORIGIN || 'https://jishi-smart-alarm.app.workbuddy.host';
const publicHost = new URL(PUBLIC_ORIGIN).host;
// 统一给 api 层一份已知的公网域名，供其同源校验使用
env.PUBLIC_ORIGIN = PUBLIC_ORIGIN;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

// 分享链接形如 https://xxx.app.workbuddy.host/?sharecode=ABC123。
// 网关要求「每个请求」都带这个参数，但它只加在入口 HTML 的 URL 上，
// 页面里的 /assets/xxx.js 是绝对路径、不带参数 → 403 → 白屏。
// 所以这里在吐 index.html 时，把 sharecode 拼进所有静态资源引用。
function injectSharecode(html, search) {
  const params = new URLSearchParams(search || '');
  const code = params.get('sharecode');
  if (!code) return html;
  const q = `?sharecode=${encodeURIComponent(code)}`;
  // 只处理 /assets/ 开头的本地资源，外链与接口不动。
  return html.replace(/(\s(?:src|href)=")(\/assets\/[^"?]+)(")/g, (m, pre, url, post) => `${pre}${url}${q}${post}`);
}

async function sendFile(res, filePath, status = 200, sharecode = null) {
  let data = await fsp.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  // 入口 HTML 需要按当前请求的 sharecode 动态改写，不能缓存。
  if (ext === '.html' && sharecode) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    securityHeaders(res);
    res.end(injectSharecode(data.toString('utf8'), sharecode));
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', path.basename(filePath).includes('.') && filePath.includes('assets')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache');
  securityHeaders(res);
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;
  securityHeaders(res);

  if (pathname.startsWith('/api/')) {
    // 反向代理场景下 host 与公网域名不一致时，校正后再做同源校验，避免误判
    if (req.headers.origin) {
      try {
        const originHost = new URL(req.headers.origin).host;
        const forwarded = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
        const allowed = new Set([req.headers.host, forwarded, publicHost].filter(Boolean));
        if (allowed.has(originHost)) req.headers.host = originHost;
      } catch {}
    }
    return api(req, res, () => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: '接口不存在' }));
    });
  }

  const target = path.normalize(path.join(dist, pathname));
  if (!target.startsWith(dist)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  try {
    const stat = await fsp.stat(target);
    if (stat.isFile()) return sendFile(res, target);
  } catch {}
  try {
    return await sendFile(res, path.join(dist, 'index.html'), 200, url.search);
  } catch {
    res.statusCode = 500;
    res.end('dist 不存在，请先执行 npm run build');
  }
});

server.listen(port, host, () => {
  console.log(`吉时已到 running at http://${host}:${port}  (PORT=${port})`);
});
