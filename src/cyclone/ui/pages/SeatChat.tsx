/**
 * 气旋工位私聊面板 —— 复用季风渲染原子，对齐季风会话视觉
 *
 * 渲染：季风 ToolCallMessage / DelegateCard / AskCard + 气旋 ContactCard + renderTextWithCode。
 * 流式：运行态不在本组件，存于 CyclonePage 级 useSeatStreamRunners 注册表（按 seatId 索引）。
 *       本组件只订阅自身 seatId、读 runner.live 缓冲渲染。切走/重挂不掐流、不丢内容。
 * 重载：从 /status 取 ContextMessage[]，contextToDisplay 配对成块，不丢内容。
 * ask：渲染季风 AskCard（选项按钮+自由输入），回复走 resume 端点续跑挂起循环。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import { renderTextWithCode } from '../../../engine/markdown';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { CompactionNotice } from '../../../components/common/CompactionNotice';
import { visibleCompactionFeedback, type StoredCompactionFeedback } from '../../../components/common/compaction-feedback';
import AskCard from '../../../components/chat/AskCard';
import QueuedChips, { MAX_QUEUE } from '../../../components/chat/QueuedChips';
import TaskBoardDrawer, { RAIL_W } from '../../../components/chat/TaskBoardDrawer';
import { useTaskboardObservations } from '../../../components/chat/useTaskboardObservations';
import {
  loadSeatTaskboard, saveSeatTaskboard, TaskboardConflictError, type TaskBoard,
} from '../../../utils/taskboard';
import { contextToDisplay, type DisplayMessage } from './messageDisplay';
import type { SeatStreamRunners } from './useSeatStreamRunners';
import { useDroppedPathInput } from '../../../lib/useDroppedPathInput';
import ExecutionStatusBar from '../../../components/chat/ExecutionStatusBar';
import SeatDispatchActivity from './SeatDispatchActivity';
import { selectOrphanedSeatDispatches, type CycloneDispatch } from './dispatch-timeline';
import {
  dispatchesRequiringSeatReload,
  findActiveSeatDispatch,
  formatSeatDispatchActivity,
} from './seat-dispatch-activity';
import { SeatDispatchReceipt, SeatOutboundDispatch } from './SeatDispatchCard';
import { useSmartChatScroll } from './useSmartChatScroll';
import { buildSeatDisplayHistory, hasUnansweredAsk } from './cyclone-reply-sequence';
import SeatTurnCard from './SeatTurnCard';
import { createLiveSeatTurn, projectSeatTimeline } from './seat-turn-projection';
import { useSeatExternalActivity } from './useSeatExternalActivity';
import { usePrivateChatActivity } from './usePrivateChatActivity';
import { projectPrivateChatLive } from './private-chat-live';
import { abortCycloneExecution } from './cyclone-execution-client';
import { subscribeCycloneChanges } from './cyclone-change-client';
import { createSeatHistoryRefresher } from './seat-history-refresh';
import { formatCycloneUsage, visibleCycloneUsage, type CycloneUsage } from './cyclone-token-usage';
import {
  deleteCyclonePrivateMessage,
  editCyclonePrivateMessage,
  resetCyclonePrivateContext,
  compactCyclonePrivateContext,
  type CyclonePrivateTarget,
} from './cyclone-control-client';

interface SeatStatus {
  id: string; title: string;
  messages: { role: string; content: string; toolCalls?: any[]; toolCallId?: string }[];
  pending?: { question: string; options?: string[] };
  updatedAt?: string;
  tokenUsage?: CycloneUsage;
  compactionNotice?: StoredCompactionFeedback;
}

export default function SeatChat({ workshopId, seatId, runners, dispatches = [], onReloaded,
  chairBase, chairRoomId, active = false }: {
  workshopId: string; seatId: string; runners: SeatStreamRunners; onReloaded?: () => void;
  dispatches?: CycloneDispatch[];
  /** 会议助理模式下覆盖端点前缀（如 /api/cyclone/workshop/{wid}/room/{rid}/chair）。普通工位不传。 */
  chairBase?: string;
  chairRoomId?: string;
  /** 当前工作室页是否可见。仅用于桌面拖拽路径接收，会议助理实例（chairBase 存在）始终不接收。 */
  active?: boolean;
}) {
  const { t, locale } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const confirm = useConfirm();
  const [seat, setSeat] = useState<SeatStatus | null>(null);
  const [history, setHistory] = useState<DisplayMessage[]>([]);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editMessageContent, setEditMessageContent] = useState('');
  // 草稿初值取自注册表：切走/重挂回来未发文本还在（内存级，硬退出不留）
  const [input, setInputRaw] = useState(() => runners.getDraft(seatId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  /** 订阅 tick：runner 每次 notify 自增，触发本组件重渲染读取最新 live 缓冲 */
  const [, forceTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onReloadedRef = useRef(onReloaded);
  const revisionRef = useRef('');
  const reloadSeq = useRef(0);
  const settlingPrivateRun = useRef('');
  onReloadedRef.current = onReloaded;
  // 写穿草稿：每次改动同步进注册表，组件卸载/重挂不丢
  const setInput = useCallback((v: string | ((p: string) => string)) => {
    setInputRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      runners.setDraft(seatId, next);
      return next;
    });
  }, [runners, seatId]);
  // 桌面端：拖入文件 → 路径进工位主对话框；会议助理实例(chairBase)始终绕开
  useDroppedPathInput(setInput, inputRef, active && !chairBase);
  useEffect(() => {
    if (!input) inputRef.current?.style.removeProperty('height');
  }, [input]);

  const isChair = seatId.startsWith('__chair__');
  const privateTarget: CyclonePrivateTarget = isChair
    ? { kind: 'chair', roomId: chairRoomId ?? seatId.slice('__chair__:'.length) }
    : { kind: 'seat', seatId };
  const runner = runners.getRunner(seatId);
  const externalView = useSeatExternalActivity(workshopId, seatId, active && !isChair);
  const externalActivity = externalView.activity;
  const externalError = externalView.error;
  // 即使 done 也继续显示 live，直到 reload 完成 + clearIfDone 删除 runner，避免终答闪空
  const externalActivityId = externalActivity?.id;
  const localStreaming = !!runner?.streaming;
  const privateActivity = usePrivateChatActivity(
    workshopId, isChair ? 'chair' : 'seat', isChair ? (chairRoomId ?? seatId.slice('__chair__:'.length)) : seatId,
    active && !localStreaming, localStreaming, locale,
  );
  const agentActivity = privateActivity.activity;
  const clearAgentActivity = privateActivity.clearIfSettled;
  const { live, streaming, agentRunning, legacyRunning: externalRunning } = projectPrivateChatLive({
    local: runner?.live ?? null, localStreaming, agentActivity,
    agentError: privateActivity.error, legacy: externalActivity, legacyError: externalError,
    factStatus: privateActivity.fact?.status ?? null,
  });
  const queue = runners.getQueue(seatId);
  const activeDispatch = isChair ? null : findActiveSeatDispatch(dispatches, seatId);
  const dispatchActivity = activeDispatch ? formatSeatDispatchActivity(activeDispatch, t) : null;
  const busy = streaming || !!activeDispatch || contextBusy;
  const taskboardObservations = useTaskboardObservations('cyclone', `${workshopId}:${seatId}`, streaming && !isChair);
  const dispatchStatuses = useRef(new Map<string, CycloneDispatch['status']>());
  const receiptStates = useRef(new Map<string, CycloneDispatch['receiptState']>());
  const externalStateRef = useRef('');
  const dispatchTextRef = useRef<(text: string) => void>(() => {});
  const seatLiveSignal = [
    ...(live?.segments.map(segment => `${segment.content.length}:${segment.blocks.length}`) ?? []),
    live?.reasoning?.length ?? 0,
    live?.phase ?? '',
    ...dispatches.filter(item => item.sourceKind === 'seat' && item.sourceSeatId === seatId)
      .map(item => `${item.id}:${item.status}:${item.updatedAt}`),
    activeDispatch ? `${activeDispatch.id}:${activeDispatch.status}:${activeDispatch.updatedAt}` : '',
  ].join('|');
  const { scrollRef, showJumpButton, scrollToBottom } = useSmartChatScroll({
    scopeKey: seatId,
    enabled: !!seat,
    content: history,
    liveContent: seatLiveSignal,
  });

  // ── 任务板（工位=会话，与季风同构；会议助理无工具，不挂板） ──
  const [board, setBoard] = useState<TaskBoard | null>(null);
  const [tbOpen, setTbOpen] = useState(() => { try { return localStorage.getItem('cyclone.taskboard.open') === '1'; } catch { return false; } });
  const [tbUnseen, setTbUnseen] = useState(false);
  const tbOpenRef = useRef(tbOpen);
  useEffect(() => { tbOpenRef.current = tbOpen; }, [tbOpen]);
  // 切工位时载入该工位的任务板（后端 task_board 落盘的同一文件）
  useEffect(() => {
    setTbUnseen(false);
    if (isChair) { setBoard(null); return; }
    let alive = true;
    loadSeatTaskboard(workshopId, seatId).then(b => { if (alive) setBoard(b); });
    return () => { alive = false; };
  }, [workshopId, seatId, isChair]);
  // agent 通过 meta 侧通道更新板子（applyEvent 写进 live.taskboard）→ 刷新 + 收起时点亮未看
  const liveBoard = live?.taskboard;
  useEffect(() => {
    if (liveBoard !== undefined) {
      setBoard(liveBoard);
      if (!tbOpenRef.current && liveBoard?.tasks.length) setTbUnseen(true);
    }
  }, [liveBoard]);
  const toggleTb = useCallback(() => setTbOpen(o => {
    const n = !o;
    try { localStorage.setItem('cyclone.taskboard.open', n ? '1' : '0'); } catch { /* ignore */ }
    if (n) setTbUnseen(false);
    return n;
  }), []);
  const onTbChange = useCallback((next: TaskBoard | null) => {
    setBoard(next);
    const expectedRevision = board?.revision ?? 0;
    saveSeatTaskboard(workshopId, seatId, next, expectedRevision)
      .then(setBoard)
      .catch(error => {
        if (error instanceof TaskboardConflictError) setBoard(error.current);
        console.error('[cyclone] 任务板保存失败', error);
      });
  }, [workshopId, seatId, board]);

  /** 拉取工位/会议助理会话。notifyParent=true 时通知父级刷新侧栏 */
  const reload = useCallback(async (notifyParent = false): Promise<boolean> => {
    const seq = ++reloadSeq.current;
    const isChair = seatId.startsWith('__chair__');
    const url = isChair
      ? `${chairBase}/status`
      : `/api/cyclone/workshop/${workshopId}/seat/${seatId}/status`;
    try {
      const r = await fetch(url);
      if (seq !== reloadSeq.current) return false;
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || tRef.current(isChair ? 'cyclone.seatChat.loadChairFailed'
          : 'cyclone.seatChat.loadSeatFailed', { status: r.status }));
      }
      const raw = await r.json();
      if (seq !== reloadSeq.current) return false;
      const s: SeatStatus = isChair
        ? { id: '__chair__', title: tRef.current('cyclone.seatChat.chairTitle', { agent: raw.chairAgentId }), messages: raw.messages, pending: raw.pending, tokenUsage: raw.tokenUsage, compactionNotice: raw.compactionNotice }
        : raw;
      setLoadError(null); setSeat(s);
      setHistory(contextToDisplay(s.messages, tRef.current('cyclone.seatChat.askFallback')));
      revisionRef.current = s.updatedAt || '';
      if (notifyParent) onReloadedRef.current?.();
      return true;
    } catch (error) {
      if (seq !== reloadSeq.current) return false;
      console.error(`[cyclone] ${tRef.current('cyclone.seatChat.loadFailedLog')}`, error);
      setLoadError((error as Error).message || tRef.current('cyclone.seatChat.loadFailedLog'));
      return false;
    }
  }, [workshopId, seatId, chairBase]);

  useEffect(() => {
    if (isChair) return;
    const previous = dispatchStatuses.current;
    const settled = dispatchesRequiringSeatReload(previous, dispatches, seatId);
    const delivered = dispatches.some(item => (
      item.sourceKind === 'seat'
      && item.sourceSeatId === seatId
      && item.receiptState === 'delivered'
      && receiptStates.current.get(item.id) !== 'delivered'
    ));
    for (const item of dispatches) {
      if (item.targetSeatId === seatId) previous.set(item.id, item.status);
      if (item.sourceKind === 'seat' && item.sourceSeatId === seatId) {
        receiptStates.current.set(item.id, item.receiptState);
      }
    }
    if (settled.length === 0 && !delivered) return;
    void reload(true).then(() => {
      if (settled.length === 0) return;
      if (findActiveSeatDispatch(dispatches, seatId)) return;
      const next = runners.dequeue(seatId);
      if (next != null) dispatchTextRef.current(next);
    });
  }, [dispatches, isChair, reload, runners, seatId]);

  // 挂载：标回前台 + 订阅 runner 通知 + 首次拉历史
  useEffect(() => {
    revisionRef.current = '';
    runners.foreground(seatId);
    const unsub = runners.subscribe(seatId, () => forceTick(t => t + 1));
    void reload();
    return () => { reloadSeq.current += 1; unsub(); };
  }, [seatId, runners, reload]);

  // 外部 Agent/人工修改通过共享变更流唤醒；断线时仍每 2 秒核对权威版本。
  useEffect(() => {
    if (!active || streaming || isChair) return;
    const refresher = createSeatHistoryRefresher(workshopId, seatId, async () => {
      const response = await fetch(`/api/cyclone/workshop/${workshopId}/seat/${seatId}/revision`);
      if (!response.ok) throw new Error(`工位历史版本读取失败 (${response.status})`);
      const revision = await response.json() as { updatedAt?: string };
      return revision.updatedAt || null;
    }, () => revisionRef.current, () => reload());
    let observed: Promise<void> | null = null;
    const observe = (request: Promise<void>) => {
      if (request === observed) return;
      observed = request;
      void request.catch(error => console.error('[cyclone] 工位历史版本检查失败', error))
        .finally(() => { if (observed === request) observed = null; });
    };
    const unsubscribe = subscribeCycloneChanges(event => observe(refresher.wake(event)));
    if (revisionRef.current) observe(refresher.poll());
    const timer = window.setInterval(() => observe(refresher.poll()), 2_000);
    return () => { refresher.stop(); unsubscribe(); window.clearInterval(timer); };
  }, [active, isChair, reload, seatId, streaming, workshopId]);

  // Contact / 入会摘要由其他界面发起：开始时刷新入站消息，结束时刷新最终结果并继续排队输入。
  useEffect(() => {
    if (!externalActivityId || externalError) return;
    const state = `${externalActivityId}:${externalRunning ? 'running' : 'done'}`;
    if (externalStateRef.current === state) return;
    externalStateRef.current = state;
    void reload(!externalRunning).then(() => {
      if (externalRunning) return;
      const next = runners.dequeue(seatId);
      if (next != null) dispatchTextRef.current(next);
    });
  }, [externalActivityId, externalError, externalRunning, reload, runners, seatId]);

  useEffect(() => {
    if (!active || !agentActivity || agentActivity.running || settlingPrivateRun.current === agentActivity.runId) return;
    const runId = agentActivity.runId;
    settlingPrivateRun.current = runId;
    void reload(true).then(loaded => {
      if (!loaded) return;
      clearAgentActivity(runId);
      const next = runners.dequeue(seatId);
      if (next != null) dispatchTextRef.current(next);
    }).finally(() => { if (settlingPrivateRun.current === runId) settlingPrivateRun.current = ''; });
  }, [active, agentActivity, clearAgentActivity, reload, runners, seatId]);

  // runner 结束后：reload 落库历史，再清出 runner 释放 live 缓冲
  const doneRunner = runner?.done ? runner : null;
  const doneSeatId = doneRunner ? seatId : null;
  useEffect(() => {
    if (!doneSeatId || !doneRunner) return;
    const wasStopped = doneRunner.userStopped;
    (async () => {
      await reload(true);
      // Ask 的旧回合结束后，用户可能已经点击回答并启动了 resume runner。
      // 旧 effect 此时才完成 reload，不能清理或出队新 runner 的状态。
      if (runners.getRunner(doneSeatId) !== doneRunner) return;
      runners.clearIfDone(doneSeatId);   // runner 删除后 streaming 归零，下条可发
      if (wasStopped) {
        // 用户「停止」：不续发，把排队项 + 当前草稿合并退回输入框，交回用户
        const items = runners.takeAllQueued(doneSeatId);
        if (items.length) {
          const merged = [...items, runners.getDraft(doneSeatId)].filter(s => s.trim()).join('\n');
          setInput(merged);
        }
      } else {
        const next = runners.dequeue(doneSeatId);
        if (next != null) dispatchText(next);  // 自然结束：逐条出队续发
      }
      forceTick(t => t + 1);
    })();
  }, [doneRunner, doneSeatId, reload, runners]);

  /** 统一发送：chat（新消息）/ resume（回答挂起的 ask） */
  function run(action: 'chat' | 'resume', text: string) {
    // 读 registry 实时态而非组件闭包 streaming —— 出队续发时本轮 runner 已被 clearIfDone 删除，可继续
    if (runners.getRunner(seatId)?.streaming) return;
    let optimisticUser: DisplayMessage | null = null;
    if (action === 'chat') {
      optimisticUser = { id: `u${Date.now()}`, role: 'user', content: text };
    } else if (seat?.pending) {
      const p = seat.pending;
      optimisticUser = { id: `ask${Date.now()}`, role: 'assistant', content: '',
        blocks: [{ kind: 'ask', question: p.question, options: p.options, answered: true, reply: text }] };
    }
    const isChair = seatId.startsWith('__chair__');
    runners.startStream({
      workshopId, seatId, action, text, optimisticUser,
      pathOverride: isChair ? `${chairBase}/${action}` : undefined,
    });
  }

  async function resetContext(mode: 'clear' | 'summary') {
    if (busy) return;
    const isChair = seatId.startsWith('__chair__');
    const label = t(isChair ? 'cyclone.seatChat.chairScope' : 'cyclone.seatChat.seatScope');
    const action = t(mode === 'summary' ? 'cyclone.seatChat.resetSummary' : 'cyclone.seatChat.resetClear');
    if (!(await confirm({
      title: t('cyclone.seatChat.resetTitle', { action, scope: label }),
      message: t('cyclone.seatChat.resetMessage'),
      confirmText: t(mode === 'summary' ? 'cyclone.seatChat.confirmSummary' : 'cyclone.seatChat.confirmClear'), danger: true,
    }))) return;
    setContextBusy(true);
    try {
      if (mode === 'summary') await compactCyclonePrivateContext(workshopId, privateTarget);
      else await resetCyclonePrivateContext(workshopId, privateTarget, mode);
    } catch (error) {
      alert((error as Error).message || t('cyclone.seatChat.resetFailed', { scope: label, status: '' }));
    } finally { await reload(true); setContextBusy(false); }
  }

  function startEditMessage(message: DisplayMessage) {
    if (message.sourceIndex === undefined) return;
    setEditingMessageIndex(message.sourceIndex);
    setEditMessageContent(message.content);
  }

  function cancelEditMessage() {
    setEditingMessageIndex(null);
    setEditMessageContent('');
  }

  async function saveEditMessage() {
    if (editingMessageIndex === null) return;
    try {
      await editCyclonePrivateMessage(
        workshopId, privateTarget, editingMessageIndex, editMessageContent,
      );
    } catch (error) { alert((error as Error).message || t('cyclone.seatChat.editFailed')); return; }
    cancelEditMessage();
    await reload(true);
  }

  async function deleteMessage(message: DisplayMessage) {
    if (message.sourceIndex === undefined) return;
    if (!(await confirm({ title: t('cyclone.seatChat.deleteTitle'), message: t('cyclone.seatChat.deleteMessage'), confirmText: t('common.delete'), danger: true }))) return;
    try {
      await deleteCyclonePrivateMessage(workshopId, privateTarget, message.sourceIndex);
    } catch (error) { alert((error as Error).message || t('cyclone.seatChat.deleteFailed')); return; }
    if (editingMessageIndex === message.sourceIndex) cancelEditMessage();
    await reload(true);
  }

  /** 实际派发一条文本：slash 指令优先，否则发起 chat 流。出队续发与即时发送共用。 */
  function dispatchText(text: string) {
    if (text === '/reset' || text === '/reset clear') { resetContext('clear'); return; }
    if (text === '/compact' || text === '/reset summary') { resetContext('summary'); return; }
    run(pending ? 'resume' : 'chat', text);
  }
  dispatchTextRef.current = dispatchText;

  function sendInput() {
    if (contextBusy) return;
    const text = input.trim();
    if (!text) return;
    if (busy) {                            // 前台流或后台派发运行期：入队，不撞工位锁
      if (runners.enqueue(seatId, text)) setInput('');
      return;
    }
    setInput('');
    dispatchText(text);
  }

  function stop() {
    if (localStreaming) { runners.abortSeat(seatId); return; }
    const execution = privateActivity.activity ?? privateActivity.fact;
    if (execution?.runId) {
      void abortCycloneExecution(execution.operationId, execution.runId)
        .catch(error => alert((error as Error).message));
    }
  }

  if (!seat) {
    if (loadError) return <div style={{ opacity: .65, margin: 'auto', padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-danger)' }}>{loadError}</div>;
    return <div style={{ opacity: .5, margin: 'auto' }}>{seatId.startsWith('__chair__') ? t('cyclone.seatChat.loadingChair') : t('cyclone.seatChat.loadingSeat')}</div>;
  }
  // 挂起态：若历史尚未包含 AskCard，才使用 seat.pending 兼容旧数据。
  const pending = !busy ? seat.pending : undefined;
  const externalOptimistic: DisplayMessage | null = privateActivity.activity ? {
    id: `external-${privateActivity.activity.runId}`, role: 'user',
    content: privateActivity.activity.message,
  } : null;
  const optimistic = localStreaming ? runner?.pendingUser ?? null
    : externalOptimistic ?? runner?.pendingUser ?? null;
  const visibleHistory = buildSeatDisplayHistory(history, optimistic);
  const timeline = projectSeatTimeline(visibleHistory);
  const orphanedDispatches = isChair ? [] : selectOrphanedSeatDispatches(
    dispatches, seatId, [...visibleHistory, ...(live?.segments ?? [])],
  );
  const token = formatCycloneUsage(visibleCycloneUsage(live?.tokenUsage, seat.tokenUsage), locale);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div title={token.title} style={{ alignSelf: 'flex-end', padding: 'var(--space-1) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{token.label}</div>
      {privateActivity.error && <div role="status" className="agent-detail__error">
        {privateActivity.error}</div>}
      {externalError && <div role="status" className="agent-detail__error">{externalError}</div>}
      {loadError && <div role="status" className="agent-detail__error">{loadError}</div>}
      {privateActivity.fact && ['failed', 'crashed'].includes(privateActivity.fact.status) && (
        <div role="alert" className="agent-detail__error">
          {privateActivity.fact.errorMessage || t('cyclone.tabs.failed')}
        </div>
      )}
      {/* 有任务板且收起时：让出竖条宽度，滚动条落在竖条左侧可点可拖；展开态抽屉浮层覆盖，无需让位 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginRight: (!isChair && !tbOpen) ? RAIL_W : 0 }}>
      <div className="chat__messages" ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', ...(!isChair && tbOpen ? { paddingRight: 'calc(var(--space-4) + 30px)' } : {}) }}>
        <CompactionNotice message={visibleCompactionFeedback(live?.compactionNotice, seat.compactionNotice)} />
        {timeline.map(item => item.kind === 'message' ? <DisplayRow
          key={item.message.id} msg={item.message}
          editing={editingMessageIndex === item.message.sourceIndex}
          editContent={editMessageContent} onEditContent={setEditMessageContent}
          onStartEdit={() => startEditMessage(item.message)} onSaveEdit={saveEditMessage}
          onCancelEdit={cancelEditMessage} onDelete={() => deleteMessage(item.message)}
        /> : <SeatTurnCard key={item.turn.id} turn={item.turn} dispatches={dispatches}
          editing={editingMessageIndex === item.turn.actionMessage?.sourceIndex}
          editContent={editMessageContent} onEditContent={setEditMessageContent}
          onStartEdit={startEditMessage} onSaveEdit={saveEditMessage} onCancelEdit={cancelEditMessage}
          onDelete={deleteMessage} onAskReply={answer => run('resume', answer)} />)}
        {orphanedDispatches.map(item => <SeatOutboundDispatch key={item.id} item={item} />)}
        {activeDispatch && <SeatDispatchActivity item={activeDispatch} />}
        {live && <SeatTurnCard turn={createLiveSeatTurn(live.segments, live.reasoning)}
          dispatches={dispatches} streaming={streaming} phase={live.phase}
          onAskReply={answer => run('resume', answer)} />}
        {pending && !runner && !hasUnansweredAsk(visibleHistory) && (
          <AskCard question={pending.question} options={pending.options} answered={false} onReply={(a) => run('resume', a)} />
        )}
      </div>
      {showJumpButton && (
        <button className="chat__jump-bottom" onClick={() => scrollToBottom('smooth')}
          aria-label={t('cyclone.seatChat.jumpBottom')} title={t('cyclone.seatChat.jumpLatest')}>↓</button>
      )}
      </div>

      <div className="chat__input-area">
        <ExecutionStatusBar
          label={contextBusy ? t('chat.page.compacting') : localStreaming ? live?.phase : agentRunning ? live?.phase
            : externalRunning ? (live?.phase || externalActivity?.label) : dispatchActivity?.label}
          target={localStreaming || agentRunning || externalRunning ? live?.activityTarget : dispatchActivity?.target}
        />
        <QueuedChips items={queue} onRemove={i => runners.removeQueued(seatId, i)} />
        <div className="chat__input-wrapper">
          <textarea ref={inputRef} className="chat__input"
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(); } }}
            placeholder={busy ? t('cyclone.seatChat.busyPlaceholder') : (pending ? t('cyclone.seatChat.pendingPlaceholder') : t('cyclone.seatChat.placeholder'))}
            rows={1}
            aria-label={t('cyclone.seatChat.inputLabel')} />
          {busy ? (
            <>
              <button className="chat__send-btn" onClick={sendInput}
                disabled={contextBusy || !input.trim() || queue.length >= MAX_QUEUE}
                title={queue.length >= MAX_QUEUE ? t('cyclone.composer.queueFull') : t('cyclone.composer.enqueue')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
              {(localStreaming || agentRunning || privateActivity.fact?.status === 'running') && (
                <button className="chat__stop-btn" onClick={stop} title={t('cyclone.composer.stop')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                </button>
              )}
            </>
          ) : (
            <button className="chat__send-btn" onClick={sendInput} disabled={!input.trim()} title={pending ? t('cyclone.seatChat.answer') : t('cyclone.composer.send')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          )}
        </div>
        <div style={inputHintStyle}>
          <span>{t('cyclone.seatChat.commands')}</span>
          <code>/reset</code>
          <span>{t('cyclone.seatChat.clear')}</span>
          <code>/compact</code>
          <span>{t('cyclone.seatChat.summary')}</span>
        </div>
      </div>
      {/* 任务板挂在整列层：竖条/抽屉贯穿全高，输入栏 z-index 高于抽屉→展开也不挡发送按钮（与季风同构） */}
      {!isChair && <TaskBoardDrawer board={board} onChange={onTbChange} expanded={tbOpen} onToggle={toggleTb} glow={tbUnseen} observations={taskboardObservations} observationScope="cyclone" observationOwnerId={`${workshopId}:${seatId}`} />}
    </div>
  );
}

const inputHintStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-tertiary)',
  paddingTop: 'var(--space-2)',
  textShadow: 'var(--text-halo)',
};

/** 单条已落库展示消息 */
function DisplayRow({ msg, editing, editContent, onEditContent, onStartEdit, onSaveEdit, onCancelEdit, onDelete }: {
  msg: DisplayMessage;
  editing: boolean;
  editContent: string;
  onEditContent: (value: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  if (msg.kind === 'dispatch-receipt') {
    return <SeatDispatchReceipt content={msg.content} id={msg.id} />;
  }
  if (editing) {
    return (
      <div className={`chat__message chat__message--${msg.role === 'user' ? 'user' : 'assistant'}`}>
        <div className="chat__avatar">{msg.role === 'user' ? t('chat.you') : msg.role === 'system' ? t('cyclone.roomFeed.archiveAvatar') : 'AI'}</div>
        <div className="chat__bubble chat__bubble--editing">
          <textarea className="chat__edit-textarea" value={editContent} onChange={e => onEditContent(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) onSaveEdit(); }} rows={4} autoFocus />
          <div className="chat__edit-actions"><button onClick={onSaveEdit}>{t('common.save')}</button><button onClick={onCancelEdit}>{t('common.cancel')}</button></div>
        </div>
      </div>
    );
  }
  const actions = msg.sourceIndex === undefined ? null : (
    <div className="chat__bubble-actions">
      <button className="chat__msg-action-btn" title={t('common.edit')} aria-label={t('chat.editMessage')} onClick={onStartEdit}>✏</button>
      <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={onDelete}>🗑</button>
    </div>
  );
  if (msg.role === 'user') {
    return (
      <div className="chat__message chat__message--user">
        <div className="chat__avatar">{t('chat.you')}</div>
        <div className="chat__bubble"><div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>{actions}</div>
      </div>
    );
  }
  if (msg.role === 'system') {
    return (
      <div className="chat__message chat__message--assistant chat__message--archive-summary">
        <div className="chat__avatar">{t('cyclone.roomFeed.archiveAvatar')}</div>
        <div className="chat__bubble"><div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>{actions}</div>
      </div>
    );
  }
  return null;
}
