import assert from 'node:assert/strict';
import test from 'node:test';
import { subscribeCycloneChanges } from './cyclone-change-client.js';
import { watchContactActivity } from './contact-activity-client.js';
import type { ContactResultDisplay } from './contact-result.js';

test('all room and workshop consumers share one change stream and reconcile on connection', () => {
  const previous = globalThis.EventSource;
  const sources: FakeSource[] = [];
  globalThis.EventSource = class extends FakeSource {
    constructor(url: string) { super(url); sources.push(this); }
  } as typeof EventSource;
  try {
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = subscribeCycloneChanges(event => first.push(event.type));
    const offSecond = subscribeCycloneChanges(event => second.push(event.type));
    assert.equal(sources.length, 1);
    sources[0].onopen?.(new Event('open'));
    sources[0].onmessage?.({ data: JSON.stringify({ type: 'change', workshopId: 'w', scope: 'room', id: 'r', revision: 1 }) } as MessageEvent);
    assert.deepEqual(first, ['sync', 'change']);
    assert.deepEqual(second, ['sync', 'change']);
    offFirst();
    assert.equal(sources[0].closed, false);
    offSecond();
    assert.equal(sources[0].closed, true);
  } finally { globalThis.EventSource = previous; }
});

class FakeSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  close() { this.closed = true; }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function contactBrowser(t: import('node:test').TestContext) {
  const sources: FakeSource[] = [];
  const previous = globalThis.EventSource;
  globalThis.EventSource = class extends FakeSource {
    constructor(url: string) { super(url); sources.push(this); }
  } as typeof EventSource;
  t.after(() => { globalThis.EventSource = previous; });
  return { change(workshopId: string) {
    sources[0].onmessage?.({ data: JSON.stringify({ type: 'change', workshopId,
      scope: 'activity', revision: 1 }) } as MessageEvent);
  }, sync() { sources[0].onopen?.(new Event('open')); } };
}

test('可见联络卡按工作室通知刷新，终态停止读取且保留回复截断事实', async t => {
  const browser = contactBrowser(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    assert.equal(String(input), '/api/cyclone/workshop/w/contact/contact-1');
    calls++;
    return Response.json({ workshopId: 'w', contactId: 'contact-1', delivered: true,
      status: calls === 1 ? 'running' : 'completed', reply: '结果正文', ...(calls > 1 ? { nextOffset: 6000 } : {}) });
  });
  const results: ContactResultDisplay[] = [];
  const errors: Error[] = [];
  const off = watchContactActivity('w', ['contact-1'], (_id, result) => results.push(result), error => errors.push(error));
  try {
    await flush();
    browser.change('other'); await flush();
    assert.equal(calls, 1);
    browser.change('w'); await flush();
    assert.equal(results.at(-1)?.status, 'success');
    assert.equal(results.at(-1)?.replyTruncated, true);
    browser.sync(); browser.change('w'); await flush();
    assert.equal(calls, 2);
    assert.deepEqual(errors, []);
  } finally { off(); }
});

test('联络刷新合并进行中的通知，切会话后旧响应不能覆盖下一窗口', async t => {
  const browser = contactBrowser(t);
  const requests: Array<{ signal?: AbortSignal | null; resolve: (value: Response) => void }> = [];
  t.mock.method(globalThis, 'fetch', (_input, init) => new Promise<Response>(resolve => {
    requests.push({ signal: init?.signal, resolve });
  }));
  const results: ContactResultDisplay[] = [];
  const off = watchContactActivity('w', ['c'], (_id, result) => results.push(result), error => { throw error; });
  browser.change('w'); browser.change('w');
  assert.equal(requests.length, 1);
  requests[0].resolve(Response.json({ workshopId: 'w', contactId: 'c', status: 'running', delivered: true }));
  await flush();
  assert.equal(requests.length, 2);
  off();
  assert.equal(requests[1].signal?.aborted, true);
  requests[1].resolve(Response.json({ workshopId: 'w', contactId: 'c', status: 'completed', delivered: true, reply: '旧窗口' }));
  await flush();
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'running');
});

test('联络查询错误不伪装成功，也不接受其他工作室的记录', async t => {
  const browser = contactBrowser(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ error: '读取失败' }, { status: 500 })
    : Response.json({ workshopId: 'other', contactId: 'c', status: 'completed', delivered: true }));
  const results: ContactResultDisplay[] = [];
  const errors: Error[] = [];
  const off = watchContactActivity('w', ['c'], (_id, result) => results.push(result), error => errors.push(error));
  try {
    await flush(); browser.change('w'); await flush();
    assert.equal(results.length, 0);
    assert.match(errors[0].message, /读取失败/);
    assert.match(errors[1].message, /身份或状态无效/);
  } finally { off(); }
});

test('冷启动直接补读已结束的联络票据，不依赖错过的终态通知', async t => {
  contactBrowser(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ workshopId: 'w', contactId: 'c-old', status: 'completed', delivered: true, reply: '后台已完成' });
  });
  const results: ContactResultDisplay[] = [];
  const off = watchContactActivity('w', ['c-old'], (_id, result) => results.push(result), error => { throw error; });
  try {
    await flush();
    assert.equal(calls, 1);
    assert.equal(results[0].status, 'success');
    assert.equal(results[0].reply, '后台已完成');
  } finally { off(); }
});
