/** React 19 development User Timing details can retain successive versions of long message props. */
export interface MeasureEntry {
  readonly name: string;
  readonly entryType: string;
  readonly detail?: unknown;
}

export interface MeasureTimeline {
  clearMeasures(name: string): void;
  getEntriesByName(name: string, type: string): readonly MeasureEntry[];
  getEntriesByType(type: string): readonly MeasureEntry[];
}

interface MeasureObserver {
  observe(options: PerformanceObserverInit): void;
  disconnect(): void;
  takeRecords(): readonly MeasureEntry[];
}

type ObserverConstructor = new (callback: (list: {
  getEntries(): readonly MeasureEntry[];
}) => void) => MeasureObserver;

interface CleanupOptions {
  timeline?: MeasureTimeline | null;
  Observer?: ObserverConstructor | null;
  document?: Pick<Document, 'addEventListener' | 'removeEventListener'> | null;
  poll?: (callback: () => void) => () => void;
  warn?: () => void;
}

// Names and tracks emitted by react-dom 19.2's component/scheduler development instrumentation.
const REACT_PHASE_NAMES = /* @__PURE__ */ new Set(['Mount', 'Unmount', 'Disconnect', 'Reconnect', 'Recovered',
  'Errored', 'Promise Resolved', 'Cascading Update', 'Update Blocked', 'Update']);
const COMPONENT_PREFIX = '\u200b';

function hasReactTrack(entry: MeasureEntry): boolean {
  try {
    const detail = entry.detail as { devtools?: { track?: unknown; trackGroup?: unknown } } | null;
    return detail?.devtools?.track === 'Components ⚛' || detail?.devtools?.trackGroup === 'Scheduler ⚛';
  } catch { return false; }
}

/** Clearing by name is the public API; preserve a phase name shared with unrelated measurements. */
export function clearReactMeasures(entries: readonly MeasureEntry[], timeline: MeasureTimeline): void {
  const components = new Set<string>();
  const phases = new Set<string>();
  for (const entry of entries) {
    if (entry.entryType !== 'measure') continue;
    if (entry.name.startsWith(COMPONENT_PREFIX)) components.add(entry.name);
    else if (REACT_PHASE_NAMES.has(entry.name)) phases.add(entry.name);
  }
  // The React component prefix avoids deserialising the very large changed-prop details to classify them.
  for (const name of components) timeline.clearMeasures(name);
  for (const name of phases) {
    const sameName = timeline.getEntriesByName(name, 'measure');
    if (sameName.length && sameName.every(hasReactTrack)) timeline.clearMeasures(name);
  }
}

/** Installed once by the development bootstrap, independently of feature and conversation lifetimes. */
export function installReactMeasureCleanup(options: CleanupOptions = {}): () => void {
  const timeline = options.timeline === undefined ? globalThis.performance : options.timeline;
  if (!timeline?.getEntriesByType || !timeline.getEntriesByName || !timeline.clearMeasures) return () => {};
  const Observer = options.Observer === undefined ? globalThis.PerformanceObserver : options.Observer;
  const page = options.document === undefined ? globalThis.document : options.document;
  let observer: MeasureObserver | undefined;
  let stopPolling: (() => void) | undefined;
  let stopped = false;
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    (options.warn ?? (() => console.warn('[dev-performance] React timing cleanup failed')))();
  };
  const clean = (entries: readonly MeasureEntry[]) => {
    if (!stopped) try { clearReactMeasures(entries, timeline); } catch { warn(); }
  };
  const sweep = () => {
    if (!stopped) try { clean(timeline.getEntriesByType('measure')); } catch { warn(); }
  };
  sweep();
  try {
    if (!Observer) throw new Error('PerformanceObserver unavailable');
    observer = new Observer(list => clean(list.getEntries()));
    observer.observe({ type: 'measure', buffered: true });
  } catch {
    observer?.disconnect();
    observer = undefined;
    stopPolling = (options.poll ?? pollMeasures)(sweep);
  }
  page?.addEventListener('visibilitychange', sweep);
  return () => {
    if (stopped) return;
    sweep();
    stopped = true;
    observer?.disconnect();
    observer?.takeRecords();
    stopPolling?.();
    page?.removeEventListener('visibilitychange', sweep);
  };
}

function pollMeasures(callback: () => void): () => void {
  const timer = setInterval(callback, 1_000);
  return () => clearInterval(timer);
}
