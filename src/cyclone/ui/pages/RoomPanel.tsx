/**
 * 气旋群聊面板 —— 对齐对流中栏布局
 *
 * 布局：Header（标题双击重命名 + 话题）+ Config bar（在场工位 tag：↑↓调序 / ×移除 / + 添加）
 *       + Messages（对流式气泡，头像 + speaker label + 工具卡片）+ Input（chat__ 输入区）。
 * 发言模型：人发一句 → 在场工位串行响应（SSE 流式），仿对流 handleSpeak。
 * 流式：运行态不在本组件，存于 CyclonePage 级 useRoomStreamRunners 注册表（按 roomId 索引）。
 *       本组件只订阅自身 roomId、读 runner.roundFeed 缓冲渲染。切走/重挂不掐流、不丢内容。
 * 复用季风渲染原子：ToolCallMessage（工具卡片）+ renderTextWithCode（markdown）+ chat__/conv__ 全局 CSS。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import type { RoomStreamRunners, FeedMsg } from './useRoomStreamRunners';
import { useDroppedPathInput } from '../../../lib/useDroppedPathInput';
import DispatchIndex from './DispatchIndex';
import RoomTimeline from './RoomTimeline';
import RoomComposer from './RoomComposer';
import RoomConfigBar from './RoomConfigBar';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';
import { publicToFeed, readRoomError, type RoomData } from './room-messages';
import '../../../styles/components/convection.css';
import { useSmartChatScroll } from './useSmartChatScroll';

interface SeatLite { id: string; title: string; }

export default function RoomPanel({ workshopId, roomId, seats, runners, dispatches,
  onDispatchAction, onChanged, onOpenSeat, active = true }: {
  workshopId: string; roomId: string; seats: SeatLite[]; runners: RoomStreamRunners;
  dispatches: CycloneDispatch[];
  onDispatchAction: (roomId: string, dispatchId: string, action: DispatchAction) => Promise<CycloneDispatch>;
  onChanged?: () => void; onOpenSeat: (seatId: string) => void; active?: boolean;
}) {
  const confirm = useConfirm();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [history, setHistory] = useState<FeedMsg[]>([]);
  // 草稿初值取自注册表：切走/重挂回来未发文本还在（内存级）
  const [input, setInputRaw] = useState(() => runners.getDraft(roomId));
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editMessageContent, setEditMessageContent] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dispatchNotice, setDispatchNotice] = useState<CycloneDispatch | null>(null);
  const [highlightedDispatchId, setHighlightedDispatchId] = useState<string | null>(null);
  /** 订阅 tick：runner 每次 notify 自增，触发本组件重渲染读取最新 roundFeed 缓冲 */
  const [, forceTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onChangedRef = useRef(onChanged);
  const knownDispatchesRef = useRef(new Map<string, CycloneDispatch['status']>());
  const mountedAtRef = useRef(Date.now());
  onChangedRef.current = onChanged;
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
  const streaming = !!runner?.streaming;
  const queue = runners.getQueue(roomId);
  // 即使 done 也继续显示 roundFeed，直到 reload 完成 + clearIfDone 删除 runner，避免终答闪空
  const roundFeed = runner?.roundFeed ?? null;
  const roomLiveSignal = roundFeed?.map(message => (
    `${message.key}:${message.content.length}:${message.reasoning?.length ?? 0}:${message.phase ?? ''}`
  )).join('|') ?? '';
  const { scrollRef, showJumpButton, scrollToBottom } = useSmartChatScroll({
    scopeKey: roomId,
    enabled: !!room,
    content: history,
    liveContent: roomLiveSignal,
  });
  const reload = useCallback(async (notify = false) => {
    const r = await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/status`);
    if (!r.ok) {
      const msg = await readRoomError(r, '加载群聊失败');
      console.error('[cyclone] 群聊加载失败', msg);
      setLoadError(msg);
      return;
    }
    setLoadError(null);
    const data: RoomData = await r.json();
    setRoom(data);
    setHistory(publicToFeed(data.publicMessages));
    if (notify) onChangedRef.current?.();
  }, [workshopId, roomId]);

  // 挂载：订阅 runner 通知 + 首次拉历史
  useEffect(() => {
    const unsub = runners.subscribe(roomId, () => forceTick(t => t + 1));
    reload();
    return unsub;
  }, [roomId, runners, reload]);

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

  const roomDispatches = dispatches.filter(item => item.sourceRoomId === roomId);
  useEffect(() => {
    const currentDispatches = dispatches.filter(item => item.sourceRoomId === roomId);
    const previous = knownDispatchesRef.current;
    const completed = currentDispatches.find(item => {
      const terminal = item.status === 'completed' || item.status === 'failed';
      const wasTerminal = previous.get(item.id) === 'completed' || previous.get(item.id) === 'failed';
      const createdHere = Date.parse(item.createdAt) >= mountedAtRef.current;
      return terminal && !wasTerminal && (previous.has(item.id) || createdHere);
    });
    knownDispatchesRef.current = new Map(currentDispatches.map(item => [item.id, item.status]));
    if (completed) setDispatchNotice(completed);
  }, [dispatches, roomId]);

  useEffect(() => {
    if (!dispatchNotice) return;
    const timer = window.setTimeout(() => setDispatchNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [dispatchNotice]);
  // ── 工位管理（替代 prompt）──
  async function postAction(action: string, body: Record<string, unknown>, fallback: string): Promise<boolean> {
    const r = await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) { alert(await readRoomError(r, fallback)); return false; }
    await reload(true);
    return true;
  }
  const joinSeat = (seatId: string) => postAction('join', { seatId }, '添加工位进群失败');
  const leaveSeat = (seatId: string) => postAction('leave', { seatId }, '移除工位失败');
  const toggleMode = () => { if (room) postAction('set-mode', { mode: room.mode === 'plan' ? 'build' : 'plan' }, '切换群聊模式失败'); };
  function moveSeat(idx: number, dir: -1 | 1) {
    if (!room) return;
    const ids = [...room.participantSeatIds];
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    postAction('reorder', { seatIds: ids }, '调整工位顺序失败');
  }
  async function commitTitle() {
    setEditingTitle(false);
    const t = titleDraft.trim();
    if (room && t && t !== room.title) await postAction('rename', { title: t }, '重命名群聊失败');
  }

  function startEditMessage(message: FeedMsg) {
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
    if (await postAction('edit-message', { index: editingMessageIndex, content: editMessageContent }, '编辑消息失败')) cancelEditMessage();
  }

  async function deleteMessage(message: FeedMsg) {
    if (message.sourceIndex === undefined) return;
    if (!(await confirm({ title: '删除此消息？', message: '此操作不可撤销。', confirmText: '删除', danger: true }))) return;
    if (await postAction('delete-message', { index: message.sourceIndex }, '删除消息失败')) {
      if (editingMessageIndex === message.sourceIndex) cancelEditMessage();
    }
  }

  async function resetRoomContext(mode: 'clear' | 'summary', scope: 'public' | 'both' = 'public') {
    if (streaming) return;
    const label = scope === 'both' ? '群聊与会长私聊' : '群聊公共上下文';
    if (!(await confirm({ title: `${mode === 'summary' ? '归档并摘要重置' : '归档并清空'}当前${label}？`, message: '共享工作区文件不会被删除。', confirmText: mode === 'summary' ? '归档重置' : '归档清空', danger: true }))) return;
    await postAction('reset-context', { mode, scope }, '重置群聊上下文失败');
  }

  /** 实际派发一轮：slash 指令优先，否则发起群聊轮。出队续发与即时发送共用。 */
  async function dispatchText(text: string) {
    if (text === '/reset' || text === '/reset clear') { await resetRoomContext('clear', 'public'); return; }
    if (text === '/reset summary') { await resetRoomContext('summary', 'public'); return; }
    if (text === '/reset all' || text === '/reset all clear') { await resetRoomContext('clear', 'both'); return; }
    if (text === '/reset all summary') { await resetRoomContext('summary', 'both'); return; }
    if (!room || room.participantSeatIds.length === 0) { alert('群里还没有工位，先从右上角添加'); return; }
    // 流式运行态托管给注册表：切走房间不掐流、后台续跑、切回读 roundFeed 恢复
    runners.startRound(workshopId, roomId, text);
  }

  function speak() {
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
    runners.abortRoom(workshopId, roomId);
  }

  function focusDispatch(item: CycloneDispatch) {
    if (item.readState === 'unread') {
      void onDispatchAction(roomId, item.id, 'read')
        .catch(error => console.error('[cyclone] 标记派发已读失败', error));
    }
    setHighlightedDispatchId(item.id);
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`#dispatch-${CSS.escape(item.id)}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => setHighlightedDispatchId(current => current === item.id ? null : current), 1_600);
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
    return <div style={{ opacity: .5, margin: 'auto' }}>加载群聊…</div>;
  }
  return (
    <div className="cyclone-room" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      {/* Header */}
      <div className="conv__header">
        {editingTitle ? (
          <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)} onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }} className="conv__header-input" />
        ) : (
          <span className="conv__header-title" title="双击重命名" onDoubleClick={() => { setEditingTitle(true); setTitleDraft(room.title); }}># {room.title}</span>
        )}
        <span className="conv__header-id">{room.topic}</span>
        <DispatchIndex dispatches={roomDispatches} onSelect={focusDispatch} />
        <button
          onClick={toggleMode}
          title={room.mode === 'plan' ? 'plan 模式：只读 + 联络，不动文件。点击切回 build' : 'build 模式：可读写工作区。点击切到 plan'}
          style={{
            marginLeft: 'auto', padding: '2px 10px', fontSize: 'var(--text-xs)', fontWeight: 600,
            borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid',
            ...(room.mode === 'plan'
              ? { background: 'var(--color-warning-subtle, #4a3a1a)', borderColor: 'var(--color-warning, #d4a017)', color: 'var(--color-warning, #d4a017)' }
              : { background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }),
          }}>
          {room.mode === 'plan' ? 'plan · 只读' : 'build · 可写'}
        </button>
      </div>

      <RoomConfigBar participantIds={room.participantSeatIds} seats={seats} streaming={streaming}
        onMove={moveSeat} onJoin={joinSeat} onLeave={leaveSeat} />

      {/* Messages：已落库 history + 本轮 roundFeed（流式中 history 不含本轮；done 后 reload 带回、clearIfDone 清 roundFeed，无重影） */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
        <div ref={scrollRef} className="chat__messages conv__messages" style={{ flex: 1, overflowY: 'auto' }}>
          <RoomTimeline history={history} roundFeed={roundFeed} dispatches={roomDispatches}
            highlightedId={highlightedDispatchId} editingMessageIndex={editingMessageIndex}
            editMessageContent={editMessageContent} onEditContent={setEditMessageContent}
            onStartEdit={startEditMessage} onSaveEdit={saveEditMessage} onCancelEdit={cancelEditMessage}
            onDelete={deleteMessage} onDispatchAction={handleDispatchAction} onOpenSeat={onOpenSeat} />
        </div>
        {showJumpButton && (
          <button className="chat__jump-bottom" onClick={() => scrollToBottom('smooth')}
            aria-label="回到底部" title="回到最新消息">↓</button>
        )}
      </div>

      {dispatchNotice && (
        <button type="button" className="cyclone-dispatch-toast" role="status"
          onClick={() => { focusDispatch(dispatchNotice); setDispatchNotice(null); }}>
          <span className="cyclone-dispatch__dot" />
          {dispatchNotice.targetSeatTitle}{dispatchNotice.status === 'completed' ? '已完成异步任务' : '异步任务失败'}
        </button>
      )}

      <RoomComposer inputRef={inputRef} input={input} streaming={streaming}
        phase={roundFeed?.[roundFeed.length - 1]?.phase} queue={queue}
        onInput={setInput} onSend={speak} onStop={stop}
        onRemoveQueued={index => runners.removeQueued(roomId, index)} />
    </div>
  );
}
