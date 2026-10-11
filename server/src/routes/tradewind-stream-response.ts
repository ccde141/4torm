import type { ServerResponse } from 'node:http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sseResponseHeaders } from '../utils/sse.js';
import type { PreparedTradewindEventStream } from '../modules/tradewind/public.js';

const MAX_PENDING_BYTES = 256 * 1024;

export function openTradewindStream(
  request: FastifyRequest, reply: FastifyReply, prepared: PreparedTradewindEventStream,
): void {
  reply.hijack();
  const raw = reply.raw;
  let closed = false;
  let ready = false;
  let queuedBytes = 0;
  const queued: string[] = [];
  let unsubscribe: () => void = () => undefined;
  let cancelReplay: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const writer = boundedWriter(raw, error => close(error));
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    cancelReplay();
    writer.dispose();
    unsubscribe();
  };
  const close = (error: Error) => { cleanup(); raw.destroy(error); };
  const send = (event: Record<string, unknown>) => {
    if (closed) return;
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    if (ready) writer.write(frame);
    else {
      queuedBytes += Buffer.byteLength(frame);
      if (queuedBytes > MAX_PENDING_BYTES) close(new Error('信风 SSE 初始事件积压过多'));
      else queued.push(frame);
    }
  };
  raw.once('close', cleanup);
  try {
    raw.writeHead(200, sseResponseHeaders(request.raw.httpVersionMajor, request.headers.origin));
    writer.write('\n');
    const subscribed = prepared.subscribe(send);
    unsubscribe = subscribed;
    if (closed) { subscribed(); return; }
    cancelReplay = replaySnapshots(prepared.snapshots(), raw, writer,
      () => closed, () => {
        ready = true;
        for (const frame of queued) {
          writer.write(frame);
          if (closed) break;
        }
        queued.length = 0;
        if (closed) return;
        heartbeat = setInterval(() => {
          if (!writer.backpressured()) writer.write(': heartbeat\n\n');
        }, 15_000);
      }, close);
  } catch (error) {
    close(error instanceof Error ? error : new Error(String(error)));
  }
}

/** 快照可能远大于实时积压上限，逐条等 drain，避免健康连接因快照过大被断开。 */
function replaySnapshots(
  snapshots: Record<string, unknown>[], raw: ServerResponse,
  writer: ReturnType<typeof boundedWriter>, isClosed: () => boolean,
  complete: () => void, fail: (error: Error) => void,
): () => void {
  let index = 0;
  const pump = () => {
    try {
      while (!isClosed() && index < snapshots.length) {
        if (writer.backpressured()) { raw.once('drain', pump); return; }
        const frame = `data: ${JSON.stringify(snapshots[index++])}\n\n`;
        if (!writer.write(frame)) {
          if (!isClosed()) raw.once('drain', pump);
          return;
        }
      }
      if (!isClosed()) complete();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  };
  pump();
  return () => raw.removeListener('drain', pump);
}

function boundedWriter(raw: ServerResponse, overflow: (error: Error) => void) {
  let blocked = false;
  let disposed = false;
  let pendingBytes = 0;
  let pending: string[] = [];
  const drain = () => {
    blocked = false;
    const backlog = pending;
    pending = [];
    pendingBytes = 0;
    for (const frame of backlog) write(frame);
  };
  const write = (frame: string) => {
    if (disposed) return false;
    if (blocked) {
      pendingBytes += Buffer.byteLength(frame);
      if (pendingBytes > MAX_PENDING_BYTES) overflow(new Error('信风 SSE 客户端消费过慢'));
      else pending.push(frame);
      return false;
    }
    try {
      if (!raw.write(frame)) {
        blocked = true;
        raw.once('drain', drain);
        return false;
      }
    } catch (error) {
      overflow(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
    return true;
  };
  return {
    write,
    backpressured: () => blocked,
    dispose: () => {
      disposed = true;
      pending = [];
      raw.removeListener('drain', drain);
    },
  };
}
