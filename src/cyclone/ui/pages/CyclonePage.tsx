/**
 * 气旋工作室页面（Phase 0 私聊最小闭环）
 *
 * 功能：建/选工作室 → 加工位(绑 agent + 角色提示词) → 与工位一对一私聊。
 * 支持 ask 挂起：工位提问时显示输入框，回答后 resume。
 * 群聊（Room）在 Phase 1 接入，此页先只做私聊。
 */

import { useState, useEffect, useCallback } from 'react';
import { getAgents } from '../../../store/agent';
import type { Agent } from '../../../types';
import RoomPanel from './RoomPanel';
import SeatChat from './SeatChat';

interface WorkshopSummary {
  id: string; title: string; seatCount: number; roomCount: number;
  createdAt: string; updatedAt: string;
}
/** 侧栏工位摘要（轻量，不含会话内容） */
interface Seat {
  id: string; title: string; pending?: boolean;
}
interface RoomLite { id: string; title: string; }

export default function CyclonePage({ active }: { active?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [activeWid, setActiveWid] = useState<string | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [activeSeatId, setActiveSeatId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  /** 右侧视图：私聊某工位 or 进入某群聊 */
  const [view, setView] = useState<{ kind: 'seat'; id: string } | { kind: 'room'; id: string } | null>(null);

  const refreshAgents = useCallback(async () => { try { setAgents(await getAgents()); } catch {} }, []);
  const refreshWorkshops = useCallback(async () => {
    try { const r = await fetch('/api/cyclone/list'); if (r.ok) setWorkshops(await r.json()); } catch {}
  }, []);

  const loadWorkshop = useCallback(async (wid: string) => {
    // 侧栏只取轻量摘要（一次请求，服务端并行读），不拉每个工位/群聊的完整会话。
    // 完整内容由 SeatChat/RoomPanel 选中时各自加载。
    const r = await fetch(`/api/cyclone/workshop/${wid}/summary`);
    if (!r.ok) return;
    const sum: { id: string; title: string; seats: Seat[]; rooms: RoomLite[] } = await r.json();
    setSeats(sum.seats);
    setRooms(sum.rooms);
    setActiveSeatId(prev => (sum.seats.length && !sum.seats.some(s => s.id === prev)) ? sum.seats[0].id : prev);
  }, []);

  useEffect(() => { if (!active) return; refreshAgents(); refreshWorkshops(); }, [active, refreshAgents, refreshWorkshops]);
  useEffect(() => { if (activeWid) loadWorkshop(activeWid); }, [activeWid, loadWorkshop]);

  const activeSeat = view?.kind === 'seat' ? seats.find(s => s.id === view.id) || null : null;

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

  async function createRoom() {
    if (!activeWid) return;
    const title = prompt('群聊名称', '新群聊');
    if (title === null) return;
    const topic = prompt('讨论话题', '自由讨论') || '自由讨论';
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/create-room`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, topic }),
    });
    if (r.ok) { const rm = await r.json(); await loadWorkshop(activeWid); setView({ kind: 'room', id: rm.id }); }
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
              <div key={s.id} onClick={() => { setActiveSeatId(s.id); setView({ kind: 'seat', id: s.id }); }}
                style={{ ...item, fontWeight: view?.kind === 'seat' && view.id === s.id ? 700 : 400 }}>
                {s.title}{s.pending ? ' ❓' : ''}
              </div>
            ))}
            <div style={{ margin: '12px 0 4px', opacity: .6, fontSize: 12 }}>群聊</div>
            <button onClick={createRoom} style={btn}>+ 新群聊</button>
            {rooms.map(rm => (
              <div key={rm.id} onClick={() => setView({ kind: 'room', id: rm.id })}
                style={{ ...item, fontWeight: view?.kind === 'room' && view.id === rm.id ? 700 : 400 }}>
                # {rm.title}
              </div>
            ))}
          </>
        )}
      </div>

      {/* 右：私聊 or 群聊 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {view?.kind === 'room' && activeWid && (
          <RoomPanel workshopId={activeWid} roomId={view.id} seats={seats.map(s => ({ id: s.id, title: s.title }))} />
        )}
        {view?.kind !== 'room' && !activeSeat && <div style={{ opacity: .5, margin: 'auto' }}>选择或创建一个工位开始私聊，或进入群聊</div>}
        {view?.kind === 'seat' && activeSeat && activeWid && (
          <SeatChat key={activeSeat.id} workshopId={activeWid} seatId={activeSeat.id} onReloaded={() => loadWorkshop(activeWid)} />
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { padding: '6px 12px', background: '#2d4a7a', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', width: '100%', marginBottom: 6 };
const item: React.CSSProperties = { padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 14 };
