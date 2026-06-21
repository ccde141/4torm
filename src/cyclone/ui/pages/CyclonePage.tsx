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
import CreateRoomPanel from './CreateRoomPanel';
import CreateWorkshopPanel from './CreateWorkshopPanel';
import SeatPanel, { type SeatDraft } from './SeatPanel';
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
  /** 右侧视图：私聊某工位 / 进入某群聊 / 创建群聊 / 创建工作室 / 创建工位 / 编辑工位 */
  const [view, setView] = useState<
    | { kind: 'seat'; id: string } | { kind: 'room'; id: string }
    | { kind: 'create-room' } | { kind: 'create-workshop' }
    | { kind: 'create-seat' } | { kind: 'edit-seat'; id: string; draft: SeatDraft }
    | null
  >(null);

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

  async function handleCreateWorkshop(cfg: { title: string; chairAgentId?: string }) {
    const r = await fetch('/api/cyclone/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
    if (r.ok) { const w = await r.json(); await refreshWorkshops(); setActiveWid(w.id); setView(null); }
  }

  async function deleteWorkshop(wid: string, title: string) {
    if (!confirm(`删除工作室「${title}」？工位、群聊及全部会话将一并删除，不可恢复。`)) return;
    const r = await fetch(`/api/cyclone/workshop/${wid}/delete`, { method: 'POST' });
    if (!r.ok) return;
    if (activeWid === wid) { setActiveWid(null); setView(null); setSeats([]); setRooms([]); }
    await refreshWorkshops();
  }

  async function submitCreateSeat(d: SeatDraft) {
    if (!activeWid) return;
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/add-seat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || '添加工位失败'); return; }
    const seat = await r.json();
    await refreshWorkshops(); await loadWorkshop(activeWid);
    setActiveSeatId(seat.id); setView({ kind: 'seat', id: seat.id });
  }

  async function openEditSeat(seatId: string) {
    if (!activeWid) return;
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/status`);
    if (!r.ok) return;
    const s = await r.json();
    setView({ kind: 'edit-seat', id: seatId, draft: {
      agentId: s.agentId, title: s.title, rolePrompt: s.rolePrompt || '',
      duty: s.duty || '', overrideAgentRole: !!s.overrideAgentRole,
    } });
  }

  async function submitEditSeat(seatId: string, d: SeatDraft) {
    if (!activeWid) return;
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/update-role`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: d.title, rolePrompt: d.rolePrompt, duty: d.duty, overrideAgentRole: d.overrideAgentRole }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || '保存失败'); return; }
    await loadWorkshop(activeWid);
    setActiveSeatId(seatId); setView({ kind: 'seat', id: seatId });
  }

  async function deleteSeat(seatId: string, title: string) {
    if (!activeWid) return;
    if (!confirm(`删除工位「${title}」？该工位的私聊会话将一并删除，不可恢复。`)) return;
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/delete`, { method: 'POST' });
    if (!r.ok) return;
    if (view?.kind === 'seat' && view.id === seatId) setView(null);
    await refreshWorkshops(); await loadWorkshop(activeWid);
  }

  /** 创建群聊：建群 → 跑入会发言（SSE 流式落库）→ 进入。入会发言的可视化在 RoomPanel 进入后 reload 自然呈现。 */
  async function handleCreateRoom(cfg: {
    title: string; topic: string; mode: 'build' | 'plan';
    participantSeatIds: string[];
    intros: Array<{ seatId: string; behavior: 'summary' | 'intro' | 'none' }>;
  }) {
    if (!activeWid) return;
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/create-room`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: cfg.title, topic: cfg.topic, mode: cfg.mode, participantSeatIds: cfg.participantSeatIds }),
    });
    if (!r.ok) return;
    const rm = await r.json();
    // 跑入会发言（若有非 none 行为）。逐条流式落库，等整体结束再进入群聊。
    const needIntro = cfg.intros.some(i => i.behavior !== 'none');
    if (needIntro) {
      try {
        await fetch(`/api/cyclone/workshop/${activeWid}/room/${rm.id}/intro`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intros: cfg.intros }),
        });
      } catch { /* 入会发言失败不阻断进入群聊 */ }
    }
    await loadWorkshop(activeWid);
    setView({ kind: 'room', id: rm.id });
  }

  if (!active) return null;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左：工作室 + 工位 + 群聊 */}
      <div style={leftPanelStyle}>
        <div style={sectionHeadStyle}>
          <span style={sectionLabelStyle}>工作室</span>
          <button onClick={() => setView({ kind: 'create-workshop' })} style={newBtnStyle} title="新建工作室">+</button>
        </div>
        {workshops.map(w => (
          <div key={w.id} onClick={() => setActiveWid(w.id)}
            style={{ ...itemStyle, display: 'flex', alignItems: 'center', gap: 4, ...(w.id === activeWid ? itemActiveStyle : null) }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.title} <span style={{ opacity: .5 }}>({w.seatCount})</span></span>
            <button onClick={e => { e.stopPropagation(); deleteWorkshop(w.id, w.title); }} style={delBtnStyle} title="删除工作室">×</button>
          </div>
        ))}
        {activeWid && (
          <>
            <div style={sectionHeadStyle}>
              <span style={sectionLabelStyle}>工位</span>
              <button onClick={() => setView({ kind: 'create-seat' })} style={newBtnStyle} title="添加工位">+</button>
            </div>
            {seats.map(s => (
              <div key={s.id} onClick={() => { setActiveSeatId(s.id); setView({ kind: 'seat', id: s.id }); }}
                style={{ ...itemStyle, display: 'flex', alignItems: 'center', gap: 4, ...(view?.kind === 'seat' && view.id === s.id ? itemActiveStyle : null) }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}{s.pending ? ' ❓' : ''}</span>
                <button onClick={e => { e.stopPropagation(); openEditSeat(s.id); }} style={delBtnStyle} title="工位设置">⚙</button>
                <button onClick={e => { e.stopPropagation(); deleteSeat(s.id, s.title); }} style={delBtnStyle} title="删除工位">×</button>
              </div>
            ))}
            <div style={sectionHeadStyle}>
              <span style={sectionLabelStyle}>群聊</span>
              <button onClick={() => setView({ kind: 'create-room' })} style={newBtnStyle} title="新建群聊">+</button>
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

      {/* 右：私聊 / 群聊 / 创建群聊 / 创建工作室 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {view?.kind === 'create-workshop' && (
          <CreateWorkshopPanel agents={agents} onCreate={handleCreateWorkshop} onCancel={() => setView(null)} />
        )}
        {view?.kind === 'create-seat' && activeWid && (
          <SeatPanel mode="create" agents={agents} workshopId={activeWid}
            onSubmit={submitCreateSeat} onCancel={() => setView(null)} />
        )}
        {view?.kind === 'edit-seat' && activeWid && (
          <SeatPanel mode="edit" agents={agents} workshopId={activeWid} initial={view.draft}
            onSubmit={d => submitEditSeat(view.id, d)} onCancel={() => setView({ kind: 'seat', id: view.id })} />
        )}
        {view?.kind === 'create-room' && activeWid && (
          <CreateRoomPanel
            seats={seats.map(s => ({ id: s.id, title: s.title }))}
            onCreate={handleCreateRoom}
            onCancel={() => setView(null)}
          />
        )}
        {view?.kind === 'room' && activeWid && (
          <RoomPanel workshopId={activeWid} roomId={view.id} seats={seats.map(s => ({ id: s.id, title: s.title }))} onChanged={() => loadWorkshop(activeWid)} />
        )}
        {(view === null || (view.kind === 'seat' && !activeSeat)) && <div style={{ opacity: .5, margin: 'auto' }}>选择或创建一个工位开始私聊，或进入群聊</div>}
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
const delBtnStyle: React.CSSProperties = { width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', cursor: 'pointer', lineHeight: 1, flexShrink: 0, padding: 0 };
