import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Agent } from '../../../types';
import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';
import { SeatHistory } from './SeatHistory';
import { ConsoleIcon } from './ConsoleIcon';
import { ConsoleStatus } from './ConsoleStatus';
import { SeatConfigEditor } from './SeatConfigEditor';
import { SeatMemoryEditor } from './SeatMemoryEditor';
import { SeatInheritedCapabilities } from './SeatInheritedCapabilities';
import { SeatCollaborationEditor } from './SeatCollaborationEditor';
import { SeatDetailNavigation } from './SeatDetailNavigation';
import { useSeatDetailMotion } from './useSeatDetailMotion';
import { WorkshopSeatCard } from './WorkshopSeatCard';
import { formatConsoleTime, useConsoleText } from './console-text';
import { consoleEventSection, type ConsoleEvent, type ConsoleSeat, type ConsoleSection, type WorkshopConsoleSnapshot } from './workshop-console-model';

export function WorkshopSeatDetails({ workshop, seat, status, agents, initialSection = 'overview', onClose, onChat, onOpenEvent, onChanged }: {
  workshop: WorkshopConsoleSnapshot; seat: ConsoleSeat; status: WorkspaceEntityStatus; agents: Agent[];
  initialSection?: ConsoleSection;
  onClose(): void; onChat(): void; onOpenEvent(event: ConsoleEvent): void; onChanged(): void;
}) {
  const text = useConsoleText();
  const titleId = useId();
  const content = useRef<HTMLDivElement>(null);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const { dialog, phase, close } = useSeatDetailMotion(seat.id, () => {
    onClose(); afterClose.current?.();
  });
  const [section, setSection] = useState<ConsoleSection>(initialSection);
  const [memoryVisited, setMemoryVisited] = useState(initialSection === 'memory');
  const sections: Array<[ConsoleSection, string]> = [
    ['overview', text('工位概览', 'Overview')], ['recent', text('履历', 'History')],
    ['stats', text('工位统计', 'Seat statistics')], ['config', text('配置与提示词', 'Configuration & prompt')],
    ['memory', text('工位记忆', 'Seat memory')], ['inherited', text('继承能力', 'Inherited capabilities')],
    ['collaboration', text('工作室协作', 'Workshop collaboration')],
  ];
  function closeThen(action: () => void) { afterClose.current = action; close(); }
  const openChat = () => closeThen(onChat);
  function select(next: ConsoleSection) {
    setSection(next); content.current?.scrollTo({ top: 0 });
    if (next === 'memory') setMemoryVisited(true);
  }
  function openEvent(event: ConsoleEvent) {
    const next = consoleEventSection(event);
    if (next && event.seatId === seat.id) select(next);
    else closeThen(() => onOpenEvent(event));
  }
  return createPortal(<dialog ref={dialog} className="cy-seat-dialog" data-phase={phase} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="cy-seat-detail__card-preview" inert aria-hidden="true">
      <WorkshopSeatCard seat={seat} status={status} preview onDetails={close} onChat={close} />
    </div>
    <div className="cy-seat-detail" inert={phase !== 'open'}><header className="cy-seat-detail__head">
      <span className="cy-console-avatar">{seat.title.slice(0, 1)}</span>
      <div className="cy-seat-detail__identity"><small>WORKSHOP SEAT / {seat.id}</small>
        <h2 id={titleId}>{seat.title}</h2><p>{text('绑定 Agent', 'Bound Agent')} · {seat.capabilities.agentName || seat.agentId}</p></div>
      <ConsoleStatus status={status} />
      <button type="button" className="cy-console-icon-button cy-seat-detail__close" onClick={close}
        aria-label={text('关闭工位详情', 'Close seat details')}><ConsoleIcon name="close" /></button>
    </header><div className="cy-seat-detail__body"><aside className="cy-seat-detail__sidebar">
      <SeatDetailNavigation sections={sections} active={section} onSelect={select} label={text('工位详情', 'Seat details')} />
      <div className="cy-seat-detail__scope">{text('所属工作室', 'Workshop')}<strong>{workshop.title}</strong></div>
    </aside><div className="cy-seat-detail__right"><header><h3>{sections.find(([key]) => key === section)?.[1]}</h3>
      <button type="button" className="cy-console-link" onClick={openChat}><ConsoleIcon name="chat" />{text('打开会话', 'Open chat')}</button>
    </header><div ref={content} className="cy-seat-detail__scroll">
      {seat.error && <p role="alert" className="cy-console-error">{seat.error}</p>}
      {section === 'overview' && <SeatOverview seat={seat} workshop={workshop} select={select} onChat={openChat} />}
      {section === 'recent' && <SeatHistory workshopId={workshop.workshopId} seatId={seat.id} onOpen={openEvent} />}
      {section === 'stats' && <SeatStatistics seat={seat} workshop={workshop} />}
      <div hidden={section !== 'config'}><SeatConfigEditor workshopId={workshop.workshopId} seat={seat} agents={agents} onChanged={onChanged} /></div>
      {memoryVisited && <div hidden={section !== 'memory'}><SeatMemoryEditor workshopId={workshop.workshopId} seatId={seat.id} onChanged={onChanged} /></div>}
      {section === 'inherited' && <SeatInheritedCapabilities seat={seat} />}
      <div hidden={section !== 'collaboration'}><SeatCollaborationEditor workshopId={workshop.workshopId} title={workshop.title}
        seat={seat} seats={workshop.seats} onChanged={onChanged} /></div>
    </div></div></div></div>
  </dialog>, document.body);
}

function SeatOverview({ seat, workshop, select, onChat }: {
  seat: ConsoleSeat; workshop: WorkshopConsoleSnapshot; select(section: ConsoleSection): void; onChat(): void;
}) {
  const text = useConsoleText();
  return <><div className="cy-seat-intro"><h3>{text('岗位职责', 'Seat duties')}</h3>
    <p>{seat.duty || text('尚未设置岗位职责', 'No duty set')}</p></div>
    <div className="cy-seat-overview-grid"><div><span className="cy-console-eyebrow">{text('最近事项', 'Latest activity')}</span>
      <p>{seat.recent[0]?.title || text('还没有工作记录', 'No activity yet')}</p>
      <button type="button" className="cy-console-link" onClick={() => select('recent')}>{text('查看履历', 'View history')} →</button></div>
      <div><span className="cy-console-eyebrow">{text('工作资料', 'Project materials')}</span><p>{text('项目共享工作区', 'Shared project workspace')}</p>
        <code>{workshop.workspacePath}</code></div></div>
    <section className="cy-seat-section"><h4>{text('工位资料', 'Seat resources')}</h4>
      <div className="cy-seat-continuity"><p>{text('岗位职责与提示词', 'Duty and seat prompt')}<button type="button" className="cy-console-link" onClick={() => select('config')}>{text('查看', 'View')}</button></p>
        <p>{text('工位记忆', 'Seat memory')}<button type="button" className="cy-console-link" onClick={() => select('memory')}>{text('查看', 'View')}</button></p>
        <p>{text('工位私聊与工作过程', 'Private conversation and work history')}<button type="button" className="cy-console-link" onClick={onChat}>{text('打开', 'Open')}</button></p></div></section>
    <section className="cy-seat-section"><h4>{text('工位统计', 'Seat statistics')}</h4><SeatMetrics seat={seat} /></section>
  </>;
}

function SeatStatistics({ seat, workshop }: { seat: ConsoleSeat; workshop: WorkshopConsoleSnapshot }) {
  const text = useConsoleText();
  return <><div className="cy-seat-intro"><h3>{text('工作记录统计', 'Work record statistics')}</h3>
    <p>{workshop.title} · {seat.title}</p></div><SeatMetrics seat={seat} />
    <dl className="cy-seat-facts"><dt>{text('工位', 'Seat')}</dt><dd>{seat.title}</dd>
      <dt>{text('所属工作室', 'Workshop')}</dt><dd>{workshop.title}</dd>
      <dt>{text('创建时间', 'Created')}</dt><dd>{formatConsoleTime(seat.createdAt, true)}</dd>
      <dt>{text('更新时间', 'Updated')}</dt><dd>{formatConsoleTime(seat.updatedAt, true)}</dd>
      <dt>{text('最近刷新', 'Last refreshed')}</dt><dd>{formatConsoleTime(workshop.capturedAt, true)}</dd></dl>
    <p className="cy-console-muted">{text('执行记录包含工位会话与工位联络。', 'Execution records include seat conversations and contacts.')}</p>
  </>;
}

function SeatMetrics({ seat }: { seat: ConsoleSeat }) {
  const text = useConsoleText();
  return <div className="cy-seat-metrics">{[[seat.stats.executionCount, text('执行记录', 'Execution records')],
    [seat.stats.dispatchCount, text('派发记录', 'Dispatch records')], [seat.stats.memoryCount ?? '—', text('工位记忆', 'Seat memories')]].map(([value, title]) =>
    <div key={title}><strong>{value}</strong><small>{title}</small></div>)}</div>;
}
