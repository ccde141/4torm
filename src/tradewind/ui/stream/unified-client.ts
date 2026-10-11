/**
 * Tradewind 共享 SSE 客户端。
 * 统一维护 /api/tradewind/stream，按 nodeId 分发事件。
 */

import {
  DEFAULT_LOCALE, readStoredLocale, resolveMessage,
  type Locale, type MessageKey, type MessageValues,
} from '../../../i18n/locale';
import { errorFromResponse, type FrameworkErrorKind } from '../../../api/error-contract';
import { streamUrl } from '../../../lib/apiBase';

type EventHandler = (event: any) => void;

const listeners = new Map<string, Set<EventHandler>>();
const allListeners = new Set<EventHandler>();
let abortController: AbortController | null = null;
let connecting = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let transportDisconnected = false;

function hasNoListeners(): boolean {
  return listeners.size === 0 && allListeners.size === 0;
}

export function subscribeAll(handler: EventHandler): void {
  allListeners.add(handler);
  ensureConnected();
}

export function unsubscribeAll(handler: EventHandler): void {
  allListeners.delete(handler);
  if (hasNoListeners()) disconnect();
}

export function subscribe(nodeId: string, handler: EventHandler): void {
  let handlers = listeners.get(nodeId);
  if (!handlers) {
    handlers = new Set();
    listeners.set(nodeId, handlers);
  }
  handlers.add(handler);
  ensureConnected();
}

export function unsubscribe(nodeId: string, handler: EventHandler): void {
  const handlers = listeners.get(nodeId);
  if (!handlers) return;
  handlers.delete(handler);
  if (handlers.size === 0) listeners.delete(nodeId);
  if (hasNoListeners()) disconnect();
}

function ensureConnected(): void {
  if (!abortController && !connecting && !retryTimer && !hasNoListeners()) void connect();
}

function scheduleReconnect(): void {
  if (retryTimer || hasNoListeners()) return;
  const delay = Math.min(250 * 2 ** Math.min(retryCount++, 5), 5000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    ensureConnected();
  }, delay);
}

async function connect(): Promise<void> {
  if (connecting || abortController) return;
  connecting = true;
  const controller = new AbortController();
  abortController = controller;
  let failed = false;
  try {
    const response = await fetch(streamUrl('/api/tradewind/stream'), { signal: controller.signal });
    connecting = false;
    const onActivity = () => {
      if (transportDisconnected) {
        transportDisconnected = false;
        dispatchTransportEvent({ type: 'transport-reconnected' });
      }
      retryCount = 0;
    };
    await readUnifiedSSE(response, event => {
      onActivity();
      dispatchEvent(event);
    }, controller.signal, onActivity);
  } catch (error) {
    if (!controller.signal.aborted) {
      failed = true;
      transportDisconnected = true;
      dispatchConnectionError(error);
    }
  } finally {
    connecting = false;
    if (abortController === controller) abortController = null;
    // 订阅者可能在旧连接的 abort 尚未结束时重新挂载（例如 StrictMode）。
    if (controller.signal.aborted && !hasNoListeners()) ensureConnected();
    else if (failed) scheduleReconnect();
  }
}

function disconnect(): void {
  abortController?.abort();
  abortController = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryCount = 0;
  transportDisconnected = false;
}

function dispatchEvent(event: any): void {
  for (const handler of allListeners) handler(event);
  if (!event.nodeId) return;
  for (const handler of listeners.get(event.nodeId) ?? []) handler(event);
}

function dispatchTransportEvent(event: { type: string; message?: string; code?: string; kind?: FrameworkErrorKind }): void {
  for (const handler of allListeners) handler(event);
  for (const handlers of listeners.values()) {
    for (const handler of handlers) handler(event);
  }
}

function dispatchConnectionError(error: unknown): void {
  for (const event of connectionFailureEvents(error)) dispatchTransportEvent(event);
}

function currentLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    return readStoredLocale(window.localStorage);
  } catch {
    return DEFAULT_LOCALE;
  }
}

function streamMessage(key: MessageKey, values?: MessageValues): string {
  return resolveMessage(currentLocale(), key, values);
}

export function connectionFailureEvents(
  error: unknown,
  locale: Locale = currentLocale(),
): Array<{ type: string; message?: string; code?: string; kind?: FrameworkErrorKind }> {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    {
      type: 'transport-disconnected',
      message: resolveMessage(locale, 'tradewind.stream.disconnected', { detail }),
      code: 'STREAM_DISCONNECTED',
      kind: 'protocol',
    },
  ];
}

function parseLine(line: string, onEvent: EventHandler, onComment?: () => void): void {
  if (line.startsWith(':')) {
    onComment?.();
    return;
  }
  if (!line.startsWith('data: ')) return;
  const json = line.slice(6).trim();
  if (!json) return;
  onEvent(JSON.parse(json));
}

export async function readUnifiedSSE(
  response: Response,
  onEvent: EventHandler,
  signal?: AbortSignal,
  onComment?: () => void,
): Promise<void> {
  if (!response.ok) {
    throw await errorFromResponse(response, streamMessage('tradewind.stream.requestFailed', { status: response.status }));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(streamMessage('tradewind.stream.missingBody'));
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal?.aborted) return;
    while (true) {
      if (signal?.aborted) return;
      const chunk = await reader.read();
      if (signal?.aborted) return;
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) parseLine(line, onEvent, onComment);
    }
    buffer += decoder.decode();
    if (buffer) for (const line of buffer.split('\n')) parseLine(line, onEvent, onComment);
    throw new Error(streamMessage('tradewind.stream.unexpectedEnd'));
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
