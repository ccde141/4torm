/**
 * 气旋群聊面板 —— 对齐对流中栏布局
 *
 * 布局：Header（标题双击重命名 + 话题）+ Config bar（在场工位 tag：↑↓调序 / ×移除 / + 添加）
 *       + Messages（对流式气泡，头像 + speaker label + 工具卡片）+ Input（chat__ 输入区）。
 * 发言模型：人发一句 → 在场工位串行响应（SSE 流式），仿对流 handleSpeak。
 * 复用季风渲染原子：ToolCallMessage（工具卡片）+ renderTextWithCode（markdown）+ chat__/conv__ 全局 CSS。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import { renderTextWithCode } from '../../../engine/markdown';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import '../../../styles/components/convection.css';

interface RoomToolCall { tool: string; args: Record<string, string>; result: string; }
interface RoomMsg { speaker: string; content: string; timestamp: number; rawContent?: string; toolCalls?: RoomToolCall[]; }
interface Room { id: string; title: string; topic: string; participantSeatIds: string[]; publicMessages: RoomMsg[]; }
interface SeatLite { id: string; title: string; }

/** 流式期间某工位的实时态 */
interface LiveSeat { speaker: string; text: string; tools: { tool: string; args: Record<string, string>; result?: string; status: 'running' | 'success' | 'error' }[]; phase: string; }

async function streamSSE(path: string, body: Record<string, unknown>, onEvent: (ev: any) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(streamUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await res.text());
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) { reader.cancel(); break; }
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
      try { onEvent(JSON.parse(p)); } catch {}
    }
  }
}

export default function RoomPanel({ workshopId, roomId, seats, onChanged }: {
  workshopId: string; roomId: string; seats: SeatLite[]; onChanged?: () => void;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<LiveSeat | null>(null);
  const [pendingEcho, setPendingEcho] = useState<RoomMsg[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const reload = useCallback(async (notify = false) => {
    const r = await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/status`);
    if (r.ok) { setRoom(await r.json()); if (notify) onChangedRef.current?.(); }
  }, [workshopId, roomId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) el.scrollTop = el.scrollHeight;
  }, [room?.publicMessages, live, pendingEcho]);

  const seatName = (id: string) => seats.find(s => s.id === id)?.title || id;

  // ── 工位管理（替代 prompt）──
  async function postAction(action: string, body: Record<string, unknown>) {
    await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await reload(true);
  }
  const joinSeat = (seatId: string) => postAction('join', { seatId });
  const leaveSeat = (seatId: string) => postAction('leave', { seatId });
  function moveSeat(idx: number, dir: -1 | 1) {
    if (!room) return;
    const ids = [...room.participantSeatIds];
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    postAction('reorder', { seatIds: ids });
  }
  async function commitTitle() {
    setEditingTitle(false);
    const t = titleDraft.trim();
    if (room && t && t !== room.title) await postAction('rename', { title: t });
  }

  async function speak() {
    if (!room || !input.trim() || streaming) return;
    if (room.participantSeatIds.length === 0) { alert('群里还没有工位，先从右上角添加'); return; }
    const text = input.trim();
    setInput('');
    setStreaming(true);
    setLive(null);
    setPendingEcho([{ speaker: '人类', content: text, timestamp: Date.now() }]);
    const abort = new AbortController();
    abortRef.current = abort;
    let ls: LiveSeat | null = null;
    const flush = () => setLive(ls ? { ...ls, tools: [...ls.tools] } : null);
    try {
      await streamSSE(`/api/cyclone/workshop/${workshopId}/room/${roomId}/speak`, { message: text }, (ev) => {
        if (ev.type === 'seat-start') { ls = { speaker: ev.speaker, text: '', tools: [], phase: '思考中...' }; flush(); }
        else if (ev.type === 'token' && ls) { ls.text += ev.content; ls.phase = ''; flush(); }
        else if (ev.type === 'tool-call' && ls) { ls.tools.push({ tool: ev.tool, args: ev.args, status: 'running' }); ls.phase = `调用 ${ev.tool}...`; flush(); }
        else if (ev.type === 'tool-result' && ls) {
          for (let i = ls.tools.length - 1; i >= 0; i--) { if (ls.tools[i].status === 'running') { ls.tools[i] = { ...ls.tools[i], result: ev.result, status: ev.ok ? 'success' : 'error' }; break; } }
          ls.phase = ''; flush();
        }
        else if (ev.type === 'seat-done') { ls = null; setLive(null); }
        else if (ev.type === 'error') { ls = { speaker: '系统', text: ev.message, tools: [], phase: '' }; flush(); }
      }, abort.signal);
    } catch (e) {
      setLive({ speaker: '系统', text: `[请求失败] ${(e as Error).message}`, tools: [], phase: '' });
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await reload(true);
      setLive(null);
      setPendingEcho([]);
    }
  }

  function stop() {
    abortRef.current?.abort();
    fetch(streamUrl(`/api/cyclone/workshop/${workshopId}/room/${roomId}/abort`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    setStreaming(false);
  }

  if (!room) return <div style={{ opacity: .5, margin: 'auto' }}>加载群聊…</div>;
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
      </div>

      {/* Config bar：在场工位 */}
      <div className="conv__config">
        <span className="conv__config-label">在场:</span>
        {room.participantSeatIds.length === 0 && <span style={{ opacity: .5, fontSize: 'var(--text-xs)' }}>（空，从右侧添加工位）</span>}
        {room.participantSeatIds.map((id, idx) => (
          <span key={id} className="conv__tag">
            <button onClick={() => moveSeat(idx, -1)} disabled={idx === 0} className="conv__tag-move">↑</button>
            <button onClick={() => moveSeat(idx, 1)} disabled={idx === room.participantSeatIds.length - 1} className="conv__tag-move">↓</button>
            {seatName(id)}
            <button onClick={() => leaveSeat(id)} className="conv__tag-remove">×</button>
          </span>
        ))}
        {candidates.length > 0 && (
          <select value="" onChange={e => { if (e.target.value) joinSeat(e.target.value); }} className="conv__config-select">
            <option value="">+</option>
            {candidates.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="chat__messages conv__messages" style={{ flex: 1, overflowY: 'auto' }}>
        {room.publicMessages.map((m, i) => <RoomBubble key={i} msg={m} idx={i} />)}
        {pendingEcho.map((m, i) => <RoomBubble key={`echo-${i}`} msg={m} idx={`e${i}`} />)}
        {live && (
          <div className="chat__message chat__message--assistant">
            <div className="chat__avatar">{live.speaker.slice(0, 2)}</div>
            <div className="chat__bubble">
              <div className="conv__speaker-label">{live.speaker}</div>
              {live.tools.map((t, ti) => (
                <ToolCallMessage key={ti} toolCall={{ toolName: t.tool, params: t.args, result: t.result, status: t.status }} />
              ))}
              {live.phase && <div className="chat__streaming-phase">{live.phase}</div>}
              {live.text && <div className="chat__content" style={{ whiteSpace: 'pre-wrap' }}>{live.text}▍</div>}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="chat__input-area">
        <div className="chat__input-wrapper">
          <textarea className="chat__input" value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); speak(); } }}
            placeholder={streaming ? '工位讨论中…' : '在群里说点什么…（Enter 发送，Shift+Enter 换行）'}
            rows={1} disabled={streaming} aria-label="群聊发言" />
          {streaming ? (
            <button className="chat__stop-btn" onClick={stop} title="停止生成">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            </button>
          ) : (
            <button className="chat__send-btn" onClick={speak} disabled={!input.trim()} title="发送">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 单条已落库群聊气泡 */
function RoomBubble({ msg, idx }: { msg: RoomMsg; idx: number | string }) {
  const isHuman = msg.speaker === '人类';
  if (isHuman) {
    return (
      <div className="chat__message chat__message--user">
        <div className="chat__avatar">你</div>
        <div className="chat__bubble"><div className="chat__content">{renderTextWithCode(msg.content, `room-u-${idx}`)}</div></div>
      </div>
    );
  }
  return (
    <div className="chat__message chat__message--assistant">
      <div className="chat__avatar">{msg.speaker.slice(0, 2)}</div>
      <div className="chat__bubble">
        <div className="conv__speaker-label">{msg.speaker}</div>
        {msg.toolCalls?.map((t, ti) => (
          <ToolCallMessage key={ti} toolCall={{ toolName: t.tool, params: t.args, result: t.result, status: 'success' }} />
        ))}
        <div className="chat__content">{renderTextWithCode(msg.content, `room-s-${idx}`)}</div>
      </div>
    </div>
  );
}
