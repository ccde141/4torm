import { useState } from 'react';
import { ConsoleEvents } from './ConsoleEvents';
import { useConsoleText } from './console-text';
import { useSeatHistory } from './useSeatHistory';
import type { ConsoleEvent, SeatHistoryFilter } from './workshop-console-model';

export function SeatHistory({ workshopId, seatId, onOpen }: {
  workshopId: string; seatId: string; onOpen(event: ConsoleEvent): void;
}) {
  const text = useConsoleText();
  const [filter, setFilter] = useState<SeatHistoryFilter>('all');
  const { page, busy, error, stale, refresh, loadMore } = useSeatHistory(workshopId, seatId, filter);
  const filters: Array<[SeatHistoryFilter, string]> = [['all', text('全部', 'All')],
    ['work', text('工作活动', 'Work activity')], ['changes', text('岗位变更', 'Seat changes')]];
  return <section className="cy-seat-history" aria-label={text('工位履历', 'Seat history')}>
    <div className="cy-seat-intro"><h3>{text('履历', 'History')}</h3>
      <p>{text('执行、联络、派发与岗位资料变更。', 'Runs, contacts, dispatches and seat resource changes.')}</p></div>
    <div className="cy-seat-history__toolbar"><div className="cy-console-filters" aria-label={text('筛选履历', 'Filter history')}>
      {filters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value}
        onClick={() => setFilter(value)}>{label}</button>)}</div>
      <button type="button" className="cy-console-link" onClick={refresh} disabled={!!busy}>
        {busy === 'read' ? text('读取中…', 'Loading…') : text('刷新履历', 'Refresh history')}</button></div>
    {!page && busy && <p role="status" className="cy-console-muted">{text('正在读取履历…', 'Loading history…')}</p>}
    {page && <ConsoleEvents events={page.items} detailed onOpen={onOpen} />}
    {stale && <div className="cy-seat-history__updated" role="status"><span>{text('有新记录', 'New records available')}</span>
      <button type="button" className="cy-console-link" onClick={refresh} disabled={!!busy}>{text('读取最新履历', 'Read latest history')}</button></div>}
    {error && <p role="alert" className="cy-console-error">{error}</p>}
    {page && <div className="cy-seat-history__footer"><span>{text(`已显示 ${page.items.length} / ${page.total} 条`, `Showing ${page.items.length} of ${page.total}`)}</span>
        {page.nextCursor && <button type="button" className="cy-console-button" disabled={!!busy || stale} onClick={loadMore}>
          {busy === 'more' ? text('读取中…', 'Loading…') : text('加载更早记录', 'Load earlier records')}</button>}</div>}
    {!page && !busy && error && <button type="button" className="cy-console-button" onClick={refresh}>{text('重新读取', 'Retry')}</button>}
  </section>;
}
