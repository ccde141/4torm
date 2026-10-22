import type { Envelope } from './types/index.js';
import { BufferAbortError } from './input-buffer.js';

/** 一个消费者一次只取一封；入队顺序就是实际接收顺序。 */
export class HandoffQueue {
  private pending: Envelope[] = [];
  private waiter?: { resolve(value: Envelope): void; reject(error: Error): void };
  private stopped = false;

  push(envelope: Envelope): void {
    if (this.stopped) throw new BufferAbortError();
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.resolve(envelope);
    } else this.pending.push(envelope);
  }

  take(): Promise<Envelope> {
    if (this.stopped) return Promise.reject(new BufferAbortError());
    if (this.waiter) return Promise.reject(new Error('同一节点不能同时等待两个信封'));
    const envelope = this.pending.shift();
    if (envelope) return Promise.resolve(envelope);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  abort(): void {
    this.stopped = true;
    this.waiter?.reject(new BufferAbortError());
    this.waiter = undefined;
    this.pending = [];
  }

  ids(): string[] { return this.pending.map(item => item.envelopeId!); }
}
