import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundVideoUrl, uploadBackgroundVideoFile, validateBackgroundVideoFile } from './skin-video.js';

test('background video accepts large MP4/WebM files and rejects invalid input', () => {
  assert.equal(validateBackgroundVideoFile({ name: 'loop.mp4', type: 'video/mp4', size: 1024 }), 'video/mp4');
  assert.equal(validateBackgroundVideoFile({ name: 'loop.webm', type: '', size: 1024 }), 'video/webm');
  assert.equal(validateBackgroundVideoFile({ name: 'loop.mp4', type: 'application/octet-stream', size: 1024 }), 'video/mp4');
  assert.throws(() => validateBackgroundVideoFile({ name: 'fake.mov', type: 'video/quicktime', size: 1024 }), /MP4|WebM/);
  assert.throws(() => validateBackgroundVideoFile({ name: 'empty.mp4', type: 'video/mp4', size: 0 }), /空/);
  assert.equal(validateBackgroundVideoFile({ name: 'huge.mp4', type: 'video/mp4', size: 8 * 1024 * 1024 * 1024 }), 'video/mp4');
});

test('background video URL uses only a validated local identifier', () => {
  assert.equal(backgroundVideoUrl('background-abc123.mp4'), '/api/skin-video/background-abc123.mp4');
  assert.equal(backgroundVideoUrl('../providers.json'), undefined);
});

test('video upload sends binary file data and reports server failure', async () => {
  const originalFetch = globalThis.fetch;
  const file = new File([Buffer.from('test video')], 'loop.mp4', { type: 'video/mp4' });
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/skin-video');
      assert.equal(init?.body, file);
      assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'video/mp4');
      return new Response(JSON.stringify({ id: 'background-abc123.mp4' }), { status: 200 });
    };
    assert.equal(await uploadBackgroundVideoFile(file), 'background-abc123.mp4');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: '磁盘已满' }), { status: 500 });
    await assert.rejects(uploadBackgroundVideoFile(file), /磁盘已满/);
  } finally { globalThis.fetch = originalFetch; }
});

test('video upload reports progress and can be cancelled without accepting a result', async () => {
  const originalXHR = globalThis.XMLHttpRequest;
  const file = new File(['video'], 'loop.mp4', { type: 'video/mp4' });
  const progress: number[] = [];
  let pending: FakeUpload | undefined;
  class FakeUpload {
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    responseText = JSON.stringify({ id: 'background-abc123.mp4' });
    method = '';
    url = '';
    contentType = '';
    body?: Document | XMLHttpRequestBodyInit | null;
    constructor() { pending = this; }
    open(method: string, url: string) { this.method = method; this.url = url; }
    setRequestHeader(_name: string, value: string) { this.contentType = value; }
    send(body?: Document | XMLHttpRequestBodyInit | null) { this.body = body; }
    abort() { this.onabort?.(); }
  }
  try {
    globalThis.XMLHttpRequest = FakeUpload as unknown as typeof XMLHttpRequest;
    const controller = new AbortController();
    const result = uploadBackgroundVideoFile(file, { signal: controller.signal, onProgress: value => progress.push(value) });
    assert.equal(pending?.method, 'PUT');
    assert.equal(pending?.url, '/api/skin-video');
    assert.equal(pending?.body, file);
    pending?.upload.onprogress?.({ loaded: 2 } as ProgressEvent);
    controller.abort();
    await assert.rejects(result, /取消/);
    assert.deepEqual(progress, [2]);
  } finally { globalThis.XMLHttpRequest = originalXHR; }
});
