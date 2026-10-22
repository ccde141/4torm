import assert from 'node:assert/strict';
import test from 'node:test';

// The shipped executor is JavaScript; load it through the same ESM boundary as tool-executor.
const { default: webfetch } = await import(new URL('../../../data/tools/executors/webfetch.js', import.meta.url).href) as {
  default: (args: { url: string }, ctx: { signal?: AbortSignal }) => Promise<string>;
};

test('webfetch keeps timeout active while reading the response body', async t => {
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    schedule(callback, ms === 15_000 ? 15 : ms, ...args));
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('headers received')); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(webfetch({ url: 'https://fixture.invalid' }, {}), /请求超时\(15000ms\)/);
  assert.equal(cancelled, true);
});

test('webfetch cancels body reading with its execution and bounds received bytes', async t => {
  const controller = new AbortController();
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(value) { value.enqueue(new TextEncoder().encode('partial')); },
    cancel() { cancelled = true; },
  })));
  const pending = webfetch({ url: 'https://fixture.invalid' }, { signal: controller.signal });
  await new Promise<void>(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /请求已取消/);
  assert.equal(cancelled, true);
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(2 * 1024 * 1024).fill(65)));
  const limited = await webfetch({ url: 'https://fixture.invalid' }, {});
  assert.equal(limited.startsWith('A'.repeat(8000)), true);
  assert.match(limited, /响应读取已达上限/);
  assert.ok(limited.length < 8200);
});

test('response cleanup cannot hold a completed bounded read open', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024).fill(65)); },
    cancel() { return new Promise<void>(() => {}); },
  })));
  const value = await Promise.race([webfetch({ url: 'https://fixture.invalid' }, {}),
    new Promise<string>(resolve => setTimeout(() => resolve('still pending'), 100))]);
  assert.match(value, /响应读取已达上限/);
});
