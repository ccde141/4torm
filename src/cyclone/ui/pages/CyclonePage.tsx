import { backendFetch } from '../../../lib/backend-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { useLocale } from '../../../i18n/LocaleContext';
import { closeWorkspaceTab, openWorkspaceTab, reconcileWorkspaceTabs,
  tabKey, type WorkspaceTab } from '../organization/workspace-tabs';
import { chairStreamKey } from './ChairDrawer';
import { CycloneSidebar } from './CycloneSidebar';
import { CycloneWorkspacePane } from './CycloneWorkspacePane';
import { readCycloneError, type CycloneView } from './cyclone-page-model';
import { projectWorkspaceStatus } from './cyclone-workspace-status';
import { resolveLoadedSeatEditor } from './seat-editor-state';
import type { SeatDraft } from './SeatPanel';
import { useRoomStreamRunners } from './useRoomStreamRunners';
import { useSeatStreamRunners } from './useSeatStreamRunners';
import { useWorkshopDispatches } from './useWorkshopDispatches';
import { useRoomExternalActivity } from './useRoomExternalActivity';
import { useCycloneCatalog } from './useCycloneCatalog';
import { useWorkshopSummary } from './useWorkshopSummary';
import { useWorkshopOperationStatus } from './useWorkshopOperationStatus';
import {
  addCycloneSeat,
  createCycloneRoom,
  deleteCycloneRoom,
  deleteCycloneSeat,
  deleteCycloneWorkshop,
  openCycloneWorkspace,
  setCycloneChair,
  updateCycloneSeat,
} from './cyclone-control-client';
import type { CycloneEntityReceipt } from './cyclone-control-client';
import '../../../styles/components/cyclone.css';
import { useCycloneActivityNavigation } from './useCycloneActivityNavigation';
import { useSupervisorStreamRunners } from './useSupervisorStreamRunners';
export default function CyclonePage({ active, preselectOperation, onClearPreselect }: {
  active?: boolean; preselectOperation?: string | null;
  onClearPreselect?: () => void;
}) {
  const { t, locale } = useLocale();
  const confirm = useConfirm();
  const { agents, workshops, workshopsLoaded, refreshWorkshops } = useCycloneCatalog(active);
  const [activeWid, setActiveWid] = useState<string | null>(null);
  const { seats, rooms, chairAgentId, bulletin, loadedWorkshopId,
    error: workshopError, refresh: loadWorkshop, setBulletin } = useWorkshopSummary(activeWid, !!active);
  const { operations: workshopOperations, uncertain: workshopUncertain,
    error: operationError } = useWorkshopOperationStatus(activeWid, !!active);
  const [chairOpen, setChairOpen] = useState(false);
  const [, forceChairRunTick] = useState(0);
  const [, forceTabStatusTick] = useState(0);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [view, setView] = useState<CycloneView>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const supervisorRunners = useSupervisorStreamRunners(activeWid, view?.kind === 'supervisor', locale);
  const activeWidRef = useRef(activeWid); activeWidRef.current = activeWid;
  const activeRoomId = view?.kind === 'room' ? view.id : null;
  const visibleSeatId = view?.kind === 'seat' ? view.id : null;

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
  const localRoomStreaming = !!(activeRoomId && roomRunners.getRunner(activeRoomId)?.streaming);
  const externalEnabled = !!active && !!activeWid && !!activeRoomId && !localRoomStreaming;
  const externalRoom = useRoomExternalActivity(activeWid ?? '', activeRoomId ?? '', externalEnabled, locale, localRoomStreaming);
  const subscribeSeat = seatRunners.subscribe;
  const subscribeRoom = roomRunners.subscribe;
  const workspaceStatus = projectWorkspaceStatus({
    seats, rooms, dispatches, operations: workshopOperations, uncertain: workshopUncertain,
    getSeatRunner: seatRunners.getRunner,
    getRoomRunner: roomRunners.getRunner, chairKey: chairStreamKey,
    externalRoom: activeRoomId && externalRoom.activity?.operationId === `room:${activeWid}:${activeRoomId}`
      ? { roomId: activeRoomId, running: externalRoom.activity.running && !externalRoom.error,
        status: externalRoom.fact?.status }
      : externalRoom.fact && activeRoomId
        && externalRoom.fact.operationId === `room:${activeWid}:${activeRoomId}`
        ? { roomId: activeRoomId, running: false, status: externalRoom.fact.status }
        : undefined,
  });

  useEffect(() => {
    if (!workshopsLoaded || !activeWid || workshops.some(item => item.id === activeWid)) return;
    setActiveWid(null); setWorkspaceTabs([]); setView(null);
  }, [activeWid, workshops, workshopsLoaded]);
  useEffect(() => {
    if (!activeWid || loadedWorkshopId !== activeWid) return;
    const available: WorkspaceTab[] = [
      ...seats.map(seat => ({ kind: 'seat' as const, id: seat.id, title: seat.title })),
      ...rooms.map(room => ({ kind: 'room' as const, id: room.id, title: room.title })),
    ];
    const valid = new Set(available.map(tabKey));
    setWorkspaceTabs(current => reconcileWorkspaceTabs(current, available));
    setView(current => current && (current.kind === 'seat' || current.kind === 'room')
      && !valid.has(tabKey(current)) ? null : current);
    const currentView = viewRef.current;
    if (currentView?.kind === 'room' && !valid.has(tabKey(currentView))) setChairOpen(false);
  }, [activeWid, loadedWorkshopId, rooms, seats]);
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
  const activityNavigationError = useCycloneActivityNavigation({
    active, preselectOperation, onClearPreselect, workshopsLoaded, workshops,
    activeWid, setActiveWid, loadedWorkshopId, seats, rooms, openWorkspaceView,
  });
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
    if (!await runControl(
      () => setCycloneChair(activeWid, agentId), t('cyclone.shell.setChairFailed'),
    )) return;
    await loadWorkshop(activeWid);
  }
  async function workshopCreated(workshop: CycloneEntityReceipt) {
    await refreshWorkshops(); setActiveWid(workshop.id); setView(null);
  }
  async function openWorkshopWorkspace() {
    if (!activeWid) return;
    await runControl(
      () => openCycloneWorkspace(activeWid), t('cyclone.shell.openWorkspaceFailed'),
    );
  }
  async function deleteWorkshop(workshopId: string, title: string) {
    if (!(await confirm({ title: t('cyclone.shell.deleteWorkshopTitle', { title }), message: t('cyclone.shell.deleteWorkshopMessage'), confirmText: t('common.delete'), danger: true }))) return;
    if (activeWid === workshopId) rooms.forEach(room => seatRunners.kill(chairStreamKey(room.id)));
    if (!await runControl(
      () => deleteCycloneWorkshop(workshopId), t('cyclone.shell.deleteWorkshopFailed'),
    )) return;
    if (activeWid === workshopId) { setActiveWid(null); setView(null); setChairOpen(false); }
    await refreshWorkshops();
  }
  async function createSeat(draft: SeatDraft) {
    if (!activeWid) return;
    const seat = await runControl(
      () => addCycloneSeat(activeWid, draft), t('cyclone.shell.addSeatFailed'),
    );
    if (!seat) return;
    await refreshWorkshops(); await loadWorkshop(activeWid);
    openWorkspaceView({ kind: 'seat', id: seat.id, title: seat.title });
  }
  async function openEditSeat(seatId: string) {
    if (!activeWid) return;
    setView({ kind: 'loading-seat', id: seatId });
    const response = await backendFetch(`/api/cyclone/workshop/${activeWid}/seat/${seatId}/status`);
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
    if (!await runControl(
      () => updateCycloneSeat(activeWid, seatId, draft), t('cyclone.shell.saveSeatFailed'),
    )) return;
    await loadWorkshop(activeWid); openWorkspaceView({ kind: 'seat', id: seatId, title: draft.title });
  }
  async function deleteSeat(seatId: string, title: string) {
    if (!activeWid || !(await confirm({ title: t('cyclone.shell.deleteSeatTitle', { title }), message: t('cyclone.shell.deleteSeatMessage'), confirmText: t('common.delete'), danger: true }))) return;
    seatRunners.kill(seatId);
    if (!await runControl(
      () => deleteCycloneSeat(activeWid, seatId), t('cyclone.shell.deleteSeatFailed'),
    )) return;
    const tab = workspaceTabs.find(item => item.kind === 'seat' && item.id === seatId); if (tab) closeWorkspaceView(tab);
    await refreshWorkshops(); await loadWorkshop(activeWid);
  }
  async function deleteRoom(roomId: string, title: string) {
    if (!activeWid || !(await confirm({ title: t('cyclone.shell.deleteRoomTitle', { title }), message: t('cyclone.shell.deleteRoomMessage'), confirmText: t('common.delete'), danger: true }))) return;
    const workshopId = activeWid;
    if (!await runControl(
      () => deleteCycloneRoom(workshopId, roomId), t('cyclone.shell.deleteRoomFailed'),
    )) return;
    roomRunners.kill(roomId); seatRunners.kill(chairStreamKey(roomId));
    const tab = workspaceTabs.find(item => item.kind === 'room' && item.id === roomId); if (tab) closeWorkspaceView(tab);
    if (activeWidRef.current === workshopId) { setChairOpen(false); await loadWorkshop(workshopId); await refreshDispatches(); }
    await refreshWorkshops();
  }
  async function createRoom(config: { title: string; topic: string; mode: 'build' | 'plan'; participantSeatIds: string[];
    intros: Array<{ seatId: string; behavior: 'summary' | 'intro' | 'none' }> }) {
    if (!activeWid) return;
    const room = await runControl(
      () => createCycloneRoom(activeWid, config), t('cyclone.shell.createRoomFailed'),
    );
    if (!room) return;
    await loadWorkshop(activeWid);
    openWorkspaceView({ kind: 'room', id: room.id, title: room.title });
    if (config.intros.some(item => item.behavior !== 'none')) roomRunners.startIntro(activeWid, room.id, config.intros);
  }

  if (!active) return null;
  return <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
    {(activityNavigationError || workshopError || operationError) && <p role="alert" className="agent-detail__error"
      style={{ position: 'absolute', top: 8, right: 18, zIndex: 2 }}>
      {activityNavigationError || workshopError || operationError}</p>}
    <CycloneSidebar workshops={workshops} activeWid={activeWid} seats={seats} rooms={rooms} view={view}
      status={workspaceStatus}
      onCreateWorkshop={() => setView({ kind: 'create-workshop' })}
      onOpenSupervisor={() => setView({ kind: 'supervisor' })}
      onSelectWorkshop={id => { setActiveWid(id); setWorkspaceTabs([]); setView(null); }}
      onDeleteWorkshop={(id, title) => void deleteWorkshop(id, title)} onOpenWorkspace={() => void openWorkshopWorkspace()}
      onCreateSeat={() => setView({ kind: 'create-seat' })} onOpenSeat={seat => openSeat(seat.id)}
      onEditSeat={id => void openEditSeat(id)} onDeleteSeat={(id, title) => void deleteSeat(id, title)}
      onCreateRoom={() => setView({ kind: 'create-room' })} onOpenRoom={room => openWorkspaceView({ kind: 'room', ...room })}
      onDeleteRoom={(id, title) => void deleteRoom(id, title)} />
    <CycloneWorkspacePane active={!!active} agents={agents} activeWid={activeWid}
      workshopLoaded={activeWid !== null && loadedWorkshopId === activeWid} workshops={workshops} seats={seats}
      rooms={rooms} bulletin={bulletin} dispatches={dispatches} view={view} tabs={workspaceTabs}
      status={workspaceStatus} statusError={operationError}
      chairAgentId={chairAgentId} chairOpen={chairOpen} seatRunners={seatRunners} roomRunners={roomRunners}
      supervisorRunners={supervisorRunners}
      externalRoom={externalRoom}
      dispatchAction={dispatchAction} setView={setView} onWorkshopCreated={workshopCreated}
      onCreateSeat={createSeat} onRetrySeat={id => void openEditSeat(id)}
      onEditSeat={editSeat} onCreateRoom={createRoom}
      onSelectTab={tab => tab ? openWorkspaceView(tab) : setView(null)} onCloseTab={closeWorkspaceView}
      onOpenSeat={openSeat}
      onWorkshopReload={() => { if (activeWid) void loadWorkshop(activeWid); }}
      onWorkshopsReload={() => void refreshWorkshops()} onBulletinSaved={setBulletin}
      onChairToggle={() => setChairOpen(open => !open)} onSetChair={agentId => void setChair(agentId)} />
  </div>;
}

async function runControl<T>(action: () => Promise<T>, fallback: string): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    alert(`${fallback}: ${(error as Error).message}`);
    return undefined;
  }
}
