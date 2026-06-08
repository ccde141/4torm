/**
 * 串行队列调度器 —— 咨询/反问通道复用
 *
 * 设计依据：workflow-design-v2.0.md §7.4 决策 5
 *
 * 核心约束：
 * - 入队即返回，handler 串行执行
 * - 队头跑完才取下一个，避免咨询 Agent 的 LLM 调用并发撕裂上下文
 * - 错误隔离：单个 handler 抛错不阻塞后续队列项
 *
 * 简化：当前用 promise chain 实现，不实现"暂停/恢复"。
 */

/** 队列任务：注册时给出执行函数 */
export type Task<T = unknown> = () => Promise<T>;

export class QueueScheduler {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * 把任务追加到队列尾。
   * 返回的 Promise 在任务执行完成后 resolve / reject。
   */
  enqueue<T>(task: Task<T>): Promise<T> {
    const next = this.tail.then(
      () => task(),
      () => task(),  // 上一个失败也继续跑后续，错误隔离
    );
    // tail 始终指向最新任务的"完成或失败"，不传播错误
    this.tail = next.catch(() => undefined);
    return next as Promise<T>;
  }

  /** 等队列清空（仅当前已入队的任务，不影响未来追加） */
  drain(): Promise<void> {
    return this.tail.then(() => undefined, () => undefined);
  }
}
