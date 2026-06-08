/**
 * Token 流广播 —— 内存级，不落盘
 *
 * 职责：
 * - 每个 Agent 节点在 LLM 流式输出时，逐 chunk 广播给订阅者（前端 SSE）
 * - 维护 partialContent 缓冲（前端中途连上时先推累积内容）
 * - 一轮 LLM 完成后 flush（清空 partial，推 round-end 信号）
 *
 * 不落盘：token 级事件 IO 压力太大，完整 messages 由现有归档机制保证。
 */

import type { ServerResponse } from 'node:http';

export interface TokenSubscriber {
  res: ServerResponse;
  nodeFilter?: string; // 只接收指定 nodeId 的 token（空则全收）
  closed: boolean;
}

/** 单次执行的 token 流管理器 */
export class TokenStreamBus {
  private readonly subscribers = new Set<TokenSubscriber>();
  /** nodeId → 当前轮次累积的 partial content */
  private readonly partials = new Map<string, string>();

  /** 推送一个 token chunk */
  pushChunk(nodeId: string, chunk: string): void {
    const prev = this.partials.get(nodeId) ?? '';
    this.partials.set(nodeId, prev + chunk);

    const payload = JSON.stringify({ type: 'token', nodeId, chunk });
    this.broadcast(payload);
  }

  /** 一轮 LLM 调用结束，清空 partial 并通知前端 */
  flushRound(nodeId: string): void {
    this.partials.delete(nodeId);
    const payload = JSON.stringify({ type: 'round-end', nodeId });
    this.broadcast(payload);
  }

  /** 获取某节点当前累积的 partial（前端中途连上时用） */
  getPartial(nodeId: string): string {
    return this.partials.get(nodeId) ?? '';
  }

  /** 注册 SSE 订阅者 */
  subscribe(res: ServerResponse, nodeFilter?: string): () => void {
    const sub: TokenSubscriber = { res, nodeFilter, closed: false };
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

  /** 广播到所有匹配的订阅者 */
  private broadcast(payload: string): void {
    const msg = `data: ${payload}\n\n`;
    for (const sub of this.subscribers) {
      if (sub.closed) continue;
      if (sub.nodeFilter) {
        // 简单过滤：payload 里含目标 nodeId 才推
        if (!payload.includes(`"nodeId":"${sub.nodeFilter}"`)) continue;
      }
      try {
        sub.res.write(msg);
      } catch {
        sub.closed = true;
        this.subscribers.delete(sub);
      }
    }
  }

  /** 关闭所有连接 */
  closeAll(): void {
    for (const sub of this.subscribers) {
      if (sub.closed) continue;
      sub.closed = true;
      try {
        sub.res.write('event: end\ndata: {}\n\n');
        sub.res.end();
      } catch { /* ignore */ }
    }
    this.subscribers.clear();
  }
}
