/**
 * 气旋工作室页面（Phase 0 私聊最小闭环）
 *
 * 功能：建/选工作室 → 加工位(绑 agent + 角色提示词) → 与工位一对一私聊。
 * 支持 ask 挂起：工位提问时显示输入框，回答后 resume。
 * 群聊（Room）在 Phase 1 接入，此页先只做私聊。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAgents } from '../../../store/agent';
import { streamUrl } from '../../../lib/apiBase';
import type { Agent } from '../../../types';

interface WorkshopSummary {
  id: string; title: string; seatCount: number; roomCount: number;
  createdAt: string; updatedAt: string;
}
interface Seat {
  id: string; title: string; rolePrompt: string; agentId: string;
  messages: { role: string; content: string }[];
  pending?: { question: string; options?: string[] };
}
interface Workshop { id: string; title: string; seatIds: string[]; roomIds: string[]; }

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

export default function CyclonePage({ active }: { active?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [activeWid, setActiveWid] = useState<string | null>(null);
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [activeSeatId, setActiveSeatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [liveToken, setLiveToken] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const refreshAgents = useCallback(async () => { try { setAgents(await getAgents()); } catch {} }, []);
  const refreshWorkshops = useCallback(async () => {
    try { const r = await fetch('/api/cyclone/list'); if (r.ok) setWorkshops(await r.json()); } catch {}
  }, []);

  const loadWorkshop = useCallback(async (wid: string) => {
    const r = await fetch(`/api/cyclone/workshop/${wid}/status`);
    if (!r.ok) return;
    const w: Workshop = await r.json();
    setWorkshop(w);
    const loaded: Seat[] = [];
    for (const sid of w.seatIds) {
      const sr = await fetch(`/api/cyclone/workshop/${wid}/seat/${sid}/status`);
      if (sr.ok) loaded.push(await sr.json());
    }
    setSeats(loaded);
    if (loaded.length && !loaded.some(s => s.id === activeSeatId)) setActiveSeatId(loaded[0].id);
  }, [activeSeatId]);

  useEffect(() => { if (!active) return; refreshAgents(); refreshWorkshops(); }, [active, refreshAgents, refreshWorkshops]);
  useEffect(() => { if (activeWid) loadWorkshop(activeWid); }, [activeWid, loadWorkshop]);

  const activeSeat = seats.find(s => s.id === activeSeatId) || null;

  async function createWorkshop() {
    const title = prompt('工作室名称', '新工作室');
    if (title === null) return;
    const r = await fetch('/api/cyclone/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    if (r.ok) { const w = await r.json(); await refreshWorkshops(); setActiveWid(w.id); }
  }

  async function addSeat() {
    if (!activeWid || !agents.length) return;
    const agentId = prompt(`绑定哪个 agent？输入 id：\n${agents.map(a => `${a.id}  ${a.name}`).join('\n')}`, agents[0].id);
    if (!agentId) return;
    const title = prompt('工位名称', '工位') || '工位';
    const rolePrompt = prompt('角色提示词（可空）', '') || '';
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/add-seat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, title, rolePrompt }),
    });
    if (r.ok) { await refreshWorkshops(); await loadWorkshop(activeWid); }
  }

  async function send(action: 'chat' | 'resume') {
    if (!activeWid || !activeSeatId || !input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
    setStreaming(true);
    setLiveToken('');
    const abort = new AbortController();
    abortRef.current = abort;
    const payloadKey = action === 'chat' ? 'message' : 'answer';
    let acc = '';
    try {
      await streamSSE(`/api/cyclone/workshop/${activeWid}/seat/${activeSeatId}/${action}`,
        { [payloadKey]: text },
        (ev) => {
          if (ev.type === 'token') { acc += ev.content; setLiveToken(acc); }
          else if (ev.type === 'ask') { /* pending 会在 reload 后显示 */ }
          else if (ev.type === 'error') { acc += `\n[错误] ${ev.message}`; setLiveToken(acc); }
        }, abort.signal);
    } catch (e) {
      setLiveToken(`[请求失败] ${(e as Error).message}`);
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await loadWorkshop(activeWid);
      setLiveToken('');
    }
  }

  if (!active) return null;

  return (
    <div style={{ display: 'flex', height: '100%', gap: 12, padding: 12 }}>
      {/* 左：工作室 + 工位 */}
      <div style={{ width: 240, borderRight: '1px solid #2a2a2a', paddingRight: 12, overflowY: 'auto' }}>
        <button onClick={createWorkshop} style={btn}>+ 新工作室</button>
        {workshops.map(w => (
          <div key={w.id} onClick={() => setActiveWid(w.id)}
            style={{ ...item, fontWeight: w.id === activeWid ? 700 : 400 }}>
            {w.title} <span style={{ opacity: .5 }}>({w.seatCount})</span>
          </div>
        ))}
        {activeWid && (
          <>
            <div style={{ margin: '12px 0 4px', opacity: .6, fontSize: 12 }}>工位</div>
            <button onClick={addSeat} style={btn}>+ 加工位</button>
            {seats.map(s => (
              <div key={s.id} onClick={() => setActiveSeatId(s.id)}
                style={{ ...item, fontWeight: s.id === activeSeatId ? 700 : 400 }}>
                {s.title}{s.pending ? ' ❓' : ''}
              </div>
            ))}
          </>
        )}
      </div>

      {/* 右：私聊 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!activeSeat && <div style={{ opacity: .5, margin: 'auto' }}>选择或创建一个工位开始私聊</div>}
        {activeSeat && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {activeSeat.messages.filter(m => m.role === 'user' || m.role === 'assistant').map((m, i) => (
                <div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  <div style={{ display: 'inline-block', maxWidth: '80%', padding: '6px 10px', borderRadius: 8, background: m.role === 'user' ? '#2d4a7a' : '#333', whiteSpace: 'pre-wrap' }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {liveToken && <div style={{ margin: '8px 0', opacity: .8, whiteSpace: 'pre-wrap' }}>{liveToken}</div>}
              {activeSeat.pending && (
                <div style={{ margin: '8px 0', padding: 10, border: '1px solid #c90', borderRadius: 8 }}>
                  ❓ 工位提问：{activeSeat.pending.question}
                  {activeSeat.pending.options?.length ? <div style={{ opacity: .7, fontSize: 12 }}>选项：{activeSeat.pending.options.join(' / ')}</div> : null}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 8 }}>
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(activeSeat.pending ? 'resume' : 'chat'); }}
                placeholder={activeSeat.pending ? '回答工位的提问…' : '对工位说点什么…'}
                disabled={streaming} style={{ flex: 1, padding: 8, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#eee' }} />
              <button onClick={() => send(activeSeat.pending ? 'resume' : 'chat')} disabled={streaming} style={btn}>
                {streaming ? '…' : (activeSeat.pending ? '回答' : '发送')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { padding: '6px 12px', background: '#2d4a7a', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', width: '100%', marginBottom: 6 };
const item: React.CSSProperties = { padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 14 };
