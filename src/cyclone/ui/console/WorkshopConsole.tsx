import { useState } from 'react';
import type { Agent } from '../../../types';
import type { WorkspaceEntityStatus, WorkspaceStatusProjection } from '../pages/cyclone-workspace-status';
import { ConsoleEvents } from './ConsoleEvents';
import { ConsoleIcon } from './ConsoleIcon';
import { WorkshopSeatCard } from './WorkshopSeatCard';
import { WorkshopSeatDetails } from './WorkshopSeatDetails';
import { SeatCardPresence } from './SeatCardPresence';
import { formatConsoleTime, useConsoleText } from './console-text';
import { consoleEventSection, filterConsoleSeats, type ConsoleEvent, type ConsoleFilter, type ConsoleSection } from './workshop-console-model';
import { useWorkshopConsole } from './useWorkshopConsole';
import './workshop-console.css';
import './workshop-seat-details.css';

export function WorkshopConsole({ workshopId, active, status, statusError, agents, onCreateSeat, onOpenSeat, onOpenRoom, onChanged }: {
  workshopId: string; active: boolean; status: WorkspaceStatusProjection; statusError?: string; agents: Agent[];
  onCreateSeat(): void; onOpenSeat(seatId: string): void; onOpenRoom(roomId: string): void; onChanged(): void;
}) {
  const text = useConsoleText();
  const { snapshot, error, refreshing, refresh } = useWorkshopConsole(workshopId, active);
  const [filter, setFilter] = useState<ConsoleFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ seatId: string; section: ConsoleSection } | null>(null);
  const openEvent = (event: ConsoleEvent) => {
    const section = consoleEventSection(event);
    if (section && event.seatId) { setSelected({ seatId: event.seatId, section }); return; }
    setSelected(null);
    if (event.roomId) onOpenRoom(event.roomId);
    else if (event.seatId) onOpenSeat(event.seatId);
  };
  const changed = () => { void refresh(); onChanged(); };
  if (!snapshot) return <section className="cy-console cy-console--loading" aria-busy={refreshing}>
    {error ? <><p role="alert" className="cy-console-error">{error}</p>
      <button type="button" className="cy-console-button" onClick={() => void refresh()}>{text('重新读取', 'Retry')}</button></>
      : <p>{text('正在读取工作室…', 'Loading workshop…')}</p>}
  </section>;
  // A failed probe cannot certify idle seats. Keep saved records, but withdraw live-state certainty.
  const statuses = new Map<string, WorkspaceEntityStatus>(snapshot.seats.map(seat => [seat.id,
    statusError ? 'unknown' : status.seats.get(seat.id) ?? 'unknown']));
  const seats = filterConsoleSeats(snapshot.seats, statuses, filter, search);
  const count = (value: ConsoleFilter) => value === 'all' ? snapshot.seats.length
    : snapshot.seats.filter(seat => statuses.get(seat.id) === value).length;
  const statusIncomplete = !!statusError || count('unknown') > 0;
  const filters: Array<[ConsoleFilter, string]> = [['all', text('全部', 'All')], ['running', text('执行中', 'Running')],
    ['waiting', text('等待你', 'Waiting')], ['idle', text('空闲', 'Idle')]];
  for (const [key, label] of [['unknown', text('状态未知', 'Unknown')], ['failed', text('执行失败', 'Failed')],
    ['unread', text('有新结果', 'New results')]] as const) if (count(key)) filters.push([key, label]);
  const selectedSeat = snapshot.seats.find(seat => seat.id === selected?.seatId);
  return <section className="cy-console">
    <header className="cy-console-heading"><div><div className="cy-console-eyebrow">WORKSHOP / {text('工作台', 'Console')}</div>
      <h2>{snapshot.title}</h2><p>{text('工位概况、工作记录与项目资料', 'Seats, work records and project materials')}</p>
      <div className="cy-console-meta"><span className="cy-console-snapshot">{text('最近刷新', 'Last refreshed')} · {formatConsoleTime(snapshot.capturedAt)}</span></div>
    </div><div className="cy-console-heading__actions"><button type="button" className="cy-console-button" onClick={() => void refresh()} disabled={refreshing}>
      {refreshing ? text('刷新中', 'Refreshing') : text('刷新', 'Refresh')}</button>
      <button type="button" className="cy-console-button primary" onClick={onCreateSeat}><ConsoleIcon name="plus" />{text('新增工位', 'Add seat')}</button></div></header>
    {error && <p role="alert" className="cy-console-notice warning">{error} · {text('已保留上次读取的记录', 'Previously loaded records are retained')}</p>}
    {statusIncomplete && <p role={statusError ? 'alert' : 'status'} className="cy-console-notice warning">
      {statusError && <>{statusError} · </>}{text('工位当前状态尚未完全确认，已有工作记录仍保留。', 'Current seat status is not fully confirmed. Existing work records are retained.')}</p>}
    <div className="cy-console-stats">
      <Metric label={text('工作室工位', 'Workshop seats')} value={snapshot.stats.seatCount} />
      <Metric label={text('执行中', 'Running')} value={statusIncomplete ? null : count('running')} tone="running" />
      <Metric label={text('等待你', 'Waiting')} value={statusIncomplete ? null : count('waiting')} tone="waiting" />
      <Metric label={text('执行记录', 'Execution records')} value={snapshot.stats.executionCount} />
      <Metric label={text('工位记忆', 'Seat memories')} value={snapshot.stats.memoryCount} />
    </div>
    <div className="cy-console-toolbar"><div className="cy-console-filters" aria-label={text('筛选工位', 'Filter seats')}>
      {filters.map(([value, label]) => <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}>
        {label}<b>{statusIncomplete && (value === 'running' || value === 'waiting') ? '—' : count(value)}</b></button>)}</div>
      <label className="cy-console-search"><ConsoleIcon name="search" /><input type="search" value={search} onChange={event => setSearch(event.target.value)}
        aria-label={text('搜索工位、职责或 Agent', 'Search seats, duties or Agents')} placeholder={text('搜索工位、职责或 Agent', 'Search seats or Agents')} /></label></div>
    <div className="cy-console-grid"><SeatCardPresence seats={seats} render={seat => <WorkshopSeatCard seat={seat}
      expanded={active && selected?.seatId === seat.id}
      status={statuses.get(seat.id) ?? 'unknown'} onDetails={() => setSelected({ seatId: seat.id, section: 'overview' })} onChat={() => onOpenSeat(seat.id)} />} /></div>
    {!seats.length && <p className="cy-console-empty">{snapshot.seats.length ? text('没有符合条件的工位', 'No matching seats')
      : text('新增一个工位，开始本项目的持续协作', 'Add a seat to begin this project’s collaboration')}</p>}
    <section className="cy-console-recent"><div className="cy-console-section-title"><h3>{text('最近事项', 'Recent activity')}</h3>
      <small>{snapshot.title}</small></div><ConsoleEvents events={snapshot.recent} onOpen={openEvent} /></section>
    {active && selectedSeat && <WorkshopSeatDetails key={`${workshopId}:${selectedSeat.id}`} workshop={snapshot} seat={selectedSeat} agents={agents}
      initialSection={selected?.section}
      status={statuses.get(selectedSeat.id) ?? 'unknown'} onClose={() => setSelected(null)}
      onChat={() => { setSelected(null); onOpenSeat(selectedSeat.id); }} onOpenEvent={openEvent} onChanged={changed} />}
  </section>;
}

function Metric({ label, value, tone = '' }: { label: string; value: number | null; tone?: string }) {
  return <div className={`cy-console-stat ${tone}`}><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}
