import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeTool } from './tool-executor.js';

test('executeTool passes the caller AbortSignal to custom executors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-abort-'));
  const dataDir = path.join(root, 'data');
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'wait_for_abort',
    description: 'test',
    executorType: 'custom',
    executorFile: 'wait_for_abort',
  }]));
  await fs.writeFile(path.join(executorDir, 'wait_for_abort.js'), `
    export default (_args, ctx) => new Promise((resolve) => {
      if (ctx.signal?.aborted) return resolve('aborted');
      ctx.signal?.addEventListener('abort', () => resolve('aborted'), { once: true });
      setTimeout(() => resolve('missing signal'), 100);
    });
  `);

  try {
    const controller = new AbortController();
    const pending = executeTool(
      dataDir, 'wait_for_abort', {}, '', undefined, undefined, undefined,
      controller.signal,
    );
    controller.abort();
    assert.equal(await pending, 'aborted');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
