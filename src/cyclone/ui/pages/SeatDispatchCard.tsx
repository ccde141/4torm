import { useState } from 'react';
import { renderTextWithCode } from '../../../engine/markdown';
import type { CycloneDispatch } from './dispatch-timeline';
import { formatSeatDispatchActivity } from './seat-dispatch-activity';

const STATUS_LABEL: Record<CycloneDispatch['status'], string> = {
  queued: '等待目标工位',
  running: '目标工位执行中',
  awaiting_human: '目标工位等待回答',
  completed: '异步任务已完成',
  failed: '异步任务失败',
};

export function SeatOutboundDispatch({ item }: { item: CycloneDispatch }) {
  const active = item.status === 'queued' || item.status === 'running';
  const activity = active ? formatSeatDispatchActivity(item) : null;
  return (
    <article className="cyclone-dispatch cyclone-seat-dispatch" role="status">
      <header className="cyclone-dispatch__header">
        <span className={`cyclone-dispatch__dot${active ? ' cyclone-dispatch__dot--active' : ''}`} />
        <strong>{STATUS_LABEL[item.status]}</strong>
        <span className="cyclone-dispatch__target">→ {item.targetSeatTitle}</span>
      </header>
      <div className="cyclone-dispatch__task">{item.task}</div>
      {activity && (
        <div className="cyclone-dispatch__activity">
          <span className="cyclone-dispatch__dot cyclone-dispatch__dot--active" />
          <span>{activity.label}</span>
          {activity.target && <code title={activity.target}>{activity.target}</code>}
        </div>
      )}
      {item.status === 'completed' && item.response && (
        <div className="cyclone-dispatch__result">{item.response}</div>
      )}
      {item.status === 'failed' && (
        <div className="cyclone-dispatch__error">{item.error || '派发执行失败'}</div>
      )}
    </article>
  );
}

export function SeatDispatchReceipt({ content, id }: { content: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat__message chat__message--user cyclone-dispatch-result cyclone-seat-receipt">
      <div className="chat__bubble">
        <button type="button" className="cyclone-dispatch-result__trigger"
          aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <span className="cyclone-dispatch__arrow">{open ? '▼' : '▶'}</span>
          <strong>异步任务回执</strong>
        </button>
        {open && (
          <div className="chat__content cyclone-dispatch-result__body md-bubble">
            {renderTextWithCode(content, id)}
          </div>
        )}
      </div>
    </div>
  );
}
