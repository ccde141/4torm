/**
 * 气旋工作室页面（Phase 0 私聊最小闭环）
 *
 * 功能：建/选工作室 → 加工位(绑 agent + 角色提示词) → 与工位一对一私聊。
 * 支持 ask 挂起：工位提问时显示输入框，回答后 resume。
 * 群聊（Room）在 Phase 1 接入，此页先只做私聊。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAgents } from '../../../store/agent';
import type { Agent } from '../../../types';
import RoomPanel from './RoomPanel';
import CreateRoomPanel from './CreateRoomPanel';
import CreateWorkshopPanel from './CreateWorkshopPanel';
import SeatPanel, { type SeatDraft } from './SeatPanel';
import SeatChat from './SeatChat';
import ChairDrawer, { chairStreamKey } from './ChairDrawer';
import { useSeatStreamRunners } from './useSeatStreamRunners';
import { useRoomStreamRunners } from './useRoomStreamRunners';
import '../../../styles/components/cyclone.css';

interface WorkshopSummary {
  id: string; title: string; seatCount: number; roomCount: number;
  createdAt: string; updatedAt: string;
}
/** 侧栏工位摘要（轻量，不含会话内容） */
interface Seat {
  id: string; title: string; pending?: boolean;
}
interface RoomLite { id: string; title: string; }

async function readErrorMessage(r: Response, fallback: string): Promise<string> {
  const e = await r.json().catch(() => ({}));
  return e?.error || `${fallback}（HTTP ${r.status}）`;
}

export default function CyclonePage({ active }: { active?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [activeWid, setActiveWid] = useState<string | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [, setActiveSeatId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  const [chairAgentId, setChairAgentId] = useState<string | null>(null);
  /** 会长私聊抽屉是否展开（常驻右侧，独立于主区 view） */
  const [chairOpen, setChairOpen] = useState(false);
  /** 右侧视图：私聊某工位 / 进入某群聊 / 创建群聊 / 创建工作室 / 创建工位 / 编辑工位 */
  const [view, setView] = useState<
    | { kind: 'seat'; id: string } | { kind: 'room'; id: string }
    | { kind: 'create-room' } | { kind: 'create-workshop' }
    | { kind: 'create-seat' } | { kind: 'edit-seat'; id: string; draft: SeatDraft }
    | null
  >(null);
  /** 当前正在查看的会议（room）id —— 会长私聊绑定到它，换会议即换会长上下文 */
  const activeRoomId = view?.kind === 'room' ? view.id : null;

  const refreshAgents = useCallback(async () => { try { setAgents(await getAgents()); } catch (e) { console.error('[cyclone] 加载 agents 失败', e); } }, []);
  const refreshWorkshops = useCallback(async () => {
    try { const r = await fetch('/api/cyclone/list'); if (r.ok) setWorkshops(await r.json()); else console.error(await readErrorMessage(r, '加载工作室列表失败')); } catch (e) { console.error('[cyclone] 加载工作室列表失败', e); }
  }, []);

  const loadWorkshop = useCallback(async (wid: string) => {
    // 侧栏只取轻量摘要（一次请求，服务端并行读），不拉每个工位/群聊的完整会话。
    // 完整内容由 SeatChat/RoomPanel 选中时各自加载。
    const r = await fetch(`/api/cyclone/workshop/${wid}/summary`);
    if (!r.ok) { console.error(await readErrorMessage(r, '加载工作室失败')); return; }
    const sum: { id: string; title: string; chairAgentId?: string; seats: Seat[]; rooms: RoomLite[] } = await r.json();
    setSeats(sum.seats);
    setRooms(sum.rooms);
    setChairAgentId(sum.chairAgentId ?? null);
    setActiveSeatId(prev => (sum.seats.length && !sum.seats.some(s => s.id === prev)) ? sum.seats[0].id : prev);
  }, []);

  useEffect(() => { if (!active) return; refreshAgents(); refreshWorkshops(); }, [active, refreshAgents, refreshWorkshops]);
  useEffect(() => { if (activeWid) loadWorkshop(activeWid); }, [activeWid, loadWorkshop]);

  // 流式注册表：运行态从组件抽到此层（始终挂载），切工位不掐流、后台续跑、切回恢复
  const activeWidRef = useRef(activeWid);
  activeWidRef.current = activeWid;
  const seatRunners = useSeatStreamRunners(useCallback(() => {
    // 任一工位流结束 → 刷新侧栏 pending 标记
    if (activeWidRef.current) loadWorkshop(activeWidRef.current);
  }, [loadWorkshop]));

  // 群聊流式注册表：同理，切走房间不掐流、后台续跑、切回读 roundFeed 恢复
  const roomRunners = useRoomStreamRunners(useCallback(() => {
    if (activeWidRef.current) loadWorkshop(activeWidRef.current);
  }, [loadWorkshop]));

  // 切走当前工位时把它的流转后台（不掐流）
  const prevViewRef = useRef<string | null>(null);
  useEffect(() => {
    const cur = view?.kind === 'seat' ? view.id : null;
    if (prevViewRef.current && prevViewRef.current !== cur) {
      seatRunners.background(prevViewRef.current);
    }
    prevViewRef.current = cur;
  }, [view, seatRunners]);

  // 会长抽屉收起 / 切会议 → 该会议的会长流转后台（不掐流，注册表续跑，切回恢复）
  const prevChairRoomRef = useRef<string | null>(null);
  useEffect(() => {
    const cur = (chairOpen && activeRoomId) ? activeRoomId : null;
    if (prevChairRoomRef.current && prevChairRoomRef.current !== cur) {
      seatRunners.background(chairStreamKey(prevChairRoomRef.current));
    }
    prevChairRoomRef.current = cur;
  }, [chairOpen, activeRoomId, seatRunners]);

  // 切换工作室时关上会长抽屉（会长随会议而设）
  const prevWidRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevWidRef.current && prevWidRef.current !== activeWid) setChairOpen(false);
    prevWidRef.current = activeWid;
  }, [activeWid]);

  /** 设置 / 更换 / 清空会长（建后也能改，对齐对流配置栏） */
  const setChair = useCallback(async (agentId: string) => {
    if (!activeWid) return;
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/set-chair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chairAgentId: agentId }),
    });
    if (!r.ok) { alert(await readErrorMessage(r, '设置会长失败')); return; }
    setChairAgentId(agentId || null);
    loadWorkshop(activeWid);
  }, [activeWid, loadWorkshop]);

  const activeSeat = view?.kind === 'seat' ? seats.find(s => s.id === view.id) || null : null;

  async function handleCreateWorkshop(cfg: { title: string; chairAgentId?: string }) {
    const r = await fetch('/api/cyclone/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
    if (!r.ok) { alert(await readErrorMessage(r, '创建工作室失败')); return; }
    const w = await r.json();
    await refreshWorkshops();
    setActiveWid(w.id);
    setView(null);
  }

  async function openWorkshopWorkspace() {
    if (!activeWid) return;
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/open-workspace`, { method: 'POST' });
    if (!r.ok) { alert(await readErrorMessage(r, '打开公共工作区失败')); return; }
  }

  async function deleteWorkshop(wid: string, title: string) {
    if (!confirm(`删除工作室「${title}」？工位、群聊及全部会话将一并删除，不可恢复。`)) return;
    // 删的是当前工作室 → 掐掉其各会议的会长流（仅当前工作室的 rooms 在内存里可知）
    if (activeWid === wid) rooms.forEach(rm => seatRunners.kill(wid, chairStreamKey(rm.id)));
    const r = await fetch(`/api/cyclone/workshop/${wid}/delete`, { method: 'POST' });
    if (!r.ok) { alert(await readErrorMessage(r, '删除工作室失败')); return; }
    if (activeWid === wid) { setActiveWid(null); setView(null); setSeats([]); setRooms([]); setChairOpen(false); }
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
    if (!r.ok) { alert(await readErrorMessage(r, '加载工位设置失败')); return; }
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
    seatRunners.kill(activeWid, seatId); // 流式中删除 → 掐流防僵尸
    const r = await fetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/delete`, { method: 'POST' });
    if (!r.ok) { alert(await readErrorMessage(r, '删除工位失败')); return; }
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
    if (!r.ok) { alert(await readErrorMessage(r, '创建群聊失败')); return; }
    const rm = await r.json();
    // 跑入会发言（若有非 none 行为）。逐条流式落库，等整体结束再进入群聊。
    const needIntro = cfg.intros.some(i => i.behavior !== 'none');
    if (needIntro) {
      try {
        await fetch(`/api/cyclone/workshop/${activeWid}/room/${rm.id}/intro`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intros: cfg.intros }),
        });
      } catch (e) { console.warn('[cyclone] 入会发言失败，已继续进入群聊', e); }
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
          <button type="button" onClick={openWorkshopWorkspace} className="cyclone__workspace-btn" title="打开当前工作室的公共工作区">
            <span className="cyclone__workspace-btn-icon">↗</span>
            <span>公共工作区</span>
          </button>
        )}
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
          <RoomPanel key={view.id} workshopId={activeWid} roomId={view.id} seats={seats.map(s => ({ id: s.id, title: s.title }))} runners={roomRunners} onChanged={() => loadWorkshop(activeWid)} active={active} />
        )}
        {(view === null || (view.kind === 'seat' && !activeSeat)) && <div style={{ opacity: .5, margin: 'auto' }}>选择或创建一个工位开始私聊，或进入群聊</div>}
        {view?.kind === 'seat' && activeSeat && activeWid && (
          <SeatChat key={activeSeat.id} workshopId={activeWid} seatId={activeSeat.id} runners={seatRunners} onReloaded={() => loadWorkshop(activeWid)} active={active} />
        )}
      </div>

      {/* 右：会长私聊抽屉（可折叠；会长随会议而设，仅进入某群聊时出现，按 room 隔离不串台） */}
      {activeWid && activeRoomId && (
        <ChairDrawer
          workshopId={activeWid}
          roomId={activeRoomId}
          roomTitle={rooms.find(r => r.id === activeRoomId)?.title}
          chairAgentId={chairAgentId}
          agents={agents}
          runners={seatRunners}
          open={chairOpen}
          onToggle={() => setChairOpen(o => !o)}
          onSetChair={setChair}
          onReloaded={() => loadWorkshop(activeWid)}
        />
      )}
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
