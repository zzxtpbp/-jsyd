import { defineConfig, loadEnv } from 'vite';
import { createApi } from './server/api.js';

export function providerEnv(mode, cwd = process.cwd()) {
  // Vite's loadEnv preserves existing process variables. For local development,
  // prefer the project's .env.local key over a different key inherited from the shell.
  const inheritedQwenKey = process.env.DASHSCOPE_API_KEY;
  let localEnv;
  try {
    delete process.env.DASHSCOPE_API_KEY;
    localEnv = loadEnv(mode, cwd, '');
  } finally {
    if (inheritedQwenKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = inheritedQwenKey;
  }
  return { ...process.env, ...localEnv };
}

export default defineConfig(({ mode }) => {
  const env = providerEnv(mode);
  const middleware = createApi(env);
  return {
    // 分享链路上网关要求每个请求都带 ?sharecode=xxx，而默认的绝对路径 /assets/xxx.js
    // 不会继承页面的查询串 → 403 → 白屏。改成相对路径 ./assets/xxx.js 后，
    // 浏览器解析时天然带上当前页面的 ?sharecode=xxx，不再依赖任何 JS 改写。
    base: './',
    plugins: [{ name: 'local-provider-api',
      configureServer(server) { server.middlewares.use(middleware); },
      configurePreviewServer(server) { server.middlewares.use(middleware); },
    }],
  };
});
