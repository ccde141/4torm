const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRendererLifecycle, createDiagnosticWriter } = require('./renderer-lifecycle.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));

function fakeWindow() {
  const window = new EventEmitter();
  const contents = new EventEmitter();
  const loads = [];
  let crashed = false;
  Object.assign(contents, {
    setWindowOpenHandler() {}, isDestroyed: () => false,
    getOSProcessId: () => 17, isCrashed: () => crashed,
    forcefullyCrashRenderer() { crashed = true; contents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 }); },
  });
  Object.assign(window, {
    webContents: contents, loads, isDestroyed: () => false,
    loadURL(url) { loads.push(url); crashed = false; contents.emit('did-finish-load'); return Promise.resolve(); },
    show() {}, isVisible: () => true, setIcon() {}, focus() {}, isMinimized: () => false,
  });
  return window;
}

function loadDesktopEntry(window, directory) {
  const app = new EventEmitter();
  Object.assign(app, {
    setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true,
    whenReady: () => ({ then() {} }), getPath: () => directory,
    getAppMetrics: () => [], isPackaged: false,
  });
  const dependencies = {
    electron: { app, BrowserWindow: function () { return window; }, ipcMain: { handle() {} },
      nativeImage: { createFromPath: () => null }, shell: {}, dialog: { showMessageBox: async () => ({ response: 1 }) } },
    './surface-registry.cjs': { createSurfaceRegistry: () => ({ dispose() {}, detachAll() { window.detachments = (window.detachments || 0) + 1; } }) },
    './desktop-browser-bridge.cjs': {},
    './transport.cjs': { certificatePath: () => '', isPinnedLocalCertificate() {}, isServerReady() {}, waitForServer() {} },
    './server-recovery.cjs': { createServerRecovery: () => ({ stop() {}, handleExit() {} }) },
  };
  const sandbox = {
    require: name => dependencies[name] || require(name.startsWith('.') ? path.join(__dirname, name) : name),
    __dirname, process: { env: {}, platform: 'win32', pid: 1, versions: process.versions },
    console: { warn() {}, error() {} }, setImmediate, clearImmediate, setTimeout, clearTimeout, setInterval, clearInterval,
    module: { exports: {} },
  };
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')}\nmodule.exports = { createWindow };`, sandbox);
  sandbox.module.exports.createWindow();
  return app;
}

test('the desktop entry recovers a disappeared renderer without touching its server', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '4torm-renderer-entry-'));
  const window = fakeWindow();
  const app = loadDesktopEntry(window, directory);
  try {
    await tick();
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 9 });
    await tick(); await tick();
    assert.equal(window.loads.length, 2, 'a dead renderer must not leave the desktop permanently blank');
    assert.equal(window.loads[1], 'http://localhost:5173');
    assert.equal(window.detachments, 1, 'native browser views detach before recovery, not before the initial load');
  } finally {
    app.emit('before-quit');
    window.emit('closed');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function lifecycleFixture(t, overrides = {}) {
  const window = fakeWindow();
  const app = new EventEmitter();
  const entries = [], prompts = [];
  let forced = 0;
  const originalForce = window.webContents.forcefullyCrashRenderer;
  window.webContents.forcefullyCrashRenderer = () => { forced += 1; originalForce(); };
  app.getAppMetrics = () => [{ pid: 17, memory: { workingSetSize: 20, privateBytes: 19 } }];
  const dialog = { showMessageBox: (_window, options) => new Promise(resolve => prompts.push({ options, resolve })) };
  const lifecycle = createRendererLifecycle({
    app, window, dialog, url: 'https://localhost:3001',
    record: entry => entries.push(entry), unresponsiveDelayMs: 2, ...overrides,
  });
  t.after(() => lifecycle.stop());
  return { window, app, lifecycle, entries, prompts, forced: () => forced };
}

test('only the first renderer disappearance restores automatically; the second has a native recovery choice', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  fixture.window.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 5 });
  assert.equal(fixture.window.loads.length, 1, 'recovery must be deferred until teardown ends');
  await tick(); await tick();
  assert.equal(fixture.window.loads.length, 2);
  fixture.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 6 });
  await tick();
  assert.equal(fixture.window.loads.length, 2, 'a repeatedly crashing UI must not reload in a loop');
  assert.equal(fixture.prompts.length, 1);
  fixture.prompts[0].resolve({ response: 0 });
  await tick(); await tick();
  assert.equal(fixture.window.loads.length, 3);
  assert.equal(fixture.forced(), 0, 'an already dead renderer needs no forced crash');
  const failure = fixture.entries.find(entry => entry.reason === 'oom');
  assert.equal(failure.exitCode, 5);
  assert.equal(failure.rendererPid, 17);
  assert.equal(failure.memorySamples.at(-1).workingSetSize, 20);
});

test('closing the desktop cancels deferred recovery and removes all lifecycle resources', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  fixture.window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  fixture.window.emit('close');
  await tick();
  assert.equal(fixture.window.loads.length, 1);
  assert.equal(fixture.prompts.length, 0);
  assert.equal(fixture.window.webContents.listenerCount('render-process-gone'), 0);
  assert.equal(fixture.app.listenerCount('child-process-gone'), 0);
  assert.equal(fixture.app.listenerCount('before-quit'), 0);
});

test('unexpected clean renderer exit recovers once, while clean exit after window close does not recover', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  fixture.window.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  await tick(); await tick();
  assert.equal(fixture.window.loads.length, 2);
  fixture.window.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  assert.equal(fixture.prompts.length, 1, 'exit code zero must not cause an unlimited reload loop');
  fixture.window.emit('close');
  fixture.window.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  await tick();
  assert.equal(fixture.window.loads.length, 2);
  assert.equal(fixture.prompts[0].options.signal.aborted, true);
});

test('a renderer that became responsive while the recovery choice was open is not killed or reloaded', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  fixture.window.webContents.emit('unresponsive');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fixture.prompts.length, 1);
  fixture.window.webContents.emit('responsive');
  assert.equal(fixture.prompts[0].options.signal.aborted, true);
  fixture.prompts[0].resolve({ response: 0 });
  await tick(); await tick();
  assert.equal(fixture.forced(), 0);
  assert.equal(fixture.window.loads.length, 1);
});

test('persistent unresponsiveness only replaces the renderer after the native recovery choice', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  fixture.window.webContents.emit('unresponsive');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fixture.forced(), 0);
  fixture.prompts[0].resolve({ response: 0 });
  await tick(); await tick();
  assert.equal(fixture.forced(), 1);
  assert.equal(fixture.window.loads.length, 2);
  assert.equal(fixture.prompts.length, 1, 'intentional renderer replacement must not open another recovery choice');
});

test('responsive arrival after accepting recovery but before its deferred load cancels replacement', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  fixture.window.webContents.emit('unresponsive');
  await new Promise(resolve => setTimeout(resolve, 10));
  fixture.prompts[0].resolve({ response: 0 });
  await Promise.resolve();
  fixture.window.webContents.emit('responsive');
  await tick(); await tick();
  assert.equal(fixture.window.loads.length, 1);
  assert.equal(fixture.forced(), 0);
});

test('normal application shutdown aborts a pending native choice without restoring the UI', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  fixture.window.webContents.emit('unresponsive');
  await new Promise(resolve => setTimeout(resolve, 10));
  fixture.app.emit('before-quit');
  assert.equal(fixture.prompts[0].options.signal.aborted, true);
  fixture.prompts[0].resolve({ response: 0 });
  await tick(); await tick();
  assert.equal(fixture.window.loads.length, 1);
  assert.equal(fixture.forced(), 0);
});

test('failed UI loads remain visible and diagnostics never contain the URL, error body, or request text', async t => {
  const fixture = lifecycleFixture(t, { url: 'https://localhost:3001/?apiKey=private-key' });
  fixture.window.loadURL = () => Promise.reject(new Error('private request body / secret https://user:password@host'));
  await fixture.lifecycle.load();
  assert.equal(fixture.prompts.length, 1);
  fixture.window.webContents.emit('did-fail-load', {}, -2, 'secret error', 'https://secret/?key=private', false);
  assert.equal(fixture.prompts.length, 1, 'an unrelated subframe must not trigger desktop recovery');
  const log = JSON.stringify(fixture.entries);
  assert.doesNotMatch(log, /private-key|private request|secret|apiKey|password|https:/);
  assert.match(log, /ui-load-rejected/);
});

test('the failed navigation error page finishing after rejection does not invalidate native recovery', async t => {
  const fixture = lifecycleFixture(t);
  let firstLoad = true;
  let completeRecovery;
  fixture.window.loadURL = url => {
    if (!firstLoad) {
      fixture.window.loads.push(url);
      return new Promise(resolve => {
        completeRecovery = () => { fixture.window.webContents.emit('did-finish-load'); resolve(); };
      });
    }
    firstLoad = false;
    fixture.window.loads.push(url);
    fixture.window.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', url, true);
    return Promise.reject(new Error('ERR_CONNECTION_REFUSED'));
  };
  await fixture.lifecycle.load();
  assert.equal(fixture.prompts.length, 1);
  fixture.window.webContents.emit('did-finish-load'); // Chromium's built-in error page.
  fixture.window.webContents.emit('did-finish-load'); // Its completion can arrive late.
  assert.equal(fixture.prompts[0].options.signal.aborted, false, 'the error page is not a successful UI recovery');
  fixture.prompts[0].resolve({ response: 0 });
  await tick(); await tick();
  assert.equal(fixture.window.loads.length, 2, 'the native choice must still load the now-available UI');
  fixture.window.webContents.emit('did-finish-load'); // The old error page finishes during manual loading.
  assert.ok(!fixture.entries.some(entry => entry.event === 'ui-load-completed' && entry.mode === 'manual'));
  completeRecovery();
  await tick();
  assert.ok(fixture.entries.some(entry => entry.event === 'ui-load-completed' && entry.mode === 'manual'));
  assert.equal(fixture.prompts.length, 1);
});

test('recent memory observations are bounded and GPU failures are distinguished from renderer failure', async t => {
  const fixture = lifecycleFixture(t);
  await fixture.lifecycle.load();
  for (let index = 0; index < 20; index += 1) fixture.window.webContents.emit('did-finish-load');
  fixture.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 7, name: 'private data' });
  const entry = fixture.entries.at(-1);
  assert.equal(entry.event, 'child-process-gone');
  assert.equal(entry.type, 'GPU');
  assert.equal(entry.memorySamples.length, 12);
  assert.equal(fixture.window.loads.length, 1);
  assert.equal(fixture.prompts.length, 0);
  assert.doesNotMatch(JSON.stringify(entry), /private data/);
});

test('renderer measurements pair with the existing bounded OS observations', async t => {
  const ipcMain = new EventEmitter();
  const f = lifecycleFixture(t, { ipcMain });
  f.window.webContents.mainFrame = {};
  f.window.webContents.send = (_channel, request) => ipcMain.emit('renderer-memory:response', {
    sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame,
  }, { ...request, memory: { heap: { usedHeapSize: 70 }, blink: { allocated: 60 },
    resources: { images: { count: 2, size: 50, liveSize: 40 } }, content: 'private-body' } });
  await f.lifecycle.load();
  for (let index = 0; index < 20; index++) f.window.webContents.emit('did-finish-load');
  f.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
  const samples = f.entries.at(-1).memorySamples;
  assert.equal(samples.length, 12);
  assert.ok(samples.every(sample => sample.pid === 17 && sample.privateBytes === 19
    && sample.renderer.heap.usedHeapSize === 70 && sample.renderer.blink.allocated === 60
    && sample.renderer.resources.images.count === 2));
  assert.doesNotMatch(JSON.stringify(f.entries), /private-body/);
  assert.equal(f.entries.some(entry => entry.event === 'renderer-memory-sample'), false,
    'continuous classification logging stays off by default');
  f.lifecycle.stop();
  assert.equal(ipcMain.listenerCount('renderer-memory:response'), 0);
});

test('the first classified memory observation is recorded once per renderer process after asynchronous IPC', async t => {
  const ipcMain = new EventEmitter();
  const f = lifecycleFixture(t, { ipcMain });
  const requests = [];
  let pid = 17;
  f.window.webContents.mainFrame = {};
  f.window.webContents.getOSProcessId = () => pid;
  f.window.webContents.send = (_channel, request) => requests.push(request);
  f.app.getAppMetrics = () => [{ pid, memory: { privateBytes: 40 } }];
  const ready = () => f.entries.filter(entry => entry.event === 'renderer-memory-ready');
  const reply = () => ipcMain.emit('renderer-memory:response', {
    sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame,
  }, { ...requests.at(-1), memory: { heap: { usedHeapSize: 30 } } });
  await f.lifecycle.load();
  assert.equal(ready().length, 0);
  reply();
  assert.equal(ready().length, 0, 'the reply only enriches the existing ring');
  f.window.webContents.emit('did-finish-load');
  assert.equal(ready().length, 1);
  assert.equal(ready()[0].rendererPid, 17);
  assert.ok(ready()[0].memorySamples.some(sample => sample.pid === 17 && sample.renderer?.heap.usedHeapSize === 30));
  for (let index = 0; index < 20; index++) f.window.webContents.emit('did-finish-load');
  assert.equal(ready().length, 1, 'ordinary later sampling does not create periodic log records');
  pid = 18;
  f.window.webContents.emit('did-finish-load');
  assert.equal(ready().length, 1, 'a previous PID measurement cannot mark the new renderer ready');
  reply();
  f.window.webContents.emit('did-finish-load');
  assert.equal(ready().length, 2);
  assert.equal(ready()[1].rendererPid, 18);
  assert.ok(ready()[1].memorySamples.some(sample => sample.pid === 18 && sample.renderer?.heap.usedHeapSize === 30));
});

test('opt-in memory monitoring records each paired sample once and never attributes an old PID to the new renderer', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const ipcMain = new EventEmitter();
  const f = lifecycleFixture(t, { ipcMain, monitorMemory: true });
  const requests = [];
  let pid = 17;
  f.window.webContents.mainFrame = {};
  f.window.webContents.getOSProcessId = () => pid;
  f.window.webContents.send = (_channel, request) => requests.push(request);
  f.app.getAppMetrics = () => [{ pid, memory: { privateBytes: 40 } }];
  const records = () => f.entries.filter(entry => entry.event === 'renderer-memory-sample');
  const reply = () => ipcMain.emit('renderer-memory:response', {
    sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame,
  }, { ...requests.at(-1), memory: { heap: { usedHeapSize: 30 } } });
  const sample = () => { t.mock.timers.tick(10_000); f.window.webContents.emit('did-finish-load'); };
  await f.lifecycle.load();
  assert.equal(records().length, 0);
  reply();
  sample();
  assert.equal(records().length, 1);
  assert.equal(records()[0].memorySamples.length, 1);
  assert.equal(records()[0].memorySamples[0].time, new Date(0).toISOString());
  sample();
  assert.equal(records().length, 1, 'another OS sample cannot duplicate an already recorded renderer measurement');
  reply();
  sample();
  assert.equal(records().length, 2);
  assert.equal(records()[1].memorySamples[0].time, new Date(20_000).toISOString());
  pid = 18;
  sample();
  assert.equal(records().length, 2, 'old-PID classification is not logged as a new-PID sample');
  reply();
  sample();
  assert.equal(records().length, 3);
  assert.equal(records()[2].rendererPid, 18);
  assert.equal(records()[2].memorySamples.length, 1);
  assert.equal(records()[2].memorySamples[0].pid, 18);
  assert.equal(records()[2].memorySamples[0].renderer.heap.usedHeapSize, 30);
});

test('local diagnostic files rotate within two bounded files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '4torm-renderer-log-'));
  try {
    const write = createDiagnosticWriter(directory);
    const entry = { event: 'test', memorySamples: Array.from({ length: 12 }, () => ({ pid: 17, workingSetSize: 2000 })) };
    for (let index = 0; index < 500; index += 1) write(entry);
    const files = fs.readdirSync(directory);
    assert.deepEqual(files.sort(), ['renderer-lifecycle.jsonl', 'renderer-lifecycle.jsonl.1']);
    for (const file of files) assert.ok(fs.statSync(path.join(directory, file)).size < 129 * 1024);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
