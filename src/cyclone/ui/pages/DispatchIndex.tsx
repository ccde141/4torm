import { useState } from 'react';
import type { CycloneDispatch } from './dispatch-timeline';
import { countPendingDispatches } from './dispatch-timeline';

export default function DispatchIndex({ dispatches, onSelect }: {
  dispatches: CycloneDispatch[];
  onSelect: (item: CycloneDispatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = countPendingDispatches(dispatches);
  const active = dispatches.filter(item => item.status === 'queued' || item.status === 'running').length;

  return (
    <div className="cyclone-dispatch-index">
      <button type="button" className="cyclone-dispatch-index__trigger" aria-expanded={open}
        onClick={() => setOpen(value => !value)} title="查看本群聊的异步任务">
        <span className={active ? 'cyclone-dispatch__dot cyclone-dispatch__dot--active' : 'cyclone-dispatch__dot'} />
        异步任务
        {pending > 0 && <span className="cyclone-dispatch-index__count">{pending}</span>}
      </button>
      {open && (
        <div className="cyclone-dispatch-index__menu" role="menu">
          {dispatches.length === 0 && <div className="cyclone-dispatch-index__empty">暂无异步任务</div>}
          {[...dispatches].reverse().map(item => (
            <button key={item.id} type="button" role="menuitem" onClick={() => { setOpen(false); onSelect(item); }}>
              <span>{item.targetSeatTitle}</span>
              <small>{item.task}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
