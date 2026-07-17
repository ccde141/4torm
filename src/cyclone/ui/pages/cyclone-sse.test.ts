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
  const events: string[] = [];
  await readCycloneSSE(response(['data: {"type":"done"}\n\n']), event => events.push(event.type));
  await readCycloneSSE(response(['data: {"type":"error","message":"失败"}\n\n']), event => events.push(event.type));
  assert.deepEqual(events, ['error']);
});

test('Cyclone SSE 无终止事件关闭时报告断线', async () => {
  await assert.rejects(
    readCycloneSSE(response(['data: {"type":"token","content":"a"}\n\n']), () => {}),
    /连接意外中断/,
  );
});
