/**
 * 入口缓冲 —— 节点的"入口齐"判定器（循环 buffer 版）
 *
 * 入口：
 *   构造: (expected: number)  — 该节点 handoff 入线总数
 *   push(env: Envelope)       — EnvelopeRouter 投递信封时调用
 *   abort()                   — Runner 收尾/中止时强制终止等待
 *
 * 出口：
 *   waitReady(): Promise<Envelope[]>
 *     - expected=0 → 立即 resolve([])（Entry 等无入线节点）
 *     - received >= expected → resolve(received[]) 然后清空 received，可再次等待下一波
 *     - abort() → reject(BufferAbortError)
 *
 * 循环语义：
 *   每次 waitReady resolve 后内部清空 received，下一次 waitReady 重新等齐 expected 条。
 *   支持节点循环处理多波信封（rework 打回 / 会议室重开 / Agent 持续监听新指令）。
 *
 * 保证：
 *   - abort 与正常 resolve 语义可区分（reject vs resolve）
 *   - push 在 waitReady 之前或之后调用均正确
 *   - resolve 后 received 立即清空，新 push 进入下一波
 */

import type { Envelope } from './types';

/** 缓冲被中止时抛出的错误，调用方可 instanceof 区分 */
export class BufferAbortError extends Error {
  constructor() {
    super('InputBuffer aborted');
    this.name = 'BufferAbortError';
  }
}

export class InputBuffer {
  private readonly expected: number;
  private received: Envelope[] = [];
  private resolver: ((envs: Envelope[]) => void) | null = null;
  private rejector: ((err: Error) => void) | null = null;
  private aborted = false;

  constructor(expected: number) {
    this.expected = expected;
  }

  /** 路由器投递信封时调用 */
  push(env: Envelope): void {
    if (this.aborted) return;
    this.received.push(env);
    if (this.resolver && this.received.length >= this.expected) {
      const batch = this.received;
      this.received = [];
      const resolve = this.resolver;
      this.resolver = null;
      this.rejector = null;
      resolve(batch);
    }
  }

  /**
   * Executor 在 execute 内 await，直到入口齐。
   * resolve 后 received 清空，下次调用 waitReady 重新等齐 expected 条。
   */
  waitReady(): Promise<Envelope[]> {
    if (this.aborted) return Promise.reject(new BufferAbortError());
    if (this.expected === 0) return Promise.resolve([]);
    if (this.received.length >= this.expected) {
      const batch = this.received;
      this.received = [];
      return Promise.resolve(batch);
    }
    return new Promise((resolve, reject) => {
      this.resolver = resolve;
      this.rejector = reject;
    });
  }

  /** 强制中止等待（Runner 收尾时用） */
  abort(): void {
    this.aborted = true;
    if (this.rejector) {
      const reject = this.rejector;
      this.resolver = null;
      this.rejector = null;
      reject(new BufferAbortError());
    }
  }
}
