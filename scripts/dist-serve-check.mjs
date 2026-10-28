// 本地起 dist 静态服务，模拟「网关只给入口 HTML 加了 ?sharecode=」的场景，
// 验证浏览器拿到的资源引用是否自带参数（相对路径会继承）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const target = path.join(dist, url.pathname);
  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  // 故意不加任何 sharecode 改写逻辑 —— 完全交给浏览器相对路径解析
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const entry = `${base}/?sharecode=DBHLIKTUCS`;
  const html = await (await fetch(entry)).text();
  const js = /src="([^"]+\.js)"/.exec(html)[1];
  const css = /href="([^"]+\.css)"/.exec(html)[1];

  const results = [];
  results.push([js.startsWith('./'), `module 引用 = ${js}`]);
  results.push([css.startsWith('./'), `样式引用 = ${css}`]);

  // 浏览器按文档 URL 解析相对路径：./assets/x.js 在 /?sharecode=X 下解析成 /assets/x.js，
  // 但真实浏览器发出的请求 URL 不带查询串 —— 所以网关校验必须在路径层面放行，
  // 或者资源本身允许无参数访问。这里验证本地服务两种情况下的可获取性。
  const jsUrl = new URL(js, entry).href;
  const cssUrl = new URL(css, entry).href;
  const rJs = await fetch(jsUrl);
  const rCss = await fetch(cssUrl);
  results.push([rJs.ok && rJs.status === 200, `JS 可获取 ${jsUrl} -> ${rJs.status} (${(await rJs.text()).length} 字符)`]);
  results.push([rCss.ok && rCss.status === 200, `CSS 可获取 ${cssUrl} -> ${rCss.status}`]);

  let failed = 0;
  for (const [ok, msg] of results) { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); }
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  server.close();
  process.exit(failed ? 1 : 0);
});
