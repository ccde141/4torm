import assert from 'node:assert/strict';
import test from 'node:test';
import { readCycloneSSE } from './cyclone-sse.js';

function response(frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  }));
}

test('Cyclone SSE 以 done 或 error 作为终止事件', async () => {
  const events: Array<{ type: string; code?: unknown; kind?: unknown }> = [];
  await readCycloneSSE(response(['data: {"type":"done"}\n\n']), () => {});
  await readCycloneSSE(response(['data: {"type":"error","message":"失败","code":"SEAT_FAILED","kind":"provider"}\n\n']), event => events.push(event));
  assert.deepEqual(events, [{ type: 'error', message: '失败', code: 'SEAT_FAILED', kind: 'provider' }]);
});

test('Cyclone SSE 无终止事件关闭时报告断线', async () => {
  await assert.rejects(
    readCycloneSSE(response(['data: {"type":"token","content":"a"}\n\n']), () => {}),
    /连接意外中断/,
  );
});

test('Cyclone SSE 可本地化传输层错误而不改变终止事件', async () => {
  await assert.rejects(
    readCycloneSSE(
      response(['data: {"type":"token","content":"a"}\n\n']),
      () => {},
      undefined,
      { disconnected: 'The SSE connection closed before a done/error event.' },
    ),
    /closed before a done\/error event/,
  );
});
