/**
 * 气旋群聊流式注册表 —— 照搬 useSeatStreamRunners 的鲁棒性契约，适配群聊「一轮多工位串行」模型
 *
 * 与私聊的根本差异：
 * - 私聊一轮产出单个 AI 的一个 Live；群聊一轮是「人发一句 → 在场工位串行响应」，产出多条消息。
 * - 故累积态是 roundFeed: FeedMsg[]（乐观人类气泡 + 本轮各工位流式消息），而非单个 Live。
 *
 * 鲁棒性同私聊：
 * - 注册表持于 CyclonePage（始终挂载），RoomPanel 按 key={roomId} 重挂不影响在跑的流。
 * - 切走房间不掐流，后台续跑，服务端自行落库（room-runner 落 publicMessages）。
 * - 切回 → 读 runner.roundFeed 恢复界面；done 后保留 roundFeed 到 reload 完成再 clear，防终答闪空。
 * - 删群标 abandoned + abort 防僵尸。
 */

import { useRef, useCallback } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import { MAX_QUEUE } from '../../../components/chat/QueuedChips';

export interface FeedTool {
  tool: string; args: Record<string, string>; result?: string;
  status: 'running' | 'success' | 'error';
}

/** 统一渲染项：历史消息 + 本轮实时消息共用（仿对流单数组模型） */
export interface FeedMsg {
  speaker: string;
  content: string;
  isHuman: boolean;
  isArchiveSummary?: boolean;
  streaming?: boolean;
  phase?: string;
  /** 原生思考流（流式当轮显示；不进上下文，重载不保留） */
  reasoning?: string;
  tools: FeedTool[];
}

/** 单个群聊一轮的运行态。归属 roomId，不归属当前界面。 */
interface RoomRunner {
  /** 本轮新增消息（乐观人类 + 各工位流式），落库前先展示 */
  roundFeed: FeedMsg[];
  /** 当前正在说话的工位标签；'' = 无（用于把 token/tool 定位到对应消息） */
  activeSpeaker: string;
  streaming: boolean;
  done: boolean;
  ctrl: AbortController;
  abandoned: boolean;
  /** 用户手动「停止」→ true。done-effect 据此「退回队列入框」而非续发。 */
  userStopped: boolean;
}

/** 把一个 RoomEvent 应用到 roundFeed（流式累积逻辑，从 RoomPanel.speak 内联处理抽出）。 */
function applyEvent(ev: any, r: RoomRunner): void {
  const feed = r.roundFeed;
  switch (ev.type) {
    case 'seat-start':
      r.activeSpeaker = ev.speaker;
      feed.push({ speaker: ev.speaker, content: '', isHuman: false, streaming: true, phase: '思考中...', tools: [] });
      break;
    case 'token': {
      const m = feed[feed.length - 1];
      if (m && m.speaker === r.activeSpeaker) { m.content += ev.content; m.phase = ''; }
      break;
    }
    case 'reasoning': {
      const m = feed[feed.length - 1];
      if (m && m.speaker === r.activeSpeaker) { m.reasoning = (m.reasoning || '') + ev.content; m.phase = ''; }
      break;
    }
    case 'tool-call': {
      const m = feed[feed.length - 1];
      if (m && m.speaker === r.activeSpeaker) {
        m.tools.push({ tool: ev.tool, args: ev.args, status: 'running' });
        m.phase = `调用 ${ev.tool}...`;
      }
      break;
    }
    case 'tool-result': {
      const m = feed[feed.length - 1];
      if (m && m.speaker === r.activeSpeaker) {
        for (let k = m.tools.length - 1; k >= 0; k--) {
          if (m.tools[k].status === 'running') { m.tools[k] = { ...m.tools[k], result: ev.result, status: ev.ok ? 'success' : 'error' }; break; }
        }
        m.phase = '';
      }
      break;
    }
    case 'seat-done': {
      const m = feed[feed.length - 1];
      if (m && m.speaker === ev.speaker) { m.content = ev.content || m.content; m.streaming = false; m.phase = ''; }
      r.activeSpeaker = '';
      break;
    }
    case 'error':
      feed.push({ speaker: '系统', content: ev.message, isHuman: false, tools: [] });
      break;
  }
}

async function streamSSE(path: string, body: Record<string, unknown>, onEvent: (ev: any) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(streamUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await res.text());
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = '';
  const processLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const p = t.slice(5).trim();
    if (!p || p === '[DONE]') return;
    try { onEvent(JSON.parse(p)); } catch (e) { console.warn('[cyclone] 群聊 SSE 事件解析失败', p, e); }
  };
  while (true) {
    if (signal.aborted) { reader.cancel(); break; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  }
  // 收尾：flush 解码器 + 处理末尾未换行终结的残留
  buf += dec.decode();
  if (buf) for (const line of buf.split('\n')) processLine(line);
}

/**
 * @param onRoomFinished 任一群聊轮结束后回调（CyclonePage 级稳定引用，刷新侧栏）
 */
export function useRoomStreamRunners(onRoomFinished: (roomId: string) => void) {
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

  /** 手动停止：abort 本地流 + 通知服务端 abort。 */
  const abortRoom = useCallback((workshopId: string, roomId: string) => {
    const r = runners.current.get(roomId);
    if (r) { r.userStopped = true; r.ctrl.abort(); }
    fetch(streamUrl(`/api/cyclone/workshop/${workshopId}/room/${roomId}/abort`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
  }, []);

  /** 删群：标弃用 + 掐流 + 通知服务端 abort。 */
  const kill = useCallback((workshopId: string, roomId: string) => {
    const r = runners.current.get(roomId);
    queues.current.delete(roomId);   // 删群连带清掉其排队 / 草稿
    drafts.current.delete(roomId);
    if (!r) return;
    r.abandoned = true;
    abortRoom(workshopId, roomId);
  }, [abortRoom]);

  /** RoomPanel reload /status 完成后清出已结束的 runner（释放 roundFeed 缓冲）。 */
  const clearIfDone = useCallback((roomId: string) => {
    const r = runners.current.get(roomId);
    if (r && r.done) runners.current.delete(roomId);
  }, []);

  /** 发起一轮群聊（fire-and-forget，脱离组件生命周期）。 */
  const startRound = useCallback((workshopId: string, roomId: string, text: string) => {
    if (runners.current.get(roomId)?.streaming) return;

    const ctrl = new AbortController();
    const runner: RoomRunner = {
      // 人类发言乐观上屏（落库前先展示，存进 runner 避免切走丢失）
      roundFeed: [{ speaker: '人类', content: text, isHuman: true, tools: [] }],
      activeSpeaker: '',
      streaming: true,
      done: false,
      ctrl,
      abandoned: false,
      userStopped: false,
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
          `/api/cyclone/workshop/${workshopId}/room/${roomId}/speak`,
          { message: text },
          (ev) => { applyEvent(ev, runner); if (HIGH_FREQ.has(ev.type)) scheduleNotify(); else flushNotify(); },
          ctrl.signal,
        );
      } catch (e) {
        if (!ctrl.signal.aborted) {
          runner.roundFeed.push({ speaker: '系统', content: `[请求失败] ${(e as Error).message}`, isHuman: false, tools: [] });
        }
      } finally {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        runner.streaming = false;
        runner.done = true;
        notify(roomId);            // 当前挂载的 RoomPanel → reload /status 后 clearIfDone
        onRoomFinished(roomId);    // 刷新侧栏（即使 RoomPanel 未挂载也生效）
      }
    })();
  }, [notify, onRoomFinished]);

  return { subscribe, getRunner, startRound, abortRoom, kill, clearIfDone,
    getQueue, enqueue, dequeue, removeQueued, takeAllQueued, getDraft, setDraft };
}

export type RoomStreamRunners = ReturnType<typeof useRoomStreamRunners>;
