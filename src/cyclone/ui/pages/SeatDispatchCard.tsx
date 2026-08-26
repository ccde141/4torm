import { useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { MessageKey } from '../../../i18n/locale';
import { renderTextWithCode } from '../../../engine/markdown';
import type { CycloneDispatch } from './dispatch-timeline';
import { formatSeatDispatchActivity } from './seat-dispatch-activity';

const STATUS_KEY: Record<CycloneDispatch['status'], MessageKey> = {
  queued: 'cyclone.dispatch.targetStatus.queued',
  running: 'cyclone.dispatch.targetStatus.running',
  awaiting_human: 'cyclone.dispatch.targetStatus.awaitingHuman',
  completed: 'cyclone.dispatch.targetStatus.completed',
  failed: 'cyclone.dispatch.targetStatus.failed',
};

export function SeatOutboundDispatch({ item }: { item: CycloneDispatch }) {
  const { t } = useLocale();
  const active = item.status === 'queued' || item.status === 'running';
  const activity = active ? formatSeatDispatchActivity(item, t) : null;
  return (
    <article className="cyclone-dispatch cyclone-seat-dispatch" role="status">
      <header className="cyclone-dispatch__header">
        <span className={`cyclone-dispatch__dot${active ? ' cyclone-dispatch__dot--active' : ''}`} />
        <strong>{t(STATUS_KEY[item.status])}</strong>
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
        <div className="cyclone-dispatch__error">{item.error || t('cyclone.dispatch.failure')}</div>
      )}
    </article>
  );
}

export function SeatDispatchReceipt({ content, id }: { content: string; id: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <div className="chat__message chat__message--user cyclone-dispatch-result cyclone-seat-receipt">
      <div className="chat__bubble">
        <button type="button" className="cyclone-dispatch-result__trigger"
          aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <span className="cyclone-dispatch__arrow">{open ? '▼' : '▶'}</span>
          <strong>{t('cyclone.dispatch.receipt')}</strong>
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
