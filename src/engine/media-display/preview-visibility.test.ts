import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewVisibilityRegistry, MAX_ACTIVE_PREVIEWS,
  observePreviewVisibility, type PreviewVisibilityEnvironment } from './preview-visibility';

function fixture(observerAvailable = true) {
  const rectangles = new Map<Element, { top: number; bottom: number; left: number; right: number; width: number; height: number }>();
  const hidden = new Set<Element>();
  const observed = new Set<Element>();
  const jobs = new Map<number, () => void>();
  let notify: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void = () => {};
  let changed = () => {};
  let next = 0, constructions = 0, disposals = 0, watchers = 0, pageVisible = true;
  const env: PreviewVisibilityEnvironment = {
    observer: callback => {
      constructions++; notify = callback;
      return observerAvailable ? { observe: target => { observed.add(target); },
        unobserve: target => { observed.delete(target); }, disconnect: () => { disposals++; observed.clear(); } } : null;
    },
    changes: callback => { watchers++; changed = callback; return () => { watchers--; }; },
    schedule: callback => { jobs.set(++next, callback); return next; }, cancel: id => { jobs.delete(id); },
    pageVisible: () => pageVisible, hasLayout: target => !hidden.has(target), rect: target => rectangles.get(target)!,
    viewport: () => ({ width: 1_000, height: 800 }),
  };
  return { registry: createPreviewVisibilityRegistry(env), hidden, observed,
    target: (top: number) => {
      const target = {} as Element;
      rectangles.set(target, { top, bottom: top + 40, left: 20, right: 60, width: 40, height: 40 });
      return target;
    },
    intersect: (targets: Element[], value = true) => notify(targets.map(target => ({ target, isIntersecting: value }))),
    layout: () => changed(), page: (visible: boolean) => { pageVisible = visible; changed(); },
    flush: () => { const pending = [...jobs.values()]; jobs.clear(); for (const job of pending) job(); },
    counts: () => ({ constructions, disposals, watchers, jobs: jobs.size }),
  };
}

test('one observer shares a finite preview allowance and prefers visible images over preload candidates', () => {
  const f = fixture();
  const near = f.target(-120);
  const targets = Array.from({ length: 30 }, (_, index) => f.target(200 + index * 3));
  const active = new Set<Element>();
  const cleanup = [near, ...targets].map(target => f.registry.observe(target,
    visible => { if (visible) active.add(target); else active.delete(target); }));
  assert.equal(f.counts().constructions, 1);
  assert.equal(f.counts().watchers, 1);
  assert.equal(active.size, 0);
  f.intersect([near, ...targets]); f.flush();
  assert.equal(active.size, MAX_ACTIVE_PREVIEWS);
  assert.equal(active.has(near), false);
  for (const dispose of cleanup) dispose();
  assert.deepEqual(f.counts(), { constructions: 1, disposals: 1, watchers: 0, jobs: 0 });
});

test('leaving the viewport, a hidden ancestor and a background page release active previews', () => {
  const f = fixture();
  const target = f.target(100);
  const values: boolean[] = [];
  const dispose = f.registry.observe(target, value => values.push(value));
  f.intersect([target]); f.flush(); assert.equal(values.at(-1), true);
  f.intersect([target], false); f.flush(); assert.equal(values.at(-1), false);
  f.intersect([target]); f.flush(); assert.equal(values.at(-1), true);
  f.hidden.add(target); f.layout(); f.flush(); assert.equal(values.at(-1), false);
  f.hidden.delete(target); f.layout(); f.flush(); assert.equal(values.at(-1), true);
  f.page(false); assert.equal(values.at(-1), false); // No animation frame is needed in a hidden document.
  f.page(true); f.flush(); assert.equal(values.at(-1), true);
  dispose();
});

test('unmount disconnects shared resources and ignores late intersection deliveries', () => {
  const f = fixture();
  const target = f.target(100);
  const values: boolean[] = [];
  const dispose = f.registry.observe(target, value => values.push(value));
  f.intersect([target]); f.flush();
  dispose();
  const before = [...values];
  f.intersect([target]); f.flush();
  assert.deepEqual(values, before);
  assert.equal(f.observed.size, 0);
  assert.deepEqual(f.counts(), { constructions: 1, disposals: 1, watchers: 0, jobs: 0 });
});

test('without visibility observation no original or preview image is activated implicitly', () => {
  const f = fixture(false);
  const values: boolean[] = [];
  const dispose = f.registry.observe(f.target(100), value => values.push(value));
  f.layout(); f.flush();
  assert.deepEqual(values, [false]);
  assert.equal(f.counts().watchers, 0);
  dispose();
});

test('owner hiding is separate from scrolling and the finite preview admission budget', () => {
  const f = fixture();
  const owner = f.target(2_000);
  let hidden = 0;
  const dispose = f.registry.observe(owner, () => {}, { onHidden: () => { hidden++; } });
  f.flush(); assert.equal(hidden, 0); // Offscreen is not hidden.
  f.intersect([owner], false); f.flush(); assert.equal(hidden, 0);
  f.page(false); assert.equal(hidden, 0); // The viewer releases bytes independently while backgrounded.
  f.page(true); f.flush(); assert.equal(hidden, 0);
  f.hidden.add(owner); f.layout(); f.flush(); assert.equal(hidden, 1);
  f.layout(); f.flush(); assert.equal(hidden, 1);
  dispose();
});

test('a deliberately opened image takes precedence over thumbnail preload admission', () => {
  const f = fixture();
  const active = new Set<Element>();
  const thumbnails = Array.from({ length: MAX_ACTIVE_PREVIEWS }, () => f.target(380));
  const viewer = f.target(300);
  const listen = (target: Element) => (visible: boolean) => { if (visible) active.add(target); else active.delete(target); };
  const cleanup = thumbnails.map(target => f.registry.observe(target, listen(target)));
  cleanup.push(f.registry.observe(viewer, listen(viewer), { priority: 1 }));
  f.intersect([...thumbnails, viewer]); f.flush();
  assert.equal(active.size, MAX_ACTIVE_PREVIEWS);
  assert.equal(active.has(viewer), true);
  for (const dispose of cleanup) dispose();
});

test('browser adapter preserves the native cancellation receiver when the final image unmounts before its frame', () => {
  // This receiver check guards the binding regression; actual DOM/observer behavior is also browser-tested.
  const names = ['window', 'document', 'IntersectionObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let notify!: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
  let cancelled: number | undefined;
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, value });
  try {
    define('window', { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} });
    define('document', { hidden: false, documentElement: {}, addEventListener() {}, removeEventListener() {} });
    define('IntersectionObserver', class {
      constructor(callback: typeof notify) { notify = callback; }
      observe() {} unobserve() {} disconnect() {}
    });
    define('MutationObserver', class { observe() {} disconnect() {} });
    define('requestAnimationFrame', () => 42);
    define('cancelAnimationFrame', function (this: unknown, frame: number) {
      assert.ok(this === undefined || this === globalThis, 'Unbound browser method received the environment object');
      cancelled = frame;
    });
    const target = {} as Element;
    const dispose = observePreviewVisibility(target, () => {});
    notify([{ target, isIntersecting: true }]);
    dispose();
    assert.equal(cancelled, 42);
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
