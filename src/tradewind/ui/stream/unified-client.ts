/**
 * 信风统一 SSE 客户端
 *
 * 浏览器同域最多 6 条 HTTP 连接。每个面板一条 SSE 太浪费。
 * 这个模块维护一条到 /api/tradewind/stream 的 SSE 连接，
 * 按 { scope, nodeId } 分发事件给注册的监听器。
 *
 * 用法：
 *   subscribe(nodeId, handler) — 注册监听
 *   unsubscribe(nodeId, handler) — 取消监听
 *   connect() — 建立连接（首次 subscribe 时自动调用）
 *   disconnect() — 断开（所有 listener 清空时自动调用）
 */

type EventHandler = (ev: any) => void;

const listeners = new Map<string, Set<EventHandler>>();
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let abortCtrl: AbortController | null = null;
let connecting = false;

/** 注册某个 nodeId 的事件监听器 */
export function subscribe(nodeId: string, handler: EventHandler): void {
  let set = listeners.get(nodeId);
  if (!set) {
    set = new Set();
    listeners.set(nodeId, set);
  }
  set.add(handler);
  // 首次有 listener 时自动连接
  if (!reader && !connecting) connect();
}

/** 取消监听 */
export function unsubscribe(nodeId: string, handler: EventHandler): void {
  const set = listeners.get(nodeId);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) listeners.delete(nodeId);
  // 所有 listener 清空时断开
  if (listeners.size === 0) disconnect();
}

/** 建立 SSE 连接 */
async function connect(): Promise<void> {
  if (connecting || reader) return;
  connecting = true;
  abortCtrl = new AbortController();

  try {
    const res = await fetch('/api/tradewind/stream', { signal: abortCtrl.signal });
    if (!res.ok || !res.body) { connecting = false; return; }

    reader = res.body.getReader();
    connecting = false;
    readLoop();
  } catch {
    connecting = false;
    // 断线重连（1s 后）
    if (listeners.size > 0) setTimeout(connect, 1000);
  }
}

/** 断开连接 */
function disconnect(): void {
  abortCtrl?.abort();
  abortCtrl = null;
  reader = null;
}

/** 读取循环 */
async function readLoop(): Promise<void> {
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json) continue;

        let ev: any;
        try { ev = JSON.parse(json); } catch { continue; }

        const nodeId = ev.nodeId;
        if (!nodeId) continue;

        const set = listeners.get(nodeId);
        if (set) {
          for (const handler of set) handler(ev);
        }
      }
    }
  } catch {
    // 连接断了
  } finally {
    reader = null;
    // 还有 listener 就重连
    if (listeners.size > 0) setTimeout(connect, 1000);
  }
}
