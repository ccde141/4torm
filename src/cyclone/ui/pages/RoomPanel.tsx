/**
 * 气旋群聊面板（Phase 1a 临时极简 UI）
 *
 * 人在群里发言 → 在场工位串行响应（SSE 流式）。
 * 拉工位进群/离群用 prompt 简易交互，正式样式待 UI 打磨阶段。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { streamUrl } from '../../../lib/apiBase';

interface RoomMsg { speaker: string; content: string; timestamp: number; }
interface Room { id: string; title: string; topic: string; participantSeatIds: string[]; publicMessages: RoomMsg[]; }
interface SeatLite { id: string; title: string; }

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

const btn: React.CSSProperties = { padding: '6px 12px', background: '#2d4a7a', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' };

export default function RoomPanel({ workshopId, roomId, seats }: { workshopId: string; roomId: string; seats: SeatLite[] }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<{ speaker: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/status`);
    if (r.ok) setRoom(await r.json());
  }, [workshopId, roomId]);

  useEffect(() => { reload(); }, [reload]);

  const seatName = (id: string) => seats.find(s => s.id === id)?.title || id;

  async function manageSeats() {
    if (!room) return;
    const inRoom = new Set(room.participantSeatIds);
    const pick = prompt(
      `输入要切换在场状态的工位 id（逗号分隔）。当前在场已标 ✓：\n` +
      seats.map(s => `${inRoom.has(s.id) ? '✓' : '　'} ${s.id}  ${s.title}`).join('\n'),
      '',
    );
    if (!pick) return;
    for (const id of pick.split(/[,，]/).map(x => x.trim()).filter(Boolean)) {
      const action = inRoom.has(id) ? 'leave' : 'join';
      await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seatId: id }),
      });
    }
    await reload();
  }

  async function speak() {
    if (!room || !input.trim() || streaming) return;
    if (room.participantSeatIds.length === 0) { alert('群里还没有工位，先拉工位进群'); return; }
    const text = input.trim();
    setInput('');
    setStreaming(true);
    setLive(null);
    const abort = new AbortController();
    abortRef.current = abort;
    let acc = '';
    let cur = '';
    const finished: { speaker: string; content: string }[] = [];
    try {
      await streamSSE(`/api/cyclone/workshop/${workshopId}/room/${roomId}/speak`, { message: text }, (ev) => {
        if (ev.type === 'seat-start') { cur = ev.speaker; acc = ''; setLive({ speaker: cur, text: '' }); }
        else if (ev.type === 'token') { acc += ev.content; setLive({ speaker: cur, text: acc }); }
        else if (ev.type === 'seat-done') { finished.push({ speaker: ev.speaker, content: ev.content }); setLive(null); }
        else if (ev.type === 'error') { setLive({ speaker: '系统', text: ev.message }); }
      }, abort.signal);
    } catch (e) {
      setLive({ speaker: '系统', text: `[请求失败] ${(e as Error).message}` });
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await reload();
      setLive(null);
    }
  }

  if (!room) return <div style={{ opacity: .5, margin: 'auto' }}>加载群聊…</div>;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><b>{room.title}</b> <span style={{ opacity: .5, fontSize: 12 }}>· {room.topic}</span></div>
        <div style={{ fontSize: 12, opacity: .7 }}>
          在场：{room.participantSeatIds.map(seatName).join('、') || '（空）'}
          <button onClick={manageSeats} style={{ ...btn, marginLeft: 8, padding: '2px 8px' }}>管理工位</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {room.publicMessages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0', textAlign: m.speaker === '人类' ? 'right' : 'left' }}>
            <div style={{ fontSize: 11, opacity: .5, margin: '0 4px' }}>{m.speaker}</div>
            <div style={{ display: 'inline-block', maxWidth: '80%', padding: '6px 10px', borderRadius: 8, background: m.speaker === '人类' ? '#2d4a7a' : '#333', whiteSpace: 'pre-wrap' }}>
              {m.content}
            </div>
          </div>
        ))}
        {live && (
          <div style={{ margin: '8px 0' }}>
            <div style={{ fontSize: 11, opacity: .5 }}>{live.speaker} 正在发言…</div>
            <div style={{ opacity: .8, whiteSpace: 'pre-wrap' }}>{live.text}</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') speak(); }}
          placeholder="在群里说点什么…" disabled={streaming}
          style={{ flex: 1, padding: 8, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#eee' }} />
        <button onClick={speak} disabled={streaming} style={btn}>{streaming ? '…' : '发送'}</button>
      </div>
    </div>
  );
}
