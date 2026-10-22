import assert from 'node:assert/strict';
import test from 'node:test';
import { backendFetch, backendOrigin, backendUrl, createBackendEventSource,
  resolveBackendOrigin } from './backend-client';
import { streamUrl } from './apiBase';
import { avatarUrl } from '../components/agents/agent-avatar-client';
import { attachmentUrl } from '../engine/chat/image-attachments';
import { backgroundVideoUrl, uploadBackgroundVideoFile } from '../store/skin-video';
import { visualObservationFrameUrl } from '../components/chat/visual-observation-client';

function connection(origin?: string) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = Object.assign(new EventTarget(), { __FOURTORM_CONNECTION__: { origin } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  return { target, restore() {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  } };
}

test('backend connection accepts an origin, keeping remote credentials on HTTPS', () => {
  assert.equal(resolveBackendOrigin(undefined), '');
  assert.equal(resolveBackendOrigin(' https://work.example:3443/ '), 'https://work.example:3443');
  assert.equal(resolveBackendOrigin('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  for (const value of ['http://work.example', 'https://user:secret@work.example',
    'https://work.example/api', 'https://work.example?token=secret', 'file:///tmp/app']) {
    assert.throws(() => resolveBackendOrigin(value));
  }
});

test('REST, SSE and server-owned files follow the same current connection', async () => {
  const state = connection('https://work.example');
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const calls: Array<{ url: unknown; init?: RequestInit }> = [];
  class Source {
    constructor(public url: string, public options: EventSourceInit) {}
  }
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init }); return new Response('{}');
    };
    globalThis.EventSource = Source as unknown as typeof EventSource;
    await backendFetch('/api/agents');
    await backendFetch(streamUrl('/api/conversation/chat'), { method: 'POST', body: '{}' });
    assert.deepEqual(calls.map(call => call.url), [
      'https://work.example/api/agents', 'https://work.example/api/conversation/chat']);
    assert.ok(calls.every(call => call.init?.credentials === 'include'));
    assert.ok(calls.every(call => call.init?.redirect === 'error'));
    const source = createBackendEventSource('/api/convection/events') as unknown as Source;
    assert.equal(source.url, 'https://work.example/api/convection/events');
    assert.equal(source.options.withCredentials, true);
    assert.equal(avatarUrl('agent/a', 7), 'https://work.example/api/agents/agent%2Fa/avatar?v=7');
    assert.equal(attachmentUrl('a', 's', 'i'), 'https://work.example/api/conversation/attachments/a/s/i');
    assert.equal(backgroundVideoUrl('background-abc.mp4'), 'https://work.example/api/skin-video/background-abc.mp4');
    assert.match(visualObservationFrameUrl('o', { scope: 'conversation', ownerId: 's' }, 2),
      /^https:\/\/work\.example\/api\/tools\/observations\/o\/frame\?/);
    state.target.__FOURTORM_CONNECTION__.origin = 'https://other.example';
    assert.equal(backendOrigin(), 'https://other.example');
    assert.equal(streamUrl('/api/tide/changes'), 'https://other.example/api/tide/changes');
    assert.equal(backendUrl('blob:local-image'), 'blob:local-image');
    assert.equal(backendUrl('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    state.restore();
  }
});

test('same-origin requests remain relative and failed writes are never replayed', async () => {
  const state = connection('');
  const originalFetch = globalThis.fetch;
  let count = 0;
  const controller = new AbortController();
  const body = new FormData();
  body.append('file', new Blob(['content']), 'report.txt');
  try {
    globalThis.fetch = async (url, init) => {
      count++;
      assert.equal(url, '/api/conversation/attachments');
      assert.equal(init?.body, body);
      assert.equal(init?.signal, controller.signal);
      assert.equal(init?.headers, undefined);
      throw new TypeError('connection lost');
    };
    await assert.rejects(backendFetch('/api/conversation/attachments', {
      method: 'POST', body, signal: controller.signal,
    }), /connection lost/);
    assert.equal(count, 1);
  } finally { globalThis.fetch = originalFetch; state.restore(); }
});

test('browser URL normalization cannot redirect backend requests to an unrelated origin', async () => {
  const state = connection('');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; return new Response('{}'); };
    for (const path of ['//unrelated.example/api', '/\\unrelated.example/api',
      '/\t/unrelated.example/api', 'https://unrelated.example/api',
      'https://backend.invalid/api', 'api/agents', 'data:text/plain,hello']) {
      await assert.rejects(backendFetch(path), /其他服务/);
    }
    assert.equal(requests, 0);
    assert.equal(backendUrl('https://images.example/photo.png'), 'https://images.example/photo.png');
  } finally { globalThis.fetch = originalFetch; state.restore(); }
});

test('only an explicit backend identity rejection opens the connection gate', async () => {
  const state = connection('https://work.example');
  const originalFetch = globalThis.fetch;
  let notified = 0;
  let count = 0;
  state.target.addEventListener('4torm:authentication-required', () => notified++);
  try {
    const providerDenied = new Response('{"error":"provider key rejected"}', { status: 401 });
    globalThis.fetch = async () => { count++; return providerDenied; };
    assert.equal(await backendFetch('/api/model-runtime/probe'), providerDenied);
    assert.equal(notified, 0);
    const denied = new Response('{"error":"login required"}', {
      status: 401, headers: { 'x-4torm-auth-required': '1' },
    });
    globalThis.fetch = async () => { count++; return denied; };
    assert.equal(await backendFetch('/api/agents'), denied);
    assert.equal(notified, 1);
    await assert.rejects(backendFetch('https://unrelated.example/api/agents'), /其他服务/);
    assert.equal(count, 2);
  } finally { globalThis.fetch = originalFetch; state.restore(); }
});

test('progress uploads use the selected backend and include the same session cookie', async () => {
  const state = connection('https://work.example');
  const originalXHR = globalThis.XMLHttpRequest;
  class Upload {
    static instances: Upload[] = [];
    upload = {};
    withCredentials = false;
    status = 200;
    responseText = '{"id":"background-abc.mp4"}';
    onload?: () => void;
    constructor() { Upload.instances.push(this); }
    open(method: string, url: string) {
      assert.equal(method, 'PUT'); assert.equal(url, 'https://work.example/api/skin-video');
    }
    setRequestHeader() {}
    send() { queueMicrotask(() => this.onload?.()); }
  }
  try {
    globalThis.XMLHttpRequest = Upload as unknown as typeof XMLHttpRequest;
    assert.equal(await uploadBackgroundVideoFile(new File(['video'], 'loop.mp4', { type: 'video/mp4' }),
      { onProgress() {} }), 'background-abc.mp4');
    assert.equal(Upload.instances[0]?.withCredentials, true);
  } finally { globalThis.XMLHttpRequest = originalXHR; state.restore(); }
});
