/**
 * 事件总线 —— emit 事件 + append 写 events.jsonl + SSE 推送
 *
 * 同一实例的写入串行执行；写入成功后才向 SSE 订阅者推送。
 * 旧严格流保留尽力记录；条件交接 required 模式向调用方真实抛错，失败后禁止后续事实越过它。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { EventLog } from './types';
import { frameworkError, FrameworkError } from '../../shared/framework-error.js';

/** SSE 订阅者句柄 */
interface SSESubscriber {
  res: ServerResponse;
  closed: boolean;
}

/**
 * 单次执行的事件总线实例。
 *
 * 每次工作流执行新建一个实例，不跨 execution 复用。
 */
export class EventBus {
  private readonly eventsFile: string;
  private readonly subscribers = new Set<SSESubscriber>();
  private writeQueue: Promise<void> = Promise.resolve();
  private writeFailure: unknown;

  constructor(eventsFile: string, private readonly required = false) {
    this.eventsFile = eventsFile;
  }

  /**
   * 串行写入事件文件；成功后推送。required 模式 await emit 可观察到持久化失败。
   */
  emit(log: EventLog): Promise<void> {
    const line = JSON.stringify(log) + '\n';
    const committed = this.writeQueue.then(async () => {
      if (this.required && this.writeFailure) throw this.writeFailure;
      await fs.mkdir(path.dirname(this.eventsFile), { recursive: true });
      await fs.appendFile(this.eventsFile, line, 'utf-8');
      this.broadcast(line);
    }).catch(error => {
      if (!this.required || error instanceof FrameworkError) throw error;
      throw frameworkError({ code: 'TRADEWIND_EVENT_WRITE_FAILED', kind: 'io',
        message: '信风执行事实未能保存，已停止继续交接；不会自动重新执行',
        source: 'tradewind.events', retryable: false }, { cause: error });
    });
    this.writeQueue = committed.catch(err => {
      this.writeFailure = err;
      console.warn('[tradewind:event-bus] 事件落盘失败：', (err as Error).message);
    });
    return this.required ? committed : this.writeQueue;
  }

  /** 注册 SSE 订阅者，返回 unsubscribe */
  subscribe(res: ServerResponse): () => void {
    const sub: SSESubscriber = { res, closed: false };
    this.subscribers.add(sub);

    const cleanup = () => {
      if (sub.closed) return;
      sub.closed = true;
      this.subscribers.delete(sub);
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
    return cleanup;
  }

  /** 广播到所有活跃订阅者 */
  private broadcast(line: string): void {
    const payload = `data: ${line.trimEnd()}\n\n`;
    for (const sub of this.subscribers) {
      if (sub.closed) continue;
      try {
        sub.res.write(payload);
      } catch {
        sub.closed = true;
        this.subscribers.delete(sub);
      }
    }
  }

  /** 等待写入结束；required 模式保留并抛出首次失败。 */
  async flush(): Promise<void> {
    await this.writeQueue;
    if (this.required && this.writeFailure) throw this.writeFailure;
  }

  /** 关闭所有 SSE 连接 */
  closeAll(): void {
    for (const sub of this.subscribers) {
      if (sub.closed) continue;
      sub.closed = true;
      try {
        sub.res.write('event: end\ndata: {}\n\n');
        sub.res.end();
      } catch {
        // ignore
      }
    }
    this.subscribers.clear();
  }
}
