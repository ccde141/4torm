import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';
import type { ConsoleSeat } from './workshop-console-model';
import { ConsoleIcon } from './ConsoleIcon';
import { ConsoleStatus } from './ConsoleStatus';
import { formatConsoleTime, useConsoleText } from './console-text';

export function WorkshopSeatCard({ seat, status, expanded = false, preview = false, onDetails, onChat }: {
  seat: ConsoleSeat; status: WorkspaceEntityStatus; expanded?: boolean; preview?: boolean; onDetails(): void; onChat(): void;
}) {
  const text = useConsoleText();
  const recent = seat.recent[0];
  return <article data-cy-seat-card={preview ? undefined : seat.id} className={`cy-seat-card ${status}${expanded ? ' cy-seat-card--expanded' : ''}`}>
    <button type="button" className="cy-seat-card__main" onClick={onDetails}
      aria-expanded={expanded}
      aria-label={text(`查看${seat.title}详情`, `View ${seat.title} details`)}>
      <div className="cy-seat-card__head">
        <span className="cy-console-avatar">{seat.title.slice(0, 1)}</span>
        <div className="cy-seat-card__name"><h3>{seat.title}</h3>
          <small>{text('绑定', 'Bound to')} {seat.capabilities.agentName || seat.agentId}</small></div>
        <ConsoleStatus status={status} />
      </div>
      <p className="cy-seat-card__duty" title={seat.duty}>{seat.duty || text('尚未设置岗位职责', 'No duty set')}</p>
      <div className="cy-seat-card__current"><div><span>{text('最近事项', 'Latest activity')}</span>
        <time dateTime={recent?.updatedAt}>{recent ? formatConsoleTime(recent.updatedAt) : '—'}</time></div>
        <p>{recent?.title || text('还没有工作记录', 'No activity yet')}</p></div>
      <div className="cy-seat-card__metrics">
        <span><b>{seat.stats.executionCount}</b>{text('执行记录', 'run records')}</span>
        <span><b>{seat.stats.dispatchCount}</b>{text('派发', 'dispatches')}</span>
        <span><b>{seat.stats.memoryCount ?? '—'}</b>{text('记忆', 'memories')}</span>
      </div>
      <p className="cy-seat-card__model"><span>{text('继承模型', 'Inherited model')}</span>
        {seat.capabilities.available ? seat.capabilities.model || '—' : text('绑定 Agent 不可用', 'Bound Agent unavailable')}</p>
      {seat.error && <p className="cy-console-error">{seat.error}</p>}
    </button>
    <div className="cy-seat-card__footer"><button type="button" onClick={onDetails}>
      {text('工位详情', 'Seat details')}<ConsoleIcon name="arrow" /></button>
      <button type="button" onClick={onChat}><ConsoleIcon name="chat" />{text('打开会话', 'Open chat')}</button></div>
  </article>;
}
