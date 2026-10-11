import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { registerTradewindNodeRoutes } from './tradewind-node-routes.js';
import { registerTradewindMeetingStreamRoutes } from './tradewind-meeting-stream-routes.js';
import type { PreparedTradewindEventStream } from '../modules/tradewind/public.js';
import { openTradewindStream } from './tradewind-stream-response.js';

test('信风两种 SSE 断开后释放功能岛订阅', async t => {
  const app = Fastify();
  const router = new CollaborationRouter([]);
  const closed: Array<Promise<void>> = [];
  router.prepareTransport = async (): Promise<PreparedTradewindEventStream> => ({
    snapshots: () => [{ type: 'connected' }],
    subscribe: () => {
      let resolve!: () => void;
      closed.push(new Promise<void>(done => { resolve = done; }));
      return resolve;
    },
  });
  await app.register(registerTradewindNodeRoutes, { router });
  await app.register(registerTradewindMeetingStreamRoutes, { router });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  for (const resource of ['/stream', '/meeting/node-a/events']) {
    const controller = new AbortController();
    const response = await fetch(`${address}${resource}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const first = await response.body!.getReader().read();
    assert.match(Buffer.from(first.value).toString(), /connected/);
    controller.abort();
  }
  assert.equal(closed.length, 2);
  const detached = await Promise.race([Promise.all(closed).then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000))]);
  assert.equal(detached, true);
});

test('信风 SSE 遇到背压后按序等待 drain 再写入', async t => {
  const app = Fastify();
  const frames: string[] = [];
  let send!: (event: Record<string, unknown>) => void;
  let drain!: () => void;
  app.get('/slow', (request, reply) => {
    const raw = reply.raw;
    const originalWrite = raw.write.bind(raw) as (...args: unknown[]) => boolean;
    let forceBackpressure = true;
    raw.write = ((...args: unknown[]) => {
      const chunk = String(args[0]);
      if (chunk.startsWith('data:')) frames.push(chunk);
      const writable = originalWrite(...args);
      if (chunk.startsWith('data:') && forceBackpressure) {
        forceBackpressure = false;
        return false;
      }
      return writable;
    }) as typeof raw.write;
    drain = () => raw.emit('drain');
    openTradewindStream(request, reply, {
      snapshots: () => [{ type: 'connected' }],
      subscribe: listener => { send = listener; return () => undefined; },
    });
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const controller = new AbortController();
  const response = await fetch(`${address}/slow`, { signal: controller.signal });
  assert.equal(response.status, 200);
  send({ type: 'one' });
  send({ type: 'two' });
  assert.equal(frames.length, 1);
  drain();
  assert.deepEqual(frames.map(frame => JSON.parse(frame.slice(6))), [
    { type: 'connected' }, { type: 'one' }, { type: 'two' },
  ]);
  controller.abort();
});

test('信风 SSE 慢客户端积压超限后断开并释放订阅', async t => {
  const app = Fastify();
  let send!: (event: Record<string, unknown>) => void;
  let unsubscribeCount = 0;
  let rawClosed!: Promise<void>;
  app.get('/blocked', (request, reply) => {
    const raw = reply.raw;
    rawClosed = new Promise(resolve => raw.once('close', resolve));
    const originalWrite = raw.write.bind(raw) as (...args: unknown[]) => boolean;
    let firstEvent = true;
    raw.write = ((...args: unknown[]) => {
      const result = originalWrite(...args);
      if (String(args[0]).startsWith('data:') && firstEvent) {
        firstEvent = false;
        return false;
      }
      return result;
    }) as typeof raw.write;
    openTradewindStream(request, reply, {
      snapshots: () => [{ type: 'connected' }],
      subscribe: listener => { send = listener; return () => { unsubscribeCount += 1; }; },
    });
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const response = await fetch(`${address}/blocked`);
  assert.equal(response.status, 200);
  for (let index = 0; index < 300; index += 1) {
    send({ type: 'token', content: 'x'.repeat(1_024) });
  }
  const detached = await Promise.race([rawClosed.then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000))]);
  assert.equal(detached, true);
  assert.equal(unsubscribeCount, 1);
});

test('信风 SSE 初始大快照等待 drain，不将快照误算为实时积压', async t => {
  const app = Fastify();
  let drain!: () => void;
  let detached = 0;
  const frames: string[] = [];
  app.get('/large-snapshot', (request, reply) => {
    const raw = reply.raw;
    const originalWrite = raw.write.bind(raw) as (...args: unknown[]) => boolean;
    let firstEvent = true;
    raw.write = ((...args: unknown[]) => {
      const chunk = String(args[0]);
      if (chunk.startsWith('data:')) frames.push(chunk);
      const result = originalWrite(...args);
      if (chunk.startsWith('data:') && firstEvent) {
        firstEvent = false;
        return false;
      }
      return result;
    }) as typeof raw.write;
    drain = () => raw.emit('drain');
    openTradewindStream(request, reply, {
      snapshots: () => [{ type: 'first' }, { type: 'large', content: 'x'.repeat(300_000) }],
      subscribe: () => () => { detached += 1; },
    });
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const controller = new AbortController();
  const response = await fetch(`${address}/large-snapshot`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.equal(frames.length, 1);
  assert.equal(detached, 0);
  drain();
  assert.equal(frames.length, 2);
  assert.equal(detached, 0);
  controller.abort();
});

test('信风 SSE 写入异常立即释放订阅', async t => {
  const app = Fastify();
  let send!: (event: Record<string, unknown>) => void;
  let detached = 0;
  let rawClosed!: Promise<void>;
  app.get('/write-error', (request, reply) => {
    const raw = reply.raw;
    rawClosed = new Promise(resolve => raw.once('close', resolve));
    const originalWrite = raw.write.bind(raw) as (...args: unknown[]) => boolean;
    raw.write = ((...args: unknown[]) => {
      if (String(args[0]).includes('"type":"fail"')) throw new Error('socket write failed');
      return originalWrite(...args);
    }) as typeof raw.write;
    openTradewindStream(request, reply, {
      snapshots: () => [{ type: 'connected' }],
      subscribe: listener => { send = listener; return () => { detached += 1; }; },
    });
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const response = await fetch(`${address}/write-error`);
  assert.equal(response.status, 200);
  assert.doesNotThrow(() => send({ type: 'fail' }));
  await rawClosed;
  assert.equal(detached, 1);
});
