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

import { useRef, useCallback } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import type { DisplayBlock, DisplayMessage } from './messageDisplay';
import type { TaskBoard } from '../../../utils/taskboard';

export interface Live {
  blocks: DisplayBlock[];
  text: string;
  phase: string;
  ask?: { question: string; options?: string[] };
  /** task_board 假工具通过 meta 侧通道回传的最新任务板（undefined=本轮未更新，null=已清空） */
  taskboard?: TaskBoard | null;
}

/** 单条工位流的运行态。归属 seatId，不归属当前界面。 */
interface SeatRunner {
  live: Live;
  /** 乐观插入的用户气泡 / 已答 ask 回显（落库前先展示，存进 runner 避免切走丢失） */
  pendingUser: DisplayMessage | null;
  streaming: boolean;
  /** 流结束（自然/abort）→ true，等当前挂载的 SeatChat reload /status 后 clear */
  done: boolean;
  ctrl: AbortController;
  /** 流式中删工位 → 标记弃用（这里仅前端语义，服务端 abort 已发） */
  abandoned: boolean;
  /** 用户手动「停止」→ true。done-effect 据此「退回队列入框」而非续发。 */
  userStopped: boolean;
  /** 转入后台的时刻；0 = 前台正在看，永不淘汰 */
  backgroundedAt: number;
}

const MAX_BG = 3;

function emptyLive(): Live {
  return { blocks: [], text: '', phase: '等待模型响应...' };
}

/** 把一个 SeatEvent 应用到 Live 累积态（流式 + 重载共用的卡片块构建逻辑）。 */
function applyEvent(ev: any, ls: Live): void {
  switch (ev.type) {
    case 'token':
      ls.text += ev.content; ls.phase = ''; break;
    case 'tool-call':
      ls.blocks.push({ kind: 'tool', tool: ev.tool, args: ev.args, status: 'running' });
      ls.phase = `正在调用 ${ev.tool}...`; break;
    case 'tool-result': {
      // task_board 侧通道：结构化任务板即时刷新抽屉（不进 LLM 上下文）
      if (ev.meta && 'taskboard' in ev.meta) ls.taskboard = ev.meta.taskboard;
      for (let i = ls.blocks.length - 1; i >= 0; i--) {
        const b = ls.blocks[i];
        if (b.kind === 'tool' && b.status === 'running') { ls.blocks[i] = { ...b, result: ev.result, status: ev.ok ? 'success' : 'error' }; break; }
      }
      ls.phase = ''; break;
    }
    case 'delegate-start':
      ls.blocks.push({ kind: 'delegate', id: ev.delegateId, task: ev.task, steps: [], status: 'running' });
      ls.phase = '子任务执行中...'; break;
    case 'delegate-token': {
      const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
      if (b && b.kind === 'delegate') b.content = (b.content || '') + ev.content; break;
    }
    case 'delegate-tool-call': {
      const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
      if (b && b.kind === 'delegate') b.steps.push({ type: 'tool', tool: ev.tool, args: ev.args }); break;
    }
    case 'delegate-tool-result': {
      const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
      if (b && b.kind === 'delegate') {
        for (let i = b.steps.length - 1; i >= 0; i--) {
          if (b.steps[i].tool === ev.tool && b.steps[i].result === undefined) { b.steps[i].result = ev.result; b.steps[i].ok = ev.ok; break; }
        }
      }
      break;
    }
    case 'delegate-done': {
      const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
      if (b && b.kind === 'delegate') { b.summary = ev.summary; b.status = ev.status === 'error' ? 'error' : 'success'; }
      ls.phase = ''; break;
    }
    case 'contact-start':
      ls.blocks.push({ kind: 'contact', id: ev.contactId, target: ev.target, message: ev.message, status: 'running' });
      ls.phase = `联络 ${ev.target}...`; break;
    case 'contact-done': {
      const b = ls.blocks.find(x => x.kind === 'contact' && x.id === ev.contactId);
      if (b && b.kind === 'contact') { b.reply = ev.reply; b.status = ev.ok ? 'success' : 'error'; }
      ls.phase = ''; break;
    }
    case 'answer':
      ls.text = ev.content; ls.phase = ''; break;
    case 'ask':
      ls.ask = { question: ev.question, options: ev.options }; ls.phase = ''; break;
    case 'error':
      ls.text += `\n[错误] ${ev.message}`; break;
  }
}

async function streamSSE(path: string, body: Record<string, unknown>, onEvent: (ev: any) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(streamUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await res.text());
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal.aborted) { reader.cancel(); break; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (!p || p === '[DONE]') continue;
      try { onEvent(JSON.parse(p)); } catch (e) { console.warn('[cyclone] 工位 SSE 事件解析失败', p, e); }
    }
  }
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

export function useSeatStreamRunners(onSeatFinished: (seatId: string) => void) {
  const runners = useRef(new Map<string, SeatRunner>());
  const listeners = useRef(new Map<string, Set<() => void>>());
  /** seatId → 待发消息队列。独立于 runner，clearIfDone 删 runner 后仍存活，跨重挂保留。 */
  const queues = useRef(new Map<string, string[]>());
  /** seatId → 输入框草稿。同样独立存活，切走/重挂不丢未发文本（仅内存，硬退出不留）。 */
  const drafts = useRef(new Map<string, string>());

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

  const getRunner = useCallback((seatId: string): SeatRunner | undefined => runners.current.get(seatId), []);

  // ── 消息队列：运行期发送先入队，本轮结束后由 SeatChat done-effect 逐条出队 ──
  /** 当前队列（只读快照引用；chips 渲染用）。 */
  const getQueue = useCallback((seatId: string): string[] => queues.current.get(seatId) ?? [], []);
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
  const getDraft = useCallback((seatId: string): string => drafts.current.get(seatId) ?? '', []);
  const setDraft = useCallback((seatId: string, text: string) => {
    if (text) drafts.current.set(seatId, text); else drafts.current.delete(seatId);
  }, []);

  /** 后台流超额淘汰最老的（abort 触发服务端落库）。 */
  const evictIfNeeded = useCallback(() => {
    const bg = [...runners.current.values()]
      .filter(r => r.streaming && r.backgroundedAt > 0)
      .sort((a, b) => a.backgroundedAt - b.backgroundedAt);
    for (let i = 0; i < bg.length - MAX_BG; i++) bg[i].ctrl.abort();
  }, []);

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
  const abortSeat = useCallback((workshopId: string, seatId: string, pathOverride?: string) => {
    const r = runners.current.get(seatId);
    if (r) { r.userStopped = true; r.ctrl.abort(); }
    fetch(streamUrl(pathOverride ?? `/api/cyclone/workshop/${workshopId}/seat/${seatId}/abort`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
  }, []);

  /** 删工位：标弃用 + 掐流 + 通知服务端 abort。 */
  const kill = useCallback((workshopId: string, seatId: string) => {
    const r = runners.current.get(seatId);
    if (!r) return;
    r.abandoned = true;
    queues.current.delete(seatId);   // 删工位连带清掉其排队 / 草稿
    drafts.current.delete(seatId);
    abortSeat(workshopId, seatId);
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
      live: emptyLive(),
      pendingUser: optimisticUser,
      streaming: true,
      done: false,
      ctrl,
      abandoned: false,
      userStopped: false,
      backgroundedAt: 0,
    };
    runners.current.set(seatId, runner);
    notify(seatId);

    const payloadKey = action === 'chat' ? 'message' : 'answer';
    const path = opts.pathOverride ?? `/api/cyclone/workshop/${workshopId}/seat/${seatId}/${action}`;
    (async () => {
      try {
        await streamSSE(
          path,
          { [payloadKey]: text },
          (ev) => { applyEvent(ev, runner.live); notify(seatId); },
          ctrl.signal,
        );
      } catch (e) {
        if (!ctrl.signal.aborted) { runner.live.text += `\n[请求失败] ${(e as Error).message}`; }
      } finally {
        runner.streaming = false;
        runner.done = true;
        notify(seatId);          // 当前挂载的 SeatChat → reload /status 后 clearIfDone
        onSeatFinished(seatId);  // 刷新侧栏（即使 SeatChat 未挂载也生效）
      }
    })();
  }, [notify, onSeatFinished]);

  return { subscribe, getRunner, startStream, background, foreground, abortSeat, kill, clearIfDone,
    getQueue, enqueue, dequeue, removeQueued, takeAllQueued, getDraft, setDraft };
}

export type SeatStreamRunners = ReturnType<typeof useSeatStreamRunners>;
