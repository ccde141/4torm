/**
 * 事件总线 —— emit 事件 + append 写 events.jsonl + SSE 推送
 *
 * 设计依据：workflow-design-v2.0.md §8.3
 *
 * 核心约束：
 * - 「文件是真相，SSE 只是渲染通道」(§8 核心原则)：每条事件必须先落盘后推送
 * - fs.appendFile 单次 write 在常见数据量下原子，先朴素实现，后续按需加锁
 * - SSE listener 断线必须清理，避免内存泄漏
 *
 * 运行环境：Node.js（Vite 插件钩子内）
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
 * 每次工作流执行新建一个，不复用——隔离最干净。
 * Phase 3 决策：Runner 实例 per execution（详见 §4.3 隐性 bug 清单 R3）
 */
export class EventBus {
  private readonly eventsFile: string;
  private readonly subscribers = new Set<SSESubscriber>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(eventsFile: string) {
    this.eventsFile = eventsFile;
  }

  /**
   * 发射事件：先落盘，后推送。
   *
   * 用 promise chain 串行化所有写入，避免 appendFile 并发交错。
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

  /** 等待所有挂起的写入完成（用于收尾时确保落盘） */
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
