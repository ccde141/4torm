/**
 * 事件总线 —— emit 事件 + append 写 events.jsonl + SSE 推送
 *
 * 同一实例的写入串行执行；写入成功后才向 SSE 订阅者推送。
 * 写入失败时记录警告、跳过推送，emit 仍正常返回；断开的订阅者会移除。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { EventLog } from './types';

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

  constructor(eventsFile: string) {
    this.eventsFile = eventsFile;
  }

  /**
   * 串行写入事件文件；成功后推送，失败时只记录警告。
   */
  emit(log: EventLog): Promise<void> {
    const line = JSON.stringify(log) + '\n';
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.eventsFile), { recursive: true });
      await fs.appendFile(this.eventsFile, line, 'utf-8');
      this.broadcast(line);
    }).catch(err => {
      console.warn('[tradewind:event-bus] 事件落盘失败：', (err as Error).message);
    });
    return this.writeQueue;
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

  /** 等待已入队的写入结束；写入失败只记录警告。 */
  async flush(): Promise<void> {
    await this.writeQueue;
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
