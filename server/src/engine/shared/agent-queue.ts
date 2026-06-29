/**
 * 进程内「按 Agent 串行」队列。
 *
 * 背景：同一个 Agent 可被多个会话 / 功能区（季风、对流、气旋…）同时驱动。
 * 这些运行各自独立、互相看不见，会并发读写同一份 workspace / MEMORY.md，
 * 造成状态污染。本模块给「驱动某 Agent 跑一轮」提供一个统一的串行闸口：
 * 同一 agentId 的多次进入严格 FIFO 依次放行，不同 agent 互不影响。
 *
 * 设计取舍：
 *  - 纯内存、不持久化（busy 互斥本就是内存态；跨进程残留由 healAgentLocks 处理）。
 *  - 这是「兜底」：正常不推荐一个 Agent 多处同时用，但用户真这么用时，
 *    我们让它静默排队、依次执行，而不是直接报错。
 *
 * 防死锁：
 *  - 重入放行：若当前异步上下文已持有该 agentId（运行中又 delegate/contact 到自身），
 *    直接执行，不再入队，避免自锁。
 *  - 超时降级：等待超过 timeoutMs 仍未轮到，记日志后照常放行——退化为「改造前的并发」，
 *    绝不比以前更差，避免异常情况下永久挂起。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface Lane {
  /** 队尾：下一个进入者需要 await 的 promise（当前持有者释放时 resolve） */
  tail: Promise<void>;
  /** 当前持有者 + 排队者总数；归零即可回收 lane */
  refs: number;
}

const lanes = new Map<string, Lane>();
const heldStore = new AsyncLocalStorage<Set<string>>();

const DEFAULT_TIMEOUT_MS = Number(process.env.AGENT_QUEUE_TIMEOUT_MS) || 10 * 60_000;

export interface AgentTurnOpts {
  /** 前方有人占用、需要排队等待时触发一次（用于推送「排队中」提示） */
  onWait?: () => void;
  /** 等待超时（毫秒），超时后降级为并发放行。默认 10 分钟，可由环境变量覆盖 */
  timeoutMs?: number;
}

/**
 * 在某 Agent 的串行队列中执行 fn，保证同一 agentId 的多次调用依次进行。
 * 返回 fn 的结果（透传异常）。
 */
export async function withAgentTurn<T>(
  agentId: string,
  fn: () => Promise<T>,
  opts: AgentTurnOpts = {},
): Promise<T> {
  // 重入：当前上下文已持有该 agent → 直接执行，避免自锁
  const held = heldStore.getStore();
  if (held?.has(agentId)) {
    return fn();
  }

  const release = await acquire(agentId, opts);
  const nextHeld = new Set(held ?? []);
  nextHeld.add(agentId);
  try {
    return await heldStore.run(nextHeld, fn);
  } finally {
    release();
  }
}

/** 进入队列，返回释放函数（内部用；withAgentTurn 已封装 finally 释放）。 */
async function acquire(agentId: string, opts: AgentTurnOpts): Promise<() => void> {
  let lane = lanes.get(agentId);
  if (!lane) {
    lane = { tail: Promise.resolve(), refs: 0 };
    lanes.set(agentId, lane);
  }

  const hadHolder = lane.refs > 0;
  lane.refs++;
  if (hadHolder) opts.onWait?.();

  const prev = lane.tail;
  let releaseInner!: () => void;
  lane.tail = new Promise<void>(res => { releaseInner = res; });

  // 等前方释放，带超时兜底
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    prev,
    new Promise<void>(res => {
      timer = setTimeout(() => {
        console.warn(`[agent-queue] ${agentId} 排队等待超时（${timeoutMs}ms），降级为并发放行`);
        res();
      }, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseInner();
    lane!.refs--;
    if (lane!.refs === 0 && lanes.get(agentId) === lane) {
      lanes.delete(agentId);
    }
  };
}

/** 当前是否有任意 agent 正被持有（调试 / 自检用）。 */
export function activeAgentLaneCount(): number {
  return lanes.size;
}
