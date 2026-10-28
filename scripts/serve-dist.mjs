import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const dist = path.resolve('dist');
const M = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = path.join(dist, p);
  const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(dist, 'index.html');
  res.setHeader('Content-Type', M[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(4175, '127.0.0.1', () => console.log('serve on 4175'));
