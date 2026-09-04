import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { useLocale } from '../../../i18n/LocaleContext';
import { createLatestRequestGuard } from '../../../lib/latest-request';
import { getAgents } from '../../../store/agent';
import type { Agent } from '../../../types';
import { closeWorkspaceTab, openWorkspaceTab, tabKey, type WorkspaceTab } from '../organization/workspace-tabs';
import type { BulletinEntry } from './BulletinBoard';
import { chairStreamKey } from './ChairDrawer';
import { CycloneSidebar } from './CycloneSidebar';
import { CycloneWorkspacePane } from './CycloneWorkspacePane';
import { readCycloneError, type CycloneView, type RoomSummary, type SeatSummary, type WorkshopSummary } from './cyclone-page-model';
import { projectWorkspaceStatus } from './cyclone-workspace-status';
import { resolveLoadedSeatEditor } from './seat-editor-state';
import type { SeatDraft } from './SeatPanel';
import { useRoomStreamRunners } from './useRoomStreamRunners';
import { useSeatStreamRunners } from './useSeatStreamRunners';
import { useWorkshopDispatches } from './useWorkshopDispatches';
import '../../../styles/components/cyclone.css';

export default function CyclonePage({ active }: { active?: boolean }) {
  const { t, locale } = useLocale();
  const tRef = useRef(t); tRef.current = t;
  const confirm = useConfirm();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [activeWid, setActiveWid] = useState<string | null>(null);
  const [seats, setSeats] = useState<SeatSummary[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [chairAgentId, setChairAgentId] = useState<string | null>(null);
  const [chairOpen, setChairOpen] = useState(false);
  const [, forceChairRunTick] = useState(0);
  const [, forceTabStatusTick] = useState(0);
  const [bulletin, setBulletin] = useState<BulletinEntry[]>([]);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [view, setView] = useState<CycloneView>(null);
  const workshopRequestGuard = useRef(createLatestRequestGuard());
  const viewRef = useRef(view); viewRef.current = view;
  const activeWidRef = useRef(activeWid); activeWidRef.current = activeWid;
  const activeRoomId = view?.kind === 'room' ? view.id : null;
  const visibleSeatId = view?.kind === 'seat' ? view.id : null;

  const refreshAgents = useCallback(async () => {
    try { setAgents(await getAgents()); }
    catch (error) { console.error(`[cyclone] ${tRef.current('cyclone.shell.loadAgentsFailed')}`, error); }
  }, []);
  const refreshWorkshops = useCallback(async () => {
    try {
      const response = await fetch('/api/cyclone/list');
      if (response.ok) setWorkshops(await response.json());
      else console.error(await readCycloneError(response, tRef.current('cyclone.shell.loadListFailed')));
    } catch (error) { console.error(`[cyclone] ${tRef.current('cyclone.shell.loadListFailed')}`, error); }
  }, []);
  const loadWorkshop = useCallback(async (workshopId: string) => {
    const request = workshopRequestGuard.current.begin();
    const response = await fetch(`/api/cyclone/workshop/${workshopId}/summary`);
    if (!response.ok) {
      if (request.isCurrent()) console.error(await readCycloneError(response, tRef.current('cyclone.shell.loadWorkshopFailed')));
      return;
    }
    const summary: { chairAgentId?: string; seats: SeatSummary[]; rooms: RoomSummary[];
      bulletin?: { entries: BulletinEntry[] } } = await response.json();
    if (!request.isCurrent()) return;
    setSeats(summary.seats); setRooms(summary.rooms); setChairAgentId(summary.chairAgentId ?? null);
    setBulletin(summary.bulletin?.entries ?? []);
  }, []);

  const { dispatches, refresh: refreshDispatches, act: dispatchAction, markSeatRead } = useWorkshopDispatches(activeWid, !!active, {
    requestFailed: t('cyclone.dispatch.requestFailed', { status: '{status}' }), noWorkshop: t('cyclone.dispatch.noWorkshop'),
  });
  const seatRunners = useSeatStreamRunners(useCallback(() => {
    if (activeWidRef.current) void loadWorkshop(activeWidRef.current);
  }, [loadWorkshop]), locale);
  const refreshDispatchesSafely = useCallback(() => {
    void refreshDispatches().catch(error => console.error('[cyclone] 刷新异步派发失败', error));
  }, [refreshDispatches]);
  const roomRunners = useRoomStreamRunners(useCallback(() => {
    if (activeWidRef.current) void loadWorkshop(activeWidRef.current);
    refreshDispatchesSafely();
  }, [loadWorkshop, refreshDispatchesSafely]), refreshDispatchesSafely, locale);
  const subscribeSeat = seatRunners.subscribe;
  const subscribeRoom = roomRunners.subscribe;
  const workspaceStatus = projectWorkspaceStatus({
    seats, rooms, dispatches, getSeatRunner: seatRunners.getRunner,
    getRoomRunner: roomRunners.getRunner, chairKey: chairStreamKey,
  });

  useEffect(() => { if (active) { void refreshAgents(); void refreshWorkshops(); } }, [active, refreshAgents, refreshWorkshops]);
  useEffect(() => { if (activeWid) void loadWorkshop(activeWid); else workshopRequestGuard.current.cancel(); }, [activeWid, loadWorkshop]);
  const visibleSeatHasUnreadResult = visibleSeatId !== null && dispatches.some(item => (
    item.targetSeatId === visibleSeatId && item.readState === 'unread'
    && (item.status === 'completed' || item.status === 'failed')
  ));
  useEffect(() => {
    if (!visibleSeatId || !visibleSeatHasUnreadResult) return;
    void markSeatRead(visibleSeatId)
      .catch(error => console.error('[cyclone] 标记工位派发已读失败', error));
  }, [markSeatRead, visibleSeatHasUnreadResult, visibleSeatId]);
  useEffect(() => activeRoomId
    ? subscribeSeat(chairStreamKey(activeRoomId), () => forceChairRunTick(tick => tick + 1))
    : undefined, [activeRoomId, subscribeSeat]);
  useEffect(() => {
    const update = () => forceTabStatusTick(value => value + 1);
    const subscriptions = [...seats.map(seat => subscribeSeat(seat.id, update)),
      ...rooms.map(room => subscribeRoom(room.id, update))];
    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [rooms, seats, subscribeRoom, subscribeSeat]);

  const previousSeatRef = useRef<string | null>(null);
  useEffect(() => {
    const current = view?.kind === 'seat' ? view.id : null;
    if (previousSeatRef.current && previousSeatRef.current !== current) seatRunners.background(previousSeatRef.current);
    previousSeatRef.current = current;
  }, [view, seatRunners]);
  const previousChairRoomRef = useRef<string | null>(null);
  useEffect(() => {
    const current = chairOpen && activeRoomId ? activeRoomId : null;
    if (previousChairRoomRef.current && previousChairRoomRef.current !== current) {
      seatRunners.background(chairStreamKey(previousChairRoomRef.current));
    }
    previousChairRoomRef.current = current;
  }, [activeRoomId, chairOpen, seatRunners]);
  const previousWorkshopRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousWorkshopRef.current && previousWorkshopRef.current !== activeWid) {
      setChairOpen(false); setWorkspaceTabs([]);
    }
    previousWorkshopRef.current = activeWid;
  }, [activeWid]);

  const openWorkspaceView = useCallback((tab: WorkspaceTab) => {
    setWorkspaceTabs(current => openWorkspaceTab(current, tab));
    setView({ kind: tab.kind, id: tab.id });
  }, []);
  const closeWorkspaceView = useCallback((tab: WorkspaceTab) => {
    const activeKey = viewRef.current?.kind === 'seat' || viewRef.current?.kind === 'room' ? tabKey(viewRef.current) : null;
    const result = closeWorkspaceTab(workspaceTabs, activeKey, tabKey(tab));
    setWorkspaceTabs(result.tabs);
    if (activeKey !== tabKey(tab)) return;
    const fallback = result.tabs.find(item => tabKey(item) === result.activeKey);
    setView(fallback ? { kind: fallback.kind, id: fallback.id } : null);
  }, [workspaceTabs]);
  const openSeat = useCallback((seatId: string) => {
    const seat = seats.find(item => item.id === seatId);
    if (seat) openWorkspaceView({ kind: 'seat', id: seat.id, title: seat.title });
  }, [openWorkspaceView, seats]);

  async function setChair(agentId: string) {
    if (!activeWid) return;
    const response = await fetch(`/api/cyclone/workshop/${activeWid}/set-chair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chairAgentId: agentId }),
    });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.setChairFailed'))); return; }
    setChairAgentId(agentId || null); await loadWorkshop(activeWid);
  }
  async function createWorkshop(config: { title: string; chairAgentId?: string }) {
    const response = await fetch('/api/cyclone/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
    });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.createWorkshopFailed'))); return; }
    const workshop = await response.json(); await refreshWorkshops(); setActiveWid(workshop.id); setView(null);
  }
  async function openWorkshopWorkspace() {
    if (!activeWid) return;
    const response = await fetch(`/api/cyclone/workshop/${activeWid}/open-workspace`, { method: 'POST' });
    if (!response.ok) alert(await readCycloneError(response, t('cyclone.shell.openWorkspaceFailed')));
  }
  async function deleteWorkshop(workshopId: string, title: string) {
    if (!(await confirm({ title: t('cyclone.shell.deleteWorkshopTitle', { title }), message: t('cyclone.shell.deleteWorkshopMessage'), confirmText: t('common.delete'), danger: true }))) return;
    if (activeWid === workshopId) rooms.forEach(room => seatRunners.kill(workshopId, chairStreamKey(room.id)));
    const response = await fetch(`/api/cyclone/workshop/${workshopId}/delete`, { method: 'POST' });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.deleteWorkshopFailed'))); return; }
    if (activeWid === workshopId) { setActiveWid(null); setView(null); setSeats([]); setRooms([]); setChairOpen(false); }
    await refreshWorkshops();
  }
  async function createSeat(draft: SeatDraft) {
    if (!activeWid) return;
    const response = await fetch(`/api/cyclone/workshop/${activeWid}/add-seat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
    });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.addSeatFailed'))); return; }
    const seat = await response.json(); await refreshWorkshops(); await loadWorkshop(activeWid);
    openWorkspaceView({ kind: 'seat', id: seat.id, title: seat.title });
  }
  async function openEditSeat(seatId: string) {
    if (!activeWid) return;
    setView({ kind: 'loading-seat', id: seatId });
    const response = await fetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/status`);
    if (!response.ok) {
      const error = await readCycloneError(response, t('cyclone.shell.loadSeatFailed'));
      setView(current => current?.kind === 'loading-seat' && current.id === seatId ? { ...current, error } : current);
      return;
    }
    const seat = await response.json();
    const draft: SeatDraft = { agentId: seat.agentId, title: seat.title, rolePrompt: seat.rolePrompt || '', duty: seat.duty || '', overrideAgentRole: !!seat.overrideAgentRole };
    setView(current => resolveLoadedSeatEditor(current, seatId, draft));
  }
  async function editSeat(seatId: string, draft: SeatDraft) {
    if (!activeWid) return;
    const response = await fetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/update-role`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
    });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.saveSeatFailed'))); return; }
    await loadWorkshop(activeWid); openWorkspaceView({ kind: 'seat', id: seatId, title: draft.title });
  }
  async function deleteSeat(seatId: string, title: string) {
    if (!activeWid || !(await confirm({ title: t('cyclone.shell.deleteSeatTitle', { title }), message: t('cyclone.shell.deleteSeatMessage'), confirmText: t('common.delete'), danger: true }))) return;
    seatRunners.kill(activeWid, seatId);
    const response = await fetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/delete`, { method: 'POST' });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.deleteSeatFailed'))); return; }
    const tab = workspaceTabs.find(item => item.kind === 'seat' && item.id === seatId); if (tab) closeWorkspaceView(tab);
    await refreshWorkshops(); await loadWorkshop(activeWid);
  }
  async function deleteRoom(roomId: string, title: string) {
    if (!activeWid || !(await confirm({ title: t('cyclone.shell.deleteRoomTitle', { title }), message: t('cyclone.shell.deleteRoomMessage'), confirmText: t('common.delete'), danger: true }))) return;
    const workshopId = activeWid;
    const response = await fetch(`/api/cyclone/workshop/${workshopId}/room/${roomId}/delete`, { method: 'POST' });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.deleteRoomFailed'))); return; }
    roomRunners.kill(workshopId, roomId); seatRunners.kill(workshopId, chairStreamKey(roomId));
    const tab = workspaceTabs.find(item => item.kind === 'room' && item.id === roomId); if (tab) closeWorkspaceView(tab);
    if (activeWidRef.current === workshopId) { setChairOpen(false); await loadWorkshop(workshopId); await refreshDispatches(); }
    await refreshWorkshops();
  }
  async function createRoom(config: { title: string; topic: string; mode: 'build' | 'plan'; participantSeatIds: string[];
    intros: Array<{ seatId: string; behavior: 'summary' | 'intro' | 'none' }> }) {
    if (!activeWid) return;
    const response = await fetch(`/api/cyclone/workshop/${activeWid}/create-room`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
    });
    if (!response.ok) { alert(await readCycloneError(response, t('cyclone.shell.createRoomFailed'))); return; }
    const room = await response.json(); await loadWorkshop(activeWid);
    openWorkspaceView({ kind: 'room', id: room.id, title: room.title });
    if (config.intros.some(item => item.behavior !== 'none')) roomRunners.startIntro(activeWid, room.id, config.intros);
  }

  if (!active) return null;
  return <div style={{ display: 'flex', height: '100%' }}>
    <CycloneSidebar workshops={workshops} activeWid={activeWid} seats={seats} rooms={rooms} view={view}
      status={workspaceStatus}
      onCreateWorkshop={() => setView({ kind: 'create-workshop' })}
      onSelectWorkshop={id => { setActiveWid(id); setWorkspaceTabs([]); setView(null); }}
      onDeleteWorkshop={(id, title) => void deleteWorkshop(id, title)} onOpenWorkspace={() => void openWorkshopWorkspace()}
      onCreateSeat={() => setView({ kind: 'create-seat' })} onOpenSeat={seat => openSeat(seat.id)}
      onEditSeat={id => void openEditSeat(id)} onDeleteSeat={(id, title) => void deleteSeat(id, title)}
      onCreateRoom={() => setView({ kind: 'create-room' })} onOpenRoom={room => openWorkspaceView({ kind: 'room', ...room })}
      onDeleteRoom={(id, title) => void deleteRoom(id, title)} />
    <CycloneWorkspacePane active={!!active} agents={agents} activeWid={activeWid} workshops={workshops} seats={seats}
      rooms={rooms} bulletin={bulletin} dispatches={dispatches} view={view} tabs={workspaceTabs}
      status={workspaceStatus}
      chairAgentId={chairAgentId} chairOpen={chairOpen} seatRunners={seatRunners} roomRunners={roomRunners}
      dispatchAction={dispatchAction} setView={setView} onCreateWorkshop={createWorkshop}
      onCreateSeat={createSeat} onRetrySeat={id => void openEditSeat(id)}
      onEditSeat={editSeat} onCreateRoom={createRoom}
      onSelectTab={tab => tab ? openWorkspaceView(tab) : setView(null)} onCloseTab={closeWorkspaceView}
      onOpenSeat={openSeat}
      onWorkshopReload={() => { if (activeWid) void loadWorkshop(activeWid); }}
      onWorkshopsReload={() => void refreshWorkshops()} onBulletinSaved={setBulletin}
      onChairToggle={() => setChairOpen(open => !open)} onSetChair={agentId => void setChair(agentId)} />
  </div>;
}
