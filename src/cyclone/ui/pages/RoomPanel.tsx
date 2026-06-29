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
import { renderTextWithCode } from '../../../engine/markdown';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import QueuedChips, { MAX_QUEUE } from '../../../components/chat/QueuedChips';
import type { RoomStreamRunners, FeedMsg } from './useRoomStreamRunners';
import { useDroppedPathInput } from '../../../lib/useDroppedPathInput';
import '../../../styles/components/convection.css';

interface RoomToolCall { tool: string; args: Record<string, string>; result: string; }
interface RoomMsg { speaker: string; content: string; timestamp: number; rawContent?: string; toolCalls?: RoomToolCall[]; }
interface Room { id: string; title: string; topic: string; mode?: 'build' | 'plan'; participantSeatIds: string[]; publicMessages: RoomMsg[]; }
interface SeatLite { id: string; title: string; }

async function readErrorMessage(r: Response, fallback: string): Promise<string> {
  const e = await r.json().catch(() => ({}));
  return e?.error || `${fallback}（HTTP ${r.status}）`;
}

function publicToFeed(msgs: RoomMsg[]): FeedMsg[] {
  return msgs.map(m => ({
    speaker: m.speaker === 'system' ? '归档摘要' : m.speaker,
    content: m.content,
    isHuman: m.speaker === '人类',
    isArchiveSummary: m.speaker === 'system' || m.content.includes('重置前的群聊摘要'),
    tools: (m.toolCalls || []).map(t => ({ tool: t.tool, args: t.args, result: t.result, status: 'success' as const })),
  }));
}

export default function RoomPanel({ workshopId, roomId, seats, runners, onChanged, active = true }: {
  workshopId: string; roomId: string; seats: SeatLite[]; runners: RoomStreamRunners; onChanged?: () => void; active?: boolean;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [history, setHistory] = useState<FeedMsg[]>([]);
  // 草稿初值取自注册表：切走/重挂回来未发文本还在（内存级）
  const [input, setInputRaw] = useState(() => runners.getDraft(roomId));
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 订阅 tick：runner 每次 notify 自增，触发本组件重渲染读取最新 roundFeed 缓冲 */
  const [, forceTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onChangedRef = useRef(onChanged);
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

  const reload = useCallback(async (notify = false) => {
    const r = await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/status`);
    if (!r.ok) {
      const msg = await readErrorMessage(r, '加载群聊失败');
      console.error('[cyclone] 群聊加载失败', msg);
      setLoadError(msg);
      return;
    }
    setLoadError(null);
    const data: Room = await r.json();
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) el.scrollTop = el.scrollHeight;
  }, [history, roundFeed, streaming]);

  const seatName = (id: string) => seats.find(s => s.id === id)?.title || id;

  // ── 工位管理（替代 prompt）──
  async function postAction(action: string, body: Record<string, unknown>, fallback: string) {
    const r = await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) { alert(await readErrorMessage(r, fallback)); return; }
    await reload(true);
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

  async function resetRoomContext(mode: 'clear' | 'summary', scope: 'public' | 'both' = 'public') {
    if (streaming) return;
    const label = scope === 'both' ? '群聊与会长私聊' : '群聊公共上下文';
    if (!confirm(`${mode === 'summary' ? '归档并摘要重置' : '归档并清空'}当前${label}？共享工作区文件不会被删除。`)) return;
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

  if (!room) {
    if (loadError) return <div style={{ opacity: .65, margin: 'auto', padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-danger)' }}>{loadError}</div>;
    return <div style={{ opacity: .5, margin: 'auto' }}>加载群聊…</div>;
  }
  const inRoom = new Set(room.participantSeatIds);
  const candidates = seats.filter(s => !inRoom.has(s.id));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      {/* Header */}
      <div className="conv__header">
        {editingTitle ? (
          <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)} onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }} className="conv__header-input" />
        ) : (
          <span className="conv__header-title" title="双击重命名" onDoubleClick={() => { setEditingTitle(true); setTitleDraft(room.title); }}># {room.title}</span>
        )}
        <span className="conv__header-id">{room.topic}</span>
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

      {/* Config bar：在场工位（流式中禁改，避免中途增删工位扰乱在跑的轮） */}
      <div className="conv__config">
        <span className="conv__config-label">在场:</span>
        {room.participantSeatIds.length === 0 && <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', textShadow: 'var(--text-halo)' }}>（空，从右侧添加工位）</span>}
        {room.participantSeatIds.map((id, idx) => (
          <span key={id} className="conv__tag">
            <button onClick={() => moveSeat(idx, -1)} disabled={streaming || idx === 0} className="conv__tag-move">↑</button>
            <button onClick={() => moveSeat(idx, 1)} disabled={streaming || idx === room.participantSeatIds.length - 1} className="conv__tag-move">↓</button>
            {seatName(id)}
            <button onClick={() => leaveSeat(id)} disabled={streaming} className="conv__tag-remove">×</button>
          </span>
        ))}
        {candidates.length > 0 && (
          <select value="" disabled={streaming} onChange={e => { if (e.target.value) joinSeat(e.target.value); }} className="conv__config-select">
            <option value="">+</option>
            {candidates.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
      </div>

      {/* Messages：已落库 history + 本轮 roundFeed（流式中 history 不含本轮；done 后 reload 带回、clearIfDone 清 roundFeed，无重影） */}
      <div ref={scrollRef} className="chat__messages conv__messages" style={{ flex: 1, overflowY: 'auto' }}>
        {history.map((m, i) => <FeedRow key={`h-${i}`} m={m} idx={i} prefix="h" />)}
        {roundFeed?.map((m, i) => <FeedRow key={`r-${i}`} m={m} idx={i} prefix="r" />)}
      </div>

      {/* Input */}
      <div className="chat__input-area">
        <QueuedChips items={queue} onRemove={i => runners.removeQueued(roomId, i)} />
        <div className="chat__input-wrapper">
          <textarea ref={inputRef} className="chat__input" value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); speak(); } }}
            placeholder={streaming ? '工位讨论中…（可继续输入，发送将排队）' : '在群里说点什么…（Enter 发送，Shift+Enter 换行）'}
            rows={1} aria-label="群聊发言" />
          {streaming ? (
            <>
              <button className="chat__send-btn" onClick={speak}
                disabled={!input.trim() || queue.length >= MAX_QUEUE}
                title={queue.length >= MAX_QUEUE ? '队列已满（最多 3 条）' : '加入队列'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
              <button className="chat__stop-btn" onClick={stop} title="停止生成">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              </button>
            </>
          ) : (
            <button className="chat__send-btn" onClick={speak} disabled={!input.trim()} title="发送">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          )}
        </div>
        <div style={inputHintStyle}>
          <span>快捷指令：</span>
          <code>/reset</code>
          <span>清空公共上下文</span>
          <code>/reset summary</code>
          <span>摘要重置公共上下文</span>
          <code>/reset all</code>
          <span>连同会长私聊一起清空</span>
        </div>
      </div>
    </div>
  );
}

const inputHintStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-tertiary)',
  paddingTop: 'var(--space-2)',
};

/** 单条群聊消息（人类气泡 / 工位气泡，历史 + 本轮实时共用） */
function FeedRow({ m, idx, prefix }: { m: FeedMsg; idx: number; prefix: string }) {
  if (m.isHuman) {
    return (
      <div className="chat__message chat__message--user">
        <div className="chat__avatar">你</div>
        <div className="chat__bubble"><div className="chat__content">{renderTextWithCode(m.content, `room-${prefix}u-${idx}`)}</div></div>
      </div>
    );
  }
  return (
    <div className={`chat__message chat__message--assistant${m.isArchiveSummary ? ' chat__message--archive-summary' : ''}`}>
      <div className="chat__avatar">{m.isArchiveSummary ? '档' : m.speaker.slice(0, 2)}</div>
      <div className="chat__bubble">
        <div className="conv__speaker-label">{m.speaker}</div>
        {m.tools.map((t, ti) => (
          <ToolCallMessage key={ti} toolCall={{ toolName: t.tool, params: t.args, result: t.result, status: t.status }} />
        ))}
        {m.phase && <div className="chat__streaming-phase">{m.phase}</div>}
        {m.content && <div className="chat__content" style={{ whiteSpace: 'pre-wrap' }}>{renderTextWithCode(m.content, `room-${prefix}s-${idx}`)}{m.streaming ? '▍' : ''}</div>}
      </div>
    </div>
  );
}
