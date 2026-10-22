import { CompactionStatus } from '../../../components/common/CompactionStatus';
import { compactionActivity } from '../../../components/common/compaction-activity';
import { visibleCycloneCompaction } from './cyclone-compaction-activity';
import { useCycloneContextOperation } from './useCycloneContextOperation';
/**
 * 气旋群聊面板 —— 对齐对流中栏布局
 *
 * 布局：Header（标题 + 话题 + 会议设置）
 *       + Messages（对流式气泡，头像 + speaker label + 工具卡片）+ Input（chat__ 输入区）。
 * 发言模型：人发一句 → 在场工位串行响应（SSE 流式），仿对流 handleSpeak。
 * 流式：运行态不在本组件，存于 CyclonePage 级 useRoomStreamRunners 注册表（按 roomId 索引）。
 *       本组件只订阅自身 roomId、读 runner.roundFeed 缓冲渲染。切走/重挂不掐流、不丢内容。
 * 复用季风渲染原子：ToolCallMessage（工具卡片）+ renderTextWithCode（markdown）+ chat__/conv__ 全局 CSS。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import type { RoomStreamRunners } from './useRoomStreamRunners';
import type { FeedMsg } from './room-stream-events';
import { useDroppedPathInput } from '../../../lib/useDroppedPathInput';
import DispatchIndex from './DispatchIndex';
import RoomTimeline from './RoomTimeline';
import RoomComposer from './RoomComposer';
import RoomSettingsPanel from './RoomSettingsPanel';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';
import { useRoomStatus } from './useRoomStatus';
import { useRoomDispatchFeedback } from './useRoomDispatchFeedback';
import { findRoomMessageIndex, snapshotRoomMessage,
  type ExpectedRoomMessage } from './room-message-identity';
import '../../../styles/components/convection.css';
import { useSmartChatScroll } from './useSmartChatScroll';
import { useLocale } from '../../../i18n/LocaleContext';
import type { ExternalRoomView } from './useRoomExternalActivity';
import { abortCycloneExecution } from './cyclone-execution-client';
import { formatCycloneUsage, useCycloneUsage } from './cyclone-token-usage';
import { CompactionNotice } from '../../../components/common/CompactionNotice';
import { ContactActivityScope } from './ContactActivityScope';
import { visibleCompactionFeedback } from '../../../components/common/compaction-feedback';
import {
  deleteCycloneRoomMessage,
  editCycloneRoomMessage,
  resetCycloneRoomContext as resetRoomContextThroughCenter,
  compactCycloneRoomContext,
} from './cyclone-control-client';

interface SeatLite { id: string; title: string; }

export default function RoomPanel({ workshopId, roomId, seats, runners, dispatches,
  externalRoom, onDispatchAction, onChanged, onOpenSeat, settingsLocked = false, active = true }: {
  workshopId: string; roomId: string; seats: SeatLite[]; runners: RoomStreamRunners;
  dispatches: CycloneDispatch[];
  externalRoom: ExternalRoomView;
  onDispatchAction: (roomId: string, dispatchId: string, action: DispatchAction) => Promise<CycloneDispatch>;
  onChanged?: () => void; onOpenSeat: (seatId: string) => void; settingsLocked?: boolean; active?: boolean;
}) {
  const { t, locale } = useLocale();
  const confirm = useConfirm();
  // 草稿初值取自注册表：切走/重挂回来未发文本还在（内存级）
  const [input, setInputRaw] = useState(() => runners.getDraft(roomId));
  const [editingMessage, setEditingMessage] = useState<ExpectedRoomMessage | null>(null);
  const [editMessageContent, setEditMessageContent] = useState('');
  /** 订阅 tick：runner 每次 notify 自增，触发本组件重渲染读取最新 roundFeed 缓冲 */
  const [, forceTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const settlingRunId = useRef('');
  // 写穿草稿：每次改动同步进注册表，组件卸载/重挂不丢
  const setInput = useCallback((v: string | ((p: string) => string)) => {
    setInputRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      runners.setDraft(roomId, next);
      return next;
    });
  }, [runners, roomId]);
  // 桌面端：拖入文件 → 路径进群聊主对话框（仅工作室页可见时）
  useDroppedPathInput(setInput, inputRef, active);

  const runner = runners.getRunner(roomId);
  const externalActivity = externalRoom.activity?.operationId === `room:${workshopId}:${roomId}`
    ? externalRoom.activity : null;
  const externalFact = externalRoom.fact?.operationId === `room:${workshopId}:${roomId}`
    ? externalRoom.fact : null;
  const streaming = !!runner?.streaming || (!!externalActivity?.running && !externalRoom.error);
  const { room, history, error: loadError, reload, loadedScope } = useRoomStatus({
    workshopId, roomId, active, streaming, onChanged,
  });
  const contextOperation = useCycloneContextOperation(`${workshopId}:${roomId}`, reload);
  const storedCompaction = compactionActivity(room?.compaction);
  const contextBusy = contextOperation.busy || (!streaming && storedCompaction?.phase === 'running');
  const compaction = contextOperation.busy ? contextOperation.activity
    : visibleCycloneCompaction(runner ? runner.compaction : externalActivity?.compaction,
      storedCompaction, contextOperation.activity);
  const liveUsage = runner ?? externalActivity;
  const tokenUsage = useCycloneUsage(`${workshopId}:${roomId}`,
    liveUsage?.lastKnownTokenUsage ?? liveUsage?.tokenUsage,
    loadedScope === `${workshopId}:${roomId}` ? room?.publicLatestTokenUsage : undefined,
    streaming || contextBusy);
  const token = formatCycloneUsage(tokenUsage, locale);
  const editingMessageIndex = editingMessage && room
    ? findRoomMessageIndex(room.publicMessages, editingMessage) : null;
  const editingMessageChanged = editingMessage !== null && editingMessageIndex === -1;
  const queue = runners.getQueue(roomId);
  // 即使 done 也继续显示 roundFeed，直到 reload 完成 + clearIfDone 删除 runner，避免终答闪空
  const roundFeed = runner?.roundFeed ?? externalActivity?.roundFeed ?? null;
  const roomLiveSignal = roundFeed?.map(message => (
    `${message.key}:${message.content.length}:${message.reasoning?.length ?? 0}:${message.phase ?? ''}`
  )).join('|') ?? '';
  const { scrollRef, showJumpButton, scrollToBottom } = useSmartChatScroll({
    scopeKey: roomId,
    enabled: !!room,
    content: history,
    liveContent: roomLiveSignal,
  });
  const { roomDispatches, notice: dispatchNotice, setNotice: setDispatchNotice,
    highlightedId: highlightedDispatchId, focus: focusDispatch } = useRoomDispatchFeedback({
    roomId, dispatches, onDispatchAction, scrollRef,
  });
  // 挂载：订阅 runner 通知；状态读取由独立的 room status port 完成。
  useEffect(() => {
    const unsub = runners.subscribe(roomId, () => forceTick(t => t + 1));
    return unsub;
  }, [roomId, runners]);

  // runner 结束后：reload 落库历史（publicMessages），再清出 runner 释放 roundFeed，避免双源重影
  const doneRoomId = runner?.done ? roomId : null;
  useEffect(() => {
    if (!doneRoomId) return;
    const wasStopped = !!runners.getRunner(doneRoomId)?.userStopped;
    (async () => {
      await reload(true);
      runners.clearIfDone(doneRoomId);
      if (wasStopped) {
        // 用户「停止」：不续发，排队项 + 当前草稿合并退回输入框
        const items = runners.takeAllQueued(doneRoomId);
        if (items.length) {
          const merged = [...items, runners.getDraft(doneRoomId)].filter(s => s.trim()).join('\n');
          setInput(merged);
        }
      } else {
        const next = runners.dequeue(doneRoomId);
        if (next != null) dispatchText(next);  // 自然结束：逐条出队续发
      }
      forceTick(t => t + 1);
    })();
  }, [doneRoomId, reload, runners]);

  useEffect(() => {
    if (!active || !externalActivity || externalActivity.running
      || settlingRunId.current === externalActivity.runId) return;
    const runId = externalActivity.runId;
    settlingRunId.current = runId;
    void reload(true).then(loaded => {
      if (!loaded) return;
      externalRoom.clearIfSettled(runId);
      const next = runners.dequeue(roomId);
      if (next != null) void dispatchText(next);
    }).finally(() => { if (settlingRunId.current === runId) settlingRunId.current = ''; });
  }, [active, externalActivity, externalRoom.clearIfSettled, reload, roomId, runners]);

  // ── 房间写操作 ──
  async function runAction(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    try { await action(); } catch (error) {
      alert((error as Error).message || fallback);
      await reload(true);
      return false;
    }
    await reload(true);
    return true;
  }
  function startEditMessage(message: FeedMsg) {
    if (message.sourceIndex === undefined) return;
    const original = room?.publicMessages[message.sourceIndex];
    if (!original) return;
    setEditingMessage(snapshotRoomMessage(original));
    setEditMessageContent(message.content);
  }

  function cancelEditMessage() {
    setEditingMessage(null);
    setEditMessageContent('');
  }

  async function saveEditMessage() {
    if (!editingMessage || editingMessageIndex === null || editingMessageIndex < 0) return;
    if (await runAction(
      () => editCycloneRoomMessage(workshopId, roomId, editingMessageIndex,
        editMessageContent, editingMessage),
      t('cyclone.roomPanel.editFailed'),
    )) cancelEditMessage();
  }

  async function deleteMessage(message: FeedMsg) {
    if (message.sourceIndex === undefined) return;
    const original = room?.publicMessages[message.sourceIndex];
    if (!original) return;
    const expected = snapshotRoomMessage(original);
    if (!(await confirm({ title: t('cyclone.roomPanel.deleteTitle'), message: t('cyclone.roomPanel.deleteMessage'), confirmText: t('common.delete'), danger: true }))) return;
    if (await runAction(
      () => deleteCycloneRoomMessage(workshopId, roomId, message.sourceIndex as number, expected),
      t('cyclone.roomPanel.deleteFailed'),
    )) {
      if (editingMessageIndex === message.sourceIndex) cancelEditMessage();
    }
  }

  async function resetRoomContext(mode: 'clear' | 'summary', scope: 'public' | 'both' = 'public') {
    if (streaming) return;
    const label = t(scope === 'both' ? 'cyclone.roomPanel.scopeBoth' : 'cyclone.roomPanel.scopePublic');
    const action = t(mode === 'summary' ? 'cyclone.roomPanel.resetSummary' : 'cyclone.roomPanel.resetClear');
    if (mode === 'clear' && !(await confirm({
      title: t('cyclone.roomPanel.resetTitle', { action, scope: label }),
      message: t('cyclone.roomPanel.resetMessage'),
      confirmText: t('cyclone.roomPanel.confirmClear'), danger: true,
    }))) return;
    const result = await contextOperation.run(mode === 'summary' ? 'compact' : 'reset', signal => mode === 'summary'
      ? compactCycloneRoomContext(workshopId, roomId, scope, signal)
      : resetRoomContextThroughCenter(workshopId, roomId, mode, scope, signal));
    if (result === 'completed') {
      const next = runners.dequeue(roomId);
      if (next != null) void dispatchText(next);
    } else if (result === 'stopped') {
      const items = runners.takeAllQueued(roomId);
      if (items.length) setInput([...items, runners.getDraft(roomId)].filter(item => item.trim()).join('\n'));
    }
  }

  /** 实际派发一轮：slash 指令优先，否则发起群聊轮。出队续发与即时发送共用。 */
  async function dispatchText(text: string) {
    if (text === '/reset' || text === '/reset clear') { await resetRoomContext('clear', 'public'); return; }
    if (text === '/compact' || text === '/reset summary') { await resetRoomContext('summary', 'public'); return; }
    if (text === '/reset all' || text === '/reset all clear') { await resetRoomContext('clear', 'both'); return; }
    if (text === '/reset all summary') { await resetRoomContext('summary', 'both'); return; }
    if (!room || room.participantSeatIds.length === 0) { alert(t('cyclone.roomPanel.noSeats')); return; }
    // 流式运行态托管给注册表：切走房间不掐流、后台续跑、切回读 roundFeed 恢复
    runners.startRound(workshopId, roomId, text);
  }

  function speak() {
    if (contextBusy) return;
    contextOperation.clear();
    const text = input.trim();
    if (!text) return;
    if (streaming) {                       // 运行期：入队，不打断当前轮
      if (runners.enqueue(roomId, text)) setInput('');
      return;
    }
    setInput('');
    dispatchText(text);
  }

  function stop() {
    if (contextOperation.busy) { contextOperation.cancel(); return; }
    if (runner?.streaming) { runners.abortRoom(roomId); return; }
    if (externalActivity?.running) {
      void abortCycloneExecution(externalActivity.operationId, externalActivity.runId)
        .catch(error => alert((error as Error).message));
    }
  }

  async function handleDispatchAction(dispatchId: string, action: DispatchAction) {
    try {
      await onDispatchAction(roomId, dispatchId, action);
      if (action === 'include') await reload(true);
    } catch (error) {
      alert((error as Error).message);
    }
  }

  if (!room) {
    if (loadError) return <div style={{ opacity: .65, margin: 'auto', padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-danger)' }}>{loadError}</div>;
    return <div style={{ opacity: .5, margin: 'auto' }}>{t('cyclone.roomPanel.loading')}</div>;
  }
  return (
    <ContactActivityScope workshopId={workshopId} targetId={roomId} active={active}>
    <div className="cyclone-room" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, position: 'relative' }}>
      {/* Header */}
      <div className="conv__header">
        <span className="conv__header-title"># {room.title}</span>
        <span className="conv__header-id">{room.topic}</span>
        <span className="conv__header-tokens" title={token.title}>{token.label}</span>
        <DispatchIndex dispatches={roomDispatches} onSelect={focusDispatch} />
        <RoomSettingsPanel room={room} seats={seats}
          workshopId={workshopId} roomId={roomId}
          roomUrl={`/api/cyclone/workshop/${workshopId}/room/${roomId}`}
          locked={streaming || settingsLocked || contextBusy} onChanged={async () => { await reload(true); }} />
      </div>

      {loadError && <div role="alert" className="agent-detail__error">
        {t('cyclone.roomPanel.loadFailed')}: {loadError}
      </div>}
      {editingMessageChanged && <div role="alert" className="agent-detail__error">
        {t('cyclone.roomPanel.editChanged')}
        <button type="button" onClick={cancelEditMessage}>{t('common.cancel')}</button>
      </div>}
      {externalRoom.error && !runner?.streaming && (
        <div role="status" className="agent-detail__error">{t('cyclone.roomPanel.loadFailed')}: {externalRoom.error}</div>
      )}
      {externalFact && (externalFact.status === 'failed' || externalFact.status === 'crashed') && (
        <div role="alert" className="agent-detail__error">
          {externalFact.errorMessage || t('cyclone.tabs.failed')}
        </div>
      )}

      {/* Messages：已落库 history + 本轮 roundFeed（流式中 history 不含本轮；done 后 reload 带回、clearIfDone 清 roundFeed，无重影） */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        <div ref={scrollRef} className="chat__messages conv__messages" style={{ flex: 1, overflowY: 'auto' }}>
          <CompactionNotice message={visibleCompactionFeedback(
            runner ? runner.compactionNotice : externalActivity?.compactionNotice, room.compactionNotice,
          )} />
          <RoomTimeline history={history} roundFeed={roundFeed} dispatches={roomDispatches}
            mediaScope={{ feature: 'cyclone', workshopId, kind: 'room', targetId: roomId }}
            highlightedId={highlightedDispatchId} editingMessageIndex={editingMessageIndex}
            editMessageContent={editMessageContent} onEditContent={setEditMessageContent}
            onStartEdit={startEditMessage} onSaveEdit={saveEditMessage} onCancelEdit={cancelEditMessage}
            onDelete={deleteMessage} onDispatchAction={handleDispatchAction} onOpenSeat={onOpenSeat} />
        </div>
        {showJumpButton && (
          <button className="chat__jump-bottom" onClick={() => scrollToBottom('smooth')}
            aria-label={t('cyclone.roomPanel.jumpBottom')} title={t('cyclone.roomPanel.jumpLatest')}>↓</button>
        )}
      </div>

      {dispatchNotice && (
        <button type="button" className="cyclone-dispatch-toast" role="status"
          onClick={() => { focusDispatch(dispatchNotice); setDispatchNotice(null); }}>
          <span className="cyclone-dispatch__dot" />
          {t(dispatchNotice.status === 'completed' ? 'cyclone.roomPanel.dispatchCompleted' : 'cyclone.roomPanel.dispatchFailed', { seat: dispatchNotice.targetSeatTitle })}
        </button>
      )}

      <CompactionStatus activity={compaction} />
      <RoomComposer inputRef={inputRef} input={input} streaming={streaming || contextOperation.busy}
        disabled={contextBusy} phase={compaction?.phase === 'running' ? undefined : externalRoom.error || roundFeed?.[roundFeed.length - 1]?.phase} queue={queue}
        onInput={setInput} onSend={speak} onStop={stop}
        onRemoveQueued={index => runners.removeQueued(roomId, index)} />
    </div>
    </ContactActivityScope>
  );
}
