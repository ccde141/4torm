import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import type { FeatureModule, ModuleInvocationContext } from '../engine/collaboration/contracts.js';
import { collaborationRoutes } from './collaboration.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function server(t: test.TestContext,
  invoke: (context: ModuleInvocationContext) => Promise<unknown>) {
  const module: FeatureModule = {
    manifest: { id: 'convection', version: 1, title: 'Cancellation fixture', methods: [{
      id: 'compactFixture', kind: 'command', permission: 'administer', audiences: ['human'],
      inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' },
    }] },
    handlers: { compactFixture: { parse: value => value, invoke } },
  };
  const app = Fastify({ forceCloseConnections: true });
  await app.register(collaborationRoutes, { router: new CollaborationRouter([module]) });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { if (app.server.listening) await app.close(); });
  return { app, request: (signal?: AbortSignal) => fetch(`${address}/invoke`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ feature: 'convection', method: 'compactFixture', input: {} }),
  }) };
}

test('a real invoke HTTP disconnect cancels the same handler context signal', { timeout: 5_000 }, async t => {
  const entered = deferred<AbortSignal>();
  const stopped = deferred<void>();
  const fixture = await server(t, async context => {
    assert.ok(context.signal);
    entered.resolve(context.signal);
    await new Promise<void>(resolve => context.signal!.addEventListener('abort', () => {
      stopped.resolve(); resolve();
    }, { once: true }));
    return { stopped: true };
  });
  const controller = new AbortController();
  const response = fixture.request(controller.signal).catch((error: unknown) => error);
  const handlerSignal = await entered.promise;
  controller.abort();
  await stopped.promise;
  assert.equal(handlerSignal.aborted, true);
  const error = await response;
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'AbortError');
});

test('a completed HTTP response is not mistaken for request cancellation', { timeout: 5_000 }, async t => {
  let handlerSignal: AbortSignal | undefined;
  const fixture = await server(t, async context => {
    handlerSignal = context.signal;
    return { committed: true };
  });
  const controller = new AbortController();
  const response = await fixture.request(controller.signal);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { committed: true });
  await setImmediate();
  assert.ok(handlerSignal);
  assert.equal(handlerSignal.aborted, false);
  controller.abort();
  await setImmediate();
  assert.equal(handlerSignal.aborted, false);
});

test('server preClose aborts an awaited invoke instead of waiting indefinitely', { timeout: 5_000 }, async t => {
  const entered = deferred<AbortSignal>();
  const stopped = deferred<void>();
  const fixture = await server(t, async context => {
    assert.ok(context.signal);
    entered.resolve(context.signal);
    await new Promise<void>(resolve => context.signal!.addEventListener('abort', () => {
      stopped.resolve(); resolve();
    }, { once: true }));
    return { stopped: true };
  });
  const controller = new AbortController();
  const response = fixture.request(controller.signal).catch((error: unknown) => error);
  const handlerSignal = await entered.promise;
  const closing = fixture.app.close();
  // A failed shutdown assertion still releases the real socket and cannot hang the test runner.
  const watchdog = setTimeout(() => controller.abort(), 1_500);
  try {
    await stopped.promise;
    assert.equal(handlerSignal.aborted, true);
    assert.match(String(handlerSignal.reason), /服务正在关闭/);
    const result = await response;
    if (result instanceof Response) await result.arrayBuffer();
  } finally {
    clearTimeout(watchdog);
    controller.abort();
    await closing;
  }
});
