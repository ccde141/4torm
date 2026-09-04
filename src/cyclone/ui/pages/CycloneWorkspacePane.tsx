import type { Dispatch, SetStateAction } from 'react';
import type { Agent } from '../../../types';
import { useLocale } from '../../../i18n/LocaleContext';
import { OrganizationWorkspace } from '../organization/OrganizationWorkspace';
import { WorkshopTabs, type WorkspaceTabStatus } from '../organization/WorkshopTabs';
import { tabKey, type WorkspaceTab } from '../organization/workspace-tabs';
import CreateRoomPanel from './CreateRoomPanel';
import CreateWorkshopPanel from './CreateWorkshopPanel';
import SeatPanel, { type SeatDraft } from './SeatPanel';
import SeatEditorLoading from './SeatEditorLoading';
import SeatChat from './SeatChat';
import RoomPanel from './RoomPanel';
import ChairDrawer, { chairStreamKey } from './ChairDrawer';
import type { BulletinEntry } from './BulletinBoard';
import type { CycloneDispatch } from './dispatch-timeline';
import type { RoomStreamRunners } from './useRoomStreamRunners';
import type { SeatStreamRunners } from './useSeatStreamRunners';
import type { WorkshopDispatches } from './useWorkshopDispatches';
import type { CycloneView, RoomSummary, SeatSummary, WorkshopSummary } from './cyclone-page-model';
import type { WorkspaceStatusProjection } from './cyclone-workspace-status';

interface Props {
  active: boolean;
  agents: Agent[];
  activeWid: string | null;
  workshops: WorkshopSummary[];
  seats: SeatSummary[];
  rooms: RoomSummary[];
  bulletin: BulletinEntry[];
  dispatches: CycloneDispatch[];
  view: CycloneView;
  tabs: WorkspaceTab[];
  status: WorkspaceStatusProjection;
  chairAgentId: string | null;
  chairOpen: boolean;
  seatRunners: SeatStreamRunners;
  roomRunners: RoomStreamRunners;
  dispatchAction: WorkshopDispatches['act'];
  setView: Dispatch<SetStateAction<CycloneView>>;
  onCreateWorkshop(config: { title: string; chairAgentId?: string }): Promise<void>;
  onCreateSeat(draft: SeatDraft): Promise<void>;
  onRetrySeat(id: string): void;
  onEditSeat(id: string, draft: SeatDraft): Promise<void>;
  onCreateRoom(config: { title: string; topic: string; mode: 'build' | 'plan'; participantSeatIds: string[];
    intros: Array<{ seatId: string; behavior: 'summary' | 'intro' | 'none' }> }): Promise<void>;
  onSelectTab(tab: WorkspaceTab | null): void;
  onCloseTab(tab: WorkspaceTab): void;
  onOpenSeat(id: string): void;
  onWorkshopReload(): void;
  onWorkshopsReload(): void;
  onBulletinSaved(entries: BulletinEntry[]): void;
  onChairToggle(): void;
  onSetChair(agentId: string): void;
}

export function CycloneWorkspacePane(props: Props) {
  const { t } = useLocale();
  const activeTabKey = props.view?.kind === 'seat' || props.view?.kind === 'room' ? tabKey(props.view) : null;
  const organizationVisible = props.view === null || props.view.kind === 'bulletin';
  const organizationPanel = props.view?.kind === 'bulletin' ? 'bulletin' : 'graph';
  const managementView = props.view !== null && props.view.kind !== 'seat'
    && props.view.kind !== 'room' && props.view.kind !== 'bulletin';
  const loadingSeat = props.view?.kind === 'loading-seat' ? props.view : null;
  const editingSeat = props.view?.kind === 'edit-seat' ? props.view : null;
  const activeRoomId = props.view?.kind === 'room' ? props.view.id : null;
  const statusForTab = (tab: WorkspaceTab): WorkspaceTabStatus => {
    const status = (tab.kind === 'seat' ? props.status.seats : props.status.rooms).get(tab.id) ?? 'idle';
    return status === 'idle' ? null : status;
  };
  return <>
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {props.activeWid && <nav className="cyclone-org-workspace__tabs" aria-label={t('cyclone.org.title')}>
        <button type="button" className={props.view === null ? 'active' : ''}
          onClick={() => props.onSelectTab(null)}>{t('cyclone.org.graph')}</button>
        <button type="button" className={props.view?.kind === 'bulletin' ? 'active' : ''}
          onClick={() => props.setView({ kind: 'bulletin' })}>{t('cyclone.org.bulletin')}</button>
      </nav>}
      {props.activeWid && props.tabs.length > 0 && <WorkshopTabs tabs={props.tabs} activeKey={activeTabKey}
        statusFor={statusForTab} onSelect={props.onSelectTab} onClose={props.onCloseTab} />}
      {props.view?.kind === 'create-workshop' && <CreateWorkshopPanel agents={props.agents}
        onCreate={props.onCreateWorkshop} onCancel={() => props.setView(null)} />}
      {props.view?.kind === 'create-seat' && props.activeWid && <SeatPanel key="create-seat" mode="create"
        agents={props.agents} workshopId={props.activeWid} onSubmit={props.onCreateSeat} onCancel={() => props.setView(null)} />}
      {loadingSeat && <SeatEditorLoading key={`loading-seat-${loadingSeat.id}`}
        error={loadingSeat.error} onRetry={() => props.onRetrySeat(loadingSeat.id)}
        onCancel={() => props.setView({ kind: 'seat', id: loadingSeat.id })} />}
      {editingSeat && props.activeWid && <SeatPanel key={`edit-seat-${editingSeat.id}`} mode="edit"
        agents={props.agents} workshopId={props.activeWid} initial={editingSeat.draft}
        onSubmit={draft => props.onEditSeat(editingSeat.id, draft)} onCancel={() => props.setView({ kind: 'seat', id: editingSeat.id })} />}
      {props.view?.kind === 'create-room' && props.activeWid && <CreateRoomPanel
        seats={props.seats.map(seat => ({ id: seat.id, title: seat.title }))} initialSeatIds={props.view.seatIds}
        onCreate={props.onCreateRoom} onCancel={() => props.setView(null)} />}
      {!props.activeWid && props.view === null && <div style={emptyStyle}>{t('cyclone.shell.empty')}</div>}
      {props.activeWid && <div style={{ display: managementView ? 'none' : 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        <div style={{ display: organizationVisible ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
          <OrganizationWorkspace workshopId={props.activeWid} agents={props.agents}
            title={props.workshops.find(workshop => workshop.id === props.activeWid)?.title} seats={props.seats}
            bulletin={props.bulletin} dispatches={props.dispatches} runners={props.seatRunners}
            seatStatuses={props.status.seats} panel={organizationPanel} active={props.active && organizationVisible}
            onBulletinSaved={props.onBulletinSaved} onRenamed={props.onWorkshopsReload} onOpenSeat={props.onOpenSeat}
          />
        </div>
        {props.tabs.map(tab => <MountedWorkspace key={tabKey(tab)} tab={tab} visible={activeTabKey === tabKey(tab)} props={props} />)}
      </div>}
    </main>
    {props.activeWid && activeRoomId && <ChairDrawer workshopId={props.activeWid} roomId={activeRoomId}
      roomTitle={props.rooms.find(room => room.id === activeRoomId)?.title} chairAgentId={props.chairAgentId}
      agents={props.agents} runners={props.seatRunners} open={props.chairOpen} onToggle={props.onChairToggle}
      onSetChair={props.onSetChair} onReloaded={props.onWorkshopReload} />}
  </>;
}

function MountedWorkspace({ tab, visible, props }: { tab: WorkspaceTab; visible: boolean; props: Props }) {
  if (!props.activeWid) return null;
  if (tab.kind === 'seat') {
    const seat = props.seats.find(item => item.id === tab.id);
    return seat ? <div style={mountedStyle(visible)}><SeatChat workshopId={props.activeWid} seatId={seat.id}
      runners={props.seatRunners} dispatches={props.dispatches} onReloaded={props.onWorkshopReload}
      active={props.active && visible} /></div> : null;
  }
  const room = props.rooms.find(item => item.id === tab.id);
  return room ? <div style={mountedStyle(visible)}><RoomPanel workshopId={props.activeWid} roomId={room.id}
    seats={props.seats.map(seat => ({ id: seat.id, title: seat.title }))} runners={props.roomRunners}
    dispatches={props.dispatches} onDispatchAction={props.dispatchAction}
    settingsLocked={!!props.seatRunners.getRunner(chairStreamKey(room.id))?.streaming
      || props.dispatches.some(item => item.sourceRoomId === room.id && ['queued', 'running', 'awaiting_human'].includes(item.status))}
    onOpenSeat={props.onOpenSeat} onChanged={props.onWorkshopReload} active={props.active && visible} /></div> : null;
}

const emptyStyle: React.CSSProperties = { color: 'var(--color-text-secondary)', margin: 'auto', textShadow: 'var(--text-halo)' };
const mountedStyle = (visible: boolean): React.CSSProperties => ({ display: visible ? 'flex' : 'none', flex: 1, minHeight: 0 });
