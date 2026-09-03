import assert from 'node:assert/strict';
import Fastify from 'fastify';
import test from 'node:test';
import { FrameworkError } from '../engine/shared/framework-error.js';
import { installFrameworkErrorHandler } from './error-handler.js';

test('Fastify 全局出口发送兼容正文与稳定错误字段', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  installFrameworkErrorHandler(app);
  app.get('/typed', async () => {
    throw new FrameworkError({
      code: 'MODEL_HTTP_ERROR', kind: 'provider', message: '模型暂不可用',
      source: 'test.model', retryable: true,
    });
  });

  const response = await app.inject({ method: 'GET', url: '/typed' });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), {
    error: '模型暂不可用', errorCode: 'MODEL_HTTP_ERROR', errorKind: 'provider',
  });
});

test('Fastify 全局出口不泄露未知异常正文', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  installFrameworkErrorHandler(app);
  app.get('/unknown', async () => { throw new Error('C:\\private\\secret.txt'); });

  const response = await app.inject({ method: 'GET', url: '/unknown' });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), {
    error: '服务器内部错误', errorCode: 'INTERNAL_ERROR', errorKind: 'internal',
  });
});

test('Fastify 原生 4xx 错误继续保留原状态', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  installFrameworkErrorHandler(app);
  app.get('/missing', async () => {
    throw Object.assign(new Error('资源不存在'), { statusCode: 404 });
  });

  const response = await app.inject({ method: 'GET', url: '/missing' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, '资源不存在');
});
