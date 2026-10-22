import type { CompactionActivity } from '../../../components/common/compaction-activity';
/**
 * 气旋群聊流式注册表 —— 照搬 useSeatStreamRunners 的鲁棒性契约，适配群聊「一轮多工位串行」模型
 *
 * 与私聊的根本差异：
 * - 私聊一轮产出单个 AI 的一个 Live；群聊一轮是「人发一句 → 在场工位串行响应」，产出多条消息。
 * - 故累积态是 roundFeed: FeedMsg[]（乐观人类气泡 + 本轮各工位流式消息），而非单个 Live。
 *
 * - 切走房间不掐流，后台续跑，服务端自行落库（room-runner 落 publicMessages）。
 * - 切回 → 读 runner.roundFeed 恢复界面；done 后保留 roundFeed 到 reload 完成再 clear，防终答闪空。
 * - 删群标 abandoned + abort 防僵尸。
 */

import { backendFetch } from '../../../lib/backend-client';
import { useRef, useCallback, useMemo } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import { MAX_QUEUE } from '../../../components/chat/QueuedChips';
import { readCycloneSSE } from './cyclone-sse';
import { errorFromResponse } from '../../../api/error-contract';
import type { Locale } from '../../../i18n/locale';
import { abortCycloneExecution } from './cyclone-execution-client';
import { applyRoomEvent, type FeedMsg } from './room-stream-events';
import type { CycloneUsage } from './cyclone-token-usage';

/** 单个群聊一轮的运行态。归属 roomId，不归属当前界面。 */
interface RoomRunner {
  /** 本轮新增消息（乐观人类 + 各工位流式），落库前先展示 */
  roundFeed: FeedMsg[];
  /** 当前正在说话的工位标签；'' = 无（用于把 token/tool 定位到对应消息） */
  activeSpeaker: string;
  tokenUsage: CycloneUsage | null;
  lastKnownTokenUsage?: CycloneUsage;
  compactionNotice?: string | null;
  compaction?: CompactionActivity | null;
  streaming: boolean;
  done: boolean;
  ctrl: AbortController;
  abandoned: boolean;
  /** 用户手动「停止」→ true。done-effect 据此「退回队列入框」而非续发。 */
  userStopped: boolean;
  operationId?: string;
  runId?: string;
  abortRequested: boolean;
  abortInFlight: boolean;
}


async function streamSSE(path: string, body: Record<string, unknown>, onEvent: (ev: any) => void, signal: AbortSignal, locale: Locale): Promise<void> {
  const res = await backendFetch(streamUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await errorFromResponse(res);
  await readCycloneSSE(res, onEvent, signal, locale === 'en-US' ? {
    missingBody: 'The SSE response does not contain a data stream.',
    disconnected: 'The SSE connection closed before a done/error event.',
  } : {});
}

/**
 * @param onRoomFinished 任一群聊轮结束后回调（CyclonePage 级稳定引用，刷新侧栏）
 * @param onDispatchCreated 派发记录创建后立即回调，刷新实时派发卡片
 */
export function useRoomStreamRunners(
  onRoomFinished: (roomId: string) => void,
  onDispatchCreated: (roomId: string) => void,
  locale: Locale = 'zh-CN',
) {
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const runners = useRef(new Map<string, RoomRunner>());
  const listeners = useRef(new Map<string, Set<() => void>>());
  /** roomId → 待发消息队列 / 输入框草稿。独立于 runner，clearIfDone 后仍存活，跨重挂保留。 */
  const queues = useRef(new Map<string, string[]>());
  const drafts = useRef(new Map<string, string>());

  const notify = useCallback((roomId: string) => {
    listeners.current.get(roomId)?.forEach(cb => cb());
  }, []);

  // ── 消息队列：运行期发送先入队，本轮结束后由 RoomPanel done-effect 出队 ──
  const getQueue = useCallback((roomId: string): string[] => queues.current.get(roomId) ?? [], []);
  const enqueue = useCallback((roomId: string, text: string): boolean => {
    let q = queues.current.get(roomId);
    if (!q) { q = []; queues.current.set(roomId, q); }
    if (q.length >= MAX_QUEUE) return false;
    q.push(text);
    notify(roomId);
    return true;
  }, [notify]);
  const dequeue = useCallback((roomId: string): string | null => {
    const q = queues.current.get(roomId);
    if (!q || q.length === 0) return null;
    const next = q.shift()!;
    if (q.length === 0) queues.current.delete(roomId);
    notify(roomId);
    return next;
  }, [notify]);
  const removeQueued = useCallback((roomId: string, index: number) => {
    const q = queues.current.get(roomId);
    if (!q || index < 0 || index >= q.length) return;
    q.splice(index, 1);
    if (q.length === 0) queues.current.delete(roomId);
    notify(roomId);
  }, [notify]);
  const takeAllQueued = useCallback((roomId: string): string[] => {
    const q = queues.current.get(roomId) ?? [];
    queues.current.delete(roomId);
    if (q.length) notify(roomId);
    return q;
  }, [notify]);
  // 输入框草稿（内存级，切走/重挂保留）
  const getDraft = useCallback((roomId: string): string => drafts.current.get(roomId) ?? '', []);
  const setDraft = useCallback((roomId: string, text: string) => {
    if (text) drafts.current.set(roomId, text); else drafts.current.delete(roomId);
  }, []);

  /** RoomPanel 挂载即订阅自身 roomId；listeners 独立于 runner 存活。 */
  const subscribe = useCallback((roomId: string, cb: () => void): (() => void) => {
    let set = listeners.current.get(roomId);
    if (!set) { set = new Set(); listeners.current.set(roomId, set); }
    set.add(cb);
    return () => { set!.delete(cb); if (set!.size === 0) listeners.current.delete(roomId); };
  }, []);

  const getRunner = useCallback((roomId: string): RoomRunner | undefined => runners.current.get(roomId), []);

  const requestAbort = useCallback((roomId: string, runner: RoomRunner) => {
    if (!runner.operationId || !runner.runId || runner.abortInFlight) return;
    runner.abortInFlight = true;
    void abortCycloneExecution(runner.operationId!, runner.runId!)
      .then(() => runner.ctrl.abort())
      .catch(error => {
        runner.abortInFlight = false;
        runner.abortRequested = false;
        runner.userStopped = false;
        runner.roundFeed.push({
          key: `stop-error-${runner.roundFeed.length}`, speaker: '系统', isHuman: false, tools: [],
          content: `[${localeRef.current === 'en-US' ? 'Stop failed' : '停止失败'}] ${(error as Error).message}`,
        });
        notify(roomId);
      });
  }, [notify]);

  /** 手动停止：中心确认后再切断本地流。 */
  const abortRoom = useCallback((roomId: string) => {
    const r = runners.current.get(roomId);
    if (!r) return;
    r.userStopped = true;
    r.abortRequested = true;
    requestAbort(roomId, r);
  }, [requestAbort]);

  /** 删群：标弃用 + 掐流 + 通知服务端 abort。 */
  const kill = useCallback((roomId: string) => {
    const r = runners.current.get(roomId);
    queues.current.delete(roomId);   // 删群连带清掉其排队 / 草稿
    drafts.current.delete(roomId);
    if (!r) return;
    r.abandoned = true;
    abortRoom(roomId);
  }, [abortRoom]);

  /** RoomPanel reload /status 完成后清出已结束的 runner（释放 roundFeed 缓冲）。 */
  const clearIfDone = useCallback((roomId: string) => {
    const r = runners.current.get(roomId);
    if (r && r.done) runners.current.delete(roomId);
  }, []);

  const startRequest = useCallback((opts: {
    workshopId: string;
    roomId: string;
    path: string;
    body: Record<string, unknown>;
    initialFeed: FeedMsg[];
  }) => {
    const { roomId, path, body, initialFeed } = opts;
    if (runners.current.get(roomId)?.streaming) return;

    const ctrl = new AbortController();
    const runner: RoomRunner = {
      roundFeed: initialFeed,
      activeSpeaker: '',
      tokenUsage: null,
      streaming: true,
      done: false,
      ctrl,
      abandoned: false,
      userStopped: false,
      abortRequested: false,
      abortInFlight: false,
    };
    runners.current.set(roomId, runner);
    notify(roomId);

    // 前沿+后沿节流：高频 token/reasoning 只延后 paint（roundFeed 已含最新累积，不丢内容）；
    // 结构性事件立即刷。突发结束后由后沿 timer 兜底刷出。
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFlushAt = 0;
    const FLUSH_MS = 80;
    const doNotify = () => { flushTimer = null; lastFlushAt = Date.now(); notify(roomId); };
    const scheduleNotify = () => {
      if (flushTimer) return;
      const wait = FLUSH_MS - (Date.now() - lastFlushAt);
      if (wait <= 0) doNotify(); else flushTimer = setTimeout(doNotify, wait);
    };
    const flushNotify = () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } lastFlushAt = Date.now(); notify(roomId); };
    const HIGH_FREQ = new Set(['token', 'reasoning']);
    (async () => {
      try {
        await streamSSE(
          path,
          body,
          (ev) => {
            if (ev.type === 'execution-start') {
              runner.operationId = ev.operationId;
              runner.runId = ev.runId;
              if (runner.abortRequested) requestAbort(roomId, runner);
            }
            applyRoomEvent(ev, runner, localeRef.current);
            if (ev.type === 'dispatch-created') onDispatchCreated(roomId);
            if (HIGH_FREQ.has(ev.type)) scheduleNotify(); else flushNotify();
          },
          ctrl.signal,
          localeRef.current,
        );
      } catch (e) {
        if (!ctrl.signal.aborted) {
          runner.roundFeed.push({ key: `error-${runner.roundFeed.length}`, speaker: '系统', content: `[${localeRef.current === 'en-US' ? 'Request failed' : '请求失败'}] ${(e as Error).message}`, isHuman: false, tools: [] });
        }
      } finally {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        runner.streaming = false;
        runner.done = true;
        notify(roomId);            // 当前挂载的 RoomPanel → reload /status 后 clearIfDone
        onRoomFinished(roomId);    // 刷新侧栏（即使 RoomPanel 未挂载也生效）
      }
    })();
  }, [notify, onDispatchCreated, onRoomFinished, requestAbort]);

  /** 发起一轮群聊（fire-and-forget，脱离组件生命周期）。 */
  const startRound = useCallback((workshopId: string, roomId: string, text: string) => {
    startRequest({
      workshopId,
      roomId,
      path: `/api/cyclone/workshop/${workshopId}/room/${roomId}/speak`,
      body: { message: text },
      initialFeed: [{ key: `human-${Date.now()}`, speaker: '人类', content: text, isHuman: true, tools: [] }],
    });
  }, [startRequest]);

  /** 新建群聊后的入会摘要使用和普通群聊相同的流注册表。 */
  const startIntro = useCallback((
    workshopId: string,
    roomId: string,
    intros: Array<{ seatId: string; behavior: 'summary' | 'intro' | 'none' }>,
  ) => {
    startRequest({
      workshopId,
      roomId,
      path: `/api/cyclone/workshop/${workshopId}/room/${roomId}/intro`,
      body: { intros },
      initialFeed: [],
    });
  }, [startRequest]);

  return useMemo(() => ({
    subscribe, getRunner, startRound, startIntro, abortRoom, kill, clearIfDone,
    getQueue, enqueue, dequeue, removeQueued, takeAllQueued, getDraft, setDraft,
  }), [subscribe, getRunner, startRound, startIntro, abortRoom, kill, clearIfDone,
    getQueue, enqueue, dequeue, removeQueued, takeAllQueued, getDraft, setDraft]);
}

export type RoomStreamRunners = ReturnType<typeof useRoomStreamRunners>;
