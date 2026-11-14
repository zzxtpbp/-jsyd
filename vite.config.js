import { defineConfig, loadEnv } from 'vite';
import { createApi } from './server/api.js';

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const middleware = createApi(env);
  return {
    build: {
      rolldownOptions: {
        input: ['index.html', 'tools/important-alarm-lab.html', 'tools/commute-lab.html'],
      },
    },
    plugins: [{
      name: 'local-provider-api',
      configureServer(server) { server.middlewares.use(middleware); },
      configurePreviewServer(server) { server.middlewares.use(middleware); },
    }],
  };
});
