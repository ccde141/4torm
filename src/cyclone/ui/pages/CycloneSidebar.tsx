import { useLocale } from '../../../i18n/LocaleContext';
import type { CycloneView, RoomSummary, SeatSummary, WorkshopSummary } from './cyclone-page-model';
import type { WorkspaceEntityStatus, WorkspaceStatusProjection } from './cyclone-workspace-status';
import { PresenceItems } from '../../../components/common/PresenceItems';
import { useConsoleText } from '../console/console-text';

interface Props {
  workshops: WorkshopSummary[];
  activeWid: string | null;
  seats: SeatSummary[];
  rooms: RoomSummary[];
  view: CycloneView;
  status: WorkspaceStatusProjection;
  onCreateWorkshop(): void;
  onSelectWorkshop(id: string): void;
  onDeleteWorkshop(id: string, title: string): void;
  onOpenWorkspace(): void;
  onCreateSeat(): void;
  onOpenSupervisor(): void;
  onOpenSeat(seat: SeatSummary): void;
  onEditSeat(id: string): void;
  onDeleteSeat(id: string, title: string): void;
  onCreateRoom(): void;
  onOpenRoom(room: RoomSummary): void;
  onDeleteRoom(id: string, title: string): void;
}

export function CycloneSidebar(props: Props) {
  const { t } = useLocale();
  const text = useConsoleText();
  return <aside style={leftPanelStyle}>
    <SectionHead label={t('cyclone.shell.workshops')} addLabel={t('cyclone.shell.createWorkshop')} onAdd={props.onCreateWorkshop} />
    <PresenceItems items={props.workshops} getKey={workshop => workshop.id}
      scope="workshops" render={workshop => <div style={itemRow(workshop.id === props.activeWid)}>
      <button type="button" onClick={() => props.onSelectWorkshop(workshop.id)} style={itemMainStyle}>
        <Ellipsis>{workshop.title} <span style={{ opacity: .5 }}>({workshop.seatCount})</span></Ellipsis>
      </button>
      <DeleteButton title={t('cyclone.shell.deleteWorkshop')} label={t('cyclone.shell.deleteWorkshopLabel', { title: workshop.title })}
        onClick={() => props.onDeleteWorkshop(workshop.id, workshop.title)} />
    </div>} />
    {props.activeWid && <button type="button" onClick={props.onOpenWorkspace} className="cyclone__workspace-btn" title={t('cyclone.shell.openWorkspace')}>
      <span className="cyclone__workspace-btn-icon">↗</span><span>{t('cyclone.shell.workspace')}</span>
    </button>}
    {props.activeWid && <>
      <button type="button" onClick={props.onOpenSupervisor} style={{ ...itemRow(props.view?.kind === 'supervisor'),
        marginTop: 'var(--space-3)', width: '100%', cursor: 'pointer' }}>
        <span aria-hidden="true">◇</span><Ellipsis>{text('工作室主管', 'Workshop supervisor')}</Ellipsis>
      </button>
      <SectionHead label={t('cyclone.shell.seats')} addLabel={t('cyclone.shell.addSeat')} onAdd={props.onCreateSeat} />
      <PresenceItems key={`seats:${props.activeWid}`} items={props.seats}
        getKey={seat => seat.id} scope="seats" render={seat =>
        <div style={itemRow(props.view?.kind === 'seat' && props.view.id === seat.id)}>
        <button type="button" onClick={() => props.onOpenSeat(seat)} style={itemMainStyle}>
          <Ellipsis>{seat.title}</Ellipsis>
        </button>
        <StatusMark status={props.status.seats.get(seat.id)} />
        <button onClick={() => props.onEditSeat(seat.id)} style={deleteButtonStyle} title={t('cyclone.shell.seatSettings')}
          aria-label={t('cyclone.shell.seatSettingsLabel', { title: seat.title })}>⚙</button>
        <DeleteButton title={t('cyclone.shell.deleteSeat')} label={t('cyclone.shell.deleteSeatLabel', { title: seat.title })}
          onClick={() => props.onDeleteSeat(seat.id, seat.title)} />
      </div>} />
      <SectionHead label={t('cyclone.shell.rooms')} addLabel={t('cyclone.shell.createRoom')} onAdd={props.onCreateRoom} />
      <PresenceItems key={`rooms:${props.activeWid}`} items={props.rooms}
        getKey={room => room.id} scope="rooms" render={room =>
          <RoomRow room={room} props={props} />} />
    </>}
  </aside>;
}

function RoomRow({ room, props }: { room: RoomSummary; props: Props }) {
  const { t } = useLocale();
  const status = props.status.rooms.get(room.id) ?? 'idle';
  const running = status === 'running' || status === 'waiting' || status === 'unknown';
  return <div style={{ ...itemRow(props.view?.kind === 'room' && props.view.id === room.id), gap: 8 }}>
    <button type="button" onClick={() => props.onOpenRoom(room)} style={itemMainStyle}><Ellipsis># {room.title}</Ellipsis></button>
    <StatusMark status={status} />
    <button disabled={running} onClick={() => props.onDeleteRoom(room.id, room.title)} style={{ ...deleteButtonStyle, opacity: running ? .35 : 1 }}
      title={t('cyclone.shell.deleteRoom')} aria-label={t('cyclone.shell.deleteRoomLabel', { title: room.title })}>×</button>
  </div>;
}

function StatusMark({ status }: { status?: WorkspaceEntityStatus }) {
  const { t } = useLocale();
  if (!status || status === 'idle') return null;
  const glyph = status === 'waiting' || status === 'unknown' ? '?' : status === 'failed' ? '!' : '•';
  const label = { running: t('cyclone.tabs.running'), waiting: t('cyclone.tabs.waiting'),
    unknown: t('cyclone.tabs.unknown'), failed: t('cyclone.tabs.failed'),
    unread: t('cyclone.tabs.unread') }[status];
  return <span className={`cyclone-sidebar-status cyclone-sidebar-status--${status}`}
    title={label} aria-label={label}>{glyph}</span>;
}

function SectionHead({ label, addLabel, onAdd }: { label: string; addLabel: string; onAdd(): void }) {
  return <div style={sectionHeadStyle}><span style={sectionLabelStyle}>{label}</span>
    <button onClick={onAdd} className="icon-add-btn icon-add-btn--sm" title={addLabel} aria-label={addLabel}>+</button></div>;
}

function DeleteButton({ title, label, onClick }: { title: string; label: string; onClick(): void }) {
  return <button onClick={onClick} style={deleteButtonStyle} title={title} aria-label={label}>×</button>;
}

function Ellipsis({ children }: { children: React.ReactNode }) {
  return <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>;
}

const leftPanelStyle: React.CSSProperties = { width: 240, borderRight: '1px solid var(--border-color)', padding: 'var(--space-4)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))' };
const sectionHeadStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-3)', marginBottom: 'var(--space-1)' };
const sectionLabelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-text-secondary)' };
const itemMainStyle: React.CSSProperties = { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', padding: 0, border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' };
const deleteButtonStyle: React.CSSProperties = { width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', cursor: 'pointer', lineHeight: 1, flexShrink: 0, padding: 0 };
function itemRow(active: boolean): React.CSSProperties {
  return { padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', border: `1px solid ${active ? 'var(--color-accent)' : 'transparent'}`, background: active ? 'var(--color-accent-subtle)' : 'transparent', fontWeight: active ? 600 : undefined, transition: 'background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo), color var(--duration-fast) var(--ease-out-expo)', display: 'flex', alignItems: 'center', gap: 4 };
}
