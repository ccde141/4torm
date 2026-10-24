/**
 * 气旋工位流式注册表 —— 照搬季风 useStreamRunners 的鲁棒性契约，适配气旋 Live 模型
 *
 * 核心：把流式运行态从「组件实例」抽到「seatId 索引的注册表」。
 * - 注册表持有于 CyclonePage（始终挂载），SeatChat 按 key={seatId} 重挂时不影响在跑的流
 * - 切走工位不掐流，后台续跑，跑完服务端自行落库（seat-runner saveSeat）
 * - 切回 / 重挂 → 直接读 runner 的 live 缓冲恢复界面
 * - 后台流超额淘汰；删工位标 abandoned 防僵尸复活
 *
 * 与季风差异：季风累积 ChatMessage[]；气旋累积 Live（blocks/text/phase/ask）+ 乐观用户消息。
 */
import { backendFetch } from '../../../lib/backend-client';
import { useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import type { DisplayMessage } from './messageDisplay';
import { readCycloneSSE } from './cyclone-sse';
import { errorFromResponse } from '../../../api/error-contract';
import type { Locale } from '../../../i18n/locale';
import { appendReplyText } from './cyclone-reply-sequence';
import { abortCycloneExecution } from './cyclone-execution-client';
import { applySeatEvent, emptyLive, type Live } from './seat-stream-events';
export type SeatRunnerOutcome = 'running' | 'completed' | 'failed' | 'aborted';

/** 单条工位流的运行态。归属 seatId，不归属当前界面。 */
interface SeatRunner {
  live: Live;
  /** 乐观插入的用户气泡 / 已答 ask 回显（落库前先展示，存进 runner 避免切走丢失） */
  pendingUser: DisplayMessage | null;
  streaming: boolean;
  outcome: SeatRunnerOutcome;
  /** 流结束（自然/abort）→ true，等当前挂载的 SeatChat reload /status 后 clear */
  done: boolean;
  ctrl: AbortController;
  /** 流式中删工位 → 标记弃用（这里仅前端语义，服务端 abort 已发） */
  abandoned: boolean;
  /** 用户手动「停止」→ true。done-effect 据此「退回队列入框」而非续发。 */
  userStopped: boolean;
  /** 转入后台的时刻；0 = 前台正在看，永不淘汰 */
  backgroundedAt: number;
  operationId?: string;
  runId?: string;
  abortRequested: boolean;
  abortInFlight: boolean;
}
const MAX_BG = 3;

async function streamSSE(path: string, body: Record<string, unknown>, onEvent: (ev: any) => void, signal: AbortSignal, locale: Locale): Promise<void> {
  const res = await backendFetch(streamUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await errorFromResponse(res);
  await readCycloneSSE(res, onEvent, signal, locale === 'en-US' ? {
    missingBody: 'The SSE response does not contain a data stream.',
    disconnected: 'The SSE connection closed before a done/error event.',
  } : {});
}

export interface StartStreamOpts {
  workshopId: string;
  seatId: string;
  action: 'chat' | 'resume';
  text: string;
  optimisticUser: DisplayMessage | null;
  /** 主席不走 /seat/ 端点，传此覆盖路径（如 /api/cyclone/workshop/${wid}/chair/${action}） */
  pathOverride?: string;
}

/**
 * @param onSeatFinished 任一工位流结束后回调（CyclonePage 级稳定引用，用于刷新侧栏 pending 标记）
 */
/** 排队消息上限（与 QueuedChips MAX_QUEUE 一致）。 */
const MAX_QUEUE = 3;

export function useSeatStreamRunners(onSeatFinished: (seatId: string) => void, locale: Locale = 'zh-CN', scope?: string) {
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const runners = useRef(new Map<string, SeatRunner>());
  const listeners = useRef(new Map<string, Set<() => void>>());
  /** seatId → 待发消息队列。独立于 runner，clearIfDone 删 runner 后仍存活，跨重挂保留。 */
  const queues = useRef(new Map<string, string[]>());
  /** seatId → 输入框草稿。同样独立存活，切走/重挂不丢未发文本（仅内存，硬退出不留）。 */
  const drafts = useRef(new Map<string, string>());
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    if (currentScope.current === scope) return;
    // 只清本地作用域；旧请求仍由自己的运行身份收尾，不中止其他工作室的工作。
    runners.current.clear(); queues.current.clear(); drafts.current.clear();
    currentScope.current = scope;
    listeners.current.forEach(set => set.forEach(listener => listener()));
  }, [scope]);

  const notify = useCallback((seatId: string) => {
    listeners.current.get(seatId)?.forEach(cb => cb());
  }, []);

  /** SeatChat 挂载即订阅自身 seatId；listeners 独立于 runner 存活。 */
  const subscribe = useCallback((seatId: string, cb: () => void): (() => void) => {
    let set = listeners.current.get(seatId);
    if (!set) { set = new Set(); listeners.current.set(seatId, set); }
    set.add(cb);
    return () => { set!.delete(cb); if (set!.size === 0) listeners.current.delete(seatId); };
  }, []);

  const getRunner = useCallback((seatId: string): SeatRunner | undefined =>
    currentScope.current === scope ? runners.current.get(seatId) : undefined, [scope]);

  // ── 消息队列：运行期发送先入队，本轮结束后由 SeatChat done-effect 逐条出队 ──
  /** 当前队列（只读快照引用；chips 渲染用）。 */
  const getQueue = useCallback((seatId: string): string[] =>
    currentScope.current === scope ? queues.current.get(seatId) ?? [] : [], [scope]);
  /** 入队一条；满（≥MAX_QUEUE）返回 false。 */
  const enqueue = useCallback((seatId: string, text: string): boolean => {
    let q = queues.current.get(seatId);
    if (!q) { q = []; queues.current.set(seatId, q); }
    if (q.length >= MAX_QUEUE) return false;
    q.push(text);
    notify(seatId);
    return true;
  }, [notify]);
  /** 出队队首；空返回 null。 */
  const dequeue = useCallback((seatId: string): string | null => {
    const q = queues.current.get(seatId);
    if (!q || q.length === 0) return null;
    const next = q.shift()!;
    if (q.length === 0) queues.current.delete(seatId);
    notify(seatId);
    return next;
  }, [notify]);
  /** 撤掉队列中第 index 条。 */
  const removeQueued = useCallback((seatId: string, index: number) => {
    const q = queues.current.get(seatId);
    if (!q || index < 0 || index >= q.length) return;
    q.splice(index, 1);
    if (q.length === 0) queues.current.delete(seatId);
    notify(seatId);
  }, [notify]);
  /** 取出全部排队项并清空（用户「停止」时退回输入框）。 */
  const takeAllQueued = useCallback((seatId: string): string[] => {
    const q = queues.current.get(seatId) ?? [];
    queues.current.delete(seatId);
    if (q.length) notify(seatId);
    return q;
  }, [notify]);

  // ── 输入框草稿：切走/重挂保留未发文本（内存级） ──
  const getDraft = useCallback((seatId: string): string =>
    currentScope.current === scope ? drafts.current.get(seatId) ?? '' : '', [scope]);
  const setDraft = useCallback((seatId: string, text: string) => {
    if (text) drafts.current.set(seatId, text); else drafts.current.delete(seatId);
  }, []);

  const requestAbort = useCallback((seatId: string, runner: SeatRunner) => {
    if (!runner.operationId || !runner.runId || runner.abortInFlight) return;
    runner.abortInFlight = true;
    void abortCycloneExecution(runner.operationId!, runner.runId!)
      .then(() => {
        runner.outcome = 'aborted';
        runner.ctrl.abort();
      })
      .catch(error => {
        runner.abortInFlight = false;
        runner.abortRequested = false;
        runner.userStopped = false;
        appendReplyText(runner.live.segments,
          `\n[${localeRef.current === 'en-US' ? 'Stop failed' : '停止失败'}] ${(error as Error).message}`);
        notify(seatId);
      });
  }, [notify]);

  /** 后台流超额时通过中心门控中止最老的执行。 */
  const evictIfNeeded = useCallback(() => {
    const bg = [...runners.current.entries()]
      .filter(([, r]) => r.streaming && r.backgroundedAt > 0)
      .sort(([, a], [, b]) => a.backgroundedAt - b.backgroundedAt);
    for (let i = 0; i < bg.length - MAX_BG; i++) {
      const [seatId, runner] = bg[i];
      runner.abortRequested = true;
      requestAbort(seatId, runner);
    }
  }, [requestAbort]);

  /** 切走某工位 → 转后台并触发超额淘汰。流继续在 runner 里跑。 */
  const background = useCallback((seatId: string) => {
    const r = runners.current.get(seatId);
    if (r && r.streaming) { r.backgroundedAt = Date.now(); evictIfNeeded(); }
  }, [evictIfNeeded]);

  /** 切回某工位 → 标回前台（live 缓冲由 SeatChat 直接读 getRunner 渲染）。 */
  const foreground = useCallback((seatId: string) => {
    const r = runners.current.get(seatId);
    if (r) r.backgroundedAt = 0;
  }, []);

  /** 手动停止：abort 本地流 + 通知服务端 abort。 */
  const abortSeat = useCallback((seatId: string) => {
    const r = runners.current.get(seatId);
    if (!r) return;
    r.userStopped = true;
    r.abortRequested = true;
    requestAbort(seatId, r);
  }, [requestAbort]);

  /** 删工位：标弃用 + 掐流 + 通知服务端 abort。 */
  const kill = useCallback((seatId: string) => {
    const r = runners.current.get(seatId);
    queues.current.delete(seatId);   // 删工位连带清掉其排队 / 草稿
    drafts.current.delete(seatId);
    if (!r) return;
    r.abandoned = true;
    abortSeat(seatId);
  }, [abortSeat]);

  /** SeatChat reload /status 完成后清出已结束的 runner（释放 live 缓冲）。 */
  const clearIfDone = useCallback((seatId: string) => {
    const r = runners.current.get(seatId);
    if (r && r.done) runners.current.delete(seatId);
  }, []);

  /** 发起一条流（fire-and-forget，脱离组件生命周期）。 */
  const startStream = useCallback((opts: StartStreamOpts) => {
    const { workshopId, seatId, action, text, optimisticUser } = opts;
    if (runners.current.get(seatId)?.streaming) return;

    const ctrl = new AbortController();
    const runner: SeatRunner = {
      live: emptyLive(localeRef.current),
      pendingUser: optimisticUser,
      streaming: true,
      outcome: 'running',
      done: false,
      ctrl,
      abandoned: false,
      userStopped: false,
      backgroundedAt: 0,
      abortRequested: false,
      abortInFlight: false,
    };
    runners.current.set(seatId, runner);
    notify(seatId);

    const payloadKey = action === 'chat' ? 'message' : 'answer';
    const path = opts.pathOverride ?? `/api/cyclone/workshop/${workshopId}/seat/${seatId}/${action}`;
    // 前沿+后沿节流：高频 token/reasoning/delegate-token 只延后 paint（live 已含最新累积，
    // 不丢内容）；结构性事件立即刷。突发结束后由后沿 timer 兜底刷出。
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFlushAt = 0;
    const FLUSH_MS = 80;
    const doNotify = () => { flushTimer = null; lastFlushAt = Date.now(); notify(seatId); };
    const scheduleNotify = () => {
      if (flushTimer) return;
      const wait = FLUSH_MS - (Date.now() - lastFlushAt);
      if (wait <= 0) doNotify(); else flushTimer = setTimeout(doNotify, wait);
    };
    const flushNotify = () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } lastFlushAt = Date.now(); notify(seatId); };
    const HIGH_FREQ = new Set(['token', 'reasoning', 'delegate-token']);
    (async () => {
      try {
        await streamSSE(
          path,
          { [payloadKey]: text },
          (ev) => {
            if (ev.type === 'execution-start') {
              runner.operationId = ev.operationId;
              runner.runId = ev.runId;
              if (runner.pendingUser?.role === 'user') runner.pendingUser.inputMessageId = ev.runId;
              if (runner.abortRequested) requestAbort(seatId, runner);
            }
            if (ev.type === 'error') runner.outcome = 'failed';
            applySeatEvent(ev, runner.live, localeRef.current);
            if (HIGH_FREQ.has(ev.type)) scheduleNotify(); else flushNotify();
          },
          ctrl.signal,
          localeRef.current,
        );
      } catch (e) {
        if (!ctrl.signal.aborted) {
          runner.outcome = 'failed';
          appendReplyText(runner.live.segments, `\n[${localeRef.current === 'en-US' ? 'Request failed' : '请求失败'}] ${(e as Error).message}`);
          runner.live.phase = '';
        } else runner.outcome = 'aborted';
      } finally {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        if (runner.outcome === 'running') runner.outcome = 'completed';
        runner.streaming = false;
        runner.done = true;
        notify(seatId);          // 当前挂载的 SeatChat → reload /status 后 clearIfDone
        onSeatFinished(seatId);  // 刷新侧栏（即使 SeatChat 未挂载也生效）
      }
    })();
  }, [notify, onSeatFinished, requestAbort]);

  return useMemo(() => ({
    subscribe, getRunner, startStream, background, foreground, abortSeat, kill, clearIfDone,
    getQueue, enqueue, dequeue, removeQueued, takeAllQueued, getDraft, setDraft,
  }), [subscribe, getRunner, startStream, background, foreground, abortSeat, kill, clearIfDone,
    getQueue, enqueue, dequeue, removeQueued, takeAllQueued, getDraft, setDraft]);
}

export type SeatStreamRunners = ReturnType<typeof useSeatStreamRunners>;
