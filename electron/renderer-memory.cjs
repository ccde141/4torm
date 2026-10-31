const REQUEST = 'renderer-memory:request';
const RESPONSE = 'renderer-memory:response';
const HEAP_KEYS = ['usedHeapSize', 'totalHeapSize', 'totalPhysicalSize', 'totalAvailableSize',
  'heapSizeLimit', 'mallocedMemory', 'peakMallocedMemory'];
const RESOURCE_KEYS = ['images', 'scripts', 'cssStyleSheets', 'xslStyleSheets', 'fonts', 'other'];

/** Diagnostics contain numeric counters only, never page content, URLs, paths, or arbitrary keys. */
function numericFields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const key of keys) {
    const number = value[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER) {
      result[key] = number;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeRendererMemory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  const heap = numericFields(value.heap, HEAP_KEYS);
  const blink = numericFields(value.blink, ['allocated', 'total']);
  if (heap) result.heap = heap;
  if (blink) result.blink = blink;
  if (value.resources && typeof value.resources === 'object' && !Array.isArray(value.resources)) {
    const resources = {};
    for (const key of RESOURCE_KEYS) {
      const counters = numericFields(value.resources[key], ['count', 'size', 'liveSize']);
      if (counters) resources[key] = counters;
    }
    if (Object.keys(resources).length) result.resources = resources;
  }
  return Object.keys(result).length ? result : undefined;
}

/** One outstanding request pairs the renderer counters with an existing bounded OS sample. */
function createRendererMemoryProbe({ ipcMain, contents, timeoutMs = 30_000 }) {
  let sequence = 0;
  let pending;
  let stopped = false;
  const clearPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = undefined;
  };
  const receive = (event, value) => {
    try {
      if (stopped || !pending || event.sender !== contents || contents.isDestroyed()
        || event.senderFrame !== contents.mainFrame || !contents.mainFrame) return;
      if (value?.id !== pending.id || value?.pid !== pending.sample.pid
        || contents.getOSProcessId() !== pending.sample.pid) return;
      const counters = sanitizeRendererMemory(value.memory);
      if (counters) pending.sample.renderer = counters;
      clearPending();
    } catch { /* Teardown can invalidate the frame while IPC is arriving. */ }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearPending();
    ipcMain?.removeListener?.(RESPONSE, receive);
    contents.removeListener?.('destroyed', stop);
  };
  ipcMain?.on?.(RESPONSE, receive);
  contents.on?.('destroyed', stop);
  return {
    request(sample) {
      clearPending();
      if (stopped || !ipcMain?.on || contents.isDestroyed() || !contents.send) return;
      const id = ++sequence;
      const timer = setTimeout(clearPending, timeoutMs);
      timer.unref?.();
      pending = { id, sample, timer };
      try { contents.send(REQUEST, { id, pid: sample.pid }); }
      catch { clearPending(); }
    },
    stop,
  };
}

/** Runs only in preload; no diagnostic API is exposed to the page's main world. */
function installRendererMemoryReporter({ ipcRenderer, process: rendererProcess, webFrame }) {
  const receive = (_event, request) => {
    if (!Number.isSafeInteger(request?.id) || request.id < 1 || request.pid !== rendererProcess.pid) return;
    const memory = {};
    try { memory.heap = rendererProcess.getHeapStatistics(); } catch { /* A counter may be unavailable. */ }
    try { memory.blink = rendererProcess.getBlinkMemoryInfo(); } catch { /* Keep other counters. */ }
    try { memory.resources = webFrame.getResourceUsage(); } catch { /* Keep other counters. */ }
    const counters = sanitizeRendererMemory(memory);
    if (counters) {
      try { ipcRenderer.send(RESPONSE, { id: request.id, pid: rendererProcess.pid, memory: counters }); }
      catch { /* Diagnostics must not interfere with renderer teardown. */ }
    }
  };
  ipcRenderer.on(REQUEST, receive);
  return () => ipcRenderer.removeListener(REQUEST, receive);
}

module.exports = { createRendererMemoryProbe, installRendererMemoryReporter, sanitizeRendererMemory };
