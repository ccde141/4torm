export const PREVIEW_MARGIN_PX = 160;
export const MAX_ACTIVE_PREVIEWS = 12;

interface Intersection {
  target: Element;
  isIntersecting: boolean;
}
interface Observer {
  observe(target: Element): void;
  unobserve(target: Element): void;
  disconnect(): void;
}
type Rect = Pick<DOMRectReadOnly, 'top' | 'bottom' | 'left' | 'right' | 'width' | 'height'>;
export interface PreviewVisibilityEnvironment {
  observer(notify: (entries: Intersection[]) => void): Observer | null;
  changes(notify: () => void): () => void;
  schedule(refresh: () => void): number;
  cancel(id: number): void;
  pageVisible(): boolean;
  hasLayout(target: Element): boolean;
  rect(target: Element): Rect;
  viewport(): { width: number; height: number };
}
interface Watched {
  intersects: boolean;
  active: boolean;
  listeners: Map<(active: boolean) => void, { priority: number; onHidden?: () => void; notified?: boolean }>;
}
interface WatchOptions { priority?: number; onHidden?: () => void }

/** One observer and a finite decoded-preview allowance, shared across every feature island. */
export function createPreviewVisibilityRegistry(env: PreviewVisibilityEnvironment) {
  const watched = new Map<Element, Watched>();
  let observer: Observer | null = null;
  let disposeChanges: (() => void) | undefined;
  let frame: number | undefined;
  let started = false;

  function publish(allowed: Set<Element>) {
    for (const [target, item] of watched) {
      const active = allowed.has(target);
      if (active === item.active) continue;
      item.active = active;
      for (const listener of item.listeners.keys()) listener(active);
    }
  }
  function refresh() {
    frame = undefined;
    const candidates: Array<{ target: Element; distance: number; priority: number }> = [];
    const viewport = env.viewport();
    if (env.pageVisible()) for (const [target, item] of watched) {
      const subscriptions = [...item.listeners.values()];
      if (!item.intersects && !subscriptions.some(value => value.onHidden)) continue;
      const rendered = env.hasLayout(target);
      for (const subscription of subscriptions) {
        if (!rendered && !subscription.notified) { subscription.notified = true; subscription.onHidden?.(); }
        else if (rendered) subscription.notified = false;
      }
      if (!item.intersects || !rendered) continue;
      const rect = env.rect(target);
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < -PREVIEW_MARGIN_PX
        || rect.top > viewport.height + PREVIEW_MARGIN_PX || rect.right < -PREVIEW_MARGIN_PX
        || rect.left > viewport.width + PREVIEW_MARGIN_PX) continue;
      const visible = rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width;
      candidates.push({ target, priority: Math.max(0, ...subscriptions.map(value => value.priority)),
        distance: (visible ? 0 : 1_000_000)
        + Math.abs((rect.top + rect.bottom) / 2 - viewport.height / 2) });
    }
    candidates.sort((left, right) => right.priority - left.priority || left.distance - right.distance);
    publish(new Set(candidates.slice(0, MAX_ACTIVE_PREVIEWS).map(item => item.target)));
  }
  function schedule() {
    if (!watched.size) return;
    if (!env.pageVisible()) { publish(new Set()); return; }
    if (frame === undefined) frame = env.schedule(refresh);
  }
  function start() {
    if (started) return;
    started = true;
    observer = env.observer(entries => {
      for (const entry of entries) {
        const item = watched.get(entry.target);
        if (item) item.intersects = entry.isIntersecting;
      }
      schedule();
    });
    // Unsupported visibility observation keeps only the explicit original-image link.
    if (observer) disposeChanges = env.changes(schedule);
  }
  function stop() {
    observer?.disconnect(); observer = null;
    disposeChanges?.(); disposeChanges = undefined;
    if (frame !== undefined) env.cancel(frame);
    frame = undefined; started = false;
  }
  return {
    observe(target: Element, listener: (active: boolean) => void, options: WatchOptions = {}) {
      start();
      let item = watched.get(target);
      if (!item) {
        item = { intersects: false, active: false, listeners: new Map() };
        watched.set(target, item); observer?.observe(target);
      }
      item.listeners.set(listener, { priority: options.priority ?? 0, onHidden: options.onHidden });
      listener(item.active);
      if (options.onHidden) schedule();
      return () => {
        item.listeners.delete(listener);
        if (!item.listeners.size) { watched.delete(target); observer?.unobserve(target); }
        if (!watched.size) stop();
        else schedule();
      };
    },
  };
}

let shared: ReturnType<typeof createPreviewVisibilityRegistry> | undefined;
export function observePreviewVisibility(target: Element, listener: (active: boolean) => void, options: WatchOptions = {}) {
  shared ??= createPreviewVisibilityRegistry(browserEnvironment());
  return shared.observe(target, listener, options);
}

function browserEnvironment(): PreviewVisibilityEnvironment {
  return {
    observer: notify => typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver(entries => notify(entries), { rootMargin: `${PREVIEW_MARGIN_PX}px`, threshold: 0 }),
    changes: notify => {
      const mutations = new MutationObserver(notify);
      mutations.observe(document.documentElement, { subtree: true, attributes: true,
        attributeFilter: ['hidden', 'style', 'class', 'open'] });
      document.addEventListener('visibilitychange', notify);
      window.addEventListener('scroll', notify, true);
      window.addEventListener('resize', notify);
      return () => { mutations.disconnect();
        document.removeEventListener('visibilitychange', notify);
        window.removeEventListener('scroll', notify, true); window.removeEventListener('resize', notify); };
    },
    schedule: refresh => requestAnimationFrame(refresh), cancel: id => cancelAnimationFrame(id),
    pageVisible: () => !document.hidden,
    hasLayout: target => !target.closest('[hidden],details:not([open])') && target.getClientRects().length > 0
      && !['hidden', 'collapse'].includes(getComputedStyle(target).visibility),
    rect: target => target.getBoundingClientRect(),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  };
}
