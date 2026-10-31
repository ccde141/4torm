const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createRendererMemoryProbe, installRendererMemoryReporter, sanitizeRendererMemory } = require('./renderer-memory.cjs');

function fixture(t, options = {}) {
  const ipcMain = new EventEmitter();
  const contents = new EventEmitter();
  let pid = 17;
  let destroyed = false;
  const requests = [];
  Object.assign(contents, { mainFrame: {}, isDestroyed: () => destroyed, getOSProcessId: () => pid,
    send: (channel, request) => requests.push({ channel, request }) });
  const probe = createRendererMemoryProbe({ ipcMain, contents, ...options });
  t.after(() => probe.stop());
  const reply = (changes = {}, event = { sender: contents, senderFrame: contents.mainFrame }) => {
    const latest = requests.at(-1).request;
    ipcMain.emit('renderer-memory:response', event, { ...latest, memory: { heap: { usedHeapSize: 30 } }, ...changes });
  };
  return { ipcMain, contents, requests, probe, reply,
    pid: value => { pid = value; }, destroy: () => { destroyed = true; contents.emit('destroyed'); } };
}

test('renderer diagnostic payloads keep only finite nonnegative numeric allowlisted counters', () => {
  const raw = { url: 'private-url', content: 'private-content',
    heap: { usedHeapSize: 17, heapSizeLimit: 40, totalHeapSize: 'secret', mallocedMemory: Infinity,
      peakMallocedMemory: -1, totalPhysicalSize: NaN, totalAvailableSize: Number.MAX_VALUE },
    blink: { allocated: 20, total: 25, file: 'private-path' },
    resources: { images: { count: 3, size: 600, liveSize: 400, text: 'private-text' },
      scripts: { count: 'secret' }, unknown: { size: 50 } } };
  const value = sanitizeRendererMemory(raw);
  assert.deepEqual(value, { heap: { usedHeapSize: 17, heapSizeLimit: 40 },
    blink: { allocated: 20, total: 25 }, resources: { images: { count: 3, size: 600, liveSize: 400 } } });
  assert.doesNotMatch(JSON.stringify(value), /secret|private|Infinity|NaN/);
  for (const value of [null, [], 20, { heap: [] }, { resources: [] }, { heap: { usedHeapSize: '17' } }]) {
    assert.equal(sanitizeRendererMemory(value), undefined);
  }
});

test('a correlated main-frame response enriches its exact OS sample only once', t => {
  const f = fixture(t);
  const sample = { pid: 17, privateBytes: 400 };
  f.probe.request(sample);
  f.reply();
  assert.deepEqual(sample, { pid: 17, privateBytes: 400, renderer: { heap: { usedHeapSize: 30 } } });
  f.reply({ memory: { heap: { usedHeapSize: 900 } } });
  assert.equal(sample.renderer.heap.usedHeapSize, 30);
});

test('another renderer, a subframe, missing sender frame, and mismatched request fields cannot attach counters', t => {
  const f = fixture(t);
  const sample = { pid: 17 };
  f.probe.request(sample);
  f.reply({}, { sender: {}, senderFrame: f.contents.mainFrame });
  f.reply({}, { sender: f.contents, senderFrame: {} });
  f.reply({}, { sender: f.contents });
  f.reply({ id: 0 });
  f.reply({ pid: 18 });
  assert.equal(sample.renderer, undefined);
  f.reply();
  assert.equal(sample.renderer.heap.usedHeapSize, 30);
});

test('only the latest outstanding sample and its current renderer process can receive counters', t => {
  const f = fixture(t);
  const first = { pid: 17 }, second = { pid: 17 };
  f.probe.request(first);
  const old = f.requests.at(-1).request;
  f.probe.request(second);
  f.reply(old);
  assert.equal(first.renderer, undefined);
  assert.equal(second.renderer, undefined);
  f.pid(18);
  f.reply();
  assert.equal(second.renderer, undefined);
  const replacement = { pid: 18 };
  f.probe.request(replacement);
  f.reply();
  assert.equal(replacement.renderer.heap.usedHeapSize, 30);
});

test('timed-out requests and destroyed or stopped probes release pending samples and listeners', async t => {
  const f = fixture(t, { timeoutMs: 1 });
  const sample = { pid: 17 };
  f.probe.request(sample);
  await new Promise(resolve => setTimeout(resolve, 5));
  f.reply();
  assert.equal(sample.renderer, undefined);
  f.probe.request({ pid: 17 });
  f.destroy();
  assert.equal(f.ipcMain.listenerCount('renderer-memory:response'), 0);
  assert.equal(f.contents.listenerCount('destroyed'), 0);
  f.probe.request({ pid: 17 });
  assert.equal(f.requests.length, 2);
  f.probe.stop();
});

test('send failure and unrecognised counters never interfere with OS sample creation', t => {
  const f = fixture(t);
  f.contents.send = () => { throw new Error('renderer exited'); };
  const sample = { pid: 17, privateBytes: 40 };
  assert.doesNotThrow(() => f.probe.request(sample));
  assert.deepEqual(sample, { pid: 17, privateBytes: 40 });
});

test('preload collects supported counters, excludes contents, rejects unrelated requests, and disposes its listener', () => {
  const ipcRenderer = new EventEmitter();
  const sent = [];
  ipcRenderer.send = (channel, value) => sent.push({ channel, value });
  const stop = installRendererMemoryReporter({ ipcRenderer,
    process: { pid: 17, getHeapStatistics: () => ({ usedHeapSize: 80, unknown: 'private-text' }),
      getBlinkMemoryInfo: () => ({ allocated: 12, total: 16 }) },
    webFrame: { getResourceUsage: () => ({ images: { count: 1, size: 64, liveSize: 32, path: 'private-path' } }) } });
  for (const request of [{ id: '1', pid: 17 }, { id: 1, pid: 18 }, { id: -1, pid: 17 }, null]) {
    ipcRenderer.emit('renderer-memory:request', {}, request);
  }
  assert.equal(sent.length, 0);
  ipcRenderer.emit('renderer-memory:request', {}, { id: 2, pid: 17 });
  assert.deepEqual(sent, [{ channel: 'renderer-memory:response', value: { id: 2, pid: 17,
    memory: { heap: { usedHeapSize: 80 }, blink: { allocated: 12, total: 16 },
      resources: { images: { count: 1, size: 64, liveSize: 32 } } } } }]);
  stop();
  assert.equal(ipcRenderer.listenerCount('renderer-memory:request'), 0);
});

test('an unavailable counter does not suppress other available measurements', () => {
  const ipcRenderer = new EventEmitter();
  const sent = [];
  ipcRenderer.send = (_channel, value) => sent.push(value);
  const stop = installRendererMemoryReporter({ ipcRenderer,
    process: { pid: 17, getHeapStatistics() { throw new Error('unsupported'); },
      getBlinkMemoryInfo: () => ({ total: 64 }) }, webFrame: {} });
  ipcRenderer.emit('renderer-memory:request', {}, { id: 1, pid: 17 });
  assert.deepEqual(sent, [{ id: 1, pid: 17, memory: { blink: { total: 64 } } }]);
  stop();
});

test('renderer teardown while reporting does not surface a new page error', () => {
  const ipcRenderer = new EventEmitter();
  ipcRenderer.send = () => { throw new Error('webContents closed'); };
  const stop = installRendererMemoryReporter({ ipcRenderer,
    process: { pid: 17, getHeapStatistics: () => ({ usedHeapSize: 1 }) }, webFrame: {} });
  assert.doesNotThrow(() => ipcRenderer.emit('renderer-memory:request', {}, { id: 1, pid: 17 }));
  stop();
});
