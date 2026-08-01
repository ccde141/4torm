import assert from 'node:assert/strict';
import test from 'node:test';
import { readToolBridgeResponse } from './tool-bridge-response.js';

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
    error => error instanceof Error
      && error.message === '(命令退出码 1)\nValueError: invalid row',
  );
});
