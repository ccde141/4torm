/**
 * Tradewind 共享 SSE 客户端。
 * 统一维护 /api/tradewind/stream，按 nodeId 分发事件。
 */

type EventHandler = (event: any) => void;

const listeners = new Map<string, Set<EventHandler>>();
const allListeners = new Set<EventHandler>();
let abortController: AbortController | null = null;
let connecting = false;

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
  if (!abortController && !connecting) void connect();
}

async function connect(): Promise<void> {
  if (connecting || abortController) return;
  connecting = true;
  const controller = new AbortController();
  abortController = controller;
  try {
    const response = await fetch('/api/tradewind/stream', { signal: controller.signal });
    connecting = false;
    await readUnifiedSSE(response, dispatchEvent, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) dispatchConnectionError(error);
  } finally {
    connecting = false;
    if (abortController === controller) abortController = null;
  }
}

function disconnect(): void {
  abortController?.abort();
  abortController = null;
}

function dispatchEvent(event: any): void {
  for (const handler of allListeners) handler(event);
  if (!event.nodeId) return;
  for (const handler of listeners.get(event.nodeId) ?? []) handler(event);
}

function dispatchConnectionError(error: unknown): void {
  for (const event of connectionFailureEvents(error)) {
    for (const handler of allListeners) handler(event);
    for (const handlers of listeners.values()) {
      for (const handler of handlers) handler(event);
    }
  }
}

export function connectionFailureEvents(error: unknown): Array<{ type: string; message?: string }> {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    { type: 'error', message: `信风实时连接已中断：${detail}` },
    { type: 'done' },
  ];
}

function parseLine(line: string, onEvent: EventHandler): void {
  if (!line.startsWith('data: ')) return;
  const json = line.slice(6).trim();
  if (!json) return;
  try {
    onEvent(JSON.parse(json));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
}

export async function readUnifiedSSE(
  response: Response,
  onEvent: EventHandler,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.ok) throw new Error(`SSE 连接失败：HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE 响应缺少数据流');
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) parseLine(line, onEvent);
  }

  buffer += decoder.decode();
  if (buffer) for (const line of buffer.split('\n')) parseLine(line, onEvent);
  throw new Error('SSE 连接意外中断');
}
