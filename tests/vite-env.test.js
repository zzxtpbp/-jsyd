import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerEnv } from '../vite.config.js';

test('本地千问 Key 优先于继承的进程 Key，且不修改进程环境', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jishi-env-'));
  const previous = process.env.DASHSCOPE_API_KEY;
  try {
    writeFileSync(join(directory, '.env.local'), 'DASHSCOPE_API_KEY=local-test-key\n');
    process.env.DASHSCOPE_API_KEY = 'inherited-test-key';
    const env = providerEnv('development', directory);
    assert.equal(env.DASHSCOPE_API_KEY, 'local-test-key');
    assert.equal(process.env.DASHSCOPE_API_KEY, 'inherited-test-key');
  } finally {
    if (previous === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
