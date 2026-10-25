import assert from 'node:assert/strict';
import test from 'node:test';
import { readToolBridgeResponse } from './tool-bridge-response.js';
import { FrameworkError } from './framework-error.js';

test('工具桥接错误保留完整 traceback 尾部', async () => {
  const traceback = `Traceback (most recent call last):\n${'frame\n'.repeat(100)}ValueError: formula 允许为空`;
  const response = new Response(JSON.stringify({ error: traceback }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    readToolBridgeResponse(response),
    error => error instanceof Error
      && error.message.includes('Traceback (most recent call last)')
      && error.message.endsWith('ValueError: formula 允许为空'),
  );
});

test('HTTP 200 中的命令业务失败仍作为工具失败交给 Agent', async () => {
  const response = new Response(JSON.stringify({
    ok: false,
    error: '(命令退出码 1)\nValueError: invalid row',
    exitCode: 1,
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    readToolBridgeResponse(response),
    error => error instanceof FrameworkError
      && error.message === '(命令退出码 1)\nValueError: invalid row'
      && error.data.code === 'TOOL_EXECUTION_FAILED'
      && error.data.details?.exitCode === 1,
  );
});

test('工具桥保留服务端稳定错误身份', async () => {
  const response = new Response(JSON.stringify({
    error: '未获准使用工具', errorCode: 'TOOL_PERMISSION_DENIED', errorKind: 'permission',
  }), { status: 403, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    readToolBridgeResponse(response),
    error => error instanceof FrameworkError
      && error.data.code === 'TOOL_PERMISSION_DENIED'
      && error.data.kind === 'permission',
  );
});

test('工具桥仅接收有效图片引用，拒绝内联像素与路径伪造', async () => {
  const image = { id: '60dab69c-9419-40ed-90e5-9f93bab90b8f', name: 'pixel.png', mimeType: 'image/png', size: 8 };
  const result = await readToolBridgeResponse(new Response(JSON.stringify({ result: 'image loaded', toolImages: [image] })));
  assert.deepEqual(result.toolImages, [image]);
  for (const toolImages of [[{ ...image, dataUrl: 'data:image/png;base64,pixels' }], [{ ...image, id: '../outside' }]]) {
    await assert.rejects(readToolBridgeResponse(new Response(JSON.stringify({ result: 'image', toolImages }))),
      error => error instanceof FrameworkError && error.data.code === 'TOOL_BRIDGE_PROTOCOL_ERROR');
  }
});
