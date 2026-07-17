import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppContext } from './app-context.js';

test('读取 Fastify 应用上下文', () => {
  const context = getAppContext({
    dataDir: '/project/data',
    projectRoot: '/project',
  });

  assert.deepEqual(context, {
    dataDir: '/project/data',
    projectRoot: '/project',
  });
});
