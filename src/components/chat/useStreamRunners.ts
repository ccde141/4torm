import { useRef, useCallback, useState } from 'react';
import type { ChatMessage } from '../../types';
import type { MonsoonBrowserEvent } from '../../engine/chat/sse-events';
import { reduceCompactionActivity, type CompactionActivity } from '../common/compaction-activity';

/** 单条流的运行态。归属 sessionId，不归属当前界面。 */
interface Runner {
  ready: Promise<void>;
  markReady: () => void;
  settled: Promise<boolean>;
  settle: (completed: boolean) => void;
  messages: ChatMessage[];
  streaming: boolean;
  abort: () => void;
  /** 转入后台的时刻；0 = 当前正在看（前台），永不淘汰 */
  backgroundedAt: number;
  /** 流式中被删会话 → 标记弃用，finalize 时跳过存盘，杜绝僵尸复活 */
  abandoned: boolean;
  /** 用户已要求停止；后续插话不得再进入正在收口的执行。 */
  userStopped: boolean;
  /** 当前后端执行标识；用于统一控制面防止旧操作误伤新执行。 */
  runId?: string;
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
  const [compactions, setCompactions] = useState<Record<string, CompactionActivity | undefined>>({});
  const isRunning = useCallback((sessionId: string) => runners.current.has(sessionId), []);
  const onCompaction = useCallback((sessionId: string, event: MonsoonBrowserEvent) => {
    if (!['compact-start', 'compact-done', 'compact-failed', 'input-ready', 'input-accepted', 'error', 'aborted'].includes(event.type)) return;
    setCompactions(current => {
      const next = reduceCompactionActivity(current[sessionId], event.type === 'input-ready'
        ? { type: 'input-accepted' } : event);
      return next === current[sessionId] ? current : { ...current, [sessionId]: next };
    });
  }, []);

  /** 流的每次更新：写进 runner 缓冲；仅当它正是当前激活会话时才刷新界面。 */
  const emit = useCallback((sessionId: string, msgs: ChatMessage[]) => {
    const r = runners.current.get(sessionId);
    if (r) {
      r.messages = msgs;
      const active = msgs.findLast(message => message.streamingPhase && message.inputRunId);
      if (active?.inputRunId) r.runId = active.inputRunId;
      if (msgs.at(-1)?.inputReady) r.markReady();
    }
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
    let settle!: (completed: boolean) => void;
    const settled = new Promise<boolean>(resolve => { settle = resolve; });
    let markReady!: () => void;
    const ready = new Promise<void>(resolve => { markReady = resolve; });
    runners.current.set(sessionId, {
      ready, markReady,
      settled, settle,
      messages: initial, streaming: true, abort, backgroundedAt: 0, abandoned: false, userStopped: false,
    });
  }, []);

  /** 流结束（自然/abort/淘汰）→ 清出注册表。返回该 runner 是否被弃用（删会话）。 */
  const finalize = useCallback((sessionId: string, completed = false): boolean => {
    const r = runners.current.get(sessionId);
    runners.current.delete(sessionId);
    r?.markReady();
    r?.settle(completed && !r.abandoned && !r.userStopped);
    onCompaction(sessionId, { type: 'aborted' });
    if (sessionId === getActiveId()) setStreaming(false);
    return r?.abandoned ?? false;
  }, [getActiveId, setStreaming, onCompaction]);

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
    const r = runners.current.get(sessionId);
    if (!r) return;
    r.abandoned = true;
    r.abort();
  }, []);

  return { runners, emit, register, finalize, background, reconnect, kill, isRunning, compactions, onCompaction };
}
