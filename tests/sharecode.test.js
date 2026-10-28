// 验证 index.html 里的 sharecode 内联脚本：在「网关要求每个请求都带 sharecode」的约束下，
// 打包产物里的 /assets/ 资源引用必须被补上参数，否则页面白屏。
// 这里不装 jsdom，用最小 DOM 桩执行真实的内联脚本源码。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 从 index.html 里抠出内联脚本正文
function inlineScript(html) {
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'index.html 必须有 sharecode 内联脚本');
  return m[1];
}

// 最小 DOM 桩：只实现脚本用到的那几个 API
function makeDom(search, tags) {
  const attrs = tags.map((t) => ({ tagName: t.tagName, _a: { ...t.attrs }, getAttribute(n) { return this._a[n] ?? null; }, setAttribute(n, v) { this._a[n] = v; } }));
  return {
    location: { search },
    tags: attrs,
    document: {
      documentElement: {},
      querySelectorAll(sel) {
        // 脚本用 'script[src],link[href]' —— 逗号分隔的选择器要全部命中
        const parts = sel.split(',');
        return attrs.filter((a) =>
          parts.some((p) => (p.includes('script') && a.tagName === 'SCRIPT' && a._a.src)
            || (p.includes('link') && a.tagName === 'LINK' && a._a.href)));
      },
    },
    Element: { prototype: { setAttribute: null } },
    MutationObserver: class { observe() {} },
  };
}

function runInline(script, dom) {
  const fn = new Function('location', 'document', 'Element', 'MutationObserver', 'window', script);
  fn(dom.location, dom.document, dom.Element, dom.MutationObserver, {});
  return dom.tags;
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = inlineScript(html);

test('入口 HTML 里必须有权处理 sharecode 的内联脚本', () => {
  assert.match(script, /sharecode/);
  assert.match(script, /\/assets\//);
});

test('带 sharecode 时，script/link 的资源路径被补上参数', () => {
  const tags = makeDom('?sharecode=DBHLIKTUCS', [
    { tagName: 'SCRIPT', attrs: { src: '/assets/index-abc.js' } },
    { tagName: 'LINK', attrs: { href: '/assets/index-def.css' } },
  ]);
  const out = runInline(script, tags);
  assert.equal(out[0]._a.src, '/assets/index-abc.js?sharecode=DBHLIKTUCS');
  assert.equal(out[1]._a.href, '/assets/index-def.css?sharecode=DBHLIKTUCS');
});

test('没有 sharecode 时（本地开发）资源路径原样不动', () => {
  const tags = makeDom('', [
    { tagName: 'SCRIPT', attrs: { src: '/assets/index-abc.js' } },
    { tagName: 'LINK', attrs: { href: '/assets/index-def.css' } },
  ]);
  const out = runInline(script, tags);
  assert.equal(out[0]._a.src, '/assets/index-abc.js');
  assert.equal(out[1]._a.href, '/assets/index-def.css');
});

test('外链与相对路径不受影响', () => {
  const tags = makeDom('?sharecode=X', [
    { tagName: 'LINK', attrs: { href: 'https://fonts.example.com/a.css' } },
    { tagName: 'SCRIPT', attrs: { src: '/other/a.js' } },
  ]);
  const out = runInline(script, tags);
  assert.equal(out[0]._a.href, 'https://fonts.example.com/a.css');
  assert.equal(out[1]._a.src, '/other/a.js');
});

test('构建产物必须使用相对路径 ./assets/，让浏览器自动继承页面的 ?sharecode=', () => {
  const distHtml = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  assert.match(distHtml, /<script type="module"[^>]+src="\.\/assets\/[^"]+\.js"/, 'module 脚本必须是 ./assets/ 相对路径');
  assert.match(distHtml, /<link[^>]+href="\.\/assets\/[^"]+\.css"/, '样式表必须是 ./assets/ 相对路径');
  // 内联脚本里还留着一处 `/assets/` 字符串判断（兜底补参数用），不算资源引用
  const refs = distHtml.match(/(?:src|href)="\/assets\/[^"]+"/g) || [];
  assert.deepEqual(refs, [], '不得再出现 /assets/ 绝对路径资源引用（会被网关拦成 403）');
});

test('构建产物里内联脚本排在 module 脚本之前', () => {
  const distHtml = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  const inlineAt = distHtml.indexOf('<script>');
  const moduleAt = distHtml.indexOf('<script type="module"');
  assert.ok(inlineAt >= 0, 'dist 里应有内联脚本');
  assert.ok(moduleAt > inlineAt, '内联脚本必须在 module 脚本之前执行，否则改不到资源标签');
});
