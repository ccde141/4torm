import { useRef, useCallback } from 'react';
import type { ChatMessage } from '../../types';
import { MAX_QUEUE } from './QueuedChips';

/** 单条流的运行态。归属 sessionId，不归属当前界面。 */
interface Runner {
  messages: ChatMessage[];
  streaming: boolean;
  abort: () => void;
  /** 转入后台的时刻；0 = 当前正在看（前台），永不淘汰 */
  backgroundedAt: number;
  /** 流式中被删会话 → 标记弃用，finalize 时跳过存盘，杜绝僵尸复活 */
  abandoned: boolean;
  /** 用户手动「停止」→ true。完成回调据此「退回队列入框」而非续发。 */
  userStopped: boolean;
}

/** 后台流上限（正在看的那条不计入） */
const MAX_BG = 3;

/**
 * 会话流注册表。把流的归属从「当前界面」改成「sessionId」：
 * - 切走不掐流，流继续在后台跑，跑完自行存盘
 * - 切回有活流的会话 → 重连其缓冲
 * - 后台流超 3 条 → 淘汰最早转入后台的（先 graceful abort 存盘）
 */
export function useStreamRunners(
  getActiveId: () => string | null,
  setMessages: (m: ChatMessage[]) => void,
  setStreaming: (v: boolean) => void,
) {
  const runners = useRef(new Map<string, Runner>());
  /** sessionId → 待发消息队列。独立于 runner，finalize 删 runner 后仍存活。 */
  const queues = useRef(new Map<string, string[]>());

  // ── 消息队列：运行期发送先入队，本轮结束后由完成回调出队 ──
  const getQueue = useCallback((sessionId: string): string[] => queues.current.get(sessionId) ?? [], []);
  /** 入队一条；满（≥MAX_QUEUE）返回 false。 */
  const enqueue = useCallback((sessionId: string, text: string): boolean => {
    let q = queues.current.get(sessionId);
    if (!q) { q = []; queues.current.set(sessionId, q); }
    if (q.length >= MAX_QUEUE) return false;
    q.push(text);
    return true;
  }, []);
  /** 出队队首；空返回 null。 */
  const dequeue = useCallback((sessionId: string): string | null => {
    const q = queues.current.get(sessionId);
    if (!q || q.length === 0) return null;
    const next = q.shift()!;
    if (q.length === 0) queues.current.delete(sessionId);
    return next;
  }, []);
  /** 撤掉队列中第 index 条。 */
  const removeQueued = useCallback((sessionId: string, index: number) => {
    const q = queues.current.get(sessionId);
    if (!q || index < 0 || index >= q.length) return;
    q.splice(index, 1);
    if (q.length === 0) queues.current.delete(sessionId);
  }, []);
  /** 取出全部排队项并清空（用户「停止」时退回输入框）。 */
  const takeAllQueued = useCallback((sessionId: string): string[] => {
    const q = queues.current.get(sessionId) ?? [];
    queues.current.delete(sessionId);
    return q;
  }, []);

  /** 流的每次更新：写进 runner 缓冲；仅当它正是当前激活会话时才刷新界面。 */
  const emit = useCallback((sessionId: string, msgs: ChatMessage[]) => {
    const r = runners.current.get(sessionId);
    if (r) r.messages = msgs;
    if (sessionId === getActiveId()) setMessages(msgs);
  }, [getActiveId, setMessages]);

  /** 后台流超额时淘汰最老的（abort 触发 streamLoop 内 finalize 存盘）。 */
  const evictIfNeeded = useCallback(() => {
    const bg = [...runners.current.values()]
      .filter(r => r.streaming && r.backgroundedAt > 0)
      .sort((a, b) => a.backgroundedAt - b.backgroundedAt);
    for (let i = 0; i < bg.length - MAX_BG; i++) bg[i].abort();
  }, []);

  /** 发起一条流前注册 runner（前台态：backgroundedAt=0）。 */
  const register = useCallback((sessionId: string, abort: () => void, initial: ChatMessage[]) => {
    runners.current.set(sessionId, {
      messages: initial, streaming: true, abort, backgroundedAt: 0, abandoned: false, userStopped: false,
    });
  }, []);

  /** 流结束（自然/abort/淘汰）→ 清出注册表。返回该 runner 是否被弃用（删会话）。 */
  const finalize = useCallback((sessionId: string): boolean => {
    const r = runners.current.get(sessionId);
    runners.current.delete(sessionId);
    if (sessionId === getActiveId()) setStreaming(false);
    return r?.abandoned ?? false;
  }, [getActiveId, setStreaming]);

  /** 把某会话的流转入后台（切走时调），并触发超额淘汰。 */
  const background = useCallback((sessionId: string) => {
    const r = runners.current.get(sessionId);
    if (r) r.backgroundedAt = Date.now();
    evictIfNeeded();
  }, [evictIfNeeded]);

  /** 切回有活流的会话 → 重连缓冲；返回是否重连成功。 */
  const reconnect = useCallback((sessionId: string): boolean => {
    const r = runners.current.get(sessionId);
    if (!r) return false;
    r.backgroundedAt = 0;
    setMessages(r.messages);
    setStreaming(r.streaming);
    return true;
  }, [setMessages, setStreaming]);

  /** 删会话：掐流 + 标记弃用（阻止 finalize 存盘，杜绝僵尸复活）。 */
  const kill = useCallback((sessionId: string) => {
    queues.current.delete(sessionId);   // 删会话连带清掉其排队
    const r = runners.current.get(sessionId);
    if (!r) return;
    r.abandoned = true;
    r.abort();
  }, []);

  return { runners, emit, register, finalize, background, reconnect, kill,
    getQueue, enqueue, dequeue, removeQueued, takeAllQueued };
}
