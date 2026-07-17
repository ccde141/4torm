import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionFailureEvents, readUnifiedSSE } from './unified-client.js';

function response(frames: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  }));
}

test('Tradewind unified SSE 在意外 EOF 时报告断线', async () => {
  const events: string[] = [];
  await assert.rejects(
    readUnifiedSSE(response(['data: {"type":"token","nodeId":"n1"}\n\n']), event => events.push(event.type)),
    /连接意外中断/,
  );
  assert.deepEqual(events, ['token']);
});

test('Tradewind unified SSE 主动 abort 时正常退出', async () => {
  const controller = new AbortController();
  controller.abort();
  await readUnifiedSSE(response([]), () => {}, controller.signal);
});

test('Tradewind 连接故障转换为 error 后 done 的收尾序列', () => {
  assert.deepEqual(connectionFailureEvents(new Error('断线')), [
    { type: 'error', message: '信风实时连接已中断：断线' },
    { type: 'done' },
  ]);
});
