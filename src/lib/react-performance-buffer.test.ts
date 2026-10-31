import assert from 'node:assert/strict';
import test from 'node:test';
import { clearReactMeasures, installReactMeasureCleanup,
  type MeasureEntry, type MeasureTimeline } from './react-performance-buffer';

const component = (name = 'MessageItem'): MeasureEntry => ({ name: `\u200b${name}`, entryType: 'measure' });
const phase = (name: string, devtools: object): MeasureEntry => ({ name, entryType: 'measure', detail: { devtools } });
const ordinary = (name = 'user-search'): MeasureEntry => ({ name, entryType: 'measure' });

class Timeline implements MeasureTimeline {
  entries: MeasureEntry[];
  cleared: string[] = [];
  constructor(entries: MeasureEntry[] = []) { this.entries = entries; }
  clearMeasures(name: string): void {
    this.cleared.push(name);
    this.entries = this.entries.filter(entry => entry.entryType !== 'measure' || entry.name !== name);
  }
  getEntriesByName(name: string, type: string): readonly MeasureEntry[] {
    return this.entries.filter(entry => entry.name === name && entry.entryType === type);
  }
  getEntriesByType(type: string): readonly MeasureEntry[] {
    return this.entries.filter(entry => entry.entryType === type);
  }
}

function unreadableDetail(name: string, entryType = 'measure'): MeasureEntry {
  return { name, entryType, get detail(): never { throw new Error('Must not materialise the payload'); } };
}

function observerFixture(failObserve = false) {
  type Callback = (list: { getEntries(): readonly MeasureEntry[] }) => void;
  const instances: Observer[] = [];
  class Observer {
    options: PerformanceObserverInit | undefined;
    disconnects = 0;
    drains = 0;
    constructor(private callback: Callback) { instances.push(this); }
    observe(options: PerformanceObserverInit): void {
      this.options = options;
      if (failObserve) throw new Error('Unsupported observation');
    }
    disconnect(): void { this.disconnects++; }
    takeRecords(): readonly MeasureEntry[] { this.drains++; return []; }
    emit(entries: readonly MeasureEntry[]): void { this.callback({ getEntries: () => entries }); }
  }
  return { Observer, get current() { const current = instances.at(-1); assert.ok(current); return current; },
    get count() { return instances.length; } };
}

function pollingFixture() {
  let tick: (() => void) | undefined;
  let starts = 0;
  let stops = 0;
  return {
    poll(callback: () => void) { tick = callback; starts++; return () => { stops++; }; },
    tick() { assert.ok(tick); tick(); },
    get starts() { return starts; }, get stops() { return stops; },
  };
}

test('React component measurements are cleared once per name without reading their large details', () => {
  const first = unreadableDetail('\u200bMessageItem');
  const second = unreadableDetail('\u200bMessageItem');
  const third = unreadableDetail('\u200bReasoningBlock');
  const keep = ordinary();
  const timeline = new Timeline([first, second, third, keep]);
  assert.doesNotThrow(() => clearReactMeasures(timeline.entries, timeline));
  assert.deepEqual(timeline.cleared, ['\u200bMessageItem', '\u200bReasoningBlock']);
  assert.deepEqual(timeline.entries, [keep]);
});

test('non-candidate measurements and marks keep their payloads untouched', () => {
  const entries = [unreadableDetail('application-render'), unreadableDetail('Render'),
    unreadableDetail('\u200bMessageItem', 'mark'), unreadableDetail('Update', 'resource')];
  const timeline = new Timeline(entries);
  assert.doesNotThrow(() => clearReactMeasures(entries, timeline));
  assert.deepEqual(timeline.cleared, []);
  assert.deepEqual(timeline.entries, entries);
});

test('React phase measurements require recognised component or scheduler track metadata', () => {
  const entries = [phase('Mount', { track: 'Components ⚛' }), phase('Update', { trackGroup: 'Scheduler ⚛' }),
    phase('Recovered', { track: 'application' }), ordinary('Unmount'), unreadableDetail('Disconnect')];
  const timeline = new Timeline(entries);
  assert.doesNotThrow(() => clearReactMeasures(entries, timeline));
  assert.deepEqual(timeline.cleared, ['Mount', 'Update']);
  assert.deepEqual(timeline.entries, entries.slice(2));
});

test('a React phase batch cannot erase unrelated same-name measurements elsewhere in the timeline', () => {
  const react = phase('Update', { trackGroup: 'Scheduler ⚛' });
  const external = ordinary('Update');
  const timeline = new Timeline([external, react]);
  clearReactMeasures([react], timeline);
  assert.deepEqual(timeline.cleared, []);
  assert.deepEqual(timeline.entries, [external, react]);
});

test('clearing a React phase preserves a mark that happens to share its name', () => {
  const react = phase('Update', { trackGroup: 'Scheduler ⚛' });
  const mark: MeasureEntry = { name: 'Update', entryType: 'mark' };
  const timeline = new Timeline([react, mark]);
  clearReactMeasures([react], timeline);
  assert.deepEqual(timeline.entries, [mark]);
});

test('installation releases existing React buffers before observing later measurements', () => {
  const initial = component();
  const keep = ordinary();
  const timeline = new Timeline([initial, keep]);
  const fixture = observerFixture();
  const polling = pollingFixture();
  const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: null, poll: polling.poll });
  assert.deepEqual(timeline.entries, [keep]);
  assert.deepEqual(fixture.current.options, { type: 'measure', buffered: true });
  assert.equal(polling.starts, 0);
  const later = component('TurnWorklog');
  timeline.entries.push(later);
  fixture.current.emit([later]);
  assert.deepEqual(timeline.entries, [keep]);
  stop();
});

test('continued render batches do not accumulate previously processed component records', () => {
  const keep = ordinary();
  const timeline = new Timeline([keep]);
  const fixture = observerFixture();
  const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: null });
  for (let index = 0; index < 500; index++) {
    const entry = unreadableDetail(`\u200bMessageItem${index % 3}`);
    timeline.entries.push(entry);
    fixture.current.emit([entry]);
    assert.deepEqual(timeline.entries, [keep]);
  }
  assert.equal(timeline.cleared.length, 500);
  stop();
});

test('visibility changes sweep buffered records and stop removes the page listener', t => {
  const page = new EventTarget();
  const add = t.mock.method(page, 'addEventListener');
  const remove = t.mock.method(page, 'removeEventListener');
  const timeline = new Timeline();
  const fixture = observerFixture();
  const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: page });
  const entry = component('BackgroundStream');
  timeline.entries.push(entry);
  page.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(timeline.entries, []);
  assert.equal(add.mock.calls[0].arguments[0], 'visibilitychange');
  stop();
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(remove.mock.calls[0].arguments[0], 'visibilitychange');
  assert.equal(remove.mock.calls[0].arguments[1], add.mock.calls[0].arguments[1]);
  timeline.entries.push(entry);
  page.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(timeline.entries, [entry]);
});

test('an unavailable PerformanceObserver uses a cancellable polling fallback', () => {
  const timeline = new Timeline();
  const polling = pollingFixture();
  const stop = installReactMeasureCleanup({ timeline, Observer: null, document: null, poll: polling.poll });
  assert.equal(polling.starts, 1);
  timeline.entries.push(component());
  polling.tick();
  assert.deepEqual(timeline.entries, []);
  stop(); stop();
  assert.equal(polling.stops, 1);
  const later = component();
  timeline.entries.push(later);
  polling.tick();
  assert.deepEqual(timeline.entries, [later]);
});

test('observation failure disconnects the partial observer before falling back', () => {
  const timeline = new Timeline();
  const fixture = observerFixture(true);
  const polling = pollingFixture();
  const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: null, poll: polling.poll });
  assert.equal(fixture.current.disconnects, 1);
  assert.equal(polling.starts, 1);
  timeline.entries.push(component());
  polling.tick();
  assert.deepEqual(timeline.entries, []);
  stop();
  assert.equal(fixture.current.disconnects, 1);
  assert.equal(polling.stops, 1);
});

test('stop is idempotent, releases observer queues, and ignores late observer callbacks', () => {
  const timeline = new Timeline();
  const fixture = observerFixture();
  const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: null });
  timeline.entries.push(component('Undelivered'));
  stop(); stop();
  assert.deepEqual(timeline.entries, []);
  assert.equal(fixture.current.disconnects, 1);
  assert.equal(fixture.current.drains, 1);
  const late = component('LateDelivery');
  timeline.entries.push(late);
  fixture.current.emit([late]);
  assert.deepEqual(timeline.entries, [late]);
});

test('missing or incomplete Performance APIs cause no observer, polling or page side effects', t => {
  const fixture = observerFixture();
  const polling = pollingFixture();
  const page = new EventTarget();
  const add = t.mock.method(page, 'addEventListener');
  const warn = t.mock.fn();
  const incomplete = { getEntriesByType() { throw new Error('Not supported'); } } as unknown as MeasureTimeline;
  for (const timeline of [null, incomplete]) {
    const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: page, poll: polling.poll, warn });
    assert.doesNotThrow(stop);
  }
  assert.equal(polling.starts, 0);
  assert.equal(fixture.count, 0);
  assert.equal(add.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 0);
});

test('cleanup errors warn once while later callbacks and disposal remain usable', t => {
  const timeline = new Timeline([component()]);
  const clear = t.mock.method(timeline, 'clearMeasures', () => { throw new Error('Synthetic cleanup failure'); });
  const fixture = observerFixture();
  const page = new EventTarget();
  const warn = t.mock.fn();
  const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: page, warn });
  assert.equal(warn.mock.callCount(), 1);
  assert.doesNotThrow(() => fixture.current.emit([component()]));
  assert.doesNotThrow(() => page.dispatchEvent(new Event('visibilitychange')));
  assert.doesNotThrow(stop);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(clear.mock.callCount(), 4);
});

test('a failed buffered read warns once without preventing subsequent observer cleanup', t => {
  const timeline = new Timeline([component()]);
  t.mock.method(timeline, 'getEntriesByType', () => { throw new Error('Synthetic unavailable buffer'); });
  const fixture = observerFixture();
  const warn = t.mock.fn();
  const stop = installReactMeasureCleanup({ timeline, Observer: fixture.Observer, document: null, warn });
  fixture.current.emit([component()]);
  assert.deepEqual(timeline.entries, []);
  assert.equal(warn.mock.callCount(), 1);
  assert.doesNotThrow(stop);
  assert.equal(warn.mock.callCount(), 1);
});
