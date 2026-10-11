import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { useCycloneCatalog } from './useCycloneCatalog.js';
import { useWorkshopDispatches } from './useWorkshopDispatches.js';

type EffectSlot = { deps: readonly unknown[]; cleanup?: () => void };
type CallbackSlot = { deps: readonly unknown[]; callback: unknown };
type ReactInternals = { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown } };
const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

function mountHook<T>(hook: () => T) {
  const internals = (React as unknown as ReactInternals)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  const slots: unknown[] = [];
  let index = 0;
  let effects: Array<() => void> = [];
  const dispatcher = {
    useContext: () => ({ t: (key: string) => key }),
    useRef: (initial: unknown) => {
      const slot = index++;
      if (slot >= slots.length) slots.push({ current: initial });
      return slots[slot];
    },
    useState: (initial: unknown) => {
      const slot = index++;
      if (slot >= slots.length) slots.push({ value: initial });
      const state = slots[slot] as { value: unknown };
      return [state.value, (value: unknown) => {
        state.value = typeof value === 'function'
          ? (value as (current: unknown) => unknown)(state.value) : value;
      }];
    },
    useCallback: (callback: unknown, deps: readonly unknown[]) => {
      const slot = index++;
      const prior = slots[slot] as CallbackSlot | undefined;
      if (!prior || !sameDeps(prior.deps, deps)) slots[slot] = { callback, deps };
      return (slots[slot] as CallbackSlot).callback;
    },
    useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
      const slot = index++;
      const prior = slots[slot] as EffectSlot | undefined;
      if (prior && sameDeps(prior.deps, deps)) return;
      effects.push(() => { prior?.cleanup?.(); slots[slot] = { deps, cleanup: effect() }; });
    },
  };
  const render = (): T => {
    index = 0;
    effects = [];
    internals.H = dispatcher;
    let result: T;
    try { result = hook(); } finally { internals.H = previous; }
    effects.forEach(run => run());
    return result;
  };
  return { render, cleanup() {
    for (const slot of slots) (slot as EffectSlot | undefined)?.cleanup?.();
    internals.H = previous;
  } };
}

function fakeBrowser() {
  const previous = {
    window: globalThis.window, EventSource: globalThis.EventSource, fetch: globalThis.fetch,
  };
  let nextTimer = 1;
  let now = 0;
  const timers = new Map<number, { due: number; repeat: number; run: () => void }>();
  const schedule = (run: () => void, delay: number, repeat: number) => {
    const id = nextTimer++;
    timers.set(id, { due: now + delay, repeat, run });
    return id;
  };
  const sources: FakeEventSource[] = [];
  class FakeEventSource {
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    constructor() { sources.push(this); }
    close() {}
  }
  Object.assign(globalThis, {
    window: {
      setTimeout: (run: () => void, delay: number) => schedule(run, delay, 0),
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: (run: () => void, delay: number) => schedule(run, delay, delay),
      clearInterval: (id: number) => timers.delete(id),
      addEventListener() {}, removeEventListener() {},
    },
    EventSource: FakeEventSource,
  });
  return {
    change(workshopId: string, scope: 'workshop' | 'dispatch') {
      sources.at(-1)?.onmessage?.({ data: JSON.stringify({ type: 'change', workshopId, scope, revision: 1 }) });
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due > now) continue;
        if (timer.repeat) timer.due += timer.repeat;
        else timers.delete(id);
        timer.run();
      }
    },
    restore() { Object.assign(globalThis, previous); },
  };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('工作室目录的慢请求仍能更新快照，完成后才安排下次兜底轮询', async () => {
  const browser = fakeBrowser();
  const pending: Array<(response: Response) => void> = [];
  globalThis.fetch = (async input => {
    if (String(input) === '/api/cyclone/list') {
      return new Promise<Response>(resolve => pending.push(resolve));
    }
    if (String(input) === '/api/agents') return Response.json([]);
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const mounted = mountHook(() => useCycloneCatalog(true));
  try {
    mounted.render();
    assert.equal(pending.length, 1);
    browser.advance(2_000);
    assert.equal(pending.length, 1);
    pending[0](Response.json([{ id: 'w1' }]));
    await flush();
    assert.deepEqual(mounted.render().workshops, [{ id: 'w1' }]);
    browser.advance(2_000);
    assert.equal(pending.length, 2);
  } finally { mounted.cleanup(); browser.restore(); }
});

test('派发列表的慢请求仍能更新快照，完成后才安排下次兜底轮询', async () => {
  const browser = fakeBrowser();
  const pending: Array<(response: Response) => void> = [];
  globalThis.fetch = (() => new Promise<Response>(resolve => pending.push(resolve))) as typeof fetch;
  const mounted = mountHook(() => useWorkshopDispatches('w1', true));
  try {
    mounted.render();
    assert.equal(pending.length, 1);
    browser.advance(2_000);
    assert.equal(pending.length, 1);
    pending[0](Response.json([{ id: 'd1' }]));
    await flush();
    assert.deepEqual(mounted.render().dispatches, [{ id: 'd1' }]);
    browser.advance(2_000);
    assert.equal(pending.length, 2);
  } finally { mounted.cleanup(); browser.restore(); }
});

test('SSE 仍触发目录刷新，旧响应不能覆盖新快照', async () => {
  const browser = fakeBrowser();
  const pending: Array<(response: Response) => void> = [];
  globalThis.fetch = (async input => String(input) === '/api/cyclone/list'
    ? new Promise<Response>(resolve => pending.push(resolve))
    : String(input) === '/api/agents' ? Response.json([]) : new Response('{}', { status: 404 })) as typeof fetch;
  const mounted = mountHook(() => useCycloneCatalog(true));
  try {
    mounted.render();
    browser.change('w1', 'workshop');
    assert.equal(pending.length, 2);
    pending[1](Response.json([{ id: 'new' }]));
    await flush();
    pending[0](Response.json([{ id: 'old' }]));
    await flush();
    assert.deepEqual(mounted.render().workshops, [{ id: 'new' }]);
  } finally { mounted.cleanup(); browser.restore(); }
});

test('派发 SSE 刷新和工作室切换都隔离旧响应', async () => {
  const browser = fakeBrowser();
  const pending: Array<{ url: string; resolve: (response: Response) => void }> = [];
  globalThis.fetch = (input => new Promise<Response>(resolve => {
    pending.push({ url: String(input), resolve });
  })) as typeof fetch;
  let workshopId = 'w1';
  const mounted = mountHook(() => useWorkshopDispatches(workshopId, true));
  try {
    mounted.render();
    browser.change('w2', 'dispatch');
    assert.equal(pending.length, 1);
    browser.change('w1', 'dispatch');
    assert.equal(pending.length, 2);
    pending[1].resolve(Response.json([{ id: 'new-w1' }]));
    await flush();
    pending[0].resolve(Response.json([{ id: 'old-w1' }]));
    await flush();
    assert.deepEqual(mounted.render().dispatches, [{ id: 'new-w1' }]);
    workshopId = 'w2';
    assert.deepEqual(mounted.render().dispatches, []);
    assert.match(pending[2].url, /\/workshop\/w2\/dispatches$/);
    pending[2].resolve(Response.json([{ id: 'w2' }]));
    await flush();
    assert.deepEqual(mounted.render().dispatches, [{ id: 'w2' }]);
  } finally { mounted.cleanup(); browser.restore(); }
});
