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
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左：工作室 + 工位 + 群聊 */}
      <div style={leftPanelStyle}>
        <div style={sectionHeadStyle}>
          <span style={sectionLabelStyle}>工作室</span>
          <button onClick={createWorkshop} style={newBtnStyle} title="新建工作室">+</button>
        </div>
        {workshops.map(w => (
          <div key={w.id} onClick={() => setActiveWid(w.id)}
            style={{ ...itemStyle, ...(w.id === activeWid ? itemActiveStyle : null) }}>
            {w.title} <span style={{ opacity: .5 }}>({w.seatCount})</span>
          </div>
        ))}
        {activeWid && (
          <>
            <div style={sectionHeadStyle}>
              <span style={sectionLabelStyle}>工位</span>
              <button onClick={addSeat} style={newBtnStyle} title="添加工位">+</button>
            </div>
            {seats.map(s => (
              <div key={s.id} onClick={() => { setActiveSeatId(s.id); setView({ kind: 'seat', id: s.id }); }}
                style={{ ...itemStyle, ...(view?.kind === 'seat' && view.id === s.id ? itemActiveStyle : null) }}>
                {s.title}{s.pending ? ' ❓' : ''}
              </div>
            ))}
            <div style={sectionHeadStyle}>
              <span style={sectionLabelStyle}>群聊</span>
              <button onClick={createRoom} style={newBtnStyle} title="新建群聊">+</button>
            </div>
            {rooms.map(rm => (
              <div key={rm.id} onClick={() => setView({ kind: 'room', id: rm.id })}
                style={{ ...itemStyle, ...(view?.kind === 'room' && view.id === rm.id ? itemActiveStyle : null) }}>
                # {rm.title}
              </div>
            ))}
          </>
        )}
      </div>

      {/* 右：私聊 or 群聊 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {view?.kind === 'room' && activeWid && (
          <RoomPanel workshopId={activeWid} roomId={view.id} seats={seats.map(s => ({ id: s.id, title: s.title }))} onChanged={() => loadWorkshop(activeWid)} />
        )}
        {view?.kind !== 'room' && !activeSeat && <div style={{ opacity: .5, margin: 'auto' }}>选择或创建一个工位开始私聊，或进入群聊</div>}
        {view?.kind === 'seat' && activeSeat && activeWid && (
          <SeatChat key={activeSeat.id} workshopId={activeWid} seatId={activeSeat.id} onReloaded={() => loadWorkshop(activeWid)} />
        )}
      </div>
    </div>
  );
}

const leftPanelStyle: React.CSSProperties = { width: '240px', borderRight: '1px solid var(--border-color)', padding: 'var(--space-4)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px' };
const sectionHeadStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-3)', marginBottom: 'var(--space-1)' };
const sectionLabelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' };
const newBtnStyle: React.CSSProperties = { width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', cursor: 'pointer', lineHeight: 1, flexShrink: 0 };
const itemStyle: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', border: '1px solid transparent', transition: 'all var(--duration-fast) var(--ease-out-expo)' };
const itemActiveStyle: React.CSSProperties = { background: 'var(--color-accent-subtle)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', fontWeight: 600 };
