import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionFailureEvents, readUnifiedSSE, subscribeAll, unsubscribeAll } from './unified-client.js';

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

test('Tradewind 连接故障只报告传输中断，不伪造业务结束', () => {
  assert.deepEqual(connectionFailureEvents(new Error('断线')), [
    { type: 'transport-disconnected', message: '信风实时连接已中断：断线', code: 'STREAM_DISCONNECTED', kind: 'protocol' },
  ]);
});

test('Tradewind connection failure can be projected in English', () => {
  assert.deepEqual(connectionFailureEvents(new Error('offline'), 'en-US'), [
    { type: 'transport-disconnected', message: 'Tradewind live connection was interrupted: offline', code: 'STREAM_DISCONNECTED', kind: 'protocol' },
  ]);
});

test('Tradewind unified SSE rejects malformed complete frames', async () => {
  await assert.rejects(readUnifiedSSE(response(['data: {bad json}\n\n']), () => {}), SyntaxError);
});

test('Tradewind unified SSE releases a pending read on abort', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
  const controller = new AbortController();
  const task = readUnifiedSSE(new Response(stream), () => {}, controller.signal);
  controller.abort();
  const result = await Promise.race([
    task.then(() => 'aborted', () => 'rejected'),
    new Promise<string>(resolve => setTimeout(() => resolve('pending'), 100)),
  ]);
  if (result === 'pending') source.close();
  assert.equal(result, 'aborted');
});

test('Tradewind unified SSE reconnects a live subscriber without ending its task', async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  const handler = (event: { type: string }) => { events.push(event.type); };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? response([]) : new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n'));
      },
    }));
  };
  try {
    subscribeAll(handler);
    const deadline = Date.now() + 1500;
    while (!events.includes('transport-reconnected') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(calls, 2);
    assert.deepEqual(events, ['transport-disconnected', 'transport-reconnected', 'connected']);
  } finally {
    unsubscribeAll(handler);
    globalThis.fetch = originalFetch;
  }
});

test('Tradewind unified SSE reports reconnection from comment heartbeats without data frames', async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  const handler = (event: { type: string }) => { events.push(event.type); };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? response([]) : new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': heartbeat\n\n: heartbeat\n\n'));
      },
    }));
  };
  try {
    subscribeAll(handler);
    const deadline = Date.now() + 1500;
    while (!events.includes('transport-reconnected') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(calls, 2);
    assert.deepEqual(events, ['transport-disconnected', 'transport-reconnected']);
  } finally {
    unsubscribeAll(handler);
    globalThis.fetch = originalFetch;
  }
});

test('Tradewind unified SSE stops reconnecting after its last subscriber leaves', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let reportFailure!: () => void;
  const failed = new Promise<void>(resolve => { reportFailure = resolve; });
  const handler = (event: { type: string }) => {
    if (event.type === 'transport-disconnected') reportFailure();
  };
  globalThis.fetch = async () => { calls += 1; return response([]); };
  try {
    subscribeAll(handler);
    await failed;
    unsubscribeAll(handler);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(calls, 1);
  } finally {
    unsubscribeAll(handler);
    globalThis.fetch = originalFetch;
  }
});

test('Tradewind SSE reconnects when subscribers return during an aborting connection', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const handler = () => undefined;
  globalThis.fetch = (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        setImmediate(() => reject(new Error('aborted')));
      }, { once: true });
    });
  };
  try {
    subscribeAll(handler);
    unsubscribeAll(handler);
    subscribeAll(handler);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 2);
  } finally {
    unsubscribeAll(handler);
    globalThis.fetch = originalFetch;
  }
});
