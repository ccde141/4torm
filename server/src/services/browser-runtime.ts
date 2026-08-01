import { normalizeBrowserEngine, type BrowserEngine } from './browser-engine.js';
import type { BrowserDriver, BrowserDriverSession } from './browser-driver.js';
import type { BrowserSnapshot } from './browser-protocol.js';
import type { ObservationScope } from './execution-observation-contract.js';
import { executionObserver, type ExecutionObserver } from './execution-observer.js';
import { PlaywrightBrowserDriver, type BrowserLauncher, type BrowserLaunchResolver } from './playwright-browser-driver.js';
import { createBrowserDriverFromEnvironment } from './browser-driver-factory.js';
import { visualArtifactStore, type VisualArtifactStore } from './visual-artifact-store.js';

type BrowserEntry = { id: string; scope: ObservationScope; ownerId: string; surfaceId: string; session: BrowserDriverSession; revision: number };

export interface BrowserRuntimeInput {
  scope: ObservationScope;
  ownerId: string;
  surfaceId?: string;
  action: string;
  url?: string;
  targetId?: string;
  x?: string | number;
  y?: string | number;
  text?: string;
  key?: string;
  revision?: string | number;
  engine?: BrowserEngine;
  signal?: AbortSignal;
}

interface BrowserRuntimeDeps {
  observer?: ExecutionObserver;
  artifacts?: VisualArtifactStore;
  driver?: BrowserDriver;
  launch?: BrowserLauncher;
  resolveLaunch?: BrowserLaunchResolver;
}

export class BrowserRuntime {
  private readonly entries = new Map<string, BrowserEntry>();
  private readonly activeBySurface = new Map<string, string>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly observer: ExecutionObserver;
  private readonly artifacts: VisualArtifactStore;
  private readonly driver: BrowserDriver;

  constructor(deps: BrowserRuntimeDeps = {}) {
    this.observer = deps.observer ?? executionObserver;
    this.artifacts = deps.artifacts ?? visualArtifactStore;
    this.driver = deps.driver ?? new PlaywrightBrowserDriver({ launch: deps.launch, resolveLaunch: deps.resolveLaunch });
  }

  async execute(input: BrowserRuntimeInput): Promise<string> {
    throwIfAborted(input.signal);
    const action = parseAction(input.action);
    if (action === 'open') return (await this.openSession(input)).snapshot;
    const entry = this.requireCurrent(input.scope, input.ownerId, input.surfaceId);
    return this.enqueue(entry.id, input.signal, async () => {
      const changedExternally = await this.syncExternalChanges(entry, input.signal);
      this.assertAgentControl(entry);
      if (action === 'inspect') return this.capture(entry, 'Page inspected', 'agent', await abortable(entry.session.inspect(), input.signal));
      if (changedExternally) throw new Error('browser changed outside agent control; inspect required');
      this.assertRevision(entry, input.revision);
      if (action === 'wait') return this.wait(entry, input);
      return this.act(entry, action, input);
    });
  }

  async takeControl(id: string, scope: ObservationScope, ownerId: string): Promise<void> {
    const entry = this.require(id, scope, ownerId);
    await this.enqueue(entry.id, undefined, async () => { this.capture(entry, 'Human is controlling this surface', 'human', await entry.session.inspect()); });
  }

  async open(input: Omit<BrowserRuntimeInput, 'action'>): Promise<string> {
    return (await this.openSession({ ...input, action: 'open' })).id;
  }

  async returnControl(id: string, scope: ObservationScope, ownerId: string): Promise<void> {
    const entry = this.require(id, scope, ownerId);
    await this.enqueue(entry.id, undefined, async () => { this.capture(entry, 'Control returned to agent', 'agent', await entry.session.inspect()); });
  }

  async refresh(id: string, scope: ObservationScope, ownerId: string): Promise<void> {
    const entry = this.require(id, scope, ownerId);
    await this.enqueue(entry.id, undefined, async () => { await this.syncExternalChanges(entry); });
  }

  async close(id: string, scope?: ObservationScope, ownerId?: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (scope && ownerId && (entry.scope !== scope || entry.ownerId !== ownerId)) throw new Error('browser execution not found');
    const existing = this.closing.get(entry.id);
    if (existing) return existing;
    const closing = this.enqueue(entry.id, undefined, async () => { await this.closeEntry(entry); });
    this.closing.set(entry.id, closing);
    try { await closing; }
    finally { if (this.closing.get(entry.id) === closing) this.closing.delete(entry.id); }
  }

  private async openSession(input: BrowserRuntimeInput): Promise<{ id: string; snapshot: string }> {
    if (!input.url) throw new Error('browser open requires url');
    const surfaceId = normalizeSurfaceId(input.surfaceId);
    const existingId = this.activeBySurface.get(ownerKey(input.scope, input.ownerId, surfaceId));
    if (existingId) {
      const entry = this.require(existingId, input.scope, input.ownerId);
      const snapshot = await this.enqueue(entry.id, input.signal, async () => {
        const changedExternally = await this.syncExternalChanges(entry, input.signal);
        this.assertAgentControl(entry);
        if (changedExternally) throw new Error('browser changed outside agent control; inspect required');
        return this.capture(entry, 'Page loaded', 'agent', await abortable(entry.session.navigate(input.url!), input.signal));
      });
      return { id: entry.id, snapshot };
    }
    const engine = normalizeBrowserEngine(input.engine);
    if (!engine) throw new Error('Unsupported browser engine');
    const label = this.driver.presentation === 'embedded-visible'
      ? '4torm Browser'
      : engine === 'system-edge' ? 'Microsoft Edge' : 'Playwright Chromium';
    const run = this.observer.start({ scope: input.scope, ownerId: input.ownerId, surfaceId, command: `${label}: ${input.url}`, kind: 'browser', viewer: 'browser' });
    try {
      const opening = this.driver.open({ executionId: run.id, engine, url: input.url });
      const opened = await abortable(opening, input.signal).catch(error => {
        if (input.signal?.aborted) void opening.then(result => result.session.close()).catch(() => undefined);
        throw error;
      });
      if (input.signal?.aborted) {
        await opened.session.close();
        throw abortedError();
      }
      const entry = { id: run.id, scope: input.scope, ownerId: input.ownerId, surfaceId, session: opened.session, revision: 0 };
      this.entries.set(entry.id, entry);
      this.activeBySurface.set(ownerKey(input.scope, input.ownerId, surfaceId), entry.id);
      return { id: run.id, snapshot: this.capture(entry, 'Page loaded', 'agent', opened.snapshot) };
    } catch (error) {
      this.observer.finish(run.id, { status: input.signal?.aborted ? 'cancelled' : 'failed', error: (error as Error).message });
      throw error;
    }
  }

  private async wait(entry: BrowserEntry, input: BrowserRuntimeInput): Promise<string> {
    const ms = Number(input.text ?? 500);
    if (!Number.isInteger(ms) || ms < 1 || ms > 10_000) throw new Error('browser wait accepts 1-10000 milliseconds');
    return this.capture(entry, `Waited ${ms}ms`, 'agent', await abortable(entry.session.wait(ms), input.signal));
  }

  private async act(entry: BrowserEntry, action: 'click' | 'click_at' | 'type' | 'press', input: BrowserRuntimeInput): Promise<string> {
    const result = await abortable(entry.session.act({
      action,
      targetId: input.targetId,
      x: input.x === undefined ? undefined : Number(input.x),
      y: input.y === undefined ? undefined : Number(input.y),
      text: input.text,
      key: input.key,
    }), input.signal);
    return this.capture(entry, `Page ${action} ${result.outcome}`, 'agent', result.snapshot);
  }

  private capture(entry: BrowserEntry, summary: string, control: 'agent' | 'human', snapshot: BrowserSnapshot): string {
    this.artifacts.publish(entry.id, 'image/png', snapshot.frame);
    entry.revision += 1;
    const presentation = this.driver.presentation;
    this.observer.updateViewer(entry.id, {
      control,
      revision: entry.revision,
      summary: snapshot.title ? `${summary}: ${snapshot.title}` : summary,
      frameUpdatedAt: Date.now(),
      ...(presentation ? { presentation } : {}),
    });
    return formatSnapshot(entry, snapshot);
  }

  private async closeEntry(entry: BrowserEntry): Promise<void> {
    let failure: Error | undefined;
    try {
      await entry.session.close();
    } catch (error) {
      failure = error as Error;
    } finally {
      this.entries.delete(entry.id);
      const key = ownerKey(entry.scope, entry.ownerId, entry.surfaceId);
      if (this.activeBySurface.get(key) === entry.id) this.activeBySurface.delete(key);
      this.artifacts.remove(entry.id);
      this.observer.finish(entry.id, failure ? { status: 'failed', error: failure.message } : { status: 'cancelled' });
    }
    if (failure) throw failure;
  }

  private async syncExternalChanges(entry: BrowserEntry, signal?: AbortSignal): Promise<boolean> {
    const events = (await abortable(entry.session.drainEvents(), signal)).filter(event => event.source === 'human');
    if (!events.length) return false;
    const state = this.observer.get(entry.id)?.viewerState;
    const event = events.at(-1)!;
    this.capture(entry, `Human ${event.type}`, state?.control ?? 'agent', await abortable(entry.session.inspect(), signal));
    return true;
  }

  private requireCurrent(scope: ObservationScope, ownerId: string, surfaceId?: string): BrowserEntry {
    const id = this.activeBySurface.get(ownerKey(scope, ownerId, normalizeSurfaceId(surfaceId)));
    if (!id) throw new Error('browser session not found');
    return this.require(id, scope, ownerId);
  }

  private require(id: string, scope: ObservationScope, ownerId: string): BrowserEntry {
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== scope || entry.ownerId !== ownerId) throw new Error('browser execution not found');
    return entry;
  }

  private assertAgentControl(entry: BrowserEntry): void {
    if (this.observer.get(entry.id)?.viewerState?.control === 'human') throw new Error('browser is under human control');
  }

  private assertRevision(entry: BrowserEntry, value: BrowserRuntimeInput['revision']): void {
    if (Number(value) !== entry.revision) throw new Error(`stale browser revision: expected ${entry.revision}`);
  }

  private async enqueue<T>(id: string, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(id, current);
    const run = (async () => {
      await previous;
      try { throwIfAborted(signal); return await task(); }
      finally { release(); if (this.queues.get(id) === current) this.queues.delete(id); }
    })();
    return abortable(run, signal);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedError();
}

function abortedError(): Error {
  return new Error('browser action aborted');
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = () => fail(abortedError());
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => settle(resolve, value), fail);
  });
}

const validActions = new Set(['open', 'inspect', 'click', 'click_at', 'type', 'press', 'wait']);

function parseAction(value: string): 'open' | 'inspect' | 'click' | 'click_at' | 'type' | 'press' | 'wait' {
  if (!validActions.has(value)) throw new Error('unsupported browser action');
  return value as ReturnType<typeof parseAction>;
}

function ownerKey(scope: ObservationScope, ownerId: string, surfaceId: string): string {
  return `${scope}:${ownerId}:${surfaceId}`;
}

function normalizeSurfaceId(value: string | undefined): string {
  return value?.trim().slice(0, 64) || 'primary';
}

function formatSnapshot(entry: BrowserEntry, snapshot: BrowserSnapshot): string {
  const lines = [`sessionId: ${entry.id}`, `revision: ${entry.revision}`, `url: ${snapshot.url}`, snapshot.title ? `title: ${snapshot.title}` : '', snapshot.text ? `text: ${snapshot.text}` : '']
    .filter(Boolean);
  for (const target of snapshot.targets) {
    const bounds = target.bounds ? ` bounds=${target.bounds.x},${target.bounds.y},${target.bounds.width}x${target.bounds.height}` : '';
    lines.push(`[${target.id}] ${target.role}: ${target.name || '(unnamed)'}${bounds}`);
  }
  return lines.join('\n');
}

export const browserRuntime = new BrowserRuntime({ driver: createBrowserDriverFromEnvironment() });
