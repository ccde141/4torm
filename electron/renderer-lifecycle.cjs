const fs = require('node:fs');
const path = require('node:path');
const { createRendererMemoryProbe } = require('./renderer-memory.cjs');

const MAX_LOG_BYTES = 128 * 1024;
const GONE_REASONS = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction']);

/** Recover the desktop UI only. Backend operations are never restarted or replayed. */
function createRendererLifecycle({ app, window, dialog, ipcMain, url, record, beforeRecover, monitorMemory = false, sampleIntervalMs = 10_000, unresponsiveDelayMs = 15_000 }) {
  const state = {
    app, window, contents: window.webContents, dialog, url, beforeRecover,
    record: record || createDiagnosticWriter(app.getPath('logs')),
    stage: 'starting', stopped: false, loading: false, automaticUsed: false,
    epoch: 0, lastPid: 0, reportedMemoryPid: 0, samples: [], listeners: [], pending: null, watchdog: null, prompt: null,
    memoryProbe: createRendererMemoryProbe({ ipcMain, contents: window.webContents }),
    monitorMemory, lastMonitoredMemoryKey: '',
  };
  listen(state, state.contents, 'render-process-gone', (_event, details) => onGone(state, details));
  listen(state, state.contents, 'unresponsive', () => onUnresponsive(state, unresponsiveDelayMs));
  listen(state, state.contents, 'responsive', () => onResponsive(state));
  listen(state, state.contents, 'did-finish-load', () => onLoaded(state));
  listen(state, state.contents, 'did-fail-load', (_event, code, _description, _url, mainFrame) => onLoadFailure(state, code, mainFrame));
  listen(state, state.contents, 'preload-error', () => diagnostic(state, 'preload-error'));
  listen(state, app, 'child-process-gone', (_event, details) => {
    if (details.type !== 'GPU' && details.type !== 'Utility') return;
    diagnostic(state, 'child-process-gone', { type: details.type, ...goneDetails(details) });
  });
  listen(state, app, 'before-quit', () => stop(state));
  listen(state, window, 'close', () => stop(state));
  listen(state, window, 'closed', () => stop(state));
  listen(state, state.contents, 'destroyed', () => stop(state));
  state.sampler = setInterval(() => sampleMemory(state), sampleIntervalMs);
  state.sampler.unref?.();
  sampleMemory(state);
  return { load: () => loadUI(state, 'initial'), stop: () => stop(state) };
}

function listen(state, target, event, handler) {
  target.on(event, handler);
  state.listeners.push(() => target.removeListener(event, handler));
}

function onGone(state, details) {
  if (state.stopped) return;
  state.stage = 'gone'; state.epoch += 1;
  clearWatchdog(state); cancelPrompt(state);
  diagnostic(state, 'render-process-gone', goneDetails(details));
  // A crash during a load is handled by that load's rejection, without a reload loop.
  if (state.loading || state.pending) return;
  if (state.automaticUsed) { void showRecovery(state, 'gone'); return; }
  state.automaticUsed = true;
  scheduleLoad(state, 'automatic');
}

function goneDetails(details) {
  return {
    reason: GONE_REASONS.has(details?.reason) ? details.reason : 'unknown',
    exitCode: Number.isInteger(details?.exitCode) ? details.exitCode : null,
  };
}

function onUnresponsive(state, delay) {
  if (state.stopped || state.stage === 'unresponsive') return;
  state.stage = 'unresponsive'; state.epoch += 1;
  diagnostic(state, 'unresponsive');
  clearWatchdog(state);
  state.watchdog = setTimeout(() => {
    state.watchdog = null;
    if (!state.stopped && state.stage === 'unresponsive') void showRecovery(state, 'unresponsive');
  }, delay);
  state.watchdog.unref?.();
}

function onResponsive(state) {
  if (state.stopped || state.stage !== 'unresponsive') return;
  state.stage = 'ready'; state.epoch += 1;
  clearWatchdog(state); cancelPrompt(state);
  diagnostic(state, 'responsive');
}

function onLoaded(state) {
  // Chromium also finishes its built-in error page after loadURL has rejected.
  // Controlled loads are confirmed by their Promise, not an unrelated finish event.
  if (state.stopped || state.loading || state.stage === 'load-failed') return;
  state.stage = 'ready'; state.epoch += 1;
  clearWatchdog(state); cancelPrompt(state);
  sampleMemory(state);
}

function onLoadFailure(state, code, mainFrame) {
  if (state.stopped || !mainFrame || code === -3) return;
  state.stage = 'load-failed'; state.epoch += 1;
  diagnostic(state, 'load-failed', { errorCode: Number.isInteger(code) ? code : null });
  if (!state.loading) void showRecovery(state, 'load-failed');
}

function scheduleLoad(state, mode, force = false) {
  if (state.stopped || state.pending || state.loading) return;
  const epoch = state.epoch;
  // Defer until Electron has finished renderer teardown. Never reload inside gone.
  state.pending = setImmediate(() => {
    state.pending = null;
    if (mode === 'manual' && state.epoch !== epoch) return;
    void loadUI(state, mode, force);
  });
}

async function loadUI(state, mode, force = false) {
  if (state.stopped || state.loading || state.window.isDestroyed()) return;
  const replaceUnresponsiveRenderer = force && state.stage === 'unresponsive';
  state.loading = true; state.stage = 'loading';
  cancelPrompt(state); clearWatchdog(state);
  diagnostic(state, 'ui-load-start', { mode });
  try {
    if (mode !== 'initial') state.beforeRecover?.();
    if (replaceUnresponsiveRenderer) state.contents.forcefullyCrashRenderer();
    await state.window.loadURL(state.url);
    if (!state.stopped) {
      state.loading = false;
      onLoaded(state);
      diagnostic(state, state.stage === 'ready' ? 'ui-load-completed' : 'ui-load-interrupted', { mode });
    }
  } catch {
    if (!state.stopped) {
      state.stage = 'load-failed'; state.epoch += 1;
      diagnostic(state, 'ui-load-rejected', { mode });
    }
  } finally {
    state.loading = false;
    if (!state.stopped && state.stage !== 'ready') void showRecovery(state, state.stage);
  }
}

async function showRecovery(state, kind) {
  if (state.stopped || state.prompt || state.loading || state.window.isDestroyed()) return;
  const epoch = state.epoch;
  const controller = new AbortController();
  state.prompt = controller;
  if (!state.window.isVisible()) state.window.show();
  try {
    const result = await state.dialog.showMessageBox(state.window, {
      type: 'warning', title: '4torm', buttons: ['恢复界面', '保持后台运行'],
      defaultId: 0, cancelId: 1, noLink: true, signal: controller.signal,
      message: kind === 'unresponsive' ? '界面暂时没有响应' : '界面已中断',
      detail: '恢复只重新加载界面，不会再次提交任务。执行状态可在对应功能区查看。',
    });
    if (state.stopped || state.epoch !== epoch || controller.signal.aborted) return;
    if (result.response === 0) scheduleLoad(state, 'manual', kind === 'unresponsive');
  } catch {
    if (!controller.signal.aborted && !state.stopped) diagnostic(state, 'recovery-dialog-failed');
  } finally {
    if (state.prompt === controller) state.prompt = null;
  }
}

function sampleMemory(state) {
  if (state.stopped || state.contents.isDestroyed()) return;
  try {
    const pid = state.contents.getOSProcessId();
    if (!pid) return;
    state.lastPid = pid;
    const memory = state.app.getAppMetrics().find(metric => metric.pid === pid)?.memory;
    if (!memory) return;
    const sample = { time: new Date().toISOString(), pid };
    for (const key of ['workingSetSize', 'peakWorkingSetSize', 'privateBytes']) {
      if (Number.isFinite(memory[key])) sample[key] = memory[key];
    }
    state.samples.push(sample);
    if (state.samples.length > 12) state.samples.shift();
    state.memoryProbe.request(sample);
    recordMemoryObservation(state, pid);
  } catch { /* The renderer can disappear between querying its PID and its metrics. */ }
}

function recordMemoryObservation(state, pid) {
  const sample = state.samples.findLast(value => value.pid === pid && value.renderer);
  if (!sample) return;
  if (state.reportedMemoryPid !== pid) {
    state.reportedMemoryPid = pid;
    diagnostic(state, 'renderer-memory-ready');
  }
  const key = `${pid}:${sample.time}`;
  if (state.monitorMemory && state.lastMonitoredMemoryKey !== key) {
    state.lastMonitoredMemoryKey = key;
    diagnostic(state, 'renderer-memory-sample', {}, [sample]);
  }
}

function diagnostic(state, event, details = {}, samples = state.samples) {
  if (state.stopped) return;
  try {
    state.record({
      time: new Date().toISOString(), event, rendererPid: state.lastPid,
      electronVersion: process.versions.electron || null,
      chromiumVersion: process.versions.chrome || null,
      ...details, memorySamples: samples.slice(),
    });
  } catch (error) {
    console.error('[electron] renderer diagnostic write failed:', error.code || error.name);
  }
}

function clearWatchdog(state) {
  if (state.watchdog) clearTimeout(state.watchdog);
  state.watchdog = null;
}

function cancelPrompt(state) {
  state.prompt?.abort();
  state.prompt = null;
}

function stop(state) {
  if (state.stopped) return;
  state.stopped = true; state.epoch += 1;
  clearWatchdog(state); cancelPrompt(state);
  if (state.pending) clearImmediate(state.pending);
  clearInterval(state.sampler);
  state.memoryProbe.stop();
  for (const remove of state.listeners) remove();
  state.listeners.length = 0;
}

function createDiagnosticWriter(directory) {
  const file = path.join(directory, 'renderer-lifecycle.jsonl');
  return entry => {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_LOG_BYTES) {
      fs.rmSync(`${file}.1`, { force: true });
      fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  };
}

module.exports = { createRendererLifecycle, createDiagnosticWriter };
